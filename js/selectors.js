// Выборки для экранов: итоги месяца, список по дням, остатки. Чистые функции.
import { dayKey } from './model.js';
import { rangeOf } from './period.js';

const signed = (tx) => (tx.type === 'income' ? tx.amount : tx.type === 'expense' ? -tx.amount : 0);

const outside = (tx, range) => { const day = dayKey(tx.date); return day < range.from || day > range.to; };

/** Доход, расход и баланс за месяц «ГГГГ-ММ» или период. Переводы, удалённые и чужая валюта не входят. */
export function monthSummary(txs, month, { currency = 'KZT', accountId = null, excludeAccounts = null } = {}) {
  const range = rangeOf(month);
  let income = 0;
  let expense = 0;
  for (const tx of txs) {
    if (tx.deleted || tx.currency !== currency || outside(tx, range)) continue;
    if (accountId && tx.account_id !== accountId) continue;
    if (!accountId && excludeAccounts?.has(tx.account_id)) continue; // счёт скрыт из общего баланса
    if (tx.type === 'income') income += tx.amount;
    else if (tx.type === 'expense') expense += tx.amount;
  }
  return { income, expense, balance: income - expense };
}

/**
 * Операции месяца по дням: дни и операции внутри дня по убыванию времени.
 * total — доходы минус расходы дня в основной валюте.
 */
export function groupByDay(txs, month, opts = {}) {
  const { accountId = null, query = '', categoriesById = new Map(), currency = 'KZT', excludeAccounts = null } = opts;
  const needle = query.trim().toLowerCase();
  const range = rangeOf(month);
  const byDay = new Map();
  for (const tx of txs) {
    if (tx.deleted || outside(tx, range)) continue;
    if (accountId && tx.account_id !== accountId && tx.to_account_id !== accountId) continue;
    if (!accountId && excludeAccounts?.has(tx.account_id)) continue;
    if (needle) {
      const category = categoriesById.get(tx.category_id)?.name ?? '';
      if (!`${tx.note ?? ''}\n${category}`.toLowerCase().includes(needle)) continue;
    }
    const day = dayKey(tx.date);
    if (!byDay.has(day)) byDay.set(day, { day, total: 0, items: [] });
    const group = byDay.get(day);
    group.items.push(tx);
    if (tx.currency === currency) group.total += signed(tx);
  }
  const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  for (const group of days) group.items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return days;
}

/** Остаток каждого счёта: начальный остаток + доходы − расходы ± переводы (в валюте счёта). */
export function accountBalances(accounts, txs) {
  const balances = new Map(accounts.map((a) => [a.id, a.initial_balance || 0]));
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const add = (id, delta, currency) => {
    if (balances.has(id) && currencyOf.get(id) === currency) balances.set(id, balances.get(id) + delta);
  };
  for (const tx of txs) {
    if (tx.deleted) continue;
    if (tx.type === 'income') add(tx.account_id, tx.amount, tx.currency);
    else if (tx.type === 'expense') add(tx.account_id, -tx.amount, tx.currency);
    else if (tx.type === 'transfer') {
      add(tx.account_id, -tx.amount, tx.currency);
      add(tx.to_account_id, tx.amount, tx.currency);
    }
  }
  return balances;
}

export function totalBalance(accounts, txs, currency = 'KZT') {
  const balances = accountBalances(accounts, txs);
  let total = 0;
  for (const account of accounts) {
    if (account.currency === currency && !account.deleted && !account.exclude_from_total) total += balances.get(account.id);
  }
  return total;
}

/** Счета, скрытые из общего баланса: их операции не показываются в режиме «Все счета». */
export function excludedAccountIds(accounts) {
  return new Set(accounts.filter((a) => a.exclude_from_total && !a.deleted).map((a) => a.id));
}
