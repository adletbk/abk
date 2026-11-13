// Главная: остаток, баланс месяца, операции по дням, нижняя панель.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { pickSheet, confirmSheet } from './sheet.js';
import { formatMoney } from '../money.js';
import { SOURCE_LABELS, dayTitle, monthTitle, shiftMonth, todayKey } from '../model.js';
import { monthSummary, groupByDay, accountBalances, totalBalance } from '../selectors.js';
import { clearDemo } from '../seed.js';

const TRANSFER_COLOR = '#60A5FA';

export async function renderHome(root, ctx) {
  const { db, state } = ctx;
  const [txs, categories, allAccounts, demo] = await Promise.all([
    db.getAll('transactions'), db.getAll('categories'), db.getAll('accounts'), db.getSetting('demo', false),
  ]);
  const today = todayKey();
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const accountsById = new Map(allAccounts.map((a) => [a.id, a]));
  const accounts = allAccounts.filter((a) => !a.deleted && !a.hidden).sort((a, b) => a.order - b.order);
  const balances = accountBalances(allAccounts, txs);
  if (state.accountId && !accounts.some((a) => a.id === state.accountId)) state.accountId = null;
  const account = state.accountId ? accountsById.get(state.accountId) : null;
  const summary = monthSummary(txs, state.month, { accountId: state.accountId });
  const month = monthTitle(state.month, today);

  // --- шапка ---
  const chip = h('button', { type: 'button', class: 'chip', onClick: pickAccount },
    h('span', { class: 'chip-label', text: account ? account.name : 'Все счета' }),
    h('span', {
      class: 'chip-value',
      text: account ? formatMoney(balances.get(account.id), account.currency) : formatMoney(totalBalance(accounts, txs)),
    }));
  const topbar = h('header', { class: 'topbar' },
    chip,
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Поиск', onClick: toggleSearch }, icon('search')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Аналитика', onClick: () => toast('Аналитика появится в M2') }, icon('chart')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Настройки', onClick: () => toast('Настройки появятся в M2') }, icon('settings')));

  async function pickAccount() {
    const picked = await pickSheet({
      title: 'Счёт',
      selected: state.accountId,
      items: [
        { value: null, label: 'Все счета', icon: 'layers', right: formatMoney(totalBalance(accounts, txs)) },
        ...accounts.map((a) => ({
          value: a.id, label: a.name, icon: a.icon || 'card', right: formatMoney(balances.get(a.id), a.currency),
        })),
      ],
    });
    if (picked) { state.accountId = picked.value; ctx.render(); }
  }

  // --- поиск ---
  const searchInput = h('input', {
    type: 'search', placeholder: 'Заметка или категория', value: state.query,
    autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'search', 'aria-label': 'Поиск по операциям',
    onInput: () => { state.query = searchInput.value; fillList(); },
  });
  const search = state.searchOpen && h('div', { class: 'search' }, icon('search', 20), searchInput,
    h('button', { type: 'button', class: 'icon-btn plain', 'aria-label': 'Закрыть поиск', onClick: toggleSearch }, icon('close', 20)));

  function toggleSearch() {
    state.searchOpen = !state.searchOpen;
    state.query = '';
    ctx.render().then(() => { if (state.searchOpen) document.querySelector('.search input')?.focus(); });
  }

  // --- баланс месяца ---
  const balanceText = formatMoney(summary.balance);
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero-month' },
      h('button', { type: 'button', class: 'icon-btn plain', 'aria-label': 'Предыдущий месяц', onClick: () => changeMonth(-1) }, icon('chevron-left', 20)),
      h('span', { class: 'title', text: `Баланс за ${month}` }),
      h('button', { type: 'button', class: 'icon-btn plain', 'aria-label': 'Следующий месяц', onClick: () => changeMonth(1) }, icon('chevron-right', 20))),
    h('div', { class: 'hero-amount' + (balanceText.length > 12 ? ' long' : ''), text: balanceText }),
    h('div', { class: 'hero-split' },
      h('div', { class: 'tile' },
        h('div', { class: 'label' }, h('span', { class: 'dot income' }), 'Доход'),
        h('div', { class: 'value income', text: formatMoney(summary.income) })),
      h('div', { class: 'tile' },
        h('div', { class: 'label' }, h('span', { class: 'dot expense' }), 'Расход'),
        h('div', { class: 'value expense', text: formatMoney(summary.expense) }))));

  function changeMonth(delta) {
    state.month = shiftMonth(state.month, delta);
    ctx.render();
  }

  // --- тестовые данные ---
  const banner = demo && h('div', { class: 'banner' },
    h('span', { text: 'Это тестовые данные' }),
    h('button', {
      type: 'button', text: 'Удалить',
      onClick: async () => {
        const yes = await confirmSheet({
          title: 'Удалить тестовые данные?',
          text: 'Тестовые операции исчезнут. Счета, категории и операции, которые вы добавили сами, останутся.',
          confirmLabel: 'Удалить', danger: true,
        });
        if (yes) { await clearDemo(db); ctx.render(); }
      },
    }));

  // --- список по дням ---
  const list = h('section', { class: 'days' });

  function row(tx) {
    const isTransfer = tx.type === 'transfer';
    const category = categoriesById.get(tx.category_id);
    const name = (id) => accountsById.get(id)?.name ?? 'Счёт';
    const title = isTransfer ? `${name(tx.account_id)} → ${name(tx.to_account_id)}` : category?.name ?? 'Без категории';
    const sub = [tx.note, SOURCE_LABELS[tx.source] ?? tx.source].filter(Boolean).join(' · ');
    const amount = tx.type === 'income' ? formatMoney(tx.amount, tx.currency, { sign: true })
      : isTransfer ? formatMoney(tx.amount, tx.currency) : formatMoney(-tx.amount, tx.currency);
    return h('button', { type: 'button', class: 'row', onClick: () => ctx.navigate(`#/add/${tx.id}`) },
      h('span', { class: 'cat-badge', style: { '--c': isTransfer ? TRANSFER_COLOR : category?.color ?? '#A3A3A3' } },
        icon(isTransfer ? 'transfer' : category?.icon ?? 'dots', 22)),
      h('span', { class: 'row-main' },
        h('div', { class: 'row-title', text: title }),
        h('div', { class: 'row-sub', text: sub })),
      h('span', { class: 'row-amount' + (tx.type === 'income' ? ' income' : isTransfer ? ' muted' : ''), text: amount }));
  }

  function fillList() {
    clear(list);
    const days = groupByDay(txs, state.month, { accountId: state.accountId, query: state.query, categoriesById });
    if (days.length === 0) {
      list.append(h('p', { class: 'empty', text: state.query.trim() ? 'Ничего не найдено' : `Нет операций за ${month}` }));
      return;
    }
    for (const group of days) {
      list.append(h('div', { class: 'day' },
        h('div', { class: 'day-head' },
          h('span', { text: dayTitle(group.day, today) }),
          h('span', { class: 'num', text: formatMoney(group.total, 'KZT', { sign: true }) })),
        h('div', { class: 'day-card' }, group.items.map(row))));
    }
  }
  fillList();

  // --- нижняя панель ---
  const dock = h('nav', { class: 'dock', 'aria-label': 'Действия' },
    h('button', { type: 'button', 'aria-label': 'Шаблоны', onClick: () => toast('Шаблоны появятся в M2') }, icon('bolt')),
    h('button', { type: 'button', class: 'dock-add', 'aria-label': 'Добавить операцию', onClick: () => ctx.navigate('#/add') }, icon('plus', 28)),
    h('button', { type: 'button', 'aria-label': 'Синхронизация', onClick: () => toast('Синхронизация появится в M3') }, icon('sync')));

  clear(root).append(h('div', { class: 'screen-home' }, topbar, search, hero, banner, list, dock));
}
