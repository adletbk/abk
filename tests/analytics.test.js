import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysInMonth, elapsedDays, monthSeries, spendDynamics, dailyAverage, categoryBreakdown,
  savedShare, buildInsights,
} from '../js/analytics.js';
import { chartPaths } from '../js/ui/chart.js';
import { plural, monthName } from '../js/model.js';

const TODAY = '2026-11-13';
const base = { currency: 'KZT', type: 'expense', category_id: 'food', account_id: 'A', to_account_id: null, deleted: false };
const txs = [
  { ...base, id: 'e1', date: '2026-11-01T10:00:00', amount: 3000 },
  { ...base, id: 'e2', date: '2026-11-03T10:00:00', amount: 1000, category_id: 'cafe' },
  { ...base, id: 'e3', date: '2026-11-13T23:59:59', amount: 2500 },
  { ...base, id: 'i1', date: '2026-11-12T09:00:00', amount: 20000, type: 'income', category_id: 'salary' },
  { ...base, id: 't1', date: '2026-11-05T09:00:00', amount: 7777, type: 'transfer', category_id: null, to_account_id: 'B' },
  { ...base, id: 'd1', date: '2026-11-06T09:00:00', amount: 8888, deleted: true },
  { ...base, id: 'u1', date: '2026-11-07T09:00:00', amount: 9999, currency: 'USD' },
  { ...base, id: 'o1', date: '2026-10-02T09:00:00', amount: 4000 },
  { ...base, id: 'o2', date: '2026-10-10T09:00:00', amount: 1000 },
  { ...base, id: 'o3', date: '2026-10-20T09:00:00', amount: 5000 },
];
const opts = { today: TODAY };

test('daysInMonth', () => {
  assert.equal(daysInMonth('2026-11'), 30);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-12'), 31);
});
test('elapsedDays: текущий, прошлый и будущий месяц', () => {
  assert.equal(elapsedDays('2026-11', TODAY), 13);
  assert.equal(elapsedDays('2026-10', TODAY), 31);
  assert.equal(elapsedDays('2026-12', TODAY), 0);
});

test('monthSeries: накопительный расход и доход ступенькой', () => {
  const s = monthSeries(txs, '2026-11', opts);
  assert.equal(s.days, 30);
  assert.equal(s.elapsed, 13);
  assert.deepEqual(s.expense, [3000, 3000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 6500]);
  assert.deepEqual(s.income, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20000, 20000]);
});
test('monthSeries: прогноз на конец текущего месяца', () => {
  assert.equal(monthSeries(txs, '2026-11', opts).forecast, 15000); // 6500 / 13 * 30
});
test('monthSeries: у прошлого месяца прогноза нет', () => {
  const s = monthSeries(txs, '2026-10', opts);
  assert.equal(s.elapsed, 31);
  assert.equal(s.forecast, null);
  assert.equal(s.expense.at(-1), 10000);
});
test('monthSeries: пустой и будущий месяц без NaN', () => {
  assert.deepEqual(monthSeries([], '2026-11', opts).expense, new Array(13).fill(0));
  assert.equal(monthSeries([], '2026-11', opts).forecast, 0);
  const future = monthSeries(txs, '2026-12', opts);
  assert.deepEqual([future.elapsed, future.expense, future.income, future.forecast], [0, [], [], null]);
});

test('spendDynamics: текущий месяц сравнивается с теми же днями прошлого', () => {
  assert.deepEqual(spendDynamics(txs, '2026-11', opts), { current: 6500, previous: 5000, percent: 30 });
});
test('spendDynamics: нет трат в прошлом периоде', () => {
  assert.deepEqual(spendDynamics(txs, '2026-10', opts), { current: 10000, previous: 0, percent: null });
});
test('dailyAverage', () => {
  assert.deepEqual(dailyAverage(txs, '2026-11', opts), { days: 13, average: 500 });
  assert.deepEqual(dailyAverage(txs, '2026-12', opts), { days: 0, average: 0 });
});

