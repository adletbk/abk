// Аналитика: только факт доходов и расходов, без бюджетов и лимитов. Чистые функции.
import { shiftMonth, plural } from './model.js';
import { rangeOf, spanDays, diffDays, addDays } from './period.js';
import { isAdjustment } from './adjust.js';
import { formatMoney } from './money.js';

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Сколько дней периода уже прошло: весь прошлый период, 0 для будущего, по сегодня для текущего. */
export function elapsedDays(month, today) {
  const range = rangeOf(month);
  if (range.to < today) return spanDays(range);
  if (range.from > today) return 0;
  return diffDays(range.from, today) + 1;
}

/** Доходы и расходы месяца в основной валюте; переводы и удалённые не входят. */
function pick(txs, month, { currency = 'KZT', accountId = null, excludeAccounts = null } = {}) {
  const { from, to } = rangeOf(month);
  return txs.filter((tx) => !tx.deleted && tx.currency === currency && tx.type !== 'transfer' && !isAdjustment(tx)
    && tx.date.slice(0, 10) >= from && tx.date.slice(0, 10) <= to
    && (accountId ? tx.account_id === accountId : !excludeAccounts?.has(tx.account_id)));
}
/** Номер дня операции внутри периода, с единицы. */
const dayIndex = (month) => { const { from } = rangeOf(month); return (tx) => diffDays(from, tx.date.slice(0, 10)) + 1; };

function expenseThrough(txs, month, dayLimit, opts) {
  let total = 0;
  const dayOf = dayIndex(month);
  for (const tx of pick(txs, month, opts)) if (tx.type === 'expense' && dayOf(tx) <= dayLimit) total += tx.amount;
  return total;
}

/**
 * Ряды для графика: накопительный расход и доход по дням (длина = число прошедших дней)
 * и прогноз расхода на конец месяца (только для текущего месяца).
 */
export function monthSeries(txs, month, opts = {}) {
  const range = rangeOf(month);
  const dayOf = dayIndex(month);
  const days = spanDays(range);
  const elapsed = elapsedDays(month, opts.today);
  const expenseByDay = new Array(days).fill(0);
  const incomeByDay = new Array(days).fill(0);
  for (const tx of pick(txs, month, opts)) {
    (tx.type === 'expense' ? expenseByDay : incomeByDay)[dayOf(tx) - 1] += tx.amount;
  }
  const cumulative = (byDay) => {
    let sum = 0;
    return byDay.slice(0, elapsed).map((value) => (sum += value));
  };
  const expense = cumulative(expenseByDay);
  const income = cumulative(incomeByDay);
  const isCurrent = range.from <= opts.today && opts.today < range.to;
  const forecast = isCurrent && elapsed > 0 ? Math.round((expense[elapsed - 1] / elapsed) * days) : null;
  return { days, elapsed, expense, income, forecast, from: range.from };
}

/**
 * Динамика трат к прошлому месяцу, в процентах. Для текущего месяца сравниваются
 * одинаковые отрезки: первые N дней этого и прошлого месяца.
 */
export function spendDynamics(txs, month, opts = {}) {
  const elapsed = elapsedDays(month, opts.today);
  const limit = month === opts.today.slice(0, 7) ? elapsed : 31;
  const current = expenseThrough(txs, month, limit, opts);
  const previous = expenseThrough(txs, shiftMonth(month, -1), limit, opts);
  const percent = previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
  return { current, previous, percent };
}

/** Средний расход в день за прошедшие дни месяца. */
export function dailyAverage(txs, month, opts = {}) {
  const days = elapsedDays(month, opts.today);
  const total = expenseThrough(txs, month, days, opts);
  return { days, average: days > 0 ? Math.round(total / days) : 0 };
}

/** Суммы по категориям за месяц с долями, по убыванию. */
export function categoryBreakdown(txs, month, opts = {}) {
  const type = opts.type ?? 'expense';
  const byCategory = new Map();
  let total = 0;
  for (const tx of pick(txs, month, opts)) {
    if (tx.type !== type) continue;
    const key = opts.parentOf?.get(tx.category_id) ?? tx.category_id; // подкатегории складываются в родителя
    byCategory.set(key, (byCategory.get(key) ?? 0) + tx.amount);
    total += tx.amount;
  }
  return [...byCategory]
    .map(([category_id, amount]) => ({ category_id, amount, share: amount / total }))
    .sort((a, b) => b.amount - a.amount);
}

/** Какая доля дохода осталась, в процентах. null, если дохода не было. */
export function savedShare({ income, expense }) {
  return income > 0 ? Math.round(((income - expense) / income) * 100) : null;
}

