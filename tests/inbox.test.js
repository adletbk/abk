// Обработка входящих: создание операций, «Проверить», дедупликация, автокатегория.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../js/db.js';
import { seedIfEmpty, clearDemo } from '../js/seed.js';
import { newParseRule } from '../js/parser.js';
import {
  findDuplicate, merchantsCompatible, categoryForMerchant, learnMerchant, processInbox, reviewCounts, DEDUP_WINDOW_MS,
} from '../js/inbox.js';
import { syncNow, createTransport } from '../js/sync.js';
import { createGas } from './helpers/gas.js';
import { FREEDOM_PRESET as FREEDOM, addPreset as addRules } from '../js/parser.js';

const NOW = new Date(2026, 10, 13, 15, 0, 0).getTime();

async function device() {
  const db = await openDb({ indexedDB: new IDBFactory() });
  await seedIfEmpty(db, NOW);
  await clearDemo(db);
  await db.put('rules', newParseRule({
    id: 'r1', name: 'Тест: списание', sources: ['notification', 'sms'], match: 'списание',
    amount: 'списание\\s+([\\d\\s.,]+)', merchant: 'в\\s+(.+?)\\.', type: 'expense',
  }, NOW));
  return db;
}
const inboxItem = (extra = {}) => ({
  id: 'i1', source: 'notification', text: 'ТЕСТ: списание 4 500 ₸ в МАГАЗИН-1.', time: '2026-11-13T14:10:00',
  received_at: '2026-11-13T09:10:05.000Z', payload: null, status: 'new', updated_at: NOW, ...extra,
});
const pay = (extra = {}) => inboxItem({
  id: 'p1', source: 'applepay', text: 'МАГАЗИН-1', payload: { amount: '4 500 ₸', merchant: 'Магазин-1' }, ...extra,
});
const live = async (db) => (await db.getAll('transactions')).filter((t) => !t.deleted);

// ---------- дедупликация ----------

const existing = (extra = {}) => ({
  id: 't1', date: '2026-11-13T14:10:00', amount: 450000, currency: 'KZT', type: 'expense',
  merchant: 'Magnum', source: 'applepay', sources: ['applepay'], deleted: false, ...extra,
});
const candidate = (extra = {}) => ({
  date: '2026-11-13T14:11:30', amount: 450000, currency: 'KZT', type: 'expense', merchant: 'MAGNUM CASH&CARRY', source: 'notification', ...extra,
});

test('findDuplicate: та же сумма, близкое время, похожий получатель, другой источник', () => {
  assert.equal(findDuplicate(candidate(), [existing()])?.id, 't1');
});
test('findDuplicate: окно по умолчанию пять минут в обе стороны', () => {
  assert.equal(DEDUP_WINDOW_MS, 5 * 60 * 1000);
  assert.equal(findDuplicate(candidate({ date: '2026-11-13T14:15:00' }), [existing()])?.id, 't1');
  assert.equal(findDuplicate(candidate({ date: '2026-11-13T14:05:00' }), [existing()])?.id, 't1');
  assert.equal(findDuplicate(candidate({ date: '2026-11-13T14:15:01' }), [existing()]), null);
  assert.equal(findDuplicate(candidate({ date: '2026-11-13T14:15:01' }), [existing()], { windowMs: 10 * 60 * 1000 })?.id, 't1');
});
test('findDuplicate: что не считается дублем', () => {
  assert.equal(findDuplicate(candidate({ amount: 450100 }), [existing()]), null, 'другая сумма');
  assert.equal(findDuplicate(candidate({ currency: 'USD' }), [existing()]), null, 'другая валюта');
  assert.equal(findDuplicate(candidate({ type: 'income' }), [existing()]), null, 'другой тип');
  assert.equal(findDuplicate(candidate(), [existing({ deleted: true })]), null, 'удалённая операция');
  assert.equal(findDuplicate(candidate({ source: 'applepay' }), [existing()]), null,
    'тот же источник: две одинаковые покупки подряд — это две операции');
  assert.equal(findDuplicate(candidate(), [existing({ source: 'manual', sources: undefined })]), null, 'ручные операции не сливаются');
  assert.equal(findDuplicate(candidate(), [existing({ sources: ['applepay', 'notification'] })]), null, 'этот источник уже учтён');
});
test('findDuplicate: получатель неизвестен с одной стороны — считаем дублем; из нескольких берётся ближайшая по времени', () => {
  assert.equal(findDuplicate(candidate({ merchant: '' }), [existing()])?.id, 't1');
  assert.equal(findDuplicate(candidate(), [existing({ merchant: '' })])?.id, 't1');
  const two = [existing({ id: 'far', date: '2026-11-13T14:07:00' }), existing({ id: 'near', date: '2026-11-13T14:11:00' })];
  assert.equal(findDuplicate(candidate(), two).id, 'near');
});

