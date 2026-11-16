import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDb, MIGRATIONS } from '../js/db.js';
import { seedIfEmpty, clearDemo } from '../js/seed.js';

const fresh = () => openDb({ indexedDB: new IDBFactory() });
const tx = (id, extra = {}) => ({ id, date: '2026-11-01T10:00:00', amount: 100, deleted: false, ...extra });

test('схема: все хранилища созданы', async () => {
  const db = await fresh();
  assert.deepEqual(db.storeNames(), [
    'accounts', 'categories', 'inbox', 'planned', 'rules', 'settings', 'templates', 'transactions',
  ]);
  db.close();
});

test('put, get, getAll', async () => {
  const db = await fresh();
  await db.put('transactions', tx('1'));
  await db.put('transactions', tx('2'));
  assert.equal((await db.get('transactions', '1')).amount, 100);
  assert.equal(await db.get('transactions', 'нет'), undefined);
  assert.equal((await db.getAll('transactions')).length, 2);
  db.close();
});

test('put с тем же id обновляет запись, а не создаёт дубль', async () => {
  const db = await fresh();
  await db.put('transactions', tx('1'));
  await db.put('transactions', tx('1', { amount: 500 }));
  const all = await db.getAll('transactions');
  assert.equal(all.length, 1);
  assert.equal(all[0].amount, 500);
  db.close();
});

test('softDelete: запись остаётся с флагом и временем', async () => {
  const db = await fresh();
  await db.put('transactions', tx('1'));
  await db.softDelete('transactions', '1', 12345);
  const got = await db.get('transactions', '1');
  assert.equal(got.deleted, true);
  assert.equal(got.deleted_at, 12345);
  assert.equal(got.updated_at, 12345);
  assert.equal(got.amount, 100);
  db.close();
});

test('putMany атомарен: при ошибке не пишется ничего', async () => {
  const db = await fresh();
  await assert.rejects(db.putMany('transactions', [tx('1'), { amount: 5 /* нет id */ }]));
  assert.equal((await db.getAll('transactions')).length, 0);
  db.close();
});

test('настройки: значение по умолчанию и запись', async () => {
  const db = await fresh();
  assert.equal(await db.getSetting('x', 'нет'), 'нет');
  await db.setSetting('x', { a: 1 });
  assert.deepEqual(await db.getSetting('x', 'нет'), { a: 1 });
  db.close();
});

test('миграция: данные v1 сохраняются при обновлении схемы', async () => {
  const idb = new IDBFactory();
  const v1 = await openDb({ indexedDB: idb });
  await v1.put('transactions', tx('keep', { amount: 777 }));
  await v1.setSetting('token', 'секрет');
  v1.close();

  const migrations = [...MIGRATIONS, (db) => db.createObjectStore('x', { keyPath: 'id' })];
  const v2 = await openDb({ indexedDB: idb, migrations });
  assert.equal((await v2.get('transactions', 'keep')).amount, 777);
  assert.equal(await v2.getSetting('token'), 'секрет');
  assert.ok(v2.storeNames().includes('x'));
  v2.close();
});

test('seedIfEmpty: заполняет один раз', async () => {
  const db = await fresh();
  const now = new Date(2026, 10, 13, 12, 0, 0).getTime();
  assert.equal(await seedIfEmpty(db, now), true);
  const accounts = await db.getAll('accounts');
  const cats = await db.getAll('categories');
  const txs = await db.getAll('transactions');
  assert.deepEqual(accounts.map((a) => a.name).sort(), ['Карта', 'Наличные']);
  assert.equal(cats.filter((c) => c.type === 'expense').length, 10);
  assert.equal(cats.filter((c) => c.type === 'income').length, 3);
  assert.ok(txs.length >= 20);
  assert.ok(txs.every((t) => t.demo === true && Number.isInteger(t.amount) && t.amount > 0));
  assert.ok(txs.every((t) => t.date <= '2026-11-13T23:59:59'), 'нет операций в будущем');
  const catIds = new Set(cats.map((c) => c.id));
  assert.ok(txs.every((t) => t.type === 'transfer' || catIds.has(t.category_id)));
  assert.equal(await db.getSetting('demo'), true);

  assert.equal(await seedIfEmpty(db, now), false);
  assert.equal((await db.getAll('transactions')).length, txs.length);
  db.close();
});

test('clearDemo: удаляет только тестовые операции', async () => {
  const db = await fresh();
  await seedIfEmpty(db, Date.now());
  await db.put('transactions', tx('mine'));
  await clearDemo(db);
  assert.deepEqual((await db.getAll('transactions')).map((t) => t.id), ['mine']);
  assert.equal(await db.getSetting('demo', false), false);
  assert.equal((await db.getAll('categories')).length, 13);
  db.close();
});
