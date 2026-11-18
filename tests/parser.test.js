// Разбор сырых записей по правилам.
// Тексты в этих тестах выдуманные и нарочно не похожи ни на один банк:
// встроенных банковских правил в приложении нет, они появятся по образцам пользователя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLooseAmount, detectCurrency, normalizeMerchant, validateRule, newParseRule, applyRule,
  matchAccount, eventDate, parseInboxItem,
} from '../js/parser.js';

const accounts = [
  { id: 'card', name: 'Карта', currency: 'KZT', hint: '1234', deleted: false },
  { id: 'cash', name: 'Наличные', currency: 'KZT', hint: '', deleted: false },
  { id: 'old', name: 'Старая 9999', currency: 'KZT', hint: '9999', deleted: true },
];
const rule = (extra = {}) => newParseRule({
  name: 'Тест: списание', sources: ['notification', 'sms'], match: 'списание',
  amount: 'списание\\s+([\\d\\s.,]+)', merchant: 'в\\s+(.+?)\\.', account: '\\*(\\d{4})', type: 'expense', ...extra,
}, 1);
const item = (extra = {}) => ({
  id: 'i1', source: 'notification', text: 'ТЕСТ: списание 4 500 ₸ в МАГАЗИН-1. Счёт *1234',
  time: '2026-11-13T14:10:00', received_at: '2026-11-13T09:10:05.000Z', payload: null, status: 'new', ...extra,
});

test('parseLooseAmount: пробелы, запятые, точки, знаки валют', () => {
  const cases = {
    '4 500': 450000, '4 500 ₸': 450000, '4500': 450000, '4500,5': 450050, '4500.50': 450050,
    '4 500,00 ₸': 450000, '1,234.56': 123456, '1.234,56': 123456, '4,500': 450000, '4.500': 450000,
    '12,5': 1250, '0,99': 99, '$19.99': 1999, '1 234 567,89 тг': 123456789, '-4 500': 450000, '+520 000': 52000000,
    '4,5': 450, '1 000 000': 100000000,
  };
  for (const [text, expected] of Object.entries(cases)) assert.equal(parseLooseAmount(text), expected, text);
});
test('parseLooseAmount: не число', () => {
  for (const text of ['', '   ', 'abc', '₸', '1,2,3,4x', '0', '0,00', null, undefined, '99999999999999999']) {
    assert.equal(parseLooseAmount(text), null, String(text));
  }
});
test('detectCurrency', () => {
  assert.equal(detectCurrency('4 500 ₸'), 'KZT');
  assert.equal(detectCurrency('4 500 тг.'), 'KZT');
  assert.equal(detectCurrency('KZT 4500'), 'KZT');
  assert.equal(detectCurrency('$19.99'), 'USD');
  assert.equal(detectCurrency('19,99 USD'), 'USD');
  assert.equal(detectCurrency('10 €'), 'EUR');
  assert.equal(detectCurrency('100 ₽'), 'RUB');
  assert.equal(detectCurrency('100 руб.'), 'RUB');
  assert.equal(detectCurrency('4 500'), null);
});
test('normalizeMerchant', () => {
  assert.equal(normalizeMerchant('  MAGNUM  Cash&Carry, №12 '), 'magnum cash carry 12');
  assert.equal(normalizeMerchant('Кофейня «У дома»'), 'кофейня у дома');
  assert.equal(normalizeMerchant(null), '');
});

test('validateRule: название, сумма и корректность выражений', () => {
  assert.deepEqual(validateRule(rule()), []);
  assert.deepEqual(validateRule(rule({ name: ' ' })), ['Введите название правила']);
  assert.deepEqual(validateRule(rule({ amount: '' })), ['Нужно выражение для суммы']);
  assert.deepEqual(validateRule(rule({ amount: '(\\d+' })), ['Сумма: ошибка в выражении']);
  assert.deepEqual(validateRule(rule({ amount: '\\d+' })), ['Сумма: нужна группа в скобках, например ([\\d\\s.,]+)']);
  assert.deepEqual(validateRule(rule({ merchant: '[' })), ['Получатель: ошибка в выражении']);
  assert.deepEqual(validateRule(rule({ match: '(' })), ['Условие: ошибка в выражении']);
  assert.deepEqual(validateRule(rule({ sources: [] })), ['Выберите хотя бы один источник']);
  assert.deepEqual(validateRule(rule({ type: 'gift' })), ['Выберите тип операции']);
});

