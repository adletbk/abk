import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../js/db.js';
import {
  moveItem, usageCount, reassignCategory, templateFromTransaction, fieldsFromTemplate,
} from '../js/catalog.js';

const fresh = () => openDb({ indexedDB: new IDBFactory() });

test('moveItem: переставляет и нумерует по порядку', () => {
  const list = [
    { id: 'a', order: 0, updated_at: 1 }, { id: 'b', order: 1, updated_at: 1 },
    { id: 'c', order: 2, updated_at: 1 }, { id: 'd', order: 3, updated_at: 1 },
  ];
  const moved = moveItem(list, 0, 2, 99);
  assert.deepEqual(moved.map((c) => [c.id, c.order]), [['b', 0], ['c', 1], ['a', 2], ['d', 3]]);
  // updated_at меняется только у тех, чей порядок изменился: меньше записей уйдёт в синхронизацию
  assert.deepEqual(moved.map((c) => c.updated_at), [99, 99, 99, 1]);
  assert.deepEqual(list.map((c) => c.id), ['a', 'b', 'c', 'd'], 'исходный список не меняется');
});
test('moveItem: тот же индекс и индекс за границей', () => {
  const list = [{ id: 'a', order: 0, updated_at: 1 }, { id: 'b', order: 1, updated_at: 1 }];
  assert.deepEqual(moveItem(list, 1, 1, 99), list);
  assert.deepEqual(moveItem(list, 0, 10, 99).map((c) => c.id), ['b', 'a']);
  assert.deepEqual(moveItem(list, 1, -5, 99).map((c) => c.id), ['b', 'a']);
});

test('usageCount: считает живые операции', () => {
  const txs = [
    { category_id: 'food', account_id: 'A', deleted: false },
    { category_id: 'food', account_id: 'B', deleted: false },
    { category_id: 'food', account_id: 'A', deleted: true },
    { category_id: null, account_id: 'A', to_account_id: 'B', deleted: false },
  ];
  assert.deepEqual([...usageCount(txs, 'category_id')], [['food', 2]]);
  // у счетов учитывается и счёт зачисления перевода
  assert.deepEqual([...usageCount(txs, 'account_id')].sort(), [['A', 2], ['B', 2]]);
});

test('reassignCategory: переносит операции и шаблоны, категорию удаляет мягко', async () => {
  const db = await fresh();
  await db.putMany('categories', [{ id: 'old', name: 'Старая' }, { id: 'new', name: 'Новая' }]);
  await db.putMany('transactions', [
    { id: '1', category_id: 'old', updated_at: 1 },
    { id: '2', category_id: 'old', updated_at: 1, deleted: true },
    { id: '3', category_id: 'new', updated_at: 1 },
  ]);
  await db.put('templates', { id: 't', category_id: 'old', updated_at: 1 });

  const moved = await reassignCategory(db, 'old', 'new', 500);
  assert.equal(moved, 2);
  const byId = new Map((await db.getAll('transactions')).map((t) => [t.id, t]));
  assert.deepEqual([byId.get('1').category_id, byId.get('1').updated_at], ['new', 500]);
  assert.equal(byId.get('2').category_id, 'new', 'удалённые тоже переносятся: иначе останется ссылка на удалённую категорию');
  assert.equal(byId.get('3').updated_at, 1, 'чужие операции не трогаются');
  assert.equal((await db.get('templates', 't')).category_id, 'new');
  const old = await db.get('categories', 'old');
  assert.deepEqual([old.deleted, old.deleted_at, old.name], [true, 500, 'Старая']);
  db.close();
});

test('reassignCategory: нельзя перенести в саму себя или в несуществующую', async () => {
  const db = await fresh();
  await db.put('categories', { id: 'old', name: 'Старая' });
  await assert.rejects(reassignCategory(db, 'old', 'old', 1));
  await assert.rejects(reassignCategory(db, 'old', 'нет', 1));
  assert.equal((await db.get('categories', 'old')).deleted, undefined);
  db.close();
});

test('шаблон: из операции и обратно', () => {
  const fields = {
    type: 'expense', amount: 150000, currency: 'KZT', category_id: 'cafe', account_id: 'card',
    to_account_id: null, note: 'Кофе', date: '2026-11-13T10:00:00', id: 'tx', source: 'applepay',
  };
  const template = templateFromTransaction(fields, '  Утренний кофе ', 700);
  assert.match(template.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...template, id: 'x' }, {
    id: 'x', name: 'Утренний кофе', type: 'expense', amount: 150000, currency: 'KZT', category_id: 'cafe',
    account_id: 'card', to_account_id: null, note: 'Кофе', deleted: false, deleted_at: null, updated_at: 700,
  });
  assert.deepEqual(fieldsFromTemplate(template), {
    type: 'expense', amount: 150000, currency: 'KZT', category_id: 'cafe', account_id: 'card',
    to_account_id: null, note: 'Кофе',
  });
});
