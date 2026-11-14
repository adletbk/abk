// Аналитика: только факт доходов и расходов, без бюджетов и лимитов. Чистые функции.
import { monthKey, shiftMonth, plural } from './model.js';
import { formatMoney } from './money.js';

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Сколько дней месяца уже прошло: весь прошлый месяц, 0 для будущего, число сегодня для текущего. */
export function elapsedDays(month, today) {
  const current = today.slice(0, 7);
  if (month < current) return daysInMonth(month);
  if (month > current) return 0;
  return Number(today.slice(8, 10));
}

/** Доходы и расходы месяца в основной валюте; переводы и удалённые не входят. */
function pick(txs, month, { currency = 'KZT', accountId = null } = {}) {
  return txs.filter((tx) => !tx.deleted && tx.currency === currency && tx.type !== 'transfer'
    && monthKey(tx.date) === month && (!accountId || tx.account_id === accountId));
}
const dayOf = (tx) => Number(tx.date.slice(8, 10));

function expenseThrough(txs, month, dayLimit, opts) {
  let total = 0;
  for (const tx of pick(txs, month, opts)) if (tx.type === 'expense' && dayOf(tx) <= dayLimit) total += tx.amount;
  return total;
}

/**
 * Ряды для графика: накопительный расход и доход по дням (длина = число прошедших дней)
 * и прогноз расхода на конец месяца (только для текущего месяца).
 */
export function monthSeries(txs, month, opts = {}) {
  const days = daysInMonth(month);
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
  const isCurrent = month === opts.today.slice(0, 7);
  const forecast = isCurrent && elapsed > 0 ? Math.round((expense[elapsed - 1] / elapsed) * days) : null;
  return { days, elapsed, expense, income, forecast };
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
    byCategory.set(tx.category_id, (byCategory.get(tx.category_id) ?? 0) + tx.amount);
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