test('categoryBreakdown: доли по убыванию', () => {
  const rows = categoryBreakdown(txs, '2026-11', opts);
  assert.deepEqual(rows.map((r) => [r.category_id, r.amount]), [['food', 5500], ['cafe', 1000]]);
  assert.ok(Math.abs(rows[0].share - 5500 / 6500) < 1e-9);
  assert.equal(rows.reduce((sum, r) => sum + r.share, 0).toFixed(6), '1.000000');
});
test('categoryBreakdown: пустой месяц', () => {
  assert.deepEqual(categoryBreakdown(txs, '2026-09', opts), []);
});

test('savedShare', () => {
  assert.equal(savedShare({ income: 52000000, expense: 41230000 }), 21);
  assert.equal(savedShare({ income: 0, expense: 500 }), null);
  assert.equal(savedShare({ income: 1000, expense: 1500 }), -50);
});

test('buildInsights: факты за период без пустых строк', () => {
  const lines = buildInsights({
    summary: { income: 52000000, expense: 41230000, balance: 10770000 },
    dynamics: { current: 1, previous: 1, percent: -6 },
    average: { days: 13, average: 3170000 },
    top: { name: 'Еда', amount: 15670000, share: 0.38 },
    forecast: 50000000,
  });
  assert.equal(lines.length, 5);
  assert.ok(lines.every((line) => typeof line === 'string' && line.length > 0 && !line.includes('NaN')));
  assert.deepEqual(buildInsights({
    summary: { income: 0, expense: 0, balance: 0 }, dynamics: { percent: null }, average: { days: 0, average: 0 }, top: null, forecast: null,
  }), ['За этот период операций нет.']);
});

test('chartPaths: доход рисуется ступенькой, расход заканчивается в точке', () => {
  const series = monthSeries(txs, '2026-11', opts);
  const p = chartPaths(series, { width: 300, height: 100 });
  assert.equal(p.max, 20000);
  assert.match(p.income, /^M[\d.]+ [\d.]+( [HV][\d.]+)+$/); // только горизонтали и вертикали
  assert.ok(p.expense.startsWith('M0 '));
  assert.ok(p.expense.endsWith(`${p.dot.x} ${p.dot.y}`));
  assert.ok(p.forecast.startsWith(`M${p.dot.x} ${p.dot.y}`));
  assert.ok(p.forecast.endsWith(' 300 25')); // прогноз 15000 из 20000 → 75% высоты
});
test('chartPaths: пустые данные не дают NaN', () => {
  const p = chartPaths(monthSeries([], '2026-12', opts), { width: 300, height: 100 });
  assert.deepEqual([p.expense, p.income, p.forecast, p.dot], ['', '', '', null]);
});

test('plural', () => {
  const forms = ['день', 'дня', 'дней'];
  assert.deepEqual([1, 2, 5, 11, 13, 21, 22, 25, 111].map((n) => plural(n, forms)),
    ['день', 'дня', 'дней', 'дней', 'дней', 'день', 'дня', 'дней', 'дней']);
});
test('monthName', () => {
  assert.equal(monthName('2026-11', TODAY), 'Ноябрь');
  assert.equal(monthName('2025-12', TODAY), 'Декабрь 2025');
});

test('categoryBreakdown: подкатегории складываются в родителя', () => {
  const parentOf = new Map([['cafe', 'food']]);
  const rows = categoryBreakdown(txs, '2026-11', { ...opts, parentOf });
  assert.deepEqual(rows.map((r) => [r.category_id, r.amount]), [['food', 6500]]);
});
test('исключённые счета не входят в аналитику «Все счета»', () => {
  const excludeAccounts = new Set(['A']);
  assert.deepEqual(categoryBreakdown(txs, '2026-11', { ...opts, excludeAccounts }), []);
  assert.equal(monthSeries(txs, '2026-11', { ...opts, excludeAccounts }).expense.at(-1), 0);
  assert.equal(categoryBreakdown(txs, '2026-11', { ...opts, accountId: 'A', excludeAccounts }).length, 2);
});

