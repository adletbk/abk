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

// ---------- палитра, иконки, подкатегории ----------
const { PALETTE, orderedCategories, categoryPath, rollupId, validParents } = await import('../js/catalog.js');
const { ICON_GROUPS, ICON_NODES } = await import('../js/icons-data.js');

test('палитра: не меньше 16 разных ярких цветов', () => {
  assert.ok(PALETTE.length >= 16);
  assert.equal(new Set(PALETTE).size, PALETTE.length);
  assert.ok(PALETTE.every((c) => /^#[0-9A-F]{6}$/.test(c)));
});
test('иконки: каждая иконка из разделов существует и не повторяется', () => {
  const all = ICON_GROUPS.flatMap((g) => g.icons);
  assert.ok(ICON_GROUPS.length >= 10 && all.length >= 120);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every((name) => Array.isArray(ICON_NODES[name]) && ICON_NODES[name].length > 0));
});

const cats = [
  { id: 'food', name: 'Еда', type: 'expense', order: 1 },
  { id: 'home', name: 'Дом', type: 'expense', order: 0 },
  { id: 'cafe', name: 'Кафе', type: 'expense', order: 5, parent_id: 'food' },
  { id: 'grocery', name: 'Продукты', type: 'expense', order: 2, parent_id: 'food' },
  { id: 'orphan', name: 'Сирота', type: 'expense', order: 9, parent_id: 'нет-такой' },
  { id: 'gone', name: 'Удалённая', type: 'expense', order: 3, deleted: true },
  { id: 'lost', name: 'Потерянная', type: 'expense', order: 4, parent_id: 'gone' },
  { id: 'salary', name: 'Зарплата', type: 'income', order: 0 },
];
const byId = new Map(cats.map((c) => [c.id, c]));

test('orderedCategories: родители по порядку, подкатегории сразу после родителя', () => {
  const live = cats.filter((c) => !c.deleted && c.type === 'expense');
  assert.deepEqual(orderedCategories(live).map((c) => [c.id, c.depth]),
    [['home', 0], ['food', 0], ['grocery', 1], ['cafe', 1], ['lost', 0], ['orphan', 0]]);
});
test('categoryPath и rollupId', () => {
  assert.equal(categoryPath('cafe', byId), 'Еда / Кафе');
  assert.equal(categoryPath('food', byId), 'Еда');
  assert.equal(categoryPath('orphan', byId), 'Сирота');
  assert.equal(categoryPath('lost', byId), 'Потерянная', 'родитель удалён — показываем без него');
  assert.equal(categoryPath(null, byId), '');
  assert.equal(rollupId('cafe', byId), 'food');
  assert.equal(rollupId('food', byId), 'food');
  assert.equal(rollupId('orphan', byId), 'orphan');
  assert.equal(rollupId(null, byId), null);
});
test('validParents: только категории верхнего уровня того же типа; у категории с детьми родителя быть не может', () => {
  assert.deepEqual(validParents(byId.get('cafe'), cats).map((c) => c.id), ['home', 'food']);
  assert.deepEqual(validParents({ id: 'new', type: 'income' }, cats).map((c) => c.id), ['salary']);
  assert.deepEqual(validParents(byId.get('food'), cats), []);
});
