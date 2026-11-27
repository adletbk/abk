// График месяца: накопительный расход, пунктирный прогноз, доход ступенькой. Свой SVG.
import { h } from './dom.js';
import { addDays } from '../period.js';

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

/**
 * Подписи оси дней: [{ pos, text }], pos — номер точки с единицы.
 * Целый месяц подписывается числами 1, 10, 20 и последним днём; другие периоды — датами.
 */
export function axisTicks({ days, from = null, bucket = 1 }) {
  const wholeMonth = !from || (bucket === 1 && from.endsWith('-01') && days >= 28 && days <= 31);
  if (wholeMonth) return [...new Set([1, 10, 20, days])].map((pos) => ({ pos, text: String(pos) }));
  const positions = days <= 7
    ? Array.from({ length: days }, (_, i) => i + 1)
    : [1, Math.round(1 + (days - 1) / 3), Math.round(1 + ((days - 1) * 2) / 3), days];
  const span = days * bucket;
  const dayAt = (pos) => addDays(from, (pos - 1) * bucket);
  const oneMonth = dayAt(1).slice(0, 7) === dayAt(days).slice(0, 7);
  const text = (pos) => {
    const day = dayAt(pos);
    if (oneMonth) return String(Number(day.slice(8)));
    return span > 366 ? `${day.slice(5, 7)}.${day.slice(2, 4)}` : `${Number(day.slice(8))}.${day.slice(5, 7)}`;
  };
  return [...new Set(positions)].map((pos) => ({ pos, text: text(pos) }));
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Рисует график. series — результат monthSeries. */
export function renderChart(series, { format = null } = {}) {
  const W = 300, H = 110, PAD_TOP = 8, AXIS = 22;
  const paths = chartPaths(series, { width: W, height: H });
  const root = svg('svg', {
    class: 'chart', viewBox: `-4 ${-PAD_TOP} ${W + 8} ${H + PAD_TOP + AXIS}`, role: 'img',
    'aria-label': 'График расходов и доходов за месяц',
  });
  for (const part of format ? [0, 1 / 3, 2 / 3, 1] : [0, 0.5, 1]) {
    const y = num(H * part);
    root.append(svg('line', { class: 'chart-grid' + (format && part < 1 ? ' dashed' : ''), x1: 0, x2: W, y1: y, y2: y }));
    if (format && part < 1 && paths.max > 0) {
      const label = svg('text', { class: 'chart-label', x: 0, y: y - 4 });
      label.textContent = format(Math.round((paths.max * (1 - part)) / 100) * 100);
      root.append(label);
    }
  }
  if (paths.income) root.append(svg('path', { class: 'chart-income', d: paths.income }));
  if (paths.forecast) root.append(svg('path', { class: 'chart-forecast', d: paths.forecast }));
  if (paths.expense) root.append(svg('path', { class: 'chart-expense', d: paths.expense }));
  if (paths.dot) root.append(svg('circle', { class: 'chart-dot', cx: paths.dot.x, cy: paths.dot.y, r: 4 }));

  for (const { pos, text } of axisTicks(series)) {
    const label = svg('text', {
      class: 'chart-label', y: H + 16,
      x: num(series.days > 1 ? ((pos - 1) / (series.days - 1)) * W : 0),
      'text-anchor': pos === 1 ? 'start' : pos === series.days ? 'end' : 'middle',
    });
    label.textContent = text;
    root.append(label);
  }
  return h('div', { class: 'chart-wrap' }, root);
}

// ---------- круговая диаграмма ----------

const polar = (cx, cy, r, angle) => [num(cx + r * Math.cos(angle)), num(cy + r * Math.sin(angle))];

/** Сектор кольца между углами a0 и a1 (радианы, от «12 часов» по часовой стрелке). Проверяется тестами. */
export function ringSegment(cx, cy, outer, inner, a0, a1) {
  const start = a0 - Math.PI / 2;
  const end = a1 - Math.PI / 2;
  const large = end - start > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, outer, start);
  const [x1, y1] = polar(cx, cy, outer, end);
  const [x2, y2] = polar(cx, cy, inner, end);
  const [x3, y3] = polar(cx, cy, inner, start);
  return {
    area: `M${x0} ${y0} A${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`,
    edge: `M${x0} ${y0} A${outer} ${outer} 0 ${large} 1 ${x1} ${y1}`,
    middle: polar(cx, cy, (outer + inner) / 2, (start + end) / 2),
  };
}

