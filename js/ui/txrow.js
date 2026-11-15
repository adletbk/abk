// Строка операции в списках (главная, день в инсайтах) и чип выбора счёта.
import { h } from './dom.js';
import { icon } from '../icons.js';
import { pickSheet } from './sheet.js';
import { formatMoney } from '../money.js';
import { accountBalances, totalBalance } from '../selectors.js';

const TRANSFER_COLOR = '#4C8DFF';

/** Строка: категория, под ней заметка (если есть) и счёт. У перевода — оба счёта и обе суммы. */
export function txRow(tx, { categoriesById, accountsById, onClick }) {
  const isTransfer = tx.type === 'transfer';
  const category = categoriesById.get(tx.category_id);
  const account = (id) => {
    const found = accountsById.get(id);
    return h('span', { class: 'row-acct' }, h('span', { class: 'row-acct-icon' }, icon(found?.icon || 'wallet', 12)),
      h('span', { class: 'row-acct-name', text: found?.name ?? 'Счёт' }));
  };
  const amount = isTransfer
    ? h('span', { class: 'row-amount' },
      h('span', { text: formatMoney(-tx.amount, tx.currency) }),
      h('span', { class: 'row-amount-in', text: formatMoney(tx.amount, tx.currency, { sign: true }) }))
    : h('span', { class: 'row-amount' + (tx.type === 'income' ? ' income' : ''),
      text: tx.type === 'income' ? formatMoney(tx.amount, tx.currency, { sign: true }) : formatMoney(-tx.amount, tx.currency) });
  return h('button', { type: 'button', class: 'row', onClick },
    h('span', { class: 'cat-badge', style: { '--c': isTransfer ? TRANSFER_COLOR : category?.color ?? '#A3A3A3' } },
      icon(isTransfer ? 'transfer' : category?.icon ?? 'dots', 22)),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title', text: isTransfer ? 'Перевод' : category?.name ?? 'Без категории' }),
      tx.note && h('span', { class: 'row-note', text: tx.note }),
      h('span', { class: 'row-sub' },
        tx.status === 'needs_review' && h('span', { class: 'row-flag', text: 'Проверить' }),
        account(tx.account_id),
        isTransfer && h('span', { class: 'row-arrow', text: '→' }),
        isTransfer && account(tx.to_account_id))),
    amount);
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
