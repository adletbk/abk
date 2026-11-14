// Синхронизация от начала до конца: клиент js/sync.js ↔ настоящий Code.gs в node:vm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../js/db.js';
import { seedIfEmpty } from '../js/seed.js';
import { newTransaction } from '../js/model.js';
import { createGas } from './helpers/gas.js';
import { SyncError, createTransport, isSyncUrl, syncNow, toWire, hasLocalChanges } from '../js/sync.js';

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_test-ID/exec';
const T0 = new Date(2026, 10, 13, 12, 0, 0).getTime();

/** Устройство: база с данными первого запуска и двумя своими операциями. */
async function device({ seed = true } = {}) {
  const db = await openDb({ indexedDB: new IDBFactory() });
  if (seed) await seedIfEmpty(db, T0);
  return db;
}
const mine = (extra = {}, now = T0 + 1000) => newTransaction({
  date: '2026-11-13T14:10:05', amount: 845050, category_id: 'cat-food', account_id: 'acc-card', note: 'Магазин', ...extra,
}, now);

/** Транспорт поверх поддельного fetch, который вызывает Code.gs. */
function wire(gas, { token = 'test-token', fail = () => false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    if (fail(body, calls.length)) throw new TypeError('Failed to fetch');
    gas.tick(10);
    return { status: 200, text: async () => gas.post(init.body).raw };
  };
  return { transport: createTransport(URL_OK, token, fetchImpl), calls };
}

// ---------- мелочи ----------

test('isSyncUrl: только адрес веб-приложения Apps Script', () => {
  assert.equal(isSyncUrl(URL_OK), true);
  assert.equal(isSyncUrl('https://script.google.com/a/macros/example.com/s/AKfycb/exec'), true);
  for (const bad of ['', 'http://script.google.com/macros/s/x/exec', 'https://evil.example/macros/s/x/exec',
    'https://script.google.com.evil.example/macros/s/x/exec', 'https://script.google.com/macros/s/x/dev',
    'https://script.google.com/macros/s/x/exec?token=1', 'javascript:alert(1)', null]) {
    assert.equal(isSyncUrl(bad), false, String(bad));
  }
});

test('createTransport: POST, text/plain, токен в теле, а не в адресе', async () => {
  const gas = createGas();
  const { transport, calls } = wire(gas);
  const res = await transport({ action: 'ping' });
  assert.equal(res.ok, true);
  const { url, init, body } = calls[0];
  assert.equal(url, URL_OK);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(body, { token: 'test-token', action: 'ping' });
  assert.throws(() => createTransport('https://evil.example/exec', 't', async () => {}), SyncError);
});

test('toWire: начальный остаток и пометка demo не уходят, названия подставляются', () => {
  const lookups = {
    categoriesById: new Map([['c', { name: 'Еда' }]]),
    accountsById: new Map([['a', { name: 'Карта' }], ['b', { name: 'Наличные' }]]),
  };
  const account = toWire('accounts', { id: 'a', name: 'Карта', currency: 'KZT', icon: 'wallet', order: 0, hidden: false, deleted: false, deleted_at: null, updated_at: 5, initial_balance: 999 }, lookups);
  assert.ok(!('initial_balance' in account));
  const tx = toWire('transactions', { ...mine({ category_id: 'c', account_id: 'a' }), demo: false, to_account_id: 'b', type: 'transfer' }, lookups);
  assert.ok(!('demo' in tx));
  assert.deepEqual([tx.category, tx.account, tx.to_account], ['Еда', 'Карта', 'Наличные']);
});

// ---------- отправка ----------

test('первая синхронизация: справочники и свои операции уходят, тестовые данные и остатки нет', async () => {
  const gas = createGas();
  const db = await device();
  const card = await db.get('accounts', 'acc-card');
  await db.put('accounts', { ...card, initial_balance: 250200000 });
  await db.putMany('transactions', [mine(), mine({ note: 'Кофе', amount: 150000, category_id: 'cat-cafe' })]);

  const { transport } = wire(gas);
  const result = await syncNow(db, transport, T0 + 5000);
  assert.deepEqual(result.pushed, { categories: 13, accounts: 2, templates: 0, transactions: 2 });

  // порядок строк зависит от случайных id, поэтому сортируем
  const rows = gas.sheet('transactions').objects().sort((x, y) => y['Сумма'] - x['Сумма']);
  assert.deepEqual(rows.map((r) => [r['Заметка'], r['Сумма'], r['Категория'], r['Счёт'], r['Источник']]),
    [['Магазин', 8450.5, 'Еда', 'Карта', 'Вручную'], ['Кофе', 1500, 'Кафе', 'Карта', 'Вручную']]);
  assert.equal(gas.sheet('categories').objects().length, 13);
  assert.ok(!JSON.stringify(gas.sheet('accounts').rows).includes('2502000'), 'начальный остаток не ушёл в таблицу');
  assert.equal(await db.getSetting('sync_error', null), null);
  assert.equal(typeof (await db.getSetting('sync_last_at')), 'number');
  db.close();
});

