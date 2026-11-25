// Отчёт по одной категории за период: операции, итоги, подкатегории, группировка. Без DOM и без хранилища.
import { elapsedDays } from './analytics.js';
import { isAdjustment } from './adjust.js';
import { rangeOf, spanDays } from './period.js';
import { groupByDay } from './selectors.js';

/** Период длиннее двух месяцев показывается по месяцам, а не одним списком дней. */
export const isLongPeriod = (period) => spanDays(rangeOf(period)) > 62;

const DAYS_IN_MONTH = 365.25 / 12;

/**
 * categoryId — категория верхнего уровня (как в аналитике) или null для операций без категории.
 * sub — id подкатегории (или самой категории), чтобы оставить только её операции; undefined — все.
 * items содержит операции в любой валюте; суммы считаются только в основной, как в аналитике.
 * share — доля от всех расходов (доходов) периода, null если их нет.
 * rate — { unit: 'day' | 'month', amount } за прошедшую часть периода или null, если период ещё не начался.
 * subs — разбивка по подкатегориям; пустая, если операции не разделены.
 */
export function categoryReport(txs, period, categoryId, {
  type = 'expense', parentOf = new Map(), sub, today, currency = 'KZT', accountId = null, excludeAccounts = null,
} = {}) {
  const { from, to } = rangeOf(period);
  const rollup = (id) => parentOf.get(id) ?? id ?? null;
  const all = txs.filter((tx) => {
    const day = tx.date.slice(0, 10);
    return !tx.deleted && tx.type === type && !isAdjustment(tx) && day >= from && day <= to
      && (accountId ? tx.account_id === accountId : !excludeAccounts?.has(tx.account_id));
  });
  const sum = (list) => list.reduce((acc, tx) => acc + (tx.currency === currency ? tx.amount : 0), 0);
  const inCategory = all.filter((tx) => rollup(tx.category_id) === categoryId);

  const bySub = new Map();
  for (const tx of inCategory) {
    const id = tx.category_id ?? null;
    const row = bySub.get(id) ?? { category_id: id, amount: 0, count: 0 };
    row.count++;
    if (tx.currency === currency) row.amount += tx.amount;
    bySub.set(id, row);
  }
  const subs = bySub.size > 1 ? [...bySub.values()].sort((a, b) => b.amount - a.amount || b.count - a.count) : [];

  // Выбранная подкатегория могла остаться от другого периода: тогда показываем всё.
  const active = sub !== undefined && subs.some((row) => row.category_id === sub) ? sub : undefined;
  const items = active === undefined ? inCategory : inCategory.filter((tx) => (tx.category_id ?? null) === active);
  const total = sum(items);
  const overall = sum(all);
  const counted = items.filter((tx) => tx.currency === currency).length;

  // Темп считается с первой записи в приложении: дни до начала учёта его не занижают.
  const first = txs.reduce((min, tx) => (!tx.deleted && tx.date.slice(0, 10) < min ? tx.date.slice(0, 10) : min), '9999-12-31');
  const start = first > from && first <= to ? first : from;
  const elapsed = elapsedDays({ from: start, to }, today);
  const long = isLongPeriod(period);
  // Операции, внесённые будущим числом, в темп не входят.
  const soFar = sum(items.filter((tx) => tx.date.slice(0, 10) <= today));
  const rate = elapsed === 0 ? null : long
    ? { unit: 'month', amount: Math.round(soFar / Math.max(1, elapsed / DAYS_IN_MONTH)) }
    : { unit: 'day', amount: Math.round(soFar / elapsed) };

  return {
    items, subs, sub: active, total, categoryTotal: sum(inCategory),
    count: items.length, average: counted ? Math.round(total / counted) : null,
    share: overall > 0 ? total / overall : null, rate, long,
  };
}

/** Операции по дням (новые сверху). */
export const reportDays = (items, period, currency = 'KZT') => groupByDay(items, rangeOf(period), { currency });

/** Операции по месяцам (новые сверху): [{ month, total, count, days }]. total — положительная сумма в основной валюте. */
export function reportMonths(items, period, currency = 'KZT') {
  const months = new Map();
  for (const group of reportDays(items, period, currency)) {
    const month = group.day.slice(0, 7);
    const entry = months.get(month) ?? { month, total: 0, count: 0, days: [] };
    entry.total += Math.abs(group.total);
    entry.count += group.items.length;
    entry.days.push(group);
    months.set(month, entry);
  }
  return [...months.values()];
}

/** Доля в процентах для подписи: «54%», «<1%». */
export function shareText(share) {
  const percent = Math.round(share * 100);
  return percent === 0 && share > 0 ? '<1%' : `${percent}%`;
}