/** Короткие факты за период для листа «Инсайты». */
export function buildInsights({ summary, dynamics, average, top, forecast }) {
  if (summary.income === 0 && summary.expense === 0) return ['За этот период операций нет.'];
  const lines = [];
  const saved = savedShare(summary);
  if (saved === null) lines.push(`Расходы за период: ${formatMoney(summary.expense)}. Доходов не было.`);
  else if (saved >= 0) lines.push(`Отложено ${saved}% дохода: ${formatMoney(summary.balance)}.`);
  else lines.push(`Расходы выше доходов на ${formatMoney(-summary.balance)}.`);

  if (dynamics.percent === 0) lines.push('Траты на уровне прошлого периода.');
  else if (dynamics.percent != null) {
    lines.push(`Траты ${dynamics.percent < 0 ? 'ниже' : 'выше'} прошлого периода на ${Math.abs(dynamics.percent)}%.`);
  }
  if (average.days > 0 && average.average > 0) {
    lines.push(`В среднем ${formatMoney(roundTo(average.average, 100))} в день за ${average.days} ${plural(average.days, ['день', 'дня', 'дней'])}.`);
  }
  if (top) {
    lines.push(`Больше всего ушло на «${top.name}»: ${formatMoney(top.amount)}, ${Math.round(top.share * 100)}% расходов.`);
  }
  if (forecast) {
    lines.push(`При таком темпе расход к концу месяца составит около ${formatMoney(roundTo(forecast, 100000))}.`);
  }
  return lines;
}

export const roundTo = (minor, step) => Math.round(minor / step) * step;

// ---------- инсайты ----------

const expensesOf = (txs, month, opts) => pick(txs, month, opts).filter((tx) => tx.type === 'expense');
const dayOfMonth = (month, day) => addDays(rangeOf(month).from, day - 1);

/** Самая крупная трата месяца. */
export function largestExpense(txs, month, opts = {}) {
  return expensesOf(txs, month, opts).reduce((best, tx) => (!best || tx.amount > best.amount ? tx : best), null);
}

/** День с наибольшей суммой трат. */
export function mostExpensiveDay(txs, month, opts = {}) {
  const byDay = new Map();
  for (const tx of expensesOf(txs, month, opts)) byDay.set(tx.date.slice(0, 10), (byDay.get(tx.date.slice(0, 10)) ?? 0) + tx.amount);
  let best = null;
  for (const [day, amount] of byDay) if (!best || amount > best.amount) best = { day, amount };
  return best;
}

/** Самая длинная серия дней без трат среди прошедших дней месяца; при равенстве — более поздняя. */
export function noSpendingStreak(txs, month, opts = {}) {
  const elapsed = elapsedDays(month, opts.today);
  const spent = new Set(expensesOf(txs, month, opts).map(dayIndex(month)));
  let best = null;
  let start = null;
  for (let day = 1; day <= elapsed + 1; day++) {
    const free = day <= elapsed && !spent.has(day);
    if (free && start === null) start = day;
    if (!free && start !== null) {
      const days = day - start;
      if (!best || days >= best.days) best = { from: dayOfMonth(month, start), to: dayOfMonth(month, day - 1), days };
      start = null;
    }
  }
  return best;
}

/** Доля трат в субботу и воскресенье, в процентах. */
export function weekendShare(txs, month, opts = {}) {
  let total = 0;
  let weekend = 0;
  for (const tx of expensesOf(txs, month, opts)) {
    const [y, m, d] = tx.date.slice(0, 10).split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    total += tx.amount;
    if (weekday === 0 || weekday === 6) weekend += tx.amount;
  }
  return total > 0 ? Math.round((weekend / total) * 100) : null;
}

/** Число доходов и расходов за месяц (переводы не считаются). */
export function transactionCount(txs, month, opts = {}) {
  return pick(txs, month, opts).length;
}

/** Категория с наибольшим числом трат. */
export function mostUsedCategory(txs, month, opts = {}) {
  const counts = new Map();
  for (const tx of expensesOf(txs, month, opts)) counts.set(tx.category_id, (counts.get(tx.category_id) ?? 0) + 1);
  let best = null;
  for (const [category_id, count] of counts) if (!best || count > best.count) best = { category_id, count };
  return best;
}

/** Расходы (или доходы) по дням с разбивкой по категориям — для столбчатой диаграммы. */
export function stackedSeries(txs, month, opts = {}) {
  const type = opts.type ?? 'expense';
  const range = rangeOf(month);
  const dayOf = dayIndex(month);
  // Длинный период не помещается по столбцу на день: дни собираются в равные отрезки.
  const bucket = Math.ceil(spanDays(range) / (opts.maxBars ?? 62));
  const days = Math.ceil(spanDays(range) / bucket);
  const byDay = Array.from({ length: days }, () => ({}));
  const totals = new Map();
  for (const tx of pick(txs, month, opts)) {
    if (tx.type !== type) continue;
    const key = opts.parentOf?.get(tx.category_id) ?? tx.category_id;
    const slot = byDay[Math.floor((dayOf(tx) - 1) / bucket)];
    slot[key] = (slot[key] ?? 0) + tx.amount;
    totals.set(key, (totals.get(key) ?? 0) + tx.amount);
  }
  const max = byDay.reduce((m, slot) => Math.max(m, Object.values(slot).reduce((s, v) => s + v, 0)), 0);
  return { days, byDay, max, from: range.from, bucket, categories: [...totals].sort((a, b) => b[1] - a[1]).map(([id]) => id) };
}