test('повторная синхронизация без изменений ничего не отправляет', async () => {
  const gas = createGas();
  const db = await device();
  await db.put('transactions', mine());
  const { transport, calls } = wire(gas);
  await syncNow(db, transport, T0 + 5000);
  assert.equal(await hasLocalChanges(db), false);
  calls.length = 0;
  const result = await syncNow(db, transport, T0 + 9000);
  assert.deepEqual(result.pushed, { categories: 0, accounts: 0, templates: 0, transactions: 0 });
  assert.deepEqual(calls.map((c) => c.body.action), ['pull']);
  assert.equal(gas.sheet('transactions').objects().length, 1);
  db.close();
});

test('правка и мягкое удаление доходят до таблицы без дублей', async () => {
  const gas = createGas();
  const db = await device();
  const tx = mine();
  await db.put('transactions', tx);
  const { transport } = wire(gas);
  await syncNow(db, transport, T0 + 5000);

  await db.put('transactions', { ...tx, note: 'Исправлено', updated_at: T0 + 6000 });
  assert.equal(await hasLocalChanges(db), true);
  assert.equal((await syncNow(db, transport, T0 + 7000)).pushed.transactions, 1);
  assert.deepEqual(gas.sheet('transactions').objects().map((r) => r['Заметка']), ['Исправлено']);

  await db.softDelete('transactions', tx.id, T0 + 8000);
  await syncNow(db, transport, T0 + 9000);
  const rows = gas.sheet('transactions').objects();
  assert.deepEqual([rows.length, rows[0]['Удалена'], rows[0].deleted_at], [1, 'да', String(T0 + 8000)]);
  db.close();
});

test('большая пачка делится на запросы не больше 200 записей', async () => {
  const gas = createGas();
  const db = await device({ seed: false });
  await db.put('accounts', { id: 'acc-card', name: 'Карта', currency: 'KZT', icon: 'wallet', order: 0, hidden: false, deleted: false, deleted_at: null, updated_at: T0 });
  await db.putMany('transactions', Array.from({ length: 450 }, (_, i) => mine({ note: `№${i}` })));
  const { transport, calls } = wire(gas);
  const result = await syncNow(db, transport, T0 + 5000);
  assert.equal(result.pushed.transactions, 450);
  const sizes = calls.filter((c) => c.body.transactions).map((c) => c.body.transactions.length);
  assert.deepEqual(sizes, [200, 200, 50]);
  assert.equal(gas.sheet('transactions').objects().length, 450);
  db.close();
});

// ---------- получение ----------

test('второе устройство получает операции и справочники, свой начальный остаток сохраняет', async () => {
  const gas = createGas();
  const a = await device();
  await a.put('transactions', mine());
  const food = await a.get('categories', 'cat-food');
  await a.put('categories', { ...food, name: 'Продукты', updated_at: T0 + 2000 });
  await a.put('templates', { id: 'tpl', name: 'Кофе', type: 'expense', amount: 150000, currency: 'KZT', category_id: 'cat-cafe', account_id: 'acc-card', to_account_id: null, note: '', deleted: false, deleted_at: null, updated_at: T0 + 2000 });
  await syncNow(a, wire(gas).transport, T0 + 5000);

  const b = await device();
  const card = await b.get('accounts', 'acc-card');
  await b.put('accounts', { ...card, initial_balance: 50000 });
  const result = await syncNow(b, wire(gas).transport, T0 + 6000);
  assert.equal(result.pulled.transactions, 1);

  const pulled = (await b.getAll('transactions')).filter((t) => !t.demo);
  assert.equal(pulled.length, 1);
  const { category, account, to_account, ...expected } = toWire('transactions', mine(), { categoriesById: new Map(), accountsById: new Map() });
  assert.deepEqual({ ...pulled[0], id: 'x' }, { ...expected, id: 'x' });
  assert.equal((await b.get('categories', 'cat-food')).name, 'Продукты');
  assert.equal((await b.get('templates', 'tpl')).name, 'Кофе');
  assert.equal((await b.get('accounts', 'acc-card')).initial_balance, 50000);
  a.close(); b.close();
});

