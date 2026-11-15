import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeOf, resolvePeriod, shiftPeriod, periodLabel, rangeText, txBounds, spanDays, canShift, addDays, diffDays,
} from '../js/period.js';
import { monthSummary, groupByDay } from '../js/selectors.js';
import {
  monthSeries, elapsedDays, noSpendingStreak, stackedSeries, largestIncome, savingsFlow, savedPercent, fundCoverage,
} from '../js/analytics.js';

const TODAY = '2026-11-16'; // понедельник
const tx = (date, amount, type = 'expense', extra = {}) => ({
  id: `${date}-${amount}-${type}`, date: `${date}T10:00:00`, amount, type, currency: 'KZT', account_id: 'A', category_id: 'c', ...extra,
});

test('rangeOf: месяц строкой превращается в отрезок, период возвращается как есть', () => {
  assert.deepEqual(rangeOf('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  const p = { kind: 'day', from: '2026-11-16', to: '2026-11-16' };
  assert.equal(rangeOf(p), p);
});

test('resolvePeriod: все виды периодов', () => {
  const r = (spec) => { const { from, to } = resolvePeriod(spec, TODAY, { first: '2025-03-04', last: '2026-11-10' }); return `${from}..${to}`; };
  assert.equal(r({ kind: 'day' }), '2026-11-16..2026-11-16');
  assert.equal(r({ kind: 'week', anchor: '2026-11-18' }), '2026-11-16..2026-11-22');
  assert.equal(r({ kind: 'week', anchor: '2026-11-15' }), '2026-11-09..2026-11-15');
  assert.equal(r({ kind: 'month' }), '2026-11-01..2026-11-30');
  assert.equal(r({ kind: 'year' }), '2026-01-01..2026-12-31');
  assert.equal(r({ kind: 'last7' }), '2026-11-10..2026-11-16');
  assert.equal(r({ kind: 'last30' }), '2026-10-18..2026-11-16');
  assert.equal(r({ kind: 'all' }), '2025-03-04..2026-11-16');
  assert.equal(r({ kind: 'custom', from: '2026-11-10', to: '2026-11-03' }), '2026-11-03..2026-11-10');
});

test('две недели: 14 дней с понедельника, соседние блоки не пересекаются', () => {
  const a = resolvePeriod({ kind: 'biweek', anchor: TODAY }, TODAY);
  assert.equal(spanDays(a), 14);
  assert.equal(new Date(`${a.from}T00:00:00Z`).getUTCDay(), 1);
  assert.ok(a.from <= TODAY && TODAY <= a.to);
  const b = resolvePeriod(shiftPeriod({ kind: 'biweek', anchor: TODAY }, 1, TODAY), TODAY);
  assert.equal(b.from, addDays(a.to, 1));
});

test('без операций «Всё время» — это сегодня', () => {
  assert.deepEqual(resolvePeriod({ kind: 'all' }, TODAY, { first: null, last: null }), { kind: 'all', from: TODAY, to: TODAY });
});

test('shiftPeriod листает день, неделю, месяц и год; остальные не листаются', () => {
  const to = (spec, delta) => resolvePeriod(shiftPeriod(spec, delta, TODAY), TODAY).from;
  assert.equal(to({ kind: 'day' }, -1), '2026-11-15');
  assert.equal(to({ kind: 'week' }, -1), '2026-11-09');
  assert.equal(to({ kind: 'month', anchor: '2026-01-31' }, -1), '2025-12-01');
  assert.equal(to({ kind: 'month', anchor: '2026-12-15' }, 1), '2027-01-01');
  assert.equal(to({ kind: 'year' }, 1), '2027-01-01');
  assert.equal(canShift({ kind: 'last7' }), false);
  assert.equal(canShift({ kind: 'custom' }), false);
  assert.equal(canShift({ kind: 'biweek' }), true);
});

test('подписи периодов', () => {
  const label = (spec) => periodLabel(resolvePeriod(spec, TODAY), TODAY);
  assert.equal(label({ kind: 'month' }), 'Этот месяц');
  assert.equal(label({ kind: 'month', anchor: '2026-10-05' }), 'Октябрь');
  assert.equal(label({ kind: 'month', anchor: '2025-12-05' }), 'Декабрь 2025');
  assert.equal(label({ kind: 'day' }), 'Сегодня');
  assert.equal(label({ kind: 'day', anchor: '2026-11-15' }), 'Вчера');
  assert.equal(label({ kind: 'day', anchor: '2026-11-03' }), '3 ноя');
  assert.equal(label({ kind: 'week' }), 'Эта неделя');
  assert.equal(label({ kind: 'week', anchor: '2026-11-03' }), '2–8 ноя');
  assert.equal(label({ kind: 'year', anchor: '2025-05-05' }), '2025');
  assert.equal(label({ kind: 'all' }), 'Всё время');
  assert.equal(rangeText('2026-10-28', '2026-11-10', TODAY), '28 окт – 10 ноя');
  assert.equal(rangeText('2025-12-28', '2026-01-10', TODAY), '28 дек 2025 – 10 янв 2026');
});

test('txBounds пропускает удалённые', () => {
  assert.deepEqual(txBounds([tx('2026-11-05', 1), tx('2026-10-01', 1, 'expense', { deleted: true }), tx('2026-11-09', 1)]),
    { first: '2026-11-05', last: '2026-11-09' });
  assert.equal(diffDays('2026-11-05', '2026-11-09'), 4);
});

const TXS = [
  tx('2026-11-09', 1000), tx('2026-11-11', 500), tx('2026-11-16', 200), tx('2026-11-08', 9000),
  tx('2026-11-10', 50000, 'income'), tx('2026-11-12', 70000, 'income'),
];
const WEEK = resolvePeriod({ kind: 'week', anchor: '2026-11-11' }, TODAY); // 9–15 ноября

test('итоги и список считаются по произвольному периоду', () => {
  assert.deepEqual(monthSummary(TXS, WEEK), { income: 120000, expense: 1500, balance: 118500 });
  assert.deepEqual(groupByDay(TXS, WEEK).map((g) => g.day), ['2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09']);
});

test('график по неделе: 7 дней, накопительный расход, прогноза у прошедшего периода нет', () => {
  const series = monthSeries(TXS, WEEK, { today: TODAY });
  assert.equal(series.days, 7);
  assert.equal(series.elapsed, 7);
  assert.deepEqual(series.expense, [1000, 1000, 1500, 1500, 1500, 1500, 1500]);
  assert.equal(series.forecast, null);
  assert.equal(series.from, '2026-11-09');
});

test('прогноз есть у текущего периода из нескольких дней и нет у одного дня', () => {
  const current = resolvePeriod({ kind: 'week' }, TODAY);
  assert.equal(elapsedDays(current, TODAY), 1);
  assert.equal(monthSeries(TXS, current, { today: TODAY }).forecast, 1400);
  assert.equal(monthSeries(TXS, resolvePeriod({ kind: 'day' }, TODAY), { today: TODAY }).forecast, null);
});

test('серия без трат в периоде, который начинается не с первого числа', () => {
  assert.deepEqual(noSpendingStreak(TXS, WEEK, { today: TODAY }), { from: '2026-11-12', to: '2026-11-15', days: 4 });
});

test('столбцы: длинный период собирается в отрезки', () => {
  const year = resolvePeriod({ kind: 'year' }, TODAY);
  const series = stackedSeries(TXS, year, { today: TODAY });
  assert.equal(series.bucket, 6);
  assert.equal(series.days, 61);
  assert.equal(series.byDay.reduce((sum, slot) => sum + (slot.c ?? 0), 0), 10700);
  assert.equal(stackedSeries(TXS, WEEK, { today: TODAY }).bucket, 1);
});

test('самое крупное поступление', () => {
  assert.equal(largestIncome(TXS, WEEK, { today: TODAY }).amount, 70000);
  assert.equal(largestIncome(TXS, resolvePeriod({ kind: 'day' }, TODAY), { today: TODAY }), null);
});

test('отложено: переводы на сбережения минус переводы обратно', () => {
  const savingsIds = new Set(['S', 'S2']);
  const moves = [
    tx('2026-11-10', 30000, 'transfer', { to_account_id: 'S' }),
    tx('2026-11-11', 5000, 'transfer', { account_id: 'S', to_account_id: 'A' }),
    tx('2026-11-12', 7000, 'transfer', { account_id: 'S', to_account_id: 'S2' }), // между сбережениями
    tx('2026-11-12', 9000, 'transfer', { to_account_id: 'B' }),                    // не сбережения
    tx('2026-11-13', 4000, 'transfer', { to_account_id: 'S', deleted: true }),
    tx('2026-10-13', 4000, 'transfer', { to_account_id: 'S' }),                    // другой период
    tx('2026-11-13', 4000, 'transfer', { to_account_id: 'S', currency: 'USD' }),
  ];
  assert.deepEqual(savingsFlow(moves, '2026-11', { savingsIds }), { put: 30000, taken: 5000, net: 25000 });
  assert.equal(savingsFlow(moves, '2026-11', { savingsIds, accountId: 'B' }).net, 0);
  assert.equal(savedPercent(25000, 120000), 21);
  assert.equal(savedPercent(25000, 0), null);
});

test('запас: на сколько месяцев хватит денег', () => {
  assert.equal(fundCoverage(120000, 300000, 15), 0.2);
  assert.equal(fundCoverage(1800000, 300000, 30), 6);
  assert.equal(fundCoverage(-5000, 300000, 30), 0);
  assert.equal(fundCoverage(1000, 0, 30), null);
});