/**
 * Кольцо по категориям. items: [{ share, color, icon }]. makeIcon(name, size) — фабрика иконок.
 * В центре — подпись, сумма и необязательная строка note (обычная разметка поверх SVG).
 * onPick(index) — нажатие на сектор; selected — номер выделенного сектора или -1.
 */
export function renderDonut(items, { label, value, note = null, makeIcon, selected = -1, onPick = null }) {
  const SIZE = 300, C = 150, OUTER = 144, INNER = 92;
  const GAP = items.length > 1 ? 0.035 : 0;
  const root = svg('svg', { class: 'donut' + (selected >= 0 ? ' picked' : '') + (onPick ? ' tappable' : ''), viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'img', 'aria-label': 'Доли категорий' });
  if (items.length === 0) {
    root.append(svg('circle', { class: 'donut-empty', cx: C, cy: C, r: (OUTER + INNER) / 2, 'stroke-width': OUTER - INNER }));
  }
  let angle = 0;
  for (const [index, item] of items.entries()) {
    const sweep = item.share * Math.PI * 2;
    // Полный круг одной дугой не рисуется: делим на две половины.
    const parts = sweep > Math.PI * 1.999
      ? [[0, Math.PI], [Math.PI, Math.PI * 2]]
      : [[angle + GAP / 2, angle + Math.max(sweep - GAP / 2, GAP / 2 + 0.004)]];
    let middle = null;
    for (const [a0, a1] of parts) {
      const seg = ringSegment(C, C, OUTER, INNER, a0, a1);
      const on = index === selected ? ' on' : '';
      const area = svg('path', { class: `donut-area${on}`, d: seg.area });
      const edge = svg('path', { class: `donut-edge${on}`, d: seg.edge });
      if (onPick) for (const el of [area, edge]) el.addEventListener('click', () => onPick(index));
      area.style.setProperty('--c', item.color);
      edge.style.setProperty('--c', item.color);
      root.append(area, edge);
      middle ??= seg.middle;
    }
    if (item.share >= 0.05 && item.icon && makeIcon) {
      const glyph = makeIcon(item.icon, 20);
      glyph.setAttribute('x', num(middle[0] - 10));
      glyph.setAttribute('y', num(middle[1] - 10));
      glyph.setAttribute('class', `donut-icon${index === selected ? ' on' : ''}`);
      glyph.style.setProperty('--c', item.color);
      root.append(glyph);
    }
    angle += sweep;
  }
  return h('div', { class: 'donut-wrap' }, root,
    h('div', { class: 'donut-center' }, h('span', { class: 'donut-label', text: label }), h('span', { class: 'donut-value', text: value }),
      note && h('span', { class: 'donut-label', text: note })));
}

// ---------- столбцы по дням ----------

/** series — результат stackedSeries; colorOf(categoryId) → цвет. */
export function renderStacked(series, colorOf) {
  const W = 300, H = 130, AXIS = 22;
  const root = svg('svg', { class: 'chart', viewBox: `-4 -8 ${W + 8} ${H + 8 + AXIS}`, role: 'img', 'aria-label': 'Суммы по дням с разбивкой по категориям' });
  for (const part of [0, 0.5, 1]) root.append(svg('line', { class: 'chart-grid', x1: 0, x2: W, y1: num(H * part), y2: num(H * part) }));
  const step = W / series.days;
  const width = Math.min(28, Math.max(2, step * 0.68));
  series.byDay.forEach((slot, index) => {
    let y = H;
    for (const id of series.categories) {
      const amount = slot[id];
      if (!amount) continue;
      const height = (amount / (series.max || 1)) * H;
      y -= height;
      const bar = svg('rect', {
        class: 'chart-bar', x: num(index * step + (step - width) / 2), y: num(y), width: num(width),
        height: num(Math.max(height - 0.6, 0.6)), rx: 1.5,
      });
      bar.style.setProperty('--c', colorOf(id));
      root.append(bar);
    }
  });
  for (const { pos, text } of axisTicks(series)) {
    const label = svg('text', { class: 'chart-label', y: H + 16, x: num((pos - 0.5) * step), 'text-anchor': 'middle' });
    label.textContent = text;
    root.append(label);
  }
  return h('div', { class: 'chart-wrap' }, root);
}