test('findDuplicate: Apple Pay и банк пишут получателя по-разному', () => {
  const dodo = existing({ merchant: 'Dodo Pizza' });
  assert.equal(findDuplicate(candidate({ merchant: 'Jetpay.kz*dodo.kz' }), [dodo])?.id, 't1', 'общее слово dodo');
  assert.equal(findDuplicate(candidate({ merchant: 'KFC' }), [existing()])?.id, 't1',
    'единственная операция с той же суммой в окне — та же покупка, даже если получатель не похож');
  const two = [existing({ id: 'a', merchant: 'Magnum' }), existing({ id: 'b', merchant: 'Small' })];
  assert.equal(findDuplicate(candidate({ merchant: 'KFC' }), two), null, 'две неподходящие — непонятно какая, не сливаем');
  assert.equal(findDuplicate(candidate({ merchant: 'SMALL TOO' }), two)?.id, 'b', 'подходящая по получателю важнее ближайшей');
});
test('merchantsCompatible: служебные слова и домены не считаются общими', () => {
  assert.equal(merchantsCompatible('Jetpay.kz*dodo.kz', 'Dodo Pizza'), true);
  assert.equal(merchantsCompatible('Jetpay.kz*kfc.kz', 'Jetpay.kz*dodo.kz'), false, 'jetpay и kz — не общее слово');
  assert.equal(merchantsCompatible('TOO Magnum', 'TOO Small'), false);
  assert.equal(merchantsCompatible('', 'KFC'), true);
});
test('processInbox: Apple Pay и уведомление Freedom о той же покупке — одна операция', async () => {
  const db = await device();
  await addRules(db, FREEDOM);
  await db.put('accounts', { id: 'dep', name: 'Freedom', currency: 'KZT', hint: '6666', order: 0, deleted: false, hidden: false });
  await db.putMany('inbox', [
    pay({ id: 'ap', time: '2026-11-18T13:05:10', text: 'Dodo Pizza', payload: { amount: '1 123,00 ₸', merchant: 'Dodo Pizza', card: 'Freedom' } }),
    inboxItem({ id: 'nt', time: '2026-11-18T13:05:40', text: 'Покупка Jetpay.kz*dodo.kz -1 123 ₸\nДоступно 1 123 123,12 ₸\nСписано с Deposit Card **6666' }),
  ]);
  const result = await processInbox(db, { now: NOW });
  assert.deepEqual([result.created, result.merged, result.unparsed], [1, 1, 0]);
  const txs = await live(db);
  assert.equal(txs.length, 1);
  assert.deepEqual([txs[0].amount, txs[0].sources.sort()], [112300, ['applepay', 'notification']]);
});

// ---------- автокатегория ----------

test('categoryForMerchant: точное совпадение, затем вхождение', () => {
  const rules = [
    { kind: 'merchant', merchant: 'magnum', category_id: 'cat-food' },
    { kind: 'merchant', merchant: 'кофейня у дома', category_id: 'cat-cafe' },
    { kind: 'merchant', merchant: 'ab', category_id: 'cat-other' },
    { kind: 'merchant', merchant: 'удалённое', category_id: 'cat-x', deleted: true },
  ];
  assert.equal(categoryForMerchant('MAGNUM', rules), 'cat-food');
  assert.equal(categoryForMerchant('Magnum Cash&Carry №12', rules), 'cat-food');
  assert.equal(categoryForMerchant('Кофейня «У дома»', rules), 'cat-cafe');
  assert.equal(categoryForMerchant('Неизвестный', rules), null);
  assert.equal(categoryForMerchant('cab', rules), null, 'слишком короткое правило не срабатывает по вхождению');
  assert.equal(categoryForMerchant('удалённое', rules), null);
  assert.equal(categoryForMerchant('', rules), null);
});

