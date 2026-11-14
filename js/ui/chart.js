// График месяца: накопительный расход, пунктирный прогноз, доход ступенькой. Свой SVG.
import { h } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const num = (n) => +n.toFixed(2);

/**
 * Геометрия графика (без DOM, проверяется тестами).
 * Возвращает строки для атрибута d и координаты последней точки расхода.
 */
export function chartPaths(series, { width, height }) {
  const { days, elapsed, expense, income, forecast } = series;
  if (elapsed === 0) return { expense: '', income: '', forecast: '', dot: null, max: 0 };

  const max = Math.max(expense[elapsed - 1], income[elapsed - 1], forecast ?? 0);
  const scale = max || 1;
  const x = (day) => num(days > 1 ? ((day - 1) / (days - 1)) * width : 0);
  const y = (value) => num(height - (value / scale) * height);

  const dot = { x: x(elapsed), y: y(expense[elapsed - 1]) };
  const expensePath = 'M' + expense.map((value, i) => `${x(i + 1)} ${y(value)}`).join(' L ');

  // Доход: вертикальный шаг в день поступления, дальше ровная линия до конца месяца.
  let incomePath = `M0 ${y(income[0])}`;
  for (let i = 1; i < elapsed; i++) {
    if (income[i] !== income[i - 1]) incomePath += ` H${x(i + 1)} V${y(income[i])}`;
  }
  incomePath += ` H${num(width)}`;

  const forecastPath = forecast != null && elapsed < days
    ? `M${dot.x} ${dot.y} L ${num(width)} ${y(forecast)}` : '';
  return { expense: expensePath, income: incomePath, forecast: forecastPath, dot, max };
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Рисует график. series — результат monthSeries. */
export function renderChart(series) {
  const W = 300, H = 110, PAD_TOP = 8, AXIS = 22;
  const paths = chartPaths(series, { width: W, height: H });
  const root = svg('svg', {
    class: 'chart', viewBox: `-4 ${-PAD_TOP} ${W + 8} ${H + PAD_TOP + AXIS}`, role: 'img',
    'aria-label': 'График расходов и доходов за месяц',
  });
  for (const part of [0, 0.5, 1]) {
    root.append(svg('line', { class: 'chart-grid', x1: 0, x2: W, y1: num(H * part), y2: num(H * part) }));
  }
  if (paths.income) root.append(svg('path', { class: 'chart-income', d: paths.income }));
  if (paths.forecast) root.append(svg('path', { class: 'chart-forecast', d: paths.forecast }));
  if (paths.expense) root.append(svg('path', { class: 'chart-expense', d: paths.expense }));
  if (paths.dot) root.append(svg('circle', { class: 'chart-dot', cx: paths.dot.x, cy: paths.dot.y, r: 4 }));

  const labels = [...new Set([1, 10, 20, series.days])];
  for (const day of labels) {
    const label = svg('text', {
      class: 'chart-label', y: H + 16,
      x: num(((day - 1) / (series.days - 1)) * W),
      'text-anchor': day === 1 ? 'start' : day === series.days ? 'end' : 'middle',
    });
    label.textContent = String(day);
    root.append(label);
  }
  return h('div', { class: 'chart-wrap' }, root);
}