// ---------- потоки: доход → категории расходов ----------

/**
 * left и right: [{ label, amount, color }]. Суммы слева и справа должны совпадать.
 * Высота узла пропорциональна сумме; ленты соединяют левые узлы с правыми по порядку.
 */
export function renderSankey(left, right, formatValue) {
  const total = right.reduce((sum, node) => sum + node.amount, 0);
  if (total <= 0) return h('p', { class: 'empty', text: 'За этот период нет данных' });
  const GAP = 5, BAR = 8, X1 = 0, X2 = 128, MIN = 13; // MIN: подписи соседних узлов не должны наезжать друг на друга
  const base = Math.max(180, right.length * 22) / total;
  const heights = right.map((node) => Math.max(node.amount * base, MIN));
  const H = heights.reduce((sum, value) => sum + value, 0) + GAP * (right.length - 1);
  const root = svg('svg', { class: 'sankey', viewBox: `0 0 300 ${H}`, role: 'img', 'aria-label': 'Потоки денег: откуда пришли и на что ушли' });

  let y = 0;
  const targets = right.map((node, i) => { const box = { ...node, y, h: heights[i], scale: heights[i] / node.amount }; y += box.h + GAP; return box; });
  const leftScale = (H - GAP * (left.length - 1)) / total;
  let ly = 0;
  const sources = left.map((node) => { const box = { ...node, y: ly, h: node.amount * leftScale, used: 0 }; ly += box.h + GAP; return box; });

  let si = 0;
  for (const target of targets) {
    let remaining = target.amount;
    let offset = 0;
    while (remaining > 0.5 && si < sources.length) {
      const source = sources[si];
      const take = Math.min(remaining, source.amount - source.used);
      if (take <= 0) { si++; continue; }
      const y0 = source.y + source.used * leftScale;
      const h0 = take * leftScale;
      const y1 = target.y + offset * target.scale;
      const h1 = take * target.scale;
      const mid = (X1 + BAR + X2) / 2;
      const band = svg('path', {
        class: 'sankey-band',
        d: `M${X1 + BAR} ${num(y0)} C${mid} ${num(y0)} ${mid} ${num(y1)} ${X2} ${num(y1)} L${X2} ${num(y1 + h1)} C${mid} ${num(y1 + h1)} ${mid} ${num(y0 + h0)} ${X1 + BAR} ${num(y0 + h0)} Z`,
      });
      band.style.setProperty('--c', target.color);
      root.append(band);
      source.used += take; remaining -= take; offset += take;
      if (source.amount - source.used <= 0.5) si++;
    }
  }
  const node = (x, box) => {
    const rect = svg('rect', { class: 'sankey-node', x, y: num(box.y), width: BAR, height: num(box.h), rx: 2 });
    rect.style.setProperty('--c', box.color);
    return rect;
  };
  for (const box of sources) root.append(node(X1, box));
  for (const box of targets) {
    root.append(node(X2, box));
    const textY = num(box.y + Math.min(box.h / 2, 9) + 4.5);
    const name = svg('text', { class: 'sankey-name', x: X2 + BAR + 6, y: textY });
    name.textContent = box.label.length > 13 ? `${box.label.slice(0, 12)}…` : box.label;
    const value = svg('text', { class: 'sankey-value', x: 300, y: textY, 'text-anchor': 'end' });
    value.textContent = formatValue(box.amount);
    root.append(name, value);
  }
  return h('div', { class: 'chart-wrap' }, root,
    h('div', { class: 'legend' }, sources.map((box) => {
      const item = h('span', {}, h('i', { class: 'line' }), `${box.label}: ${formatValue(box.amount)}`);
      item.style.setProperty('color', box.color);
      return item;
    })));
}