test('learnMerchant: правило создаётся и обновляется, а не множится', async () => {
  const db = await device();
  await learnMerchant(db, 'Магазин-1', 'cat-food', NOW);
  await learnMerchant(db, ' магазин 1 ', 'cat-cafe', NOW + 1);
  await learnMerchant(db, '', 'cat-cafe', NOW + 2);
  const rules = (await db.getAll('rules')).filter((r) => r.kind === 'merchant');
  assert.deepEqual(rules.map((r) => [r.merchant, r.category_id, r.updated_at]), [['магазин 1', 'cat-cafe', NOW + 1]]);
  db.close();
});

// ---------- обработка ----------

test('processInbox: разобранная запись без известной категории идёт в «Проверить»', async () => {
  const db = await device();
  await db.put('inbox', inboxItem());
  const result = await processInbox(db, { now: NOW });
  assert.deepEqual(result, { created: 1, merged: 0, review: 1, unparsed: 0, ignored: 0 });
  const [tx] = await live(db);
  assert.deepEqual({
    date: tx.date, amount: tx.amount, type: tx.type, category_id: tx.category_id, account_id: tx.account_id,
    note: tx.note, merchant: tx.merchant, source: tx.source, sources: tx.sources, status: tx.status,
    fingerprint: tx.fingerprint, inbox_ids: tx.inbox_ids,
  }, {
    date: '2026-11-13T14:10:00', amount: 450000, type: 'expense', category_id: null, account_id: 'acc-card',
    note: 'МАГАЗИН-1', merchant: 'МАГАЗИН-1', source: 'notification', sources: ['notification'], status: 'needs_review',
    fingerprint: 'inbox:i1', inbox_ids: ['i1'],
  });
  const item = await db.get('inbox', 'i1');
  assert.deepEqual([item.status, item.tx_id], ['done', tx.id]);
  assert.deepEqual(await reviewCounts(db), { transactions: 1, inbox: 0, total: 1 });
  db.close();
});

test('processInbox: известный получатель получает категорию, операция сразу «ок»', async () => {
  const db = await device();
  await learnMerchant(db, 'Магазин-1', 'cat-food', NOW);
  await db.put('inbox', inboxItem());
  assert.deepEqual(await processInbox(db, { now: NOW }), { created: 1, merged: 0, review: 0, unparsed: 0, ignored: 0 });
  const [tx] = await live(db);
  assert.deepEqual([tx.category_id, tx.status], ['cat-food', 'ok']);
  db.close();
});

test('processInbox: неразобранная запись остаётся во входящих со статусом needs_review', async () => {
  const db = await device();
  await db.put('inbox', inboxItem({ text: 'Ваш код подтверждения 1234' }));
  assert.deepEqual(await processInbox(db, { now: NOW }), { created: 0, merged: 0, review: 0, unparsed: 1, ignored: 0 });
  assert.equal((await live(db)).length, 0);
  const item = await db.get('inbox', 'i1');
  assert.deepEqual([item.status, item.reason, item.text], ['needs_review', 'no_rule', 'Ваш код подтверждения 1234']);
  assert.deepEqual(await reviewCounts(db), { transactions: 0, inbox: 1, total: 1 });
  db.close();
});

test('processInbox: повторный запуск ничего не дублирует', async () => {
  const db = await device();
  await db.put('inbox', inboxItem());
  await processInbox(db, { now: NOW });
  assert.deepEqual(await processInbox(db, { now: NOW + 1000 }), { created: 0, merged: 0, review: 0, unparsed: 0, ignored: 0 });
  assert.equal((await live(db)).length, 1);
  db.close();
});

test('processInbox: после появления правила неразобранные записи разбираются заново', async () => {
  const db = await device();
  await db.put('inbox', inboxItem({ text: 'ТЕСТ: оплата 900 ₸' }));
  await processInbox(db, { now: NOW });
  await db.put('rules', newParseRule({ id: 'r2', name: 'Тест: оплата', sources: ['notification'], amount: 'оплата\\s+([\\d\\s]+)', type: 'expense' }, NOW));
  assert.deepEqual(await processInbox(db, { now: NOW + 1, retry: true }), { created: 1, merged: 0, review: 1, unparsed: 0, ignored: 0 });
  assert.equal((await db.get('inbox', 'i1')).status, 'done');
  db.close();
});

