// Корректировка остатка счёта: операция со служебной категорией «Корректировка счёта».
// Она меняет остаток счёта, но не считается доходом или расходом в итогах и аналитике.
import { newTransaction } from './model.js';

export const ADJUST_NAME = 'Корректировка счёта';
// Постоянные id: по ним корректировка узнаётся на любом устройстве, в том числе после синхронизации.
export const ADJUST_IDS = { income: 'adjust-income', expense: 'adjust-expense' };

export const isAdjustment = (tx) => tx.category_id === ADJUST_IDS.income || tx.category_id === ADJUST_IDS.expense;
export const isAdjustCategory = (category) => category.id === ADJUST_IDS.income || category.id === ADJUST_IDS.expense;

/** Служебная категория для корректировки вверх (income) или вниз (expense). В списках выбора не показывается. */
export function adjustCategory(type, now = Date.now()) {
  return {
    id: ADJUST_IDS[type], name: ADJUST_NAME, icon: 'sync', color: '#A3A3A3', type, order: 9999,
    hidden: true, deleted: false, deleted_at: null, updated_at: now,
  };
}

/**
 * Операция, которая приводит остаток счёта к нужному значению.
 * current и target — в минимальных единицах. null, если остаток уже такой.
 */
export function adjustmentFor(account, current, target, now = Date.now()) {
  const delta = target - current;
  if (!Number.isInteger(delta) || delta === 0) return null;
  const type = delta > 0 ? 'income' : 'expense';
  return newTransaction({
    type, amount: Math.abs(delta), currency: account.currency, account_id: account.id,
    category_id: ADJUST_IDS[type], note: '',
  }, now);
}
