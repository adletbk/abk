// Инсайты: факты о тратах за месяц и список операций выбранного дня.
import { h, clear } from './dom.js';
import { icon } from '../icons.js';
import { periodPill } from './screen.js';
import { accountChip, txRow } from './txrow.js';
import { renderChart } from './chart.js';
import { formatAmount, formatMoney } from '../money.js';
import { dayKey, dayShort, dayTitle, periodTitle, plural, shiftMonth, todayKey } from '../model.js';
import { monthSummary, excludedAccountIds } from '../selectors.js';
import {
  monthSeries, dailyAverage, largestExpense, mostExpensiveDay, noSpendingStreak, weekendShare,
  transactionCount, mostUsedCategory, roundTo,
} from '../analytics.js';

async function load(ctx) {
  const { db, state } = ctx;
  const [txs, categories, allAccounts] = await Promise.all([db.getAll('transactions'), db.getAll('categories'), db.getAll('accounts')]);
  return {
    txs, allAccounts,
    accounts: allAccounts.filter((a) => !a.deleted && !a.hidden).sort((a, b) => a.order - b.order),
    categoriesById: new Map(categories.map((c) => [c.id, c])),
    accountsById: new Map(allAccounts.map((a) => [a.id, a])),
    today: todayKey(),
    opts: { today: todayKey(), accountId: state.accountId, excludeAccounts: excludedAccountIds(allAccounts) },
  };
}

/** Плитка: заголовок и значок сверху, пояснение, крупное значение внизу. */
function tile({ title, glyph, sub, value, onClick, extra, accent = false }) {
  const body = [
    h('span', { class: 'ins-head' }, h('span', { class: 'ins-title', text: title }), glyph),
    sub && h('span', { class: 'ins-sub', text: sub }),
    extra,
    h('span', { class: 'ins-value', text: value }),
  ];
  const cls = 'ins-tile' + (accent ? ' accent' : '');
  return onClick ? h('button', { type: 'button', class: cls, onClick }, body) : h('div', { class: cls }, body);
}

