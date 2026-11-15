// Периоды отчётов: день, неделя, две недели, месяц, год, последние N дней, всё время, свой.
// Период — отрезок дней { kind, from, to } включительно. Без DOM и без хранилища.

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;
const toUtc = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (day, delta) => fromUtc(toUtc(day) + delta * DAY_MS);
/** Сколько дней от a до b (b позже — число положительное). */
export const diffDays = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
export const spanDays = (range) => diffDays(range.from, range.to) + 1;

function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Отрезок дней для месяца «ГГГГ-ММ» или для готового периода. */
export function rangeOf(value) {
  return typeof value === 'string' ? { from: `${value}-01`, to: monthEnd(value) } : value;
}

export const PERIOD_KINDS = [
  ['day', 'День'], ['week', 'Неделя'], ['biweek', '2 недели'], ['month', 'Месяц'], ['year', 'Год'],
  ['last7', 'Последние 7 дней'], ['last30', 'Последние 30 дней'], ['all', 'Всё время'],
];
const STEPPED = new Set(['day', 'week', 'biweek', 'month', 'year']);

/** Можно ли листать период стрелками. */
export const canShift = (spec) => STEPPED.has(spec.kind);

const EPOCH_MONDAY = '1970-01-05';
/** Понедельник недели (или двухнедельного блока), в которую попадает день. */
function blockStart(day, size) {
  const offset = diffDays(EPOCH_MONDAY, day);
  return addDays(day, -(((offset % size) + size) % size));
}

/**
 * Превращает описание периода { kind, anchor, from, to } в отрезок дней.
 * anchor — любой день внутри периода; bounds — первый и последний день с операциями (для «Всё время»).
 */
export function resolvePeriod(spec, today, bounds = null) {
  const anchor = spec.anchor ?? today;
  switch (spec.kind) {
    case 'day': return { kind: 'day', from: anchor, to: anchor };
    case 'week': { const from = blockStart(anchor, 7); return { kind: 'week', from, to: addDays(from, 6) }; }
    case 'biweek': { const from = blockStart(anchor, 14); return { kind: 'biweek', from, to: addDays(from, 13) }; }
    case 'year': return { kind: 'year', from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
    case 'last7': return { kind: 'last7', from: addDays(today, -6), to: today };
    case 'last30': return { kind: 'last30', from: addDays(today, -29), to: today };
    case 'all': {
      const from = bounds?.first && bounds.first < today ? bounds.first : today;
      const to = bounds?.last && bounds.last > today ? bounds.last : today;
      return { kind: 'all', from, to };
    }
    case 'custom': {
      const [from, to] = spec.from <= spec.to ? [spec.from, spec.to] : [spec.to, spec.from];
      return { kind: 'custom', from, to };
    }
    default: return { kind: 'month', ...rangeOf(anchor.slice(0, 7)) };
  }
}

/** Сдвигает период на шаг назад или вперёд. Периоды без шага возвращаются как есть. */
export function shiftPeriod(spec, delta, today) {
  const anchor = spec.anchor ?? today;
  switch (spec.kind) {
    case 'day': return { ...spec, anchor: addDays(anchor, delta) };
    case 'week': return { ...spec, anchor: addDays(anchor, 7 * delta) };
    case 'biweek': return { ...spec, anchor: addDays(anchor, 14 * delta) };
    case 'year': return { ...spec, anchor: `${Number(anchor.slice(0, 4)) + delta}-01-01` };
    case 'month': {
      const [y, m] = anchor.split('-').map(Number);
      const index = y * 12 + (m - 1) + delta;
      return { ...spec, anchor: `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01` };
    }
    default: return spec;
  }
}

/** Если день не попадает в выбранный период, возвращает месяц этого дня; иначе период как есть. */
export function revealDay(spec, day, today) {
  if (spec.kind === 'all') return spec;
  const { from, to } = resolvePeriod(spec, today);
  return day >= from && day <= to ? spec : { kind: 'month', anchor: day };
}

/** Первый и последний день с неудалёнными операциями. */
export function txBounds(txs) {
  let first = null;
  let last = null;
  for (const tx of txs) {
    if (tx.deleted) continue;
    const day = tx.date.slice(0, 10);
    if (!first || day < first) first = day;
    if (!last || day > last) last = day;
  }
  return { first, last };
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «3–9 ноя», «28 окт – 10 ноя», с годом, если он не текущий. */
export function rangeText(from, to, today) {
  const part = (day, withMonth) => `${Number(day.slice(8))}${withMonth ? ` ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}` : ''}`;
  const year = to.slice(0, 4) === today.slice(0, 4) && from.slice(0, 4) === today.slice(0, 4) ? '' : ` ${to.slice(0, 4)}`;
  if (from === to) return part(from, true) + year;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${part(from, false)}–${part(to, true)}${year}`;
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${part(from, true)} ${from.slice(0, 4)} – ${part(to, true)} ${to.slice(0, 4)}`;
  return `${part(from, true)} – ${part(to, true)}${year}`;
}

/** Подпись периода для таблетки: «Этот месяц», «Октябрь», «Эта неделя», «3–9 ноя», «2025». */
export function periodLabel(period, today) {
  const has = period.from <= today && today <= period.to;
  switch (period.kind) {
    case 'day':
      return period.from === today ? 'Сегодня' : period.from === addDays(today, -1) ? 'Вчера' : rangeText(period.from, period.to, today);
    case 'week': return has ? 'Эта неделя' : rangeText(period.from, period.to, today);
    case 'year': return has ? 'Этот год' : period.from.slice(0, 4);
    case 'last7': return '7 дней';
    case 'last30': return '30 дней';
    case 'all': return 'Всё время';
    case 'month': {
      if (has) return 'Этот месяц';
      const name = MONTHS[Number(period.from.slice(5, 7)) - 1];
      return period.from.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${period.from.slice(0, 4)}`;
    }
    default: return rangeText(period.from, period.to, today);
  }
}
