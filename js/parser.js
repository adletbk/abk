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

/** Типы правил: три вида операций и «не операция» (запись скрывается без создания операции). */
export const RULE_TYPES = { expense: 'Расход', income: 'Доход', transfer: 'Перевод', ignore: 'Не операция' };

/**
 * Насколько надёжно определён счёт: выше — надёжнее. При слиянии Apple Pay и уведомления банка
 * побеждает более надёжный; выбранный вручную не меняется никогда.
 */
export const ACCOUNT_RANK = { fallback: 0, name: 1, rule: 3, hint: 3, card: 4, manual: 5 };

/** Список проблем правила; пустой список — правило можно сохранять. */
export function validateRule(rule) {
  if (!String(rule.name ?? '').trim()) return ['Введите название правила'];
  if (!Array.isArray(rule.sources) || rule.sources.length === 0) return ['Выберите хотя бы один источник'];
  if (!(rule.type in RULE_TYPES)) return ['Выберите тип операции'];
  if (rule.type === 'ignore') {
    if (!rule.match) return ['Для правила «не операция» нужно условие'];
    const matchError = regexError('Условие', rule.match);
    return matchError ? [matchError] : [];
  }
  if (!rule.amount) {
    // Постоянная операция: в уведомлении нет суммы (например, «Билет Onay»), сумма задана в правиле.
    if (Number.isInteger(rule.fixed_amount) && rule.fixed_amount > 0) {
      if (!rule.match) return ['Для постоянной операции нужно условие'];
      if (rule.type === 'transfer') return ['Постоянная операция — только доход или расход'];
      const matchError = regexError('Условие', rule.match) ?? regexError('Счёт', rule.account, { needGroup: true });
      return matchError ? [matchError] : [];
    }
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
    if (!rule.amount && Number.isInteger(rule.fixed_amount) && rule.fixed_amount > 0) {
      if (!rule.match) return null;
      return {
        amount: rule.fixed_amount, currency: rule.currency ?? 'KZT', merchant: '',
        accountText: rule.account ? captured(compile(rule.account).exec(text)) : '',
        category_id: rule.category_id ?? null, note: rule.note ?? '',
      };
    }
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
  return findAccount(text, accounts)?.id ?? null;
}

/**
 * То же, но с надёжностью: { id, rank }. cards — запомненные карты Apple Pay («карта → счёт»),
 * они надёжнее всего, потому что их подтвердил пользователь. null — счёт не найден.
 */
export function findAccount(text, accounts, cards = []) {
  const value = String(text ?? '').toLowerCase();
  if (!value.trim()) return null;
  const candidates = accounts.filter((a) => !a.deleted);
  const known = normalizeMerchant(text);
  const card = cards.find((r) => r.kind === 'card' && !r.deleted && r.card === known && candidates.some((a) => a.id === r.account_id));
  if (card) return { id: card.account_id, rank: ACCOUNT_RANK.card };
  const byHint = candidates.find((a) => a.hint && value.includes(String(a.hint).toLowerCase()));
  if (byHint) return { id: byHint.id, rank: ACCOUNT_RANK.hint };
  // Длинное название надёжнее короткого: «Freedom Deposit» раньше, чем «Freedom».
  const byName = candidates.filter((a) => a.name?.length >= 3 && value.includes(a.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return byName ? { id: byName.id, rank: ACCOUNT_RANK.name } : null;
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
  const cards = rules.filter((rule) => rule.kind === 'card');
  const fallback = { id: defaultAccountId ?? null, rank: ACCOUNT_RANK.fallback };

  // Apple Pay: Команда присылает готовые поля, правила не нужны.
  if (item.source === 'applepay' && item.payload && typeof item.payload === 'object') {
    const amount = parseLooseAmount(item.payload.amount);
    if (amount === null) return { ok: false, reason: 'no_amount' };
    const card = String(item.payload.card ?? '').trim();
    const account = findAccount(card, accounts, cards) ?? fallback;
    return {
      ok: true, ruleId: null,
      fields: {
        type: 'expense', amount, currency: detectCurrency(item.payload.amount) ?? 'KZT',
        merchant: String(item.payload.merchant ?? '').trim(),
        account_id: account.id, account_rank: account.rank, card, date,
      },
    };
  }

  const text = String(item.text ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };

  const applicable = rules
    .filter((rule) => (rule.kind ?? 'parse') === 'parse' && rule.enabled !== false && !rule.deleted
      && Array.isArray(rule.sources) && rule.sources.includes(item.source))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
  for (const rule of applicable) {
    if (rule.type === 'ignore') {
      let hit = false;
      try { hit = Boolean(rule.match) && compile(rule.match).test(text); } catch { /* сломанное правило не подходит */ }
      if (hit) return { ok: true, ignore: true, ruleId: rule.id };
      continue;
    }
    const found = applyRule(rule, text);
    if (!found) continue;
    const account = (rule.account_id && accounts.some((a) => a.id === rule.account_id && !a.deleted)
      ? { id: rule.account_id, rank: ACCOUNT_RANK.rule } : null)
      ?? findAccount(found.accountText, accounts) ?? fallback;
    return {
      ok: true, ruleId: rule.id,
      fields: {
        type: rule.type, amount: found.amount, currency: found.currency ?? 'KZT', merchant: found.merchant,
        account_id: account.id, account_rank: account.rank, date,
        ...(found.category_id ? { category_id: found.category_id } : {}),
        ...(found.note ? { note: found.note } : {}),
      },
    };
  }
  return { ok: false, reason: 'no_rule' };
}

// ---------- помощники для редактора правил ----------

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const firstLine = (text) => String(text ?? '').trim().split(/\r?\n/, 1)[0].trim();

// ---------- готовые правила ----------

/**
 * Freedom Bank (приложение Freedom SuperApp). Составлено по уведомлениям пользователя.
 * Команда iOS присылает заголовок и текст уведомления вместе. Сумма бывает и на отдельной
 * строке, и в одной строке с получателем:
 *
 *   Покупка <получатель>            Покупка <получатель> -1 123 ₸     Кешбэк за покупку
 *   -18 282 ₸                       Доступно 1 123 123,12 ₸           +159 ₸
 *   Доступно 1 000 850,27 ₸         Списано с Deposit Card **0000     <ПОЛУЧАТЕЛЬ>
 *   Списано с Deposit Card **0000
 *
 * Сумма покупки — первое число со знаком минус перед ₸: остаток «Доступно» минуса не имеет.
 * Третье правило — запасное, для записей без заголовка (только текст уведомления).
 */
const AMOUNT_WITH_MINUS = '[-\u2212]\\s*(\\d[\\d\\s.,]*?)\\s*₸';

export const FREEDOM_PRESET = [
  {
    id: 'preset-freedom-cashback', name: 'Freedom: кешбэк (не операция)', type: 'ignore',
    sources: ['notification', 'sms'], match: '^\\s*Кешб[эе]к',
  },
  {
    id: 'preset-freedom-purchase', name: 'Freedom: покупка', type: 'expense', sources: ['notification'],
    match: '^\\s*Покупка\\s',
    amount: AMOUNT_WITH_MINUS,
    merchant: '^\\s*Покупка\\s+(.+?)(?=\\s+[-\u2212]\\s*\\d|\\s*\\n|\\s*$)',
    account: '\\*\\*(\\d{4})',
  },
  {
    id: 'preset-freedom-debit', name: 'Freedom: списание без заголовка', type: 'expense', sources: ['notification'],
    match: 'Списано с',
    amount: AMOUNT_WITH_MINUS,
    account: '\\*\\*(\\d{4})',
  },
];

/**
 * Прежние версии готовых правил. Если правило у пользователя совпадает с одной из них
 * (то есть его не меняли вручную), upgradePreset заменяет его новой версией.
 */
export const FREEDOM_HISTORY = {
  'preset-freedom-purchase': [{
    type: 'expense', sources: ['notification'], match: '^\\s*Покупка\\s',
    amount: '^[^\\n]*\\n\\s*[-\u2212]?\\s*([\\d\\s.,]+?)\\s*₸',
    merchant: '^\\s*Покупка\\s+([^\\n]+)', account: '\\*\\*(\\d{4})',
  }],
  'preset-freedom-debit': [{
    type: 'expense', sources: ['notification'], match: 'Списано с',
    amount: '^\\s*[-\u2212]\\s*([\\d\\s.,]+?)\\s*₸', merchant: '', account: '\\*\\*(\\d{4})',
  }],
};

const ruleKey = (r) => JSON.stringify([r.type, [...(r.sources ?? [])].sort(), r.match ?? '', r.amount ?? '', r.merchant ?? '', r.account ?? '']);

/** Обновляет готовые правила, которые пользователь не менял. Возвращает число обновлённых. */
export async function upgradePreset(db, preset, history, now = Date.now()) {
  let upgraded = 0;
  for (const fields of preset) {
    const existing = await db.get('rules', fields.id);
    if (!existing || existing.deleted || ruleKey(existing) === ruleKey({ merchant: '', account: '', ...fields })) continue;
    if (!(history[fields.id] ?? []).some((old) => ruleKey(old) === ruleKey(existing))) continue;
    await db.put('rules', { ...existing, ...fields, merchant: fields.merchant ?? '', account: fields.account ?? '', updated_at: now });
    upgraded++;
  }
  return upgraded;
}

/** Добавляет готовые правила, которых ещё нет. Правки и удаления пользователя не трогает. Возвращает число добавленных. */
export async function addPreset(db, preset, now = Date.now()) {
  let added = 0;
  for (const [order, fields] of preset.entries()) {
    if (await db.get('rules', fields.id)) continue;
    await db.put('rules', newParseRule({ ...fields, order }, now));
    added++;
  }
  return added;
}