export async function renderInsights(root, ctx) {
  const { state } = ctx;
  const { txs, accounts, allAccounts, categoriesById, today, opts } = await load(ctx);
  const month = state.month;
  const summary = monthSummary(txs, month, opts);
  const series = monthSeries(txs, month, opts);
  const average = dailyAverage(txs, month, opts);
  const largest = largestExpense(txs, month, opts);
  const topDay = mostExpensiveDay(txs, month, opts);
  const streak = noSpendingStreak(txs, month, opts);
  const weekend = weekendShare(txs, month, opts);
  const used = mostUsedCategory(txs, month, opts);
  const count = transactionCount(txs, month, opts);
  const changeMonth = (delta) => { state.month = shiftMonth(state.month, delta); ctx.render(); };
  const dayName = (day) => dayShort(day, today);
  const category = (id) => categoriesById.get(id) ?? { name: 'Без категории', color: '#A3A3A3', icon: 'dots' };
  const badge = (c) => h('span', { class: 'cat-badge', style: { '--c': c.color } }, icon(c.icon, 22));

  const top = h('header', { class: 'topbar' },
    accountChip(ctx, { accounts, allAccounts, txs }),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onClick: () => ctx.back() }, icon('close')));

  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero-period' }, periodPill(periodTitle(month, today), () => changeMonth(-1), () => changeMonth(1))),
    h('div', { class: 'hero-amount' + (summary.expense > 99999999 ? ' long' : ''), text: formatMoney(-summary.expense) }));

  const chart = h('section', { class: 'card' }, renderChart(series, { format: formatAmount }),
    h('div', { class: 'legend' },
      h('span', { class: 'expense' }, h('i', { class: 'line' }), formatAmount(summary.expense)),
      h('span', { class: 'muted' }, h('i', { class: 'line' }), formatAmount(summary.income)),
      series.forecast ? h('span', { class: 'expense' }, h('i', { class: 'line dashed' }), `~${formatAmount(roundTo(series.forecast, 100000))}`) : null));

  const largestCategory = largest && category(largest.category_id);
  const usedCategory = used && category(used.category_id);
  const tiles = h('div', { class: 'ins-grid' },
    tile({
      title: 'В среднем в день', glyph: icon('calendar', 22),
      sub: average.days ? `за ${average.days} ${plural(average.days, ['день', 'дня', 'дней'])}` : null,
      value: formatMoney(roundTo(average.average, 100)),
    }),
    largest
      ? tile({
        title: 'Самая крупная трата', accent: true,
        extra: h('span', { class: 'ins-center' }, badge(largestCategory),
          h('span', { class: 'ins-name', text: largestCategory.name }),
          largest.note && h('span', { class: 'ins-sub', text: largest.note })),
        value: formatMoney(largest.amount, largest.currency),
        onClick: () => ctx.navigate(`#/add/${largest.id}`),
      })
      : tile({ title: 'Самая крупная трата', value: '—' }),
    tile({
      title: 'Самый дорогой день', glyph: icon('lu-shopping-bag', 22),
      sub: topDay ? dayName(topDay.day) : 'трат не было',
      value: topDay ? formatMoney(topDay.amount) : '—',
      onClick: topDay ? () => ctx.navigate(`#/day/${topDay.day}`) : null,
    }),
    tile({
      title: 'Серия без трат', glyph: h('span', { class: 'ins-flame' }, icon('lu-flame', 22)),
      sub: streak ? (streak.from === streak.to ? dayName(streak.from) : `${dayName(streak.from)} – ${dayName(streak.to)}`) : 'траты были каждый день',
      value: streak ? `${streak.days} ${plural(streak.days, ['день', 'дня', 'дней'])}` : '0',
    }),
    tile({
      title: 'Траты в выходные', glyph: icon('lu-umbrella', 22),
      sub: weekend === null ? 'трат не было' : `${weekend}% трат приходится на субботу и воскресенье`,
      value: weekend === null ? '—' : `${weekend}%`,
    }),
    tile({ title: 'Число операций', sub: 'доходы и расходы за период', value: String(count) }),
    tile({
      title: 'Самая частая категория', glyph: usedCategory ? badge(usedCategory) : null,
      sub: usedCategory ? usedCategory.name : 'трат не было',
      value: used ? `${used.count} ${plural(used.count, ['раз', 'раза', 'раз'])}` : '—',
    }));

  clear(root).append(h('div', { class: 'screen insights' }, top, hero, chart, tiles));
}

/** Операции одного дня: открывается из плитки «Самый дорогой день». */
export async function renderDay(root, ctx, day) {
  const { txs, categoriesById, accountsById, today, opts } = await load(ctx);
  const items = txs
    .filter((tx) => !tx.deleted && dayKey(tx.date) === day
      && (opts.accountId ? tx.account_id === opts.accountId || tx.to_account_id === opts.accountId : !opts.excludeAccounts.has(tx.account_id)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = items.reduce((sum, tx) => sum + (tx.currency !== 'KZT' ? 0 : tx.type === 'income' ? tx.amount : tx.type === 'expense' ? -tx.amount : 0), 0);

  clear(root).append(h('div', { class: 'screen' },
    h('header', { class: 'screen-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onClick: () => ctx.back() }, icon('close')),
      h('h1', {}, dayShort(day, today), h('span', { class: 'head-sub', text: periodTitle(day.slice(0, 7), today) })),
      h('span', { class: 'head-spacer' })),
    h('div', { class: 'day' },
      h('div', { class: 'day-head' },
        h('span', { text: dayTitle(day, today) }),
        h('span', { class: 'num' + (total > 0 ? ' income' : ''), text: formatMoney(total, 'KZT', { sign: true }) })),
      items.length
        ? items.map((tx) => txRow(tx, { categoriesById, accountsById, onClick: () => ctx.navigate(`#/add/${tx.id}`) }))
        : h('p', { class: 'empty', text: 'В этот день операций нет' }))));
}
