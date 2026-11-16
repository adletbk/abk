import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newPlanned, validatePlanned, occurrences, statusOf, schedule, overdue, scheduleSummary, markPlanned, monthGrid, monthRange,
} from '../js/planned.js';

const NOW = new Date(2026, 10, 16, 12, 0, 0).getTime();
const TODAY = '2026-11-16';
const plan = (fields) => newPlanned({ name: 'Подписка', category_id: 'subs', amount: 499000, start: '2026-11-10', ...fields }, NOW);

test('новый платёж: проверка полей', () => {
  assert.deepEqual(validatePlanned(plan()), []);
  assert.deepEqual(validatePlanned(plan({ amount: null })), []);
  assert.ok(validatePlanned(plan({ name: '  ' })).includes('Введите название'));
  assert.ok(validatePlanned(plan({ category_id: null })).includes('Выберите категорию'));
  assert.ok(validatePlanned(plan({ start: '10.11.2026' })).includes('Выберите дату платежа'));
  assert.equal(validatePlanned(plan({ amount: 0 })).length, 1);
  assert.equal(validatePlanned(plan({ amount: 10.5 })).length, 1);
  assert.equal(validatePlanned(plan({ repeat: 'daily' })).length, 1);
});

test('разовый платёж: одна дата', () => {
  const p = plan({ repeat: 'once' });
  assert.deepEqual(occurrences(p, '2026-11-01', '2026-11-30'), ['2026-11-10']);
  assert.deepEqual(occurrences(p, '2026-12-01', '2026-12-31'), []);
  assert.deepEqual(occurrences(p, '2026-10-01', '2026-10-31'), []);
});

test('ежемесячный платёж: каждый месяц начиная с первой даты', () => {
  const p = plan({ repeat: 'month' });
  assert.deepEqual(occurrences(p, '2026-10-01', '2026-10-31'), []);
  assert.deepEqual(occurrences(p, '2026-11-01', '2026-11-30'), ['2026-11-10']);
  assert.deepEqual(occurrences(p, '2026-11-11', '2027-02-09'), ['2026-12-10', '2027-01-10']);
  assert.deepEqual(occurrences(p, '2026-11-10', '2026-11-10'), ['2026-11-10']);
});

test('ежемесячный платёж 31-го числа прижимается к концу короткого месяца', () => {
  const p = plan({ repeat: 'month', start: '2026-01-31' });
  assert.deepEqual(occurrences(p, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(occurrences(p, '2028-02-01', '2028-02-29'), ['2028-02-29']);
});

test('еженедельный платёж: шаг семь дней от первой даты', () => {
  const p = plan({ repeat: 'week', start: '2026-11-03' });
  assert.deepEqual(occurrences(p, '2026-11-01', '2026-11-30'), ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
  assert.deepEqual(occurrences(p, '2026-11-11', '2026-11-17'), ['2026-11-17']);
  assert.deepEqual(occurrences(p, '2026-10-01', '2026-11-02'), []);
});

test('ежегодный платёж: 29 февраля в невисокосный год — 28-е', () => {
  const p = plan({ repeat: 'year', start: '2024-02-29' });
  assert.deepEqual(occurrences(p, '2024-01-01', '2028-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.deepEqual(occurrences(p, '2026-03-01', '2026-12-31'), []);
});

test('состояние: к оплате, просрочен, оплачен, пропущен', () => {
  const p = plan();
  assert.equal(statusOf(p, '2026-11-10', TODAY), 'late');
  assert.equal(statusOf(p, '2026-11-16', TODAY), 'due');
  assert.equal(statusOf(p, '2026-12-10', TODAY), 'due');
  const paid = markPlanned(p, '2026-11-10', 'paid', { txId: 't1', now: NOW });
  assert.equal(statusOf(paid, '2026-11-10', TODAY), 'paid');
  assert.equal(statusOf(paid, '2026-12-10', TODAY), 'due');
  assert.equal(p.marks['2026-11-10'], undefined, 'исходная запись не меняется');
  assert.equal(statusOf(markPlanned(p, '2026-11-10', 'skipped'), '2026-11-10', TODAY), 'skipped');
  assert.equal(statusOf(markPlanned(paid, '2026-11-10', null), '2026-11-10', TODAY), 'late');
});

test('если операцию оплаты удалили, платёж снова не оплачен', () => {
  const paid = markPlanned(plan(), '2026-11-10', 'paid', { txId: 't1' });
  assert.equal(statusOf(paid, '2026-11-10', TODAY, new Set(['t1'])), 'paid');
  assert.equal(statusOf(paid, '2026-11-10', TODAY, new Set()), 'late');
  const manual = markPlanned(plan(), '2026-11-10', 'paid');
  assert.equal(statusOf(manual, '2026-11-10', TODAY, new Set()), 'paid', 'отметка без операции остаётся');
});

test('расписание месяца: по дате, без удалённых', () => {
  const a = plan({ name: 'Б', start: '2026-11-25' });
  const b = plan({ name: 'А', start: '2026-11-25' });
  const c = plan({ name: 'В', start: '2026-11-05' });
  const gone = plan({ name: 'Удалён', deleted: true });
  const items = schedule([a, b, c, gone], '2026-11-01', '2026-11-30', TODAY);
  assert.deepEqual(items.map((i) => `${i.day} ${i.payment.name} ${i.status}`), [
    '2026-11-05 В late', '2026-11-25 А due', '2026-11-25 Б due',
  ]);
});

test('просроченные раньше: только неоплаченные до указанной даты', () => {
  const p = plan({ start: '2026-08-10' });
  const paid = markPlanned(markPlanned(p, '2026-08-10', 'paid'), '2026-10-10', 'skipped');
  assert.deepEqual(overdue([paid], '2026-11-01', TODAY).map((i) => i.day), ['2026-09-10']);
  assert.deepEqual(overdue([paid], '2026-11-16', TODAY).map((i) => i.day), ['2026-09-10', '2026-11-10']);
});

test('итоги: осталось, оплачено по факту, просрочено, без суммы', () => {
  const a = markPlanned(plan({ start: '2026-11-05' }), '2026-11-05', 'paid', { txId: 't1' });
  const b = markPlanned(plan({ start: '2026-11-06', amount: 100000 }), '2026-11-06', 'paid');
  const c = plan({ start: '2026-11-12', amount: 229000 });
  const d = plan({ start: '2026-11-20', amount: null });
  const e = markPlanned(plan({ start: '2026-11-21' }), '2026-11-21', 'skipped');
  const usd = plan({ start: '2026-11-22', currency: 'USD' });
  const items = schedule([a, b, c, d, e, usd], '2026-11-01', '2026-11-30', TODAY);
  assert.deepEqual(scheduleSummary(items, { txAmounts: new Map([['t1', 510000]]) }), {
    left: 229000, paid: 610000, late: 1, unknown: 1, leftCount: 2, paidCount: 2,
  });
});

test('сетка месяца начинается с понедельника', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  const grid = monthGrid('2026-11'); // 1 ноября 2026 — воскресенье
  assert.equal(grid.length, 6);
  assert.deepEqual(grid[0], [null, null, null, null, null, null, '2026-11-01']);
  assert.equal(grid[5][0], '2026-11-30');
  assert.ok(grid.every((week) => week.length === 7));
  assert.equal(monthGrid('2026-06')[0][0], '2026-06-01'); // 1 июня 2026 — понедельник
});