test('applyRule: сумма, валюта, получатель, текст счёта', () => {
  assert.deepEqual(applyRule(rule(), item().text), { amount: 450000, currency: 'KZT', merchant: 'МАГАЗИН-1', accountText: '1234' });
});
test('applyRule: условие не совпало или суммы нет', () => {
  assert.equal(applyRule(rule(), 'ТЕСТ: зачисление 4 500 ₸'), null);
  assert.equal(applyRule(rule(), 'ТЕСТ: списание отменено'), null);
});
test('applyRule: регистр не важен, необязательные поля могут не найтись', () => {
  assert.deepEqual(applyRule(rule(), 'тест: СПИСАНИЕ 900'), { amount: 90000, currency: null, merchant: '', accountText: '' });
});
test('applyRule: именованная группа amount имеет приоритет над первой', () => {
  const r = rule({ amount: '(списание)\\s+(?<amount>[\\d\\s]+)' });
  assert.equal(applyRule(r, 'списание 4 500').amount, 450000);
});
test('applyRule: сломанное правило не роняет разбор', () => {
  assert.equal(applyRule({ ...rule(), amount: '(' }, item().text), null);
});

test('matchAccount: по подсказке и по названию, удалённые не участвуют', () => {
  assert.equal(matchAccount('1234', accounts), 'card');
  assert.equal(matchAccount('Счёт *1234 KZT', accounts), 'card');
  assert.equal(matchAccount('наличные', accounts), 'cash');
  assert.equal(matchAccount('9999', accounts), null);
  assert.equal(matchAccount('', accounts), null);
  assert.equal(matchAccount('5555', accounts), null);
});

test('eventDate: локальное время без пояса берётся как есть', () => {
  assert.equal(eventDate(item()), '2026-11-13T14:10:00');
  assert.equal(eventDate(item({ time: '2026-11-13T14:10' })), '2026-11-13T14:10:00');
  assert.equal(eventDate(item({ time: '2026-11-13 14:10:07' })), '2026-11-13T14:10:07');
});
test('eventDate: время с поясом и без времени события', () => {
  const fmt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  assert.match(eventDate(item({ time: '2026-11-13T14:10:00+05:00' })), fmt);
  assert.match(eventDate(item({ time: null })), fmt);
  assert.match(eventDate(item({ time: 'вчера вечером', received_at: null }), 1794000000000), fmt);
  // время события в формате с поясом переводится в местное так же, как это делает Date
  const d = new Date('2026-11-13T14:10:00+05:00');
  assert.equal(eventDate(item({ time: '2026-11-13T14:10:00+05:00' })).slice(11, 13), String(d.getHours()).padStart(2, '0'));
});

test('parseInboxItem: уведомление разбирается первым подходящим правилом', () => {
  const rules = [rule({ id: 'income', name: 'Тест: зачисление', match: 'зачисление', amount: 'зачисление\\s+([\\d\\s.,]+)', type: 'income', order: 0 }), rule({ id: 'expense', order: 1 })];
  const parsed = parseInboxItem(item(), { rules, accounts, defaultAccountId: 'cash' });
  assert.deepEqual(parsed, {
    ok: true, ruleId: 'expense',
    fields: { type: 'expense', amount: 450000, currency: 'KZT', merchant: 'МАГАЗИН-1', account_id: 'card', date: '2026-11-13T14:10:00' },
  });
  const income = parseInboxItem(item({ text: 'ТЕСТ: зачисление 520 000 ₸' }), { rules, accounts, defaultAccountId: 'cash' });
  assert.deepEqual([income.fields.type, income.fields.amount, income.fields.account_id], ['income', 52000000, 'cash']);
});
test('parseInboxItem: порядок правил, выключенные, удалённые и чужой источник', () => {
  const base = { accounts, defaultAccountId: 'cash' };
  const a = rule({ id: 'a', order: 2 });
  const b = rule({ id: 'b', order: 1, type: 'income' });
  assert.equal(parseInboxItem(item(), { ...base, rules: [a, b] }).ruleId, 'b');
  assert.equal(parseInboxItem(item(), { ...base, rules: [a, { ...b, enabled: false }] }).ruleId, 'a');
  assert.equal(parseInboxItem(item(), { ...base, rules: [a, { ...b, deleted: true }] }).ruleId, 'a');
  assert.equal(parseInboxItem(item(), { ...base, rules: [{ ...a, sources: ['sms'] }] }).ok, false);
  assert.equal(parseInboxItem(item({ source: 'sms' }), { ...base, rules: [{ ...a, sources: ['sms'] }] }).ok, true);
});
test('parseInboxItem: счёт из правила важнее найденного по тексту, по умолчанию — запасной', () => {
  const base = { accounts, defaultAccountId: 'cash' };
  assert.equal(parseInboxItem(item(), { ...base, rules: [rule({ account_id: 'cash' })] }).fields.account_id, 'cash');
  assert.equal(parseInboxItem(item({ text: 'списание 100 в А.' }), { ...base, rules: [rule()] }).fields.account_id, 'cash');
  assert.equal(parseInboxItem(item({ text: 'списание 100 в А.' }), { accounts, defaultAccountId: null, rules: [rule()] }).fields.account_id, null);
});
test('parseInboxItem: ничего не подошло — причина, запись не теряется', () => {
  assert.deepEqual(parseInboxItem(item({ text: 'Ваш код 1234' }), { rules: [rule()], accounts, defaultAccountId: 'cash' }),
    { ok: false, reason: 'no_rule' });
  assert.deepEqual(parseInboxItem(item(), { rules: [], accounts, defaultAccountId: 'cash' }), { ok: false, reason: 'no_rule' });
  assert.deepEqual(parseInboxItem(item({ text: '' }), { rules: [rule()], accounts, defaultAccountId: 'cash' }), { ok: false, reason: 'empty' });
});

