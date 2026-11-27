// Аналитика месяца: доли категорий и четыре вида отчёта. Только факт, без бюджетов.
import { h, clear } from './dom.js';
import { icon } from '../icons.js';
import { currentPeriod, periodControl } from './period.js';
import { pickSheet } from './sheet.js';
import { accountChip } from './txrow.js';
import { renderChart, renderDonut, renderStacked, renderSankey } from './chart.js';
import { formatAmount, formatMoney } from '../money.js';
import { TYPE_LABELS, todayKey } from '../model.js';
import { monthSummary, excludedAccountIds } from '../selectors.js';
import { monthSeries, categoryBreakdown, stackedSeries, roundTo } from '../analytics.js';
import { rollupId } from '../catalog.js';
import { NO_CATEGORY, categoryHash } from './category.js';
import { shareText } from '../category-report.js';

const VIEWS = {
  pie: { label: 'Круговая', icon: 'pie' },
  line: { label: 'Линия', icon: 'lu-chart-line' },
  stacked: { label: 'Столбцы по дням', icon: 'bars' },
  sankey: { label: 'Потоки', icon: 'flow' },
};

export async function renderAnalytics(root, ctx) {
  const { db, state } = ctx;
  state.chartType ??= 'pie';
  state.analyticsType ??= 'expense';
  state.analyticsOff ??= new Set();
  const off = state.analyticsOff;

  const [txs, categories, allAccounts] = await Promise.all([db.getAll('transactions'), db.getAll('categories'), db.getAll('accounts')]);
  const accounts = allAccounts.filter((a) => !a.deleted && !a.hidden).sort((a, b) => a.order - b.order);
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  // Подкатегории в сводках складываются в родителя.
  const parentOf = new Map(categories.map((c) => [c.id, rollupId(c.id, categoriesById)]));
  const today = todayKey();
  const base = { today, accountId: state.accountId, excludeAccounts: excludedAccountIds(allAccounts), parentOf };
  const type = state.analyticsType;
  const info = (id) => categoriesById.get(id) ?? NO_CATEGORY;

  const period = currentPeriod(state, txs, today);
  const rows = categoryBreakdown(txs, period, { ...base, type });
  const shown = rows.filter((row) => !off.has(row.category_id));
  const total = shown.reduce((sum, row) => sum + row.amount, 0);
  const largest = rows[0]?.amount ?? 0;

  // Выделенный сектор круговой диаграммы; сбрасывается, если категории больше нет среди показанных.
  const pickedIndex = state.analyticsPick === undefined ? -1 : shown.findIndex((row) => row.category_id === state.analyticsPick);
  const pickedRow = shown[pickedIndex] ?? null;
  const openCategory = (id) => { state.categoryView = null; ctx.navigate(categoryHash(id)); };

  async function pickView() {
    const picked = await pickSheet({
      title: 'Вид отчёта', selected: state.chartType,
      items: Object.entries(VIEWS).map(([value, view]) => ({ value, label: view.label, icon: view.icon })),
    });
    if (picked) { state.chartType = picked.value; ctx.render(); }
  }

  const top = h('header', { class: 'topbar' },
    accountChip(ctx, { accounts, allAccounts, txs }),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Вид отчёта: ${VIEWS[state.chartType].label}`, onClick: pickView },
      icon(VIEWS[state.chartType].icon)));

  const typeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Что показывать' },
    [['income', 'arrow-in'], ['expense', 'arrow-out']].map(([value, glyph]) => h('button', {
      type: 'button', class: `seg-${value}`, 'aria-label': TYPE_LABELS[value], 'aria-pressed': String(type === value),
      onClick: () => { state.analyticsType = value; state.analyticsPick = undefined; off.clear(); ctx.render(); },
    }, icon(glyph, 22), type === value && h('span', { text: TYPE_LABELS[value] }))));
  const controls = h('div', { class: 'analytics-controls' }, typeSeg,
    periodControl(ctx, period, today));

  // ---------- диаграмма ----------
  let chart;
  if (state.chartType === 'pie') {
    chart = renderDonut(shown.map((row) => ({ share: row.amount / total, color: info(row.category_id).color, icon: info(row.category_id).icon })),
      {
        label: pickedRow ? info(pickedRow.category_id).name : 'Всего',
        value: formatMoney(pickedRow ? pickedRow.amount : total),
        note: pickedRow ? `${shareText(pickedRow.amount / total)} ${type === 'income' ? 'доходов' : 'расходов'}` : null,
        makeIcon: icon, selected: pickedIndex,
        onPick: (index) => { state.analyticsPick = index === pickedIndex ? undefined : shown[index].category_id; ctx.render(); },
      });
    if (pickedRow) {
      chart = h('div', {}, chart, h('button', { type: 'button', class: 'donut-open', onClick: () => openCategory(pickedRow.category_id) },
        h('span', { text: `${type === 'income' ? 'Показать доходы' : 'Показать траты'}: ${info(pickedRow.category_id).name}` }), icon('chevron-right', 18)));
    }
  } else if (state.chartType === 'line') {
    const series = monthSeries(txs, period, base);
    const summary = monthSummary(txs, period, base);
    chart = h('section', { class: 'card' }, renderChart(series, { format: formatAmount }),
      h('div', { class: 'legend' },
        h('span', { class: 'expense' }, h('i', { class: 'line' }), formatAmount(summary.expense)),
        h('span', { class: 'muted' }, h('i', { class: 'line' }), formatAmount(summary.income)),
        series.forecast ? h('span', { class: 'expense' }, h('i', { class: 'line dashed' }), `Прогноз ~${formatAmount(roundTo(series.forecast, 100000))}`) : null));
  } else if (state.chartType === 'stacked') {
    const visible = txs.filter((tx) => !off.has(parentOf.get(tx.category_id) ?? tx.category_id));
    const series = stackedSeries(visible, period, { ...base, type });
    chart = h('section', { class: 'card' },
      series.max ? renderStacked(series, (id) => info(id).color) : h('p', { class: 'empty', text: 'За этот период нет данных' }));
  } else {
    // Потоки: откуда деньги пришли и на что ушли. Не зависит от переключателя «доход / расход».
    const summary = monthSummary(txs, period, base);
    const expenses = categoryBreakdown(txs, period, { ...base, type: 'expense' });
    const right = expenses.map((row) => ({ label: info(row.category_id).name, amount: row.amount, color: info(row.category_id).color }));
    const left = [];
    if (summary.income) left.push({ label: 'Доход', amount: Math.min(summary.income, Math.max(summary.expense, summary.income)), color: '#10B981' });
    if (summary.income > summary.expense) right.push({ label: 'Осталось', amount: summary.income - summary.expense, color: '#A3A3A3' });
    if (summary.expense > summary.income) left.push({ label: 'Сверх дохода', amount: summary.expense - summary.income, color: '#FB923C' });
    chart = h('section', { class: 'card' }, renderSankey(left, right, formatAmount));
  }

  // ---------- список категорий с переключателями ----------
  const check = (on) => h('span', { class: 'check-dot' + (on ? ' on' : '') }, on ? icon('check', 16) : null);
  const allOn = off.size === 0;
  const list = h('div', { class: 'list' },
    h('button', {
      type: 'button', class: 'item analytics-all',
      onClick: () => { if (allOn) rows.forEach((row) => off.add(row.category_id)); else off.clear(); ctx.render(); },
    }, h('span', { class: 'item-main' }, h('span', { class: 'item-label', text: 'Все категории' })),
    h('span', { class: 'analytics-amount', text: formatMoney(total) }), check(allOn)),
    rows.map((row) => {
      const category = info(row.category_id);
      const on = !off.has(row.category_id);
      const pill = h('span', { class: 'cat-pill' }, icon(category.icon, 20), h('span', { text: category.name }));
      pill.style.setProperty('--c', category.color);
      pill.style.setProperty('--w', `${Math.max(8, Math.round((row.amount / largest) * 100))}%`);
      // Две кнопки в строке: категория открывает свои операции, галочка включает её в диаграмму.
      return h('div', { class: 'item analytics-row' + (on ? '' : ' off') },
        h('button', { type: 'button', class: 'analytics-open', onClick: () => openCategory(row.category_id) },
          h('span', { class: 'cat-pill-wrap' }, pill),
          h('span', { class: 'analytics-amount', text: formatMoney(row.amount) }),
          h('span', { class: 'item-chevron' }, icon('chevron-right', 18))),
        h('button', {
          type: 'button', class: 'analytics-check', 'aria-pressed': String(on), 'aria-label': `Показывать в диаграмме: ${category.name}`,
          onClick: () => { if (on) off.add(row.category_id); else off.delete(row.category_id); ctx.render(); },
        }, check(on)));
    }));

  clear(root).append(h('div', { class: 'screen' }, top, controls, chart,
    rows.length ? list : h('p', { class: 'empty', text: type === 'expense' ? 'Расходов за период нет' : 'Доходов за период нет' })));
}