/** Самое крупное поступление за период. */
export function largestIncome(txs, month, opts = {}) {
  return pick(txs, month, opts).filter((tx) => tx.type === 'income')
    .reduce((best, tx) => (!best || tx.amount > best.amount ? tx : best), null);
}

/**
 * Сколько отложено за период: переводы на счета-сбережения минус переводы с них обратно.
 * Переводы между двумя счетами-сбережениями не считаются.
 */
export function savingsFlow(txs, month, { savingsIds, accountId = null, currency = 'KZT' } = {}) {
  const { from, to } = rangeOf(month);
  let put = 0;
  let taken = 0;
  for (const tx of txs) {
    const day = tx.date.slice(0, 10);
    if (tx.deleted || tx.type !== 'transfer' || tx.currency !== currency || day < from || day > to) continue;
    if (accountId && tx.account_id !== accountId && tx.to_account_id !== accountId) continue;
    const toSavings = savingsIds.has(tx.to_account_id);
    const fromSavings = savingsIds.has(tx.account_id);
    if (toSavings && !fromSavings) put += tx.amount;
    else if (fromSavings && !toSavings) taken += tx.amount;
  }
  return { put, taken, net: put - taken };
}

/** Доля дохода, отложенная на сбережения, в процентах. null, если дохода не было. */
export function savedPercent(net, income) {
  return income > 0 ? Math.round((net / income) * 100) : null;
}

/** На сколько месяцев хватит денег при расходах как в этом периоде (30 дней = месяц). null, если трат не было. */
export function fundCoverage(funds, expense, days) {
  if (expense <= 0 || days <= 0) return null;
  return Math.max(0, Math.round((funds / ((expense / days) * 30)) * 10) / 10);
}

// ---------- ещё инсайты ----------

/** Мелкие траты: покупки до limit (минимальные единицы). share — доля от всех трат периода, в процентах. */
export function smallPurchases(txs, month, opts = {}, limit = 300000) {
  const all = expensesOf(txs, month, opts);
  const small = all.filter((tx) => tx.amount <= limit);
  const total = all.reduce((sum, tx) => sum + tx.amount, 0);
  const amount = small.reduce((sum, tx) => sum + tx.amount, 0);
  return { count: small.length, amount, share: total > 0 ? Math.round((amount / total) * 100) : null, limit };
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const weekdayOf = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/**
 * День недели, в который в среднем тратится больше всего: сумма трат за этот день недели,
 * делённая на число таких дней в прошедшей части периода. Нужно хотя бы две полные недели.
 */
export function busiestWeekday(txs, month, opts = {}) {
  const range = rangeOf(month);
  const elapsed = elapsedDays(month, opts.today);
  if (elapsed < 14) return null;
  const days = new Array(7).fill(0);
  for (let i = 0; i < elapsed; i++) days[weekdayOf(addDays(range.from, i))]++;
  const sums = new Array(7).fill(0);
  const last = addDays(range.from, elapsed - 1);
  for (const tx of expensesOf(txs, month, opts)) if (tx.date.slice(0, 10) <= last) sums[weekdayOf(tx.date.slice(0, 10))] += tx.amount;
  let best = null;
  for (let d = 0; d < 7; d++) {
    const average = days[d] ? Math.round(sums[d] / days[d]) : 0;
    if (average > 0 && (!best || average > best.average)) best = { weekday: d, name: WEEKDAYS[d], average };
  }
  return best;
}

/**
 * Категория, траты в которой выросли сильнее всего по сравнению с таким же отрезком перед периодом.
 * Для месяца сравнивается с прошлым месяцем; у текущего периода берётся столько же дней от начала.
 * null, если ничего не выросло или сравнивать не с чем.
 */
export function categoryGrowth(txs, month, opts = {}) {
  const range = rangeOf(month);
  const elapsed = elapsedDays(month, opts.today);
  if (elapsed === 0) return null;
  const isMonth = range.from.endsWith('-01') && range.to === rangeOf(range.from.slice(0, 7)).to;
  const prevFrom = isMonth ? `${shiftMonth(range.from.slice(0, 7), -1)}-01` : addDays(range.from, -spanDays(range));
  const prevEnd = isMonth ? rangeOf(shiftMonth(range.from.slice(0, 7), -1)).to : addDays(range.from, -1);
  const current = { from: range.from, to: addDays(range.from, elapsed - 1) };
  const cut = addDays(prevFrom, elapsed - 1);
  const previous = { from: prevFrom, to: cut < prevEnd ? cut : prevEnd };
  const before = new Map(categoryBreakdown(txs, previous, opts).map((row) => [row.category_id, row.amount]));
  if (before.size === 0) return null;
  let best = null;
  for (const row of categoryBreakdown(txs, current, opts)) {
    const was = before.get(row.category_id) ?? 0;
    const delta = row.amount - was;
    if (delta > 0 && (!best || delta > best.delta)) {
      best = { category_id: row.category_id, amount: row.amount, previous: was, delta, percent: was > 0 ? Math.round((delta / was) * 100) : null };
    }
  }
  return best;
}