// ---------- инсайты ----------
const {
  largestExpense, mostExpensiveDay, noSpendingStreak, weekendShare, transactionCount, mostUsedCategory, stackedSeries,
} = await import('../js/analytics.js');

test('largestExpense и mostExpensiveDay', () => {
  assert.equal(largestExpense(txs, '2026-11', opts).id, 'e1');
  assert.deepEqual(mostExpensiveDay(txs, '2026-11', opts), { day: '2026-11-01', amount: 3000 });
  const twoOnOneDay = [...txs, { ...base, id: 'e9', date: '2026-11-03T18:00:00', amount: 2500 }];
  assert.deepEqual(mostExpensiveDay(twoOnOneDay, '2026-11', opts), { day: '2026-11-03', amount: 3500 });
  assert.equal(largestExpense([], '2026-11', opts), null);
  assert.equal(mostExpensiveDay([], '2026-11', opts), null);
});
test('noSpendingStreak: самая длинная серия дней без трат среди прошедших дней', () => {
  assert.deepEqual(noSpendingStreak(txs, '2026-11', opts), { from: '2026-11-04', to: '2026-11-12', days: 9 });
  // трат не было совсем: серия — все прошедшие дни
  assert.deepEqual(noSpendingStreak([], '2026-11', opts), { from: '2026-11-01', to: '2026-11-13', days: 13 });
  // траты каждый день
  const daily = Array.from({ length: 13 }, (_, i) => ({ ...base, id: `d${i}`, date: `2026-11-${String(i + 1).padStart(2, '0')}T10:00:00`, amount: 1 }));
  assert.equal(noSpendingStreak(daily, '2026-11', opts), null);
  assert.equal(noSpendingStreak(txs, '2026-12', opts), null, 'будущий месяц');
  // при равных сериях берётся более поздняя
  const even = [{ ...base, id: 'x', date: '2026-11-07T10:00:00', amount: 1 }];
  assert.deepEqual(noSpendingStreak(even, '2026-11', opts), { from: '2026-11-08', to: '2026-11-13', days: 6 });
});
test('weekendShare, transactionCount, mostUsedCategory', () => {
  assert.equal(weekendShare(txs, '2026-11', opts), 46); // 1 ноября 2026 — воскресенье: 3000 из 6500
  assert.equal(weekendShare([], '2026-11', opts), null);
  assert.equal(transactionCount(txs, '2026-11', opts), 4);
  assert.deepEqual(mostUsedCategory(txs, '2026-11', opts), { category_id: 'food', count: 2 });
  assert.equal(mostUsedCategory([], '2026-11', opts), null);
});
test('stackedSeries: расходы по дням с разбивкой по категориям', () => {
  const s = stackedSeries(txs, '2026-11', opts);
  assert.equal(s.days, 30);
  assert.deepEqual(s.categories, ['food', 'cafe']);
  assert.deepEqual(s.byDay[0], { food: 3000 });
  assert.deepEqual(s.byDay[2], { cafe: 1000 });
  assert.deepEqual(s.byDay[1], {});
  assert.equal(s.max, 3000);
  assert.equal(stackedSeries([], '2026-11', opts).max, 0);
});

test('ringSegment: сектор кольца начинается сверху и замыкается', async () => {
  const { ringSegment } = await import('../js/ui/chart.js');
  const quarter = ringSegment(150, 150, 100, 60, 0, Math.PI / 2);
  assert.equal(quarter.area, 'M150 50 A100 100 0 0 1 250 150 L210 150 A60 60 0 0 0 150 90 Z');
  assert.equal(quarter.edge, 'M150 50 A100 100 0 0 1 250 150');
  const big = ringSegment(150, 150, 100, 60, 0, Math.PI * 1.5);
  assert.ok(big.area.includes('A100 100 0 1 1'), 'дуга больше половины круга помечается флагом large-arc');
  assert.ok(!big.area.includes('NaN'));
});
