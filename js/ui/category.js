// Траты (или доходы) одной категории за выбранный период: итоги, подкатегории, операции по дням или месяцам.
import { h, clear } from './dom.js';
import { icon } from '../icons.js';
import { screenHeader } from './screen.js';
import { currentPeriod, periodControl } from './period.js';
import { txRow } from './txrow.js';
import { formatMoney } from '../money.js';
import { dayTitle, monthName, plural, todayKey } from '../model.js';
import { excludedAccountIds } from '../selectors.js';
import { rollupId } from '../catalog.js';
import { categoryReport, reportDays, reportMonths, shareText } from '../category-report.js';

export const NO_CATEGORY = { name: 'Без категории', color: '#A3A3A3', icon: 'dots' };
const NONE = 'none';
const whole = (minor) => formatMoney(Math.round(minor / 100) * 100);
const OPERATIONS = ['операция', 'операции', 'операций'];

/** Адрес экрана категории; null — операции без категории. */
export const categoryHash = (id) => `#/category/${id ?? NONE}`;

export async function renderCategory(root, ctx, param) {
  const { db, state } = ctx;
  const id = param === NONE ? null : param;
  const [txs, categories, allAccounts] = await Promise.all([db.getAll('transactions'), db.getAll('categories'), db.getAll('accounts')]);
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const accountsById = new Map(allAccounts.map((a) => [a.id, a]));
  const info = (categoryId) => categoriesById.get(categoryId) ?? NO_CATEGORY;
  const category = info(id);
  const today = todayKey();
  const type = state.analyticsType ?? category.type ?? 'expense';
  const period = currentPeriod(state, txs, today);

  // Выбранная подкатегория и раскрытый месяц помнятся, пока смотрим одну и ту же категорию.
  if (state.categoryView?.id !== id) state.categoryView = { id, sub: undefined, month: undefined };
  const view = state.categoryView;

  const report = categoryReport(txs, period, id, {
    type, today, sub: view.sub, accountId: state.accountId, excludeAccounts: excludedAccountIds(allAccounts),
    parentOf: new Map(categories.map((c) => [c.id, rollupId(c.id, categoriesById)])),
  });

  const account = accountsById.get(state.accountId);
  const ofWhat = type === 'income' ? 'всех доходов' : 'всех расходов';
  const notes = [report.share !== null && `${shareText(report.share)} ${ofWhat}`, account && account.name].filter(Boolean);
  const amountText = formatMoney(report.total);
  const hero = h('div', { class: 'cat-hero' },
    h('div', { class: 'plan-period' }, periodControl(ctx, period, today)),
    h('span', { class: 'cat-badge', style: { '--c': category.color } }, icon(category.icon, 28)),
    h('span', { class: 'cat-hero-sum num' + (amountText.length > 13 ? ' long' : ''), text: amountText }),
    notes.length > 0 && h('span', { class: 'cat-hero-note', text: notes.join(' · ') }));

  const stat = (label, value) => h('div', { class: 'cat-stat' }, h('span', { text: label }), h('b', { class: 'num', text: value }));
  const stats = h('div', { class: 'cat-stats' },
    stat('Операций', String(report.count)),
    stat('В среднем', report.average === null ? '—' : whole(report.average)),
    report.rate && stat(report.rate.unit === 'month' ? 'В месяц' : 'В день', whole(report.rate.amount)));

  const chip = (sub, label, color, amount) => h('button', {
    type: 'button', class: 'cat-sub', 'aria-pressed': String(report.sub === sub), style: color ? { '--c': color } : null,
    onClick: () => { view.sub = sub; ctx.render(); },
  }, color && h('i'), h('span', { text: label }), h('em', { class: 'num', text: formatMoney(amount) }));
  const subs = report.subs.length > 0 && h('div', { class: 'cat-subs', role: 'group', 'aria-label': 'Подкатегории' },
    chip(undefined, 'Все', null, report.categoryTotal),
    report.subs.map((row) => chip(row.category_id, row.category_id === id ? 'Без подкатегории' : info(row.category_id).name, info(row.category_id).color, row.amount)));

  const dayBlock = (group) => h('div', { class: 'day' },
    h('div', { class: 'day-head' },
      h('span', { text: dayTitle(group.day, today) }),
      h('span', { class: 'num' + (group.total > 0 ? ' income' : ''), text: formatMoney(group.total, 'KZT', { sign: true }) })),
    group.items.map((tx) => txRow(tx, { categoriesById, accountsById, onClick: () => ctx.navigate(`#/add/${tx.id}`) })));

  let body;
  if (report.count === 0) {
    body = h('p', { class: 'empty', text: 'За этот период операций нет' });
  } else if (report.long) {
    const months = reportMonths(report.items, period);
    // По умолчанию раскрыт последний месяц; null — всё свёрнуто.
    const open = view.month === undefined || (view.month && !months.some((m) => m.month === view.month)) ? months[0].month : view.month;
    body = h('div', { class: 'list' }, months.map((entry) => {
      const expanded = entry.month === open;
      return h('div', { class: 'cat-month' },
        h('button', {
          type: 'button', class: 'item', 'aria-expanded': String(expanded),
          onClick: () => { view.month = expanded ? null : entry.month; ctx.render(); },
        },
        h('span', { class: 'item-main' },
          h('span', { class: 'item-label', text: monthName(entry.month, today) }),
          h('span', { class: 'item-sub', text: `${entry.count} ${plural(entry.count, OPERATIONS)}` })),
        h('span', { class: 'analytics-amount', text: formatMoney(entry.total) }),
        h('span', { class: 'item-chevron' }, icon('chevron-right', 18))),
        expanded && h('div', { class: 'cat-month-days' }, entry.days.map(dayBlock)));
    }));
  } else {
    body = h('div', {}, reportDays(report.items, period).map(dayBlock));
  }

  clear(root).append(h('div', { class: 'screen screen-category' }, screenHeader(ctx, category.name), hero, stats, subs, body));
}
