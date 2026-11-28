// Главная: остаток, баланс месяца, операции по дням. Кнопка «+» — рядом с вкладками (tabs.js).
import { h, clear } from './dom.js';
import { icon } from '../icons.js';
import { confirmSheet } from './sheet.js';
import { accountChip, txRow } from './txrow.js';
import { formatAmount, formatMoney } from '../money.js';
import { dayTitle, todayKey } from '../model.js';
import { currentPeriod, periodControl } from './period.js';
import { monthSummary, groupByDay, excludedAccountIds } from '../selectors.js';
import { clearDemo } from '../seed.js';
import { reviewCounts } from '../inbox.js';

export async function renderHome(root, ctx) {
  const { db, state } = ctx;
  const [txs, categories, allAccounts, demo] = await Promise.all([
    db.getAll('transactions'), db.getAll('categories'), db.getAll('accounts'), db.getSetting('demo', false),
  ]);
  const review = await reviewCounts(db);
  const today = todayKey();
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const accountsById = new Map(allAccounts.map((a) => [a.id, a]));
  const accounts = allAccounts.filter((a) => !a.deleted && !a.hidden).sort((a, b) => a.order - b.order);
  if (state.accountId && !accounts.some((a) => a.id === state.accountId)) state.accountId = null;
  // Счета, скрытые из общего баланса, не участвуют в режиме «Все счета».
  const scope = { accountId: state.accountId, excludeAccounts: excludedAccountIds(allAccounts) };
  const period = currentPeriod(state, txs, today);
  const summary = monthSummary(txs, period, scope);

  // --- шапка ---
  const topbar = h('header', { class: 'topbar' },
    accountChip(ctx, { accounts, allAccounts, txs }),
    h('span', { class: 'spacer' }),
    // Синхронизация идёт сама; значок виден, только пока она выполняется.
    h('span', { class: 'sync-indicator', role: 'status', 'aria-label': 'Идёт синхронизация' }, icon('sync', 18)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Поиск', onClick: toggleSearch }, icon('search')));

  // --- поиск ---
  const searchInput = h('input', {
    type: 'search', placeholder: 'Заметка, категория или счёт', value: state.query,
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
    h('div', { class: 'hero-period' },
      h('span', { text: 'Баланс за' }),
      periodControl(ctx, period, today)),
    h('div', { class: 'hero-amount' + (balanceText.length > 11 ? ' long' : ''), text: balanceText }),
    h('div', { class: 'hero-flow' },
      h('span', { class: 'income', 'aria-label': `Доход ${formatMoney(summary.income)}` },
        icon('arrow-in', 18), h('span', { text: formatAmount(summary.income) })),
      h('span', { class: 'expense', 'aria-label': `Расход ${formatMoney(summary.expense)}` },
        icon('arrow-out', 18), h('span', { text: formatAmount(summary.expense) }))),
    h('button', { type: 'button', class: 'pill-btn', onClick: () => ctx.navigate('#/insights') },
      icon('sparkles', 20), 'Инсайты'));

  // --- тестовые данные ---
  const banner = demo && h('div', { class: 'banner' },
    h('span', { text: 'Это тестовые данные' }),
    h('button', {
      type: 'button', text: 'Удалить',
      onClick: async () => {
        const yes = await confirmSheet({
          title: 'Удалить тестовые данные?',
          text: 'Тестовые операции исчезнут. Счета, категории и операции, которые вы добавили или изменили сами, останутся.',
          confirmLabel: 'Удалить', danger: true,
        });
        if (yes) { await clearDemo(db); ctx.render(); }
      },
    }));

  const reviewBanner = review.total > 0 && h('div', { class: 'banner banner-review' },
    h('span', { text: `Нужно проверить: ${review.total}` }),
    h('button', { type: 'button', text: 'Открыть', onClick: () => ctx.navigate('#/review') }));

  // --- список по дням ---
  const list = h('section', { class: 'days' });
  const accountName = (id) => accountsById.get(id)?.name ?? 'Счёт';

  function fillList() {
    clear(list);
    // Поиск идёт по заметке, категории и счёту: подставляем их в одно поле для выборки.
    const searchable = state.query.trim()
      ? txs.map((tx) => ({ ...tx, note: `${tx.note ?? ''}\n${accountName(tx.account_id)}` }))
      : txs;
    const byId = new Map(txs.map((tx) => [tx.id, tx]));
    const days = groupByDay(searchable, period, { ...scope, query: state.query, categoriesById });
    if (days.length === 0) {
      list.append(h('p', {
        class: 'empty',
        text: state.query.trim() ? 'Ничего не найдено' : 'За этот период операций нет',
      }));
      return;
    }
    for (const group of days) {
      list.append(h('div', { class: 'day' },
        h('div', { class: 'day-head' },
          h('span', { text: dayTitle(group.day, today) }),
          h('span', { class: 'num' + (group.total > 0 ? ' income' : ''), text: formatMoney(group.total, 'KZT', { sign: true }) })),
        group.items.map((tx) => txRow(byId.get(tx.id), {
          categoriesById, accountsById, onClick: () => ctx.navigate(`#/add/${tx.id}`),
        }))));
    }
  }
  fillList();

  clear(root).append(h('div', { class: 'screen-home' }, topbar, search, hero, banner, reviewBanner, list));
}