test('parseInboxItem: Apple Pay приходит полями и разбирается без правил', () => {
  const pay = item({ source: 'applepay', text: 'Кофейня', payload: { amount: '1 500,00 ₸', merchant: 'Кофейня', card: 'Карта *1234' } });
  assert.deepEqual(parseInboxItem(pay, { rules: [], accounts, defaultAccountId: 'cash' }), {
    ok: true, ruleId: null,
    fields: { type: 'expense', amount: 150000, currency: 'KZT', merchant: 'Кофейня', account_id: 'card', date: '2026-11-13T14:10:00' },
  });
});
test('parseInboxItem: Apple Pay без суммы идёт на проверку', () => {
  const pay = item({ source: 'applepay', text: '', payload: { amount: '', merchant: 'Кофейня' } });
  assert.deepEqual(parseInboxItem(pay, { rules: [], accounts, defaultAccountId: 'cash' }), { ok: false, reason: 'no_amount' });
  const noPayload = item({ source: 'applepay', text: 'Кофейня 1500', payload: null });
  assert.deepEqual(parseInboxItem(noPayload, { rules: [], accounts, defaultAccountId: 'cash' }), { ok: false, reason: 'no_rule' });
});

// ---------- «не операция» и готовые правила Freedom ----------
// Формат взят со скриншотов пользователя; суммы, получатели и номер карты заменены выдуманными.
const { FREEDOM_PRESET, escapeRegex, firstLine } = await import('../js/parser.js');
const freedom = FREEDOM_PRESET.map((fields, order) => newParseRule({ ...fields, order }, 1));
const cards = [{ id: 'dep', name: 'Freedom', currency: 'KZT', hint: '0000', deleted: false }, { id: 'cash', name: 'Наличные', currency: 'KZT', hint: '', deleted: false }];
const ctx = { rules: freedom, accounts: cards, defaultAccountId: 'cash' };
const PURCHASE = 'Покупка Test cafe\n-18 282 ₸\nДоступно 1 000 850,27 ₸\nСписано с Deposit Card **0000';

test('правило типа «не операция»: достаточно условия, сумма не нужна', () => {
  const ignore = newParseRule({ name: 'Кешбэк', type: 'ignore', match: '^Кешбэк' }, 1);
  assert.deepEqual(validateRule(ignore), []);
  assert.deepEqual(validateRule({ ...ignore, match: '' }), ['Для правила «не операция» нужно условие']);
  assert.deepEqual(validateRule({ ...ignore, match: '(' }), ['Условие: ошибка в выражении']);
  assert.deepEqual(parseInboxItem(item({ text: 'Кешбэк за покупку\n+159 ₸\nSHOP' }), { rules: [ignore], accounts, defaultAccountId: 'cash' }),
    { ok: true, ignore: true, ruleId: ignore.id });
  assert.equal(parseInboxItem(item({ text: 'Покупка 5 ₸' }), { rules: [ignore], accounts, defaultAccountId: 'cash' }).ok, false);
});