test('processInbox: Apple Pay и уведомление банка об одной покупке дают одну операцию', async () => {
  const db = await device();
  await db.putMany('inbox', [pay(), inboxItem({ time: '2026-11-13T14:11:20' })]);
  const result = await processInbox(db, { now: NOW });
  assert.deepEqual(result, { created: 1, merged: 1, review: 1, unparsed: 0, ignored: 0 });
  const txs = await live(db);
  assert.equal(txs.length, 1);
  assert.deepEqual([txs[0].source, txs[0].sources, txs[0].inbox_ids, txs[0].date],
    ['applepay', ['applepay', 'notification'], ['p1', 'i1'], '2026-11-13T14:10:00']);
  assert.deepEqual((await db.getAll('inbox')).map((i) => [i.id, i.status, i.tx_id]).sort(),
    [['i1', 'done', txs[0].id], ['p1', 'done', txs[0].id]]);
  db.close();
});

test('processInbox: порядок прихода не важен — уведомление раньше Apple Pay', async () => {
  const db = await device();
  await db.put('inbox', inboxItem({ time: '2026-11-13T14:11:20' }));
  await processInbox(db, { now: NOW });
  await db.put('inbox', pay());
  assert.deepEqual(await processInbox(db, { now: NOW + 5 }), { created: 0, merged: 1, review: 0, unparsed: 0, ignored: 0 });
  const txs = await live(db);
  assert.equal(txs.length, 1);
  assert.deepEqual(txs[0].sources, ['notification', 'applepay']);
  assert.equal(txs[0].updated_at, NOW + 5, 'слияние меняет запись, чтобы она ушла в синхронизацию');
  db.close();
});

test('processInbox: слияние заполняет недостающее и не трогает исправленное вручную', async () => {
  const db = await device();
  await db.put('inbox', pay({ payload: { amount: '4 500 ₸', merchant: '' }, text: '' }));
  await processInbox(db, { now: NOW });
  const [first] = await live(db);
  assert.equal(first.merchant, '');
  await db.put('transactions', { ...first, category_id: 'cat-food', status: 'ok', note: 'Моя заметка' });
  await db.put('inbox', inboxItem({ time: '2026-11-13T14:10:40' }));
  await processInbox(db, { now: NOW + 5 });
  const [merged] = await live(db);
  assert.deepEqual([merged.merchant, merged.note, merged.category_id, merged.status], ['МАГАЗИН-1', 'Моя заметка', 'cat-food', 'ok']);
  db.close();
});

test('processInbox: две одинаковые покупки из одного источника — две операции', async () => {
  const db = await device();
  await db.putMany('inbox', [inboxItem({ id: 'a' }), inboxItem({ id: 'b', time: '2026-11-13T14:12:00' })]);
  assert.equal((await processInbox(db, { now: NOW })).created, 2);
  assert.equal((await live(db)).length, 2);
  db.close();
});

test('processInbox: SMS записывается как уведомление банка, счёт по умолчанию — последний использованный', async () => {
  const db = await device();
  await db.setSetting('last_account_id', 'acc-cash');
  await db.put('inbox', inboxItem({ source: 'sms' }));
  await processInbox(db, { now: NOW });
  const [tx] = await live(db);
  assert.deepEqual([tx.source, tx.sources, tx.account_id], ['notification', ['sms'], 'acc-cash']);
  db.close();
});

test('processInbox: уже подтверждённые и проигнорированные записи не трогаются', async () => {
  const db = await device();
  await db.putMany('inbox', [inboxItem({ id: 'd', status: 'done' }), inboxItem({ id: 'ig', status: 'done', ignored: true })]);
  assert.deepEqual(await processInbox(db, { now: NOW, retry: true }), { created: 0, merged: 0, review: 0, unparsed: 0, ignored: 0 });
  assert.equal((await live(db)).length, 0);
  db.close();
});

// ---------- вместе с синхронизацией ----------

