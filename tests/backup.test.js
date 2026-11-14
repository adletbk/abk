import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../js/db.js';
import { seedIfEmpty } from '../js/seed.js';
import { exportBackup, validateBackup, importBackup, transactionsToCsv } from '../js/backup.js';

const fresh = () => openDb({ indexedDB: new IDBFactory() });
const NOW = new Date(2026, 10, 13, 12, 0, 0).getTime();

async function seeded() {
  const db = await fresh();
  await seedIfEmpty(db, NOW);
  await db.setSetting('last_account_id', 'acc-cash');
  const card = await db.get('accounts', 'acc-card');
  await db.put('accounts', { ...card, initial_balance: 12345600 });
  return db;
}

test('exportBackup: формат, версия и все хранилища', async () => {
  const db = await seeded();
  const backup = await exportBackup(db, NOW);
  assert.equal(backup.format, 'finance-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.exported_at, new Date(NOW).toISOString());
  assert.deepEqual(Object.keys(backup.data).sort(),
    ['accounts', 'categories', 'inbox', 'rules', 'settings', 'templates', 'transactions']);
  assert.equal(backup.data.transactions.length, 25);
  // начальные остатки входят в бэкап: в таблицу они не уходят
  assert.equal(backup.data.accounts.find((a) => a.id === 'acc-card').initial_balance, 12345600);
  db.close();
});

test('бэкап переживает JSON и восстанавливается в пустую базу', async () => {
  const source = await seeded();
  const json = JSON.stringify(await exportBackup(source, NOW));
  const target = await fresh();
  const result = await importBackup(target, JSON.parse(json));
  assert.equal(result.counts.transactions, 25);
  for (const store of ['transactions', 'categories', 'accounts', 'templates', 'settings']) {
    const sort = (rows) => rows.map((r) => JSON.stringify(r)).sort();
    assert.deepEqual(sort(await target.getAll(store)), sort(await source.getAll(store)), store);
  }
  assert.equal(await target.getSetting('last_account_id'), 'acc-cash');
  source.close(); target.close();
});

test('importBackup заменяет данные целиком, а не дописывает', async () => {
  const db = await seeded();
  const backup = await exportBackup(db, NOW);
  await db.put('transactions', { id: 'после-бэкапа', date: '2026-11-13T10:00:00', amount: 1 });
  await importBackup(db, backup);
  assert.equal(await db.get('transactions', 'после-бэкапа'), undefined);
  assert.equal((await db.getAll('transactions')).length, 25);
  db.close();
});

test('validateBackup: чужой и повреждённый файл', () => {
  assert.deepEqual(validateBackup(null), ['Это не файл бэкапа приложения']);
  assert.deepEqual(validateBackup({ format: 'other', version: 1, data: {} }), ['Это не файл бэкапа приложения']);
  assert.deepEqual(validateBackup({ format: 'finance-backup', version: 99, data: {} }),
    ['Бэкап создан в более новой версии приложения. Обновите приложение и повторите']);
  assert.deepEqual(validateBackup({ format: 'finance-backup', version: 1, data: { transactions: 'x' } }),
    ['Файл бэкапа повреждён: transactions']);
  assert.deepEqual(validateBackup({ format: 'finance-backup', version: 1, data: { transactions: [{ amount: 1 }] } }),
    ['Файл бэкапа повреждён: transactions']);
  assert.deepEqual(validateBackup({ format: 'finance-backup', version: 1, data: { settings: [{ value: 1 }] } }),
    ['Файл бэкапа повреждён: settings']);
});

test('importBackup: невалидный файл не трогает текущие данные', async () => {
  const db = await seeded();
  await assert.rejects(importBackup(db, { format: 'finance-backup', version: 1, data: { transactions: [{ amount: 1 }] } }),
    /повреждён/);
  await assert.rejects(importBackup(db, { hello: 'world' }), /не файл бэкапа/);
  assert.equal((await db.getAll('transactions')).length, 25);
  assert.equal((await db.getAll('accounts')).length, 2);
  db.close();
});

test('importBackup: отсутствующее в файле хранилище очищается', async () => {
  const db = await seeded();
  await importBackup(db, { format: 'finance-backup', version: 1, data: { accounts: [{ id: 'a', name: 'Счёт' }] } });
  assert.equal((await db.getAll('transactions')).length, 0);
  assert.deepEqual((await db.getAll('accounts')).map((a) => a.id), ['a']);
  db.close();
});

// ---------- csv ----------

const categoriesById = new Map([['food', { name: 'Еда' }], ['salary', { name: 'Зарплата' }]]);
const accountsById = new Map([['card', { name: 'Карта' }], ['cash', { name: 'Наличные' }]]);
const row = (extra) => ({
  id: 'x', date: '2026-11-13T14:10:00', amount: 845000, currency: 'KZT', type: 'expense',
  category_id: 'food', account_id: 'card', to_account_id: null, note: '', source: 'applepay', deleted: false, ...extra,
});
const csv = (txs, period = {}) => transactionsToCsv(txs, { categoriesById, accountsById, ...period });
const lines = (text) => text.slice(1).split('\r\n');

test('csv: BOM, заголовок, запятая, CRLF', () => {
  const text = csv([row()]);
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.deepEqual(lines(text), [
    'Дата,Время,Сумма,Валюта,Тип,Категория,Счёт,Счёт зачисления,Заметка,Источник',
    '2026-11-13,14:10,8450,KZT,Расход,Еда,Карта,,,Apple Pay',
    '',
  ]);
});
test('csv: сумма числом с точкой, тип словом, перевод', () => {
  const text = csv([
    row({ amount: 845050 }),
    row({ id: 'i', type: 'income', category_id: 'salary', amount: 52000000, source: 'import' }),
    row({ id: 't', type: 'transfer', category_id: null, to_account_id: 'cash', amount: 3000000, source: 'manual' }),
  ]);
  assert.deepEqual(lines(text).slice(1, 4), [
    '2026-11-13,14:10,8450.5,KZT,Расход,Еда,Карта,,,Apple Pay',
    '2026-11-13,14:10,520000,KZT,Доход,Зарплата,Карта,,,Импорт выписки',
    '2026-11-13,14:10,30000,KZT,Перевод,,Карта,Наличные,,Вручную',
  ]);
});
test('csv: запятые, кавычки и переводы строк в заметке не сдвигают колонки', () => {
  const text = csv([row({ note: 'Магазин, "Small"\nвторая строка' })]);
  assert.equal(lines(text)[1], '2026-11-13,14:10,8450,KZT,Расход,Еда,Карта,,"Магазин, ""Small"" вторая строка",Apple Pay');
});
test('csv: защита от формул', () => {
  for (const note of ['=SUM(A1)', '+7 700', '-скидка', '@user']) {
    assert.ok(lines(csv([row({ note })]))[1].includes(`,'${note},`), note);
  }
});
test('csv: период включительно, удалённые не попадают, сортировка по дате', () => {
  const text = csv([
    row({ id: 'c', date: '2026-11-30T23:59:59' }),
    row({ id: 'a', date: '2026-11-01T00:00:00' }),
    row({ id: 'before', date: '2026-10-31T23:59:59' }),
    row({ id: 'after', date: '2026-12-01T00:00:00' }),
    row({ id: 'gone', date: '2026-11-10T10:00:00', deleted: true }),
  ], { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(lines(text).slice(1, -1).map((l) => l.slice(0, 16)), ['2026-11-01,00:00', '2026-11-30,23:59']);
});
