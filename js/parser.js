// Разбор сырых записей (уведомления банка, SMS, Apple Pay) по правилам. Чистые функции.
//
// Встроенных банковских правил здесь нет: формат уведомлений не выдумывается.
// Правила хранятся в настройках (хранилище rules) и правятся без пересборки приложения.

import { localIso, uuid } from './model.js';

const MAX_WHOLE_DIGITS = 12;

/**
 * Сумма из текста в минимальные единицы: «4 500», «4 500,50 ₸», «1,234.56», «$19.99».
 * Знак игнорируется: расход это или доход, определяет правило. null, если суммы нет.
 */
export function parseLooseAmount(text) {
  if (text === null || text === undefined) return null;
  const run = String(text).match(/\d[\d\s  '.,]*\d|\d/);
  if (!run) return null;
  const token = run[0].replace(/[\s  ']/g, '');
  const commas = (token.match(/,/g) ?? []).length;
  const dots = (token.match(/\./g) ?? []).length;

  let whole = token;
  let frac = '';
  const splitAt = (index) => { whole = token.slice(0, index).replace(/[.,]/g, ''); frac = token.slice(index + 1); };

  if (commas && dots) {
    // Оба разделителя: последний — десятичный, остальные разделяют тысячи.
    splitAt(Math.max(token.lastIndexOf(','), token.lastIndexOf('.')));
    if (!/^\d{1,2}$/.test(frac)) return null;
  } else if (commas + dots === 1) {
    const index = token.search(/[.,]/);
    const after = token.slice(index + 1);
    const before = token.slice(0, index);
    if (after.length === 3 && before.length <= 3 && before !== '0') whole = before + after; // «4,500» — тысячи
    else if (/^\d{1,2}$/.test(after)) splitAt(index);
    else return null;
  } else if (commas + dots > 1) {
    // Один и тот же разделитель несколько раз: только разделитель тысяч.
    if (!/^\d{1,3}([.,]\d{3})+$/.test(token)) return null;
    whole = token.replace(/[.,]/g, '');
  }
  if (!/^\d+$/.test(whole) || whole.length > MAX_WHOLE_DIGITS) return null;
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return minor > 0 ? minor : null;
}

const CURRENCY_MARKS = [
  ['KZT', /₸|тенге|KZT|тг\.?(?![а-яё])/i],
  ['USD', /\$|USD/i],
  ['EUR', /€|EUR/i],
  ['RUB', /₽|RUB|руб/i],
];

export function detectCurrency(text) {
  const value = String(text ?? '');
  for (const [code, mark] of CURRENCY_MARKS) if (mark.test(value)) return code;
  return null;
}

/** Получатель для сравнения: нижний регистр, только буквы и цифры. */
export function normalizeMerchant(value) {
  return String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// ---------- правила ----------

export const RULE_SOURCES = { notification: 'Уведомление банка', sms: 'SMS', applepay: 'Apple Pay' };

export function newParseRule(fields = {}, now = Date.now()) {
  return {
    id: uuid(), kind: 'parse', name: '', enabled: true, order: 0, sources: ['notification'],
    match: '', amount: '', merchant: '', account: '', type: 'expense', account_id: null,
    deleted: false, deleted_at: null, ...fields, updated_at: now,
  };
}

const compile = (source) => new RegExp(source, 'i');
const groupCount = (source) => new RegExp(`${source}|`).exec('').length - 1;

function regexError(label, source, { needGroup = false } = {}) {
  if (!source) return null;
  try {
    compile(source);
  } catch {
    return `${label}: ошибка в выражении`;
  }
  if (needGroup && groupCount(source) < 1) return `${label}: нужна группа в скобках, например ([\\d\\s.,]+)`;
  return null;
}

/** Список проблем правила; пустой список — правило можно сохранять. */
export function validateRule(rule) {
  if (!String(rule.name ?? '').trim()) return ['Введите название правила'];
  if (!Array.isArray(rule.sources) || rule.sources.length === 0) return ['Выберите хотя бы один источник'];
  if (!['expense', 'income', 'transfer'].includes(rule.type)) return ['Выберите тип операции'];
  if (!rule.amount) {
    const matchError = regexError('Условие', rule.match);
    return [matchError ?? 'Нужно выражение для суммы'];
  }
  const error = regexError('Условие', rule.match)
    ?? regexError('Сумма', rule.amount, { needGroup: true })
    ?? regexError('Получатель', rule.merchant, { needGroup: true })
    ?? regexError('Счёт', rule.account, { needGroup: true });
  return error ? [error] : [];
}

const captured = (match) => (match ? (match[1] ?? match[0] ?? '').trim() : '');

/**
 * Применяет правило к тексту. Возвращает найденные поля или null,
 * если правило не подошло. Сломанное правило просто не подходит.
 */
export function applyRule(rule, text) {
  try {
    if (rule.match && !compile(rule.match).test(text)) return null;
    const found = compile(rule.amount).exec(text);
    if (!found) return null;
    const raw = found.groups?.amount ?? found[1] ?? '';
    const amount = parseLooseAmount(raw);
    if (amount === null) return null;
    return {
      amount,
      currency: detectCurrency(raw) ?? detectCurrency(text),
      merchant: rule.merchant ? captured(compile(rule.merchant).exec(text)) : '',
      accountText: rule.account ? captured(compile(rule.account).exec(text)) : '',
    };
  } catch {
    return null;
  }
}

/** Счёт по тексту: сначала по подсказке счёта (например, последние цифры карты), затем по названию. */
export function matchAccount(text, accounts) {
  const value = String(text ?? '').toLowerCase();
  if (!value.trim()) return null;
  const candidates = accounts.filter((a) => !a.deleted);
  const byHint = candidates.find((a) => a.hint && value.includes(String(a.hint).toLowerCase()));
  if (byHint) return byHint.id;
  const byName = candidates.find((a) => a.name?.length >= 3 && value.includes(a.name.toLowerCase()));
  return byName?.id ?? null;
}

/** Время события записи в местном времени: «ГГГГ-ММ-ДДTЧЧ:ММ:СС». */
export function eventDate(item, now = Date.now()) {
  const time = String(item.time ?? '').trim();
  const local = time.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (local) return `${local[1]}T${local[2]}:${local[3] ?? '00'}`;
  for (const candidate of [time, item.received_at]) {
    const parsed = candidate ? Date.parse(candidate) : NaN;
    if (Number.isFinite(parsed)) return localIso(new Date(parsed));
  }
  return localIso(new Date(now));
}

/**
 * Разбирает запись inbox.
 * Успех: { ok: true, ruleId, fields: { type, amount, currency, merchant, account_id, date } }.
 * Неудача: { ok: false, reason } — запись должна попасть в «Проверить», а не пропасть.
 */
export function parseInboxItem(item, { rules, accounts, defaultAccountId }, now = Date.now()) {
  const date = eventDate(item, now);

  // Apple Pay: Команда присылает готовые поля, правила не нужны.
  if (item.source === 'applepay' && item.payload && typeof item.payload === 'object') {
    const amount = parseLooseAmount(item.payload.amount);
    if (amount === null) return { ok: false, reason: 'no_amount' };
    return {
      ok: true, ruleId: null,
      fields: {
        type: 'expense', amount, currency: detectCurrency(item.payload.amount) ?? 'KZT',
        merchant: String(item.payload.merchant ?? '').trim(),
        account_id: matchAccount(item.payload.card, accounts) ?? defaultAccountId ?? null, date,
      },
    };
  }

  const text = String(item.text ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };

  const applicable = rules
    .filter((rule) => rule.kind !== 'merchant' && rule.enabled !== false && !rule.deleted
      && Array.isArray(rule.sources) && rule.sources.includes(item.source))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
  for (const rule of applicable) {
    const found = applyRule(rule, text);
    if (!found) continue;
    return {
      ok: true, ruleId: rule.id,
      fields: {
        type: rule.type, amount: found.amount, currency: found.currency ?? 'KZT', merchant: found.merchant,
        account_id: rule.account_id ?? matchAccount(found.accountText, accounts) ?? defaultAccountId ?? null, date,
      },
    };
  }
  return { ok: false, reason: 'no_rule' };
}
