// Строка операции в списках (главная, день в инсайтах) и чип выбора счёта.
import { h } from './dom.js';
import { icon } from '../icons.js';
import { pickSheet } from './sheet.js';
import { formatMoney } from '../money.js';
import { SOURCE_LABELS } from '../model.js';
import { accountBalances, totalBalance } from '../selectors.js';

const TRANSFER_COLOR = '#4C8DFF';
const SHORT_SOURCE = { applepay: 'Apple Pay', notification: 'банк', sms: 'SMS' };

/** Операция, собранная из двух источников, показывает оба: «Apple Pay + банк». */
export const sourceLabel = (tx) => (tx.sources?.length > 1
  ? tx.sources.map((s) => SHORT_SOURCE[s] ?? s).join(' + ')
  : SOURCE_LABELS[tx.source] ?? tx.source);

export function txRow(tx, { categoriesById, accountsById, onClick }) {
  const isTransfer = tx.type === 'transfer';
  const category = categoriesById.get(tx.category_id);
  const name = (id) => accountsById.get(id)?.name ?? 'Счёт';
  const fallback = isTransfer ? 'Перевод' : category?.name ?? 'Без категории';
  const where = isTransfer ? `${name(tx.account_id)} → ${name(tx.to_account_id)}` : name(tx.account_id);
  const amount = tx.type === 'income' ? formatMoney(tx.amount, tx.currency, { sign: true })
    : isTransfer ? formatMoney(tx.amount, tx.currency) : formatMoney(-tx.amount, tx.currency);
  return h('button', { type: 'button', class: 'row', onClick },
    h('span', { class: 'cat-badge', style: { '--c': isTransfer ? TRANSFER_COLOR : category?.color ?? '#A3A3A3' } },
      icon(isTransfer ? 'transfer' : category?.icon ?? 'dots', 22)),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title', text: tx.note || fallback }),
      h('span', { class: 'row-sub', text: `${tx.status === 'needs_review' ? 'Проверить · ' : ''}${where} · ${sourceLabel(tx)}` })),
    h('span', { class: 'row-amount' + (tx.type === 'income' ? ' income' : isTransfer ? ' muted' : ''), text: amount }));
}

/**
 * Чип «Все счета / счёт» с остатком. По нажатию открывает выбор счёта,
 * записывает его в state.accountId и перерисовывает экран.
 */
export function accountChip(ctx, { accounts, allAccounts, txs }) {
  const { state } = ctx;
  const balances = accountBalances(allAccounts, txs);
  const account = accounts.find((a) => a.id === state.accountId) ?? null;
  const total = formatMoney(totalBalance(accounts, txs));
  async function pick() {
    const picked = await pickSheet({
      title: 'Счёт', selected: state.accountId,
      items: [
        { value: null, label: 'Все счета', icon: 'layers', right: total },
        ...accounts.map((a) => ({
          value: a.id, label: a.name, icon: a.icon || 'wallet', color: a.color,
          right: formatMoney(balances.get(a.id), a.currency),
        })),
      ],
    });
    if (picked) { state.accountId = picked.value; ctx.render(); }
  }
  const badge = h('span', { class: 'acct-icon' }, icon(account?.icon || 'wallet', 18));
  if (account?.color) badge.style.setProperty('background', account.color);
  return h('button', { type: 'button', class: 'acct', onClick: pick },
    badge,
    h('span', { class: 'acct-text' },
      h('span', { class: 'acct-name', text: account ? account.name : 'Все счета' }),
      h('span', { class: 'acct-balance', text: account ? formatMoney(balances.get(account.id), account.currency) : total })));
}
