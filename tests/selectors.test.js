import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthSummary, groupByDay, accountBalances, totalBalance } from '../js/selectors.js';

const base = {
  currency: 'KZT', type: 'expense', category_id: 'food', account_id: 'A', to_account_id: null,
  note: '', deleted: false,
};
const txs = [
  { ...base, id: 'inc', date: '2026-11-01T10:00:00', amount: 50000000, type: 'income', category_id: 'salary' },
  { ...base, id: 'exp', date: '2026-11-01T00:00:00', amount: 450000, note: 'кофе с собой', category_id: 'cafe' },
  { ...base, id: 'oct', date: '2026-10-31T23:59:59', amount: 100000 },
  { ...base, id: 'tr', date: '2026-11-05T12:00:00', amount: 2000000, type: 'transfer', category_id: null, to_account_id: 'B' },
  { ...base, id: 'del', date: '2026-11-05T13:00:00', amount: 999900, deleted: true },
  { ...base, id: 'usd', date: '2026-11-06T09:00:00', amount: 1000, currency: 'USD' },
];
const accounts = [
  { id: 'A', currency: 'KZT', initial_balance: 10000000 },
  { id: 'B', currency: 'KZT', initial_balance: 0 },
];
const categoriesById = new Map([
  ['food', { id: 'food', name: 'Продукты' }],
  ['cafe', { id: 'cafe', name: 'Кафе' }],
  ['salary', { id: 'salary', name: 'Зарплата' }],
]);

test('monthSummary: перевод, удалённая, другая валюта и соседний месяц не входят', () => {
  assert.deepEqual(monthSummary(txs, '2026-11'), { income: 50000000, expense: 450000, balance: 49550000 });
});
test('monthSummary: граница месяца', () => {
  assert.deepEqual(monthSummary(txs, '2026-10'), { income: 0, expense: 100000, balance: -100000 });
});
test('monthSummary: фильтр по счёту', () => {
  assert.deepEqual(monthSummary(txs, '2026-11', { accountId: 'B' }), { income: 0, expense: 0, balance: 0 });
});

test('groupByDay: дни по убыванию, подитоги', () => {
  const days = groupByDay(txs, '2026-11');
  assert.deepEqual(days.map((d) => d.day), ['2026-11-06', '2026-11-05', '2026-11-01']);
  assert.deepEqual(days[1].items.map((t) => t.id), ['tr']); // удалённой нет
  assert.equal(days[1].total, 0);                            // перевод не влияет
  assert.deepEqual(days[0].items.map((t) => t.id), ['usd']);
  assert.equal(days[0].total, 0);                            // другая валюта не входит в подитог
  assert.deepEqual(days[2].items.map((t) => t.id), ['inc', 'exp']); // внутри дня по убыванию времени
  assert.equal(days[2].total, 49550000);
});
test('groupByDay: поиск по заметке и по названию категории без учёта регистра', () => {
  assert.deepEqual(groupByDay(txs, '2026-11', { query: 'КОФЕ', categoriesById })[0].items.map((t) => t.id), ['exp']);
  assert.deepEqual(groupByDay(txs, '2026-11', { query: 'зарпл', categoriesById })[0].items.map((t) => t.id), ['inc']);
  assert.deepEqual(groupByDay(txs, '2026-11', { query: 'нет такого', categoriesById }), []);
});
test('groupByDay: фильтр по счёту включает переводы на этот счёт', () => {
  const days = groupByDay(txs, '2026-11', { accountId: 'B' });
  assert.deepEqual(days.flatMap((d) => d.items.map((t) => t.id)), ['tr']);
});

test('accountBalances: начальный остаток, операции и переводы', () => {
  const b = accountBalances(accounts, txs);
  assert.equal(b.get('A'), 10000000 + 50000000 - 450000 - 100000 - 2000000);
  assert.equal(b.get('B'), 2000000);
});
test('totalBalance: перевод не меняет общий остаток', () => {
  const withoutTransfer = txs.filter((t) => t.id !== 'tr');
  assert.equal(totalBalance(accounts, txs), totalBalance(accounts, withoutTransfer));
  assert.equal(totalBalance(accounts, txs), 59450000);
});
