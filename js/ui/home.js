// Главная: остаток, баланс месяца, операции по дням, нижняя панель.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { openSheet, pickSheet, confirmSheet } from './sheet.js';
import { monthSeries, spendDynamics, dailyAverage, categoryBreakdown, buildInsights } from '../analytics.js';
import { formatAmount, formatMoney } from '../money.js';
import { SOURCE_LABELS, dayTitle, monthTitle, periodTitle, shiftMonth, todayKey } from '../model.js';
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

  // --- шапка ---
  const chip = h('button', { type: 'button', class: 'acct', onClick: pickAccount },
    h('span', { class: 'acct-icon' }, icon(account?.icon || 'wallet', 18)),
    h('span', { class: 'acct-text' },
      h('span', { class: 'acct-name', text: account ? account.name : 'Все счета' }),
      h('span', {
        class: 'acct-balance',
        text: account ? formatMoney(balances.get(account.id), account.currency) : formatMoney(totalBalance(accounts, txs)),
      })));
  const topbar = h('header', { class: 'topbar' },
    chip,
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Поиск', onClick: toggleSearch }, icon('search')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Аналитика', onClick: () => ctx.navigate('#/analytics') }, icon('pie')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Настройки', onClick: () => ctx.navigate('#/settings') }, icon('settings')));

  async function pickAccount() {
    const picked = await pickSheet({
      title: 'Счёт',
      selected: state.accountId,
      items: [
        { value: null, label: 'Все счета', icon: 'layers', right: formatMoney(totalBalance(accounts, txs)) },
        ...accounts.map((a) => ({
          value: a.id, label: a.name, icon: a.icon || 'wallet', right: formatMoney(balances.get(a.id), a.currency),
        })),
      ],
    });
    if (picked) { state.accountId = picked.value; ctx.render(); }
  }

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
      h('div', { class: 'period' },
        h('button', { type: 'button', 'aria-label': 'Предыдущий месяц', onClick: () => changeMonth(-1) }, icon('chevron-left', 18)),
        h('span', { class: 'period-title', text: periodTitle(state.month, today) }),
        h('button', { type: 'button', 'aria-label': 'Следующий месяц', onClick: () => changeMonth(1) }, icon('chevron-right', 18)))),
    h('div', { class: 'hero-amount' + (balanceText.length > 11 ? ' long' : ''), text: balanceText }),
    h('div', { class: 'hero-flow' },
      h('span', { class: 'income', 'aria-label': `Доход ${formatMoney(summary.income)}` },
        icon('arrow-in', 18), h('span', { text: formatAmount(summary.income) })),
      h('span', { class: 'expense', 'aria-label': `Расход ${formatMoney(summary.expense)}` },
        icon('arrow-out', 18), h('span', { text: formatAmount(summary.expense) }))),
    h('button', { type: 'button', class: 'pill-btn', onClick: showInsights },
      icon('sparkles', 20), 'Инсайты'));

  function showInsights() {
    const opts = { today, accountId: state.accountId };
    const top = categoryBreakdown(txs, state.month, opts)[0];
    const lines = buildInsights({
      summary,
      dynamics: spendDynamics(txs, state.month, opts),
      average: dailyAverage(txs, state.month, opts),
      top: top ? { ...top, name: categoriesById.get(top.category_id)?.name ?? 'Без категории' } : null,
      forecast: monthSeries(txs, state.month, opts).forecast,
    });
    openSheet({
      title: `Инсайты: ${periodTitle(state.month, today).toLowerCase()}`,
      content: h('ul', { class: 'insights' }, lines.map((text) => h('li', { text }))),
    });
  }

  async function pickTemplate() {
    const templates = (await db.getAll('templates')).filter((t) => !t.deleted).sort((a, b) => a.updated_at - b.updated_at);
    if (templates.length === 0) {
      toast('Шаблонов пока нет. Создайте его из меню «⋮» на экране операции', { duration: 4500 });
      return;
    }
    const picked = await pickSheet({
      title: 'Шаблоны',
      items: templates.map((t) => {
        const category = categoriesById.get(t.category_id);
        return {
          value: t.id, label: t.name,
          icon: t.type === 'transfer' ? 'transfer' : category?.icon ?? 'bolt',
          color: t.type === 'transfer' ? TRANSFER_COLOR : category?.color ?? '#FBBF24',
          right: t.amount ? formatMoney(t.amount, t.currency) : null,
        };
      }),
    });
    if (picked) ctx.navigate(`#/add?t=${picked.value}`);
  }

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
          text: 'Тестовые операции исчезнут. Счета, категории и операции, которые вы добавили или изменили сами, останутся.',
          confirmLabel: 'Удалить', danger: true,
        });
        if (yes) { await clearDemo(db); ctx.render(); }
      },
    }));

  // --- список по дням ---
  const list = h('section', { class: 'days' });
  const accountName = (id) => accountsById.get(id)?.name ?? 'Счёт';

  function row(tx) {
    const isTransfer = tx.type === 'transfer';
    const category = categoriesById.get(tx.category_id);
    const fallback = isTransfer ? 'Перевод' : category?.name ?? 'Без категории';
    const where = isTransfer ? `${accountName(tx.account_id)} → ${accountName(tx.to_account_id)}` : accountName(tx.account_id);
    const amount = tx.type === 'income' ? formatMoney(tx.amount, tx.currency, { sign: true })
      : isTransfer ? formatMoney(tx.amount, tx.currency) : formatMoney(-tx.amount, tx.currency);
    return h('button', { type: 'button', class: 'row', onClick: () => ctx.navigate(`#/add/${tx.id}`) },
      h('span', { class: 'cat-badge', style: { '--c': isTransfer ? TRANSFER_COLOR : category?.color ?? '#A3A3A3' } },
        icon(isTransfer ? 'transfer' : category?.icon ?? 'dots', 22)),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title', text: tx.note || fallback }),
        h('span', { class: 'row-sub', text: `${where} · ${SOURCE_LABELS[tx.source] ?? tx.source}` })),
      h('span', { class: 'row-amount' + (tx.type === 'income' ? ' income' : isTransfer ? ' muted' : ''), text: amount }));
  }

  function fillList() {
    clear(list);
    // Поиск идёт по заметке, категории и счёту: подставляем их в одно поле для выборки.
    const searchable = state.query.trim()
      ? txs.map((tx) => ({ ...tx, note: `${tx.note ?? ''}\n${accountName(tx.account_id)}` }))
      : txs;
    const byId = new Map(txs.map((tx) => [tx.id, tx]));
    const days = groupByDay(searchable, state.month, { accountId: state.accountId, query: state.query, categoriesById });
    if (days.length === 0) {
      list.append(h('p', {
        class: 'empty',
        text: state.query.trim() ? 'Ничего не найдено' : `Нет операций за ${monthTitle(state.month, today)}`,
      }));
      return;
    }
    for (const group of days) {
      list.append(h('div', { class: 'day' },
        h('div', { class: 'day-head' },
          h('span', { text: dayTitle(group.day, today) }),
          h('span', { class: 'num' + (group.total > 0 ? ' income' : ''), text: formatMoney(group.total, 'KZT', { sign: true }) })),
        group.items.map((tx) => row(byId.get(tx.id)))));
    }
  }
  fillList();

  // --- нижняя панель ---
  const dock = h('nav', { class: 'dock', 'aria-label': 'Действия' },
    h('button', { type: 'button', 'aria-label': 'Шаблоны', onClick: pickTemplate }, icon('bolt')),
    h('button', { type: 'button', class: 'dock-add', 'aria-label': 'Добавить операцию', onClick: () => ctx.navigate('#/add') }, icon('plus', 28)),
    h('button', { type: 'button', 'aria-label': 'Синхронизация', onClick: () => toast('Синхронизация появится в M3') }, icon('sync')));

  clear(root).append(h('div', { class: 'screen-home' }, topbar, search, hero, banner, list, dock));
}