test('Freedom: покупка с заголовком — сумма, получатель, счёт по цифрам карты', () => {
  const parsed = parseInboxItem(item({ text: PURCHASE }), ctx);
  assert.deepEqual(parsed.fields, {
    type: 'expense', amount: 1828200, currency: 'KZT', merchant: 'Test cafe', account_id: 'dep', date: '2026-11-13T14:10:00',
  });
});
test('Freedom: сумма покупки не путается с остатком «Доступно»', () => {
  const parsed = parseInboxItem(item({ text: 'Покупка Shop\n-2 650 ₸\nДоступно 1 324 930,27 ₸\nСписано с Deposit Card **0000' }), ctx);
  assert.equal(parsed.fields.amount, 265000);
  const fractional = parseInboxItem(item({ text: 'Покупка Shop\n-556,2 ₸\nДоступно 10 ₸\nСписано с Deposit Card **0000' }), ctx);
  assert.equal(fractional.fields.amount, 55620);
});
test('Freedom: только тело уведомления (старая Команда без заголовка) — сумма и счёт, получателя нет', () => {
  const parsed = parseInboxItem(item({ text: '-18 282 ₸\nДоступно 1 000 850,27 ₸\nСписано с Deposit Card **0000' }), ctx);
  assert.deepEqual([parsed.ok, parsed.fields.amount, parsed.fields.merchant, parsed.fields.account_id], [true, 1828200, '', 'dep']);
});
test('Freedom: сумма в одной строке с получателем (заголовок и текст через пробел)', () => {
  const text = 'Покупка Jetpay.kz*dodo.kz -1 123 ₸\nДоступно 1 123 123,12 ₸\nСписано с Deposit Card **0000';
  const parsed = parseInboxItem(item({ text }), ctx);
  assert.deepEqual([parsed.ok, parsed.fields.amount, parsed.fields.merchant, parsed.fields.account_id], [true, 112300, 'Jetpay.kz*dodo.kz', 'dep']);
  const flat = parseInboxItem(item({ text: text.replaceAll('\n', ' ') }), ctx);
  assert.deepEqual([flat.fields.amount, flat.fields.merchant, flat.fields.account_id], [112300, 'Jetpay.kz*dodo.kz', 'dep']);
  const dashed = parseInboxItem(item({ text: 'Покупка Store-24 -500,50 ₸\nДоступно 10 ₸\nСписано с Deposit Card **0000' }), ctx);
  assert.deepEqual([dashed.fields.amount, dashed.fields.merchant], [50050, 'Store-24'], 'дефис в названии не путается с минусом');
});
test('готовые правила: неизменённая старая версия обновляется, изменённая вручную — нет', async () => {
  const { FREEDOM_HISTORY, upgradePreset } = await import('../js/parser.js');
  const store = new Map();
  const db = { get: async (_, id) => store.get(id), put: async (_, row) => { store.set(row.id, row); } };
  const old = FREEDOM_HISTORY['preset-freedom-purchase'][0];
  store.set('preset-freedom-purchase', newParseRule({ id: 'preset-freedom-purchase', name: 'Freedom: покупка', ...old, account_id: 'dep', enabled: false }, 1));
  store.set('preset-freedom-debit', newParseRule({ id: 'preset-freedom-debit', name: 'Своё', ...FREEDOM_HISTORY['preset-freedom-debit'][0], match: 'Моё условие' }, 1));
  assert.equal(await upgradePreset(db, FREEDOM_PRESET, FREEDOM_HISTORY, 5), 1);
  const purchase = store.get('preset-freedom-purchase');
  assert.equal(purchase.amount, FREEDOM_PRESET.find((r) => r.id === purchase.id).amount);
  assert.deepEqual([purchase.account_id, purchase.enabled, purchase.updated_at], ['dep', false, 5], 'настройки пользователя сохраняются');
  assert.equal(store.get('preset-freedom-debit').match, 'Моё условие');
  assert.equal(await upgradePreset(db, FREEDOM_PRESET, FREEDOM_HISTORY, 6), 0, 'повторно не обновляется');
});
test('Freedom: кешбэк помечается как не операция', () => {
  assert.deepEqual(parseInboxItem(item({ text: 'Кешбэк за покупку\n+159 ₸\nTEST SHOP' }), ctx).ignore, true);
  assert.deepEqual(parseInboxItem(item({ text: 'Кешбек за покупку\n+556,2 ₸\nTEST SHOP' }), ctx).ignore, true, 'оба написания: кешбэк и кешбек');
});
test('Freedom: незнакомое уведомление остаётся неразобранным', () => {
  assert.deepEqual(parseInboxItem(item({ text: 'Акция! Скидки до 50%' }), ctx), { ok: false, reason: 'no_rule' });
});
test('готовые правила проходят собственную проверку и имеют постоянные id', () => {
  for (const rule of freedom) assert.deepEqual(validateRule(rule), [], rule.name);
  assert.ok(FREEDOM_PRESET.every((r) => /^preset-freedom-/.test(r.id)));
  assert.equal(new Set(FREEDOM_PRESET.map((r) => r.id)).size, FREEDOM_PRESET.length);
});
test('escapeRegex и firstLine: условие по первой строке записи', () => {
  assert.equal(firstLine('  Кешбэк за покупку (1+1)\n+159 ₸'), 'Кешбэк за покупку (1+1)');
  assert.equal(new RegExp('^' + escapeRegex('Кешбэк за покупку (1+1)')).test('Кешбэк за покупку (1+1)\n+5'), true);
  assert.equal(new RegExp(escapeRegex('a.b')).test('axb'), false);
});