test('от Команды iOS до таблицы: запись приходит, разбирается, операция и статус уходят обратно', async () => {
  const gas = createGas();
  const db = await device();
  const fetchImpl = async (url, init) => { gas.tick(10); return { status: 200, text: async () => gas.post(init.body).raw }; };
  const transport = createTransport('https://script.google.com/macros/s/AKfycb_test/exec', 'test-token', fetchImpl);

  gas.call({ action: 'add', source: 'notification', text: 'ТЕСТ: списание 4 500 ₸ в МАГАЗИН-1.', time: '2026-11-13T14:10:00' });
  assert.equal((await syncNow(db, transport, NOW)).inbox, 1);
  assert.deepEqual(await processInbox(db, { now: NOW + 1000 }), { created: 1, merged: 0, review: 1, unparsed: 0, ignored: 0 });
  await syncNow(db, transport, NOW + 2000);

  const [row] = gas.sheet('transactions').objects();
  assert.deepEqual([row['Сумма'], row['Заметка'], row['Источник'], row['Статус'], row['Категория']],
    [4500, 'МАГАЗИН-1', 'Уведомление банка', 'проверить', '']);
  assert.match(row.fingerprint, /^inbox:/);
  assert.equal(gas.sheet('inbox').objects()[0]['Статус'], 'done');

  // второе устройство не создаёт вторую операцию из той же записи
  const other = await device();
  await syncNow(other, transport, NOW + 3000);
  assert.deepEqual(await processInbox(other, { now: NOW + 4000 }), { created: 0, merged: 0, review: 0, unparsed: 0, ignored: 0 });
  assert.equal((await live(other)).length, 1);
  db.close(); other.close();
});

// ---------- «не операция» и Freedom ----------
const { FREEDOM_PRESET, addPreset } = await import('../js/parser.js');

test('processInbox: запись по правилу «не операция» скрывается сама и в «Проверить» не попадает', async () => {
  const db = await device();
  await db.put('rules', newParseRule({ id: 'ig', name: 'Кешбэк', type: 'ignore', match: '^Кешб[эе]к', sources: ['notification'], order: -1 }, NOW));
  await db.put('inbox', inboxItem({ text: 'Кешбэк за покупку\n+159 ₸\nTEST SHOP' }));
  assert.deepEqual(await processInbox(db, { now: NOW }), { created: 0, merged: 0, review: 0, unparsed: 0, ignored: 1 });
  const item = await db.get('inbox', 'i1');
  assert.deepEqual([item.status, item.ignored, item.text.split('\n')[0]], ['done', true, 'Кешбэк за покупку']);
  assert.equal((await live(db)).length, 0);
  assert.equal((await reviewCounts(db)).total, 0);
  db.close();
});

test('addPreset: готовые правила добавляются один раз и не затирают правки пользователя', async () => {
  const db = await device();
  assert.equal(await addPreset(db, FREEDOM_PRESET, NOW), FREEDOM_PRESET.length);
  const first = FREEDOM_PRESET[0];
  await db.put('rules', { ...(await db.get('rules', first.id)), name: 'Моё название', updated_at: NOW + 1 });
  assert.equal(await addPreset(db, FREEDOM_PRESET, NOW + 2), 0);
  assert.equal((await db.get('rules', first.id)).name, 'Моё название');
  db.close();
});

test('Freedom + Apple Pay: одна покупка, одна операция; кешбэк не создаёт ничего', async () => {
  const db = await device();
  await addPreset(db, FREEDOM_PRESET, NOW);
  await db.putMany('inbox', [
    pay({ id: 'ap', time: '2026-11-13T15:39:10', text: 'Test_cafe', payload: { amount: '₸18 282,00', merchant: 'Test_cafe', card: 'Freedom Bank Kazakhstan' } }),
    inboxItem({ id: 'bank', time: '2026-11-13T15:39:40', text: 'Покупка Test cafe\n-18 282 ₸\nДоступно 1 000 850,27 ₸\nСписано с Deposit Card **0000' }),
    inboxItem({ id: 'cb', time: '2026-11-13T15:42:00', text: 'Кешбэк за покупку\n+1 096,92 ₸\nTEST CAFE' }),
  ]);
  assert.deepEqual(await processInbox(db, { now: NOW }), { created: 1, merged: 1, review: 1, unparsed: 0, ignored: 1 });
  const txs = await live(db);
  assert.equal(txs.length, 1);
  assert.deepEqual([txs[0].amount, txs[0].sources, txs[0].merchant], [1828200, ['applepay', 'notification'], 'Test_cafe']);

  // после выбора категории следующая покупка там же проходит без «Проверить»
  await learnMerchant(db, txs[0].merchant, 'cat-cafe', NOW);
  await db.put('inbox', inboxItem({ id: 'bank2', time: '2026-11-14T10:00:00', text: 'Покупка Test cafe\n-900 ₸\nДоступно 5 ₸\nСписано с Deposit Card **0000' }));
  assert.deepEqual(await processInbox(db, { now: NOW + 1 }), { created: 1, merged: 0, review: 0, unparsed: 0, ignored: 0 });
  db.close();
});
