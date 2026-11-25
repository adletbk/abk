import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryReport, isLongPeriod, reportDays, reportMonths, shareText } from '../js/category-report.js';
import { categoryBreakdown } from '../js/analytics.js';

const TODAY = '2026-11-20';
const parentOf = new Map([['food', 'food'], ['cafe', 'food'], ['grocery', 'food'], ['home', 'home']]);
let n = 0;
const tx = (date, amount, category_id, extra = {}) => ({
  id: `t${++n}`, date: `${date}T12:00:00`, amount, category_id, type: 'expense', currency: 'KZT', account_id: 'A', deleted: false, ...extra,
});
const opts = { type: 'expense', parentOf, today: TODAY };
const TXS = [
  tx('2026-11-01', 1000, 'food'), tx('2026-11-05', 3000, 'cafe'), tx('2026-11-20', 2000, 'grocery'), tx('2026-11-20', 4000, 'home'),
  tx('2026-10-31', 9000, 'cafe'), tx('2026-12-01', 9000, 'cafe'),
  tx('2026-11-06', 7000, 'cafe', { deleted: true }), tx('2026-11-06', 7000, 'food', { type: 'income' }),
  tx('2026-11-06', 500, 'cafe', { currency: 'USD' }), tx('2026-11-06', 800, 'adjust-expense'),
];

test('категория вместе с подкатегориями за период; сумма совпадает с аналитикой', () => {
  const r = categoryReport(TXS, '2026-11', 'food', opts);
  assert.equal(r.total, 6000);
  assert.equal(r.total, categoryBreakdown(TXS, '2026-11', opts).find((x) => x.category_id === 'food').amount);
  assert.equal(r.count, 4, 'операция в другой валюте видна в списке');
  assert.equal(r.average, 2000, 'но в сумму и среднее не входит');
  assert.equal(r.share, 0.6);
});

test('подкатегории: суммы, выбор одной, выбор из другого периода сбрасывается', () => {
  const r = categoryReport(TXS, '2026-11', 'food', opts);
  assert.deepEqual(r.subs, [
    { category_id: 'cafe', amount: 3000, count: 2 }, { category_id: 'grocery', amount: 2000, count: 1 }, { category_id: 'food', amount: 1000, count: 1 },
  ]);
  const cafe = categoryReport(TXS, '2026-11', 'food', { ...opts, sub: 'cafe' });
  assert.deepEqual([cafe.total, cafe.count, cafe.share, cafe.categoryTotal], [3000, 2, 0.3, 6000]);
  const stale = categoryReport(TXS, '2026-11', 'food', { ...opts, sub: 'нет такой' });
  assert.deepEqual([stale.sub, stale.total], [undefined, 6000]);
  assert.deepEqual(categoryReport(TXS, '2026-11', 'home', opts).subs, [], 'без подкатегорий ленты нет');
});

test('счёт, исключённые счета, доходы и операции без категории', () => {
  const list = [...TXS, tx('2026-11-07', 600, 'food', { account_id: 'B' }), tx('2026-11-07', 50, null), tx('2026-11-07', 60, undefined)];
  assert.equal(categoryReport(list, '2026-11', 'food', { ...opts, accountId: 'B' }).total, 600);
  assert.equal(categoryReport(list, '2026-11', 'food', { ...opts, excludeAccounts: new Set(['B']) }).total, 6000);
  assert.equal(categoryReport(list, '2026-11', 'food', { ...opts, type: 'income' }).total, 7000);
  assert.equal(categoryReport(list, '2026-11', null, opts).total, 110);
});

test('темп: в день за прошедшие дни, в месяц для длинного периода, без будущих операций', () => {
  assert.deepEqual(categoryReport(TXS, '2026-11', 'food', opts).rate, { unit: 'day', amount: 300 });
  const year = { kind: 'year', from: '2026-01-01', to: '2026-12-31' };
  const r = categoryReport(TXS, year, 'food', opts);
  assert.equal(r.total, 24000, 'декабрьская операция входит в сумму');
  assert.equal(r.rate.unit, 'month');
  assert.equal(r.rate.amount, 15000, 'но не в темп: с первой записи 31 октября прошло меньше месяца');
  const older = categoryReport([tx('2025-03-01', 1, 'home'), ...TXS], year, 'food', opts);
  assert.equal(older.rate.amount, Math.round(15000 / (324 / (365.25 / 12))), 'учёт шёл до начала года — делим на все прошедшие дни');
  const january = categoryReport([tx('2027-01-02', 1000, 'food')], { from: '2027-01-01', to: '2027-12-31' }, 'food', { ...opts, today: '2027-01-03' });
  assert.equal(january.rate.amount, 1000, 'в начале года месяц не домысливается');
  assert.equal(categoryReport(TXS, '2027-05', 'food', opts).rate, null, 'период ещё не начался');
});

test('пустая категория', () => {
  const r = categoryReport([], '2026-11', 'food', opts);
  assert.deepEqual([r.total, r.count, r.average, r.share, r.subs, r.items], [0, 0, null, null, [], []]);
});

test('длинный период: операции по месяцам, короткий — по дням', () => {
  assert.equal(isLongPeriod('2026-11'), false);
  assert.equal(isLongPeriod({ from: '2026-07-01', to: '2026-08-31' }), false, 'ровно два месяца — ещё по дням');
  assert.equal(isLongPeriod({ from: '2026-07-01', to: '2026-09-01' }), true);
  const year = { from: '2026-01-01', to: '2026-12-31' };
  const { items } = categoryReport(TXS, year, 'food', opts);
  const months = reportMonths(items, year);
  assert.deepEqual(months.map((m) => [m.month, m.total, m.count]), [['2026-12', 9000, 1], ['2026-11', 6000, 4], ['2026-10', 9000, 1]]);
  assert.deepEqual(months[1].days.map((d) => d.day), ['2026-11-20', '2026-11-06', '2026-11-05', '2026-11-01']);
  assert.equal(months.reduce((s, m) => s + m.total, 0), 24000);
  assert.equal(reportDays(items, '2026-11').length, 4);
});

test('доля в подписи', () => {
  assert.deepEqual([shareText(0.544), shareText(1), shareText(0.004), shareText(0)], ['54%', '100%', '<1%', '0%']);
});