test('получение не затирает более свежую локальную запись', async () => {
  const gas = createGas();
  const a = await device();
  const tx = mine();
  await a.put('transactions', tx);
  await syncNow(a, wire(gas).transport, T0 + 5000);

  const b = await device();
  await b.put('transactions', { ...tx, note: 'Свежее на втором устройстве', updated_at: T0 + 50000 });
  await syncNow(b, wire(gas).transport, T0 + 60000);
  assert.equal((await b.get('transactions', tx.id)).note, 'Свежее на втором устройстве');
  assert.equal(gas.sheet('transactions').objects()[0]['Заметка'], 'Свежее на втором устройстве');
  a.close(); b.close();
});

// ---------- inbox ----------

test('inbox: записи из таблицы сохраняются на устройстве и подтверждаются', async () => {
  const gas = createGas();
  const db = await device();
  const first = gas.call({ action: 'add', text: 'Покупка 4 500 ₸ Magnum', source: 'notification', time: '2026-11-13T14:10:00' });
  gas.call({ action: 'add', text: 'Magnum', source: 'applepay', payload: { amount: '4500', merchant: 'Magnum' } });

  const { transport } = wire(gas);
  const result = await syncNow(db, transport, T0 + 5000);
  assert.equal(result.inbox, 2);
  const local = await db.getAll('inbox');
  assert.deepEqual(local.map((i) => [i.text, i.source, i.status]).sort(),
    [['Magnum', 'applepay', 'new'], ['Покупка 4 500 ₸ Magnum', 'notification', 'new']]);
  assert.deepEqual(local.find((i) => i.source === 'applepay').payload, { amount: '4500', merchant: 'Magnum' });
  assert.equal(local.find((i) => i.id === first.id).time, '2026-11-13T14:10:00');
  assert.deepEqual(gas.sheet('inbox').objects().map((r) => r['Статус']), ['fetched', 'fetched']);

  assert.equal((await syncNow(db, transport, T0 + 9000)).inbox, 0);
  assert.equal((await db.getAll('inbox')).length, 2);
  db.close();
});

test('inbox: сбой между сохранением и подтверждением не теряет и не дублирует записи', async () => {
  const gas = createGas();
  const db = await device();
  gas.call({ action: 'add', text: 'Кофе 900', source: 'sms' });

  const broken = wire(gas, { fail: (body) => Array.isArray(body.inbox) });
  await assert.rejects(syncNow(db, broken.transport, T0 + 5000), (error) => error instanceof SyncError && error.code === 'network');
  assert.equal((await db.getAll('inbox')).length, 1, 'запись уже на устройстве');
  assert.equal(gas.sheet('inbox').objects()[0]['Статус'], 'new', 'в таблице она ещё не подтверждена');

  const result = await syncNow(db, wire(gas).transport, T0 + 9000);
  assert.equal(result.inbox, 0, 'повторно как новая не считается');
  assert.equal((await db.getAll('inbox')).length, 1);
  assert.equal(gas.sheet('inbox').objects()[0]['Статус'], 'fetched');
  db.close();
});

test('inbox: разобранная на устройстве запись не возвращается в статус new', async () => {
  const gas = createGas();
  const db = await device();
  const added = gas.call({ action: 'add', text: 'Кофе 900', source: 'sms' });
  const broken = wire(gas, { fail: (body) => Array.isArray(body.inbox) });
  await assert.rejects(syncNow(db, broken.transport, T0 + 5000));
  const local = await db.get('inbox', added.id);
  await db.put('inbox', { ...local, status: 'done' });
  await syncNow(db, wire(gas).transport, T0 + 9000);
  assert.equal((await db.get('inbox', added.id)).status, 'done');
  db.close();
});

// ---------- ошибки ----------

test('неверный токен: понятная ошибка, метки не сдвигаются, после исправления всё уходит', async () => {
  const gas = createGas();
  const db = await device();
  await db.put('transactions', mine());
  await assert.rejects(syncNow(db, wire(gas, { token: 'wrong' }).transport, T0 + 5000), (error) => {
    assert.ok(error instanceof SyncError);
    assert.equal(error.code, 'unauthorized');
    assert.equal(error.message, 'Неверный токен');
    return true;
  });
  assert.deepEqual((await db.getSetting('sync_error')).code, 'unauthorized');
  assert.equal(await hasLocalChanges(db), true);
  assert.equal(gas.sheets.size, 0);

  const result = await syncNow(db, wire(gas).transport, T0 + 9000);
  assert.equal(result.pushed.transactions, 1);
  assert.equal(await db.getSetting('sync_error', null), null);
  db.close();
});

