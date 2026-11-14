// Аналитика месяца: только факт доходов и расходов.
import { h, clear } from './dom.js';
import { screenHeader, periodPill } from './screen.js';
import { renderChart } from './chart.js';
import { formatAmount, formatMoney } from '../money.js';
import { monthName, plural, shiftMonth, todayKey } from '../model.js';
import { monthSummary } from '../selectors.js';
import {
  monthSeries, spendDynamics, dailyAverage, categoryBreakdown, savedShare, roundTo,
} from '../analytics.js';

const MINUS = '−';

export async function renderAnalytics(root, ctx) {
  const { db, state } = ctx;
  const [txs, categories] = await Promise.all([db.getAll('transactions'), db.getAll('categories')]);
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const today = todayKey();
  const opts = { today, accountId: state.accountId };

  const summary = monthSummary(txs, state.month, opts);
  const series = monthSeries(txs, state.month, opts);
  const dynamics = spendDynamics(txs, state.month, opts);
  const average = dailyAverage(txs, state.month, opts);
  const breakdown = categoryBreakdown(txs, state.month, opts);
  const saved = savedShare(summary);

  const changeMonth = (delta) => { state.month = shiftMonth(state.month, delta); ctx.render(); };
  const head = screenHeader(ctx, 'Аналитика',
    periodPill(monthName(state.month, today), () => changeMonth(-1), () => changeMonth(1)));

  const balanceText = formatMoney(summary.balance);
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'hero-amount' + (balanceText.length > 11 ? ' long' : ''), text: balanceText }),
    saved === null
      ? h('div', { class: 'hero-note muted', text: summary.expense ? 'Доходов за период не было' : 'Операций за период нет' })
      : saved >= 0
        ? h('div', { class: 'hero-note income', text: `Отложено ${saved}% дохода` })
        : h('div', { class: 'hero-note expense', text: 'Расходы выше доходов' }));

  const legend = h('div', { class: 'legend' },
    h('span', { class: 'expense' }, h('i', { class: 'line' }), formatAmount(summary.expense)),
    h('span', { class: 'muted' }, h('i', { class: 'line' }), formatAmount(summary.income)),
    series.forecast ? h('span', { class: 'expense' }, h('i', { class: 'line dashed' }),
      `Прогноз ~${formatAmount(roundTo(series.forecast, 100000))}`) : null);
  const chartCard = h('section', { class: 'card' }, renderChart(series), legend);

  const percent = dynamics.percent;
  const tiles = h('div', { class: 'tiles' },
    h('section', { class: 'card tile' },
      h('div', { class: 'tile-title', text: 'Динамика трат' }),
      h('div', { class: 'tile-sub', text: 'к прошлому месяцу' }),
      h('div', {
        class: 'tile-value' + (percent == null ? ' muted' : percent > 0 ? ' expense' : ' income'),
        text: percent == null ? '—' : `${percent > 0 ? '+' : percent < 0 ? MINUS : ''}${Math.abs(percent)}%`,
      })),
    h('section', { class: 'card tile' },
      h('div', { class: 'tile-title', text: 'В день в среднем' }),
      h('div', { class: 'tile-sub', text: `за ${average.days} ${plural(average.days, ['день', 'дня', 'дней'])}` }),
      h('div', { class: 'tile-value', text: formatAmount(roundTo(average.average, 100)) })));

  const bar = h('div', { class: 'seg-bar', 'aria-hidden': 'true' });
  const rows = h('div', { class: 'cat-rows' });
  for (const item of breakdown) {
    const category = categoriesById.get(item.category_id);
    const color = category?.color ?? '#A3A3A3';
    bar.append(h('span', { style: { '--c': color, 'flex-grow': String(Math.max(item.share, 0.01)) } }));
    rows.append(h('div', { class: 'cat-row' },
      h('span', { class: 'dot', style: { '--c': color } }),
      h('span', { class: 'cat-row-name', text: category?.name ?? 'Без категории' }),
      h('span', { class: 'cat-row-share', text: `${Math.round(item.share * 100)}%` }),
      h('span', { class: 'cat-row-amount', text: formatMoney(item.amount) })));
  }
  const categoriesCard = h('section', { class: 'card' },
    h('h2', { class: 'card-title', text: 'Расходы по категориям' }),
    breakdown.length ? [bar, rows] : h('p', { class: 'muted', text: 'Расходов за период нет' }));

  clear(root).append(h('div', { class: 'screen' }, head, hero, chartCard, tiles, categoriesCard));
}
