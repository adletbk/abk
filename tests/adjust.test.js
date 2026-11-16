import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADJUST_IDS, ADJUST_NAME, adjustCategory, adjustmentFor, isAdjustment, isAdjustCategory } from '../js/adjust.js';
import { monthSummary, groupByDay, accountBalances } from '../js/selectors.js';
import { categoryBreakdown, largestExpense, transactionCount } from '../js/analytics.js';
import { validateTransaction } from '../js/model.js';

const NOW = new Date(2026, 10, 16, 12, 0, 0).getTime();
const account = { id: 'A', currency: 'KZT', initial_balance: 0 };

test('корректировка вверх — доход, вниз — расход, на разницу остатков', () => {
  const up = adjustmentFor(account, 100000, 150050, NOW);
  assert.equal(up.type, 'income');
  assert.equal(up.amount, 50050);
  assert.equal(up.category_id, ADJUST_IDS.income);
  assert.equal(up.account_id, 'A');
  assert.equal(up.currency, 'KZT');
  assert.deepEqual(validateTransaction(up), []);

  const down = adjustmentFor(account, -5270176, 0, NOW);
  assert.equal(down.type, 'income');
  assert.equal(down.amount, 5270176);

  const minus = adjustmentFor(account, 1000, -2500, NOW);
  assert.equal(minus.type, 'expense');
  assert.equal(minus.amount, 3500);
  assert.equal(minus.category_id, ADJUST_IDS.expense);
});

test('если остаток уже такой, операции нет', () => {
  assert.equal(adjustmentFor(account, 500, 500, NOW), null);
});

test('служебная категория скрыта, id подходит для протокола синхронизации', () => {
  for (const type of ['income', 'expense']) {
    const category = adjustCategory(type, NOW);
    assert.equal(category.name, ADJUST_NAME);
    assert.equal(category.type, type);
    assert.equal(category.hidden, true);
    assert.match(category.id, /^[A-Za-z0-9_-]{1,64}$/);
    assert.ok(isAdjustCategory(category));
  }
  assert.equal(isAdjustCategory({ id: 'food' }), false);
});

test('корректировка меняет остаток счёта, но не входит в доходы, расходы и аналитику', () => {
  const spend = { id: 's', date: '2026-11-16T09:00:00', amount: 2000, type: 'expense', currency: 'KZT', account_id: 'A', category_id: 'food' };
  const fix = adjustmentFor(account, -2000, 10000, NOW);
  const txs = [spend, fix];
  assert.ok(isAdjustment(fix));
  assert.equal(isAdjustment(spend), false);
  assert.equal(accountBalances([account], txs).get('A'), 10000);
  assert.deepEqual(monthSummary(txs, '2026-11'), { income: 0, expense: 2000, balance: -2000 });
  const [day] = groupByDay(txs, '2026-11');
  assert.equal(day.items.length, 2);
  assert.equal(day.total, -2000);
  const opts = { today: '2026-11-16' };
  assert.deepEqual(categoryBreakdown(txs, '2026-11', { ...opts, type: 'income' }), []);
  assert.equal(transactionCount(txs, '2026-11', opts), 1);
  assert.equal(largestExpense([adjustmentFor(account, 5000, 0, NOW)], '2026-11', opts), null);
});