test('обрыв сети посреди отправки: повтор досылает всё без дублей', async () => {
  const gas = createGas();
  const db = await device();
  await db.putMany('transactions', Array.from({ length: 250 }, (_, i) => mine({ note: `№${i}` })));
  // первый запрос с операциями проходит, второй обрывается
  let txCalls = 0;
  const broken = wire(gas, { fail: (body) => Array.isArray(body.transactions) && ++txCalls === 2 });
  await assert.rejects(syncNow(db, broken.transport, T0 + 5000), (error) => error.code === 'network');
  assert.equal(gas.sheet('transactions').objects().length, 200);
  assert.equal(await hasLocalChanges(db), true);

  const result = await syncNow(db, wire(gas).transport, T0 + 9000);
  assert.equal(result.pushed.transactions, 250);
  const ids = gas.sheet('transactions').objects().map((r) => r.id);
  assert.equal(ids.length, 250);
  assert.equal(new Set(ids).size, 250);
  db.close();
});

test('вместо JSON пришла HTML-страница Google: ошибка про адрес и доступ', async () => {
  const fetchImpl = async () => ({ status: 200, text: async () => '<!DOCTYPE html><html><body>Sign in</body></html>' });
  const transport = createTransport(URL_OK, 't', fetchImpl);
  await assert.rejects(transport({ action: 'ping' }), (error) => {
    assert.equal(error.code, 'bad_response');
    assert.match(error.message, /адрес|доступ/);
    assert.ok(!error.message.includes('Unexpected token'));
    return true;
  });
});

test('ошибки сервера переводятся в понятные сообщения', async () => {
  const transport = createTransport(URL_OK, 'x', async () => ({ status: 200, text: async () => JSON.stringify({ ok: false, error: 'not_configured', message: 'm' }) }));
  await assert.rejects(transport({ action: 'ping' }), (error) => error.code === 'not_configured' && /setup/.test(error.message));
  const busy = createTransport(URL_OK, 'x', async () => ({ status: 200, text: async () => JSON.stringify({ ok: false, error: 'busy', message: 'm' }) }));
  await assert.rejects(busy({ action: 'ping' }), (error) => error.code === 'busy');
});

test('отклонённые сервером записи видны в результате', async () => {
  const gas = createGas();
  const db = await device();
  await db.put('transactions', { ...mine(), date: 'мусор' });
  const result = await syncNow(db, wire(gas).transport, T0 + 5000);
  assert.equal(result.rejected, 1);
  assert.equal(gas.sheet('transactions').objects().length, 0);
  db.close();
});

test('дубль по fingerprint: своя копия мягко удаляется, приходит операция с другого устройства', async () => {
  const gas = createGas();
  const a = await device();
  const b = await device();
  const fromA = mine({ fingerprint: 'inbox:same', note: 'с устройства А' });
  const fromB = mine({ fingerprint: 'inbox:same', note: 'с устройства Б' });
  await a.put('transactions', fromA);
  await b.put('transactions', fromB);
  await syncNow(a, wire(gas).transport, T0 + 5000);

  const result = await syncNow(b, wire(gas).transport, T0 + 6000);
  assert.deepEqual(result.duplicates, [{ id: fromB.id, existing_id: fromA.id }]);
  assert.equal((await b.get('transactions', fromB.id)).deleted, true);
  assert.equal((await b.get('transactions', fromA.id)).note, 'с устройства А');
  assert.equal(gas.sheet('transactions').objects().length, 1);

  // следующая синхронизация не зацикливается и не плодит строки
  await syncNow(b, wire(gas).transport, T0 + 7000);
  assert.equal(gas.sheet('transactions').objects().length, 1);
  a.close(); b.close();
});

test('получение не стирает локальные поля операции', async () => {
  const gas = createGas();
  const a = await device();
  const tx = { ...mine(), merchant: 'Магазин', sources: ['applepay'], inbox_ids: ['i1'] };
  await a.put('transactions', tx);
  await syncNow(a, wire(gas).transport, T0 + 5000);
  // правка «с другого устройства»: в таблице появляется более новая версия
  gas.tick();
  gas.call({ action: 'upsert', transactions: [{ ...toWire('transactions', tx, { categoriesById: new Map(), accountsById: new Map() }), note: 'Новая заметка', updated_at: T0 + 6000 }] });
  await syncNow(a, wire(gas).transport, T0 + 7000);
  const local = await a.get('transactions', tx.id);
  assert.deepEqual([local.note, local.merchant, local.sources, local.inbox_ids], ['Новая заметка', 'Магазин', ['applepay'], ['i1']]);
  a.close();
});
