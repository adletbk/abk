// Календарь платежей: плановые платежи и их даты. Без DOM и без хранилища.
// Плановый платёж ни на что не влияет, пока не оплачен: остатки и аналитику меняет только
// обычная операция, созданная при оплате. Хранятся платежи только на устройстве и в JSON-бэкапе.
import { uuid } from './model.js';
import { addDays, diffDays } from './period.js';

export const REPEATS = [
  { value: 'once', label: 'Один раз' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];
const REPEAT_VALUES = new Set(REPEATS.map((r) => r.value));
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** День месяца, прижатый к его длине: 31-е число в ноябре — это 30-е. */
const clamped = (year, month, day) => `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;

export const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(y, m))}` };
};

export function newPlanned(fields = {}, now = Date.now()) {
  return {
    id: uuid(),
    name: '',
    amount: null,          // null — сумма заранее неизвестна, вводится при оплате
    currency: 'KZT',
    category_id: null,
    account_id: null,
    start: null,           // первая дата платежа, «ГГГГ-ММ-ДД»
    repeat: 'month',
    until: null,           // месяц последнего платежа «ГГГГ-ММ»; null — без конца
    icon: null,            // null — как у категории
    color: null,
    note: '',
    marks: {},             // дата платежа → { state: 'paid' | 'skipped', tx_id, at }
    deleted: false,
    deleted_at: null,
    ...fields,
    updated_at: now,
  };
}

/** Список сообщений об ошибках; пустой список — платёж корректен. */
export function validatePlanned(p) {
  const errors = [];
  if (!String(p.name ?? '').trim()) errors.push('Введите название');
  if (p.amount !== null && (!Number.isInteger(p.amount) || p.amount <= 0)) errors.push('Сумма: введите число больше нуля или оставьте пустой');
  if (!p.category_id) errors.push('Выберите категорию');
  if (!DAY_RE.test(p.start ?? '')) errors.push('Выберите дату платежа');
  if (!REPEAT_VALUES.has(p.repeat)) errors.push('Выберите повтор');
  if (p.until != null && p.repeat !== 'once') {
    if (!/^\d{4}-\d{2}$/.test(p.until)) errors.push('Последний платёж: выберите месяц');
    else if (DAY_RE.test(p.start ?? '') && p.until < p.start.slice(0, 7)) errors.push('Последний платёж раньше первого');
  }
  return errors;
}

/** Даты платежа в диапазоне [from, to] включительно, по возрастанию. */
export function occurrences(p, from, rangeTo) {
  const end = p.repeat !== 'once' && /^\d{4}-\d{2}$/.test(p.until ?? '') ? monthRange(p.until).to : null;
  const to = end && end < rangeTo ? end : rangeTo;
  if (!DAY_RE.test(p.start ?? '') || to < p.start || to < from) return [];
  const lo = from < p.start ? p.start : from;
  const out = [];
  if (p.repeat === 'once') {
    if (p.start >= lo && p.start <= to) out.push(p.start);
  } else if (p.repeat === 'week') {
    const skip = Math.ceil(diffDays(p.start, lo) / 7);
    for (let day = addDays(p.start, skip * 7); day <= to; day = addDays(day, 7)) out.push(day);
  } else {
    const [sy, sm, sd] = p.start.split('-').map(Number);
    const [ly, lm] = lo.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    if (p.repeat === 'month') {
      for (let index = ly * 12 + lm - 1; index <= ty * 12 + tm - 1; index++) {
        const day = clamped(Math.floor(index / 12), (index % 12) + 1, sd);
        if (day >= lo && day <= to) out.push(day);
      }
    } else {
      for (let year = ly; year <= ty; year++) {
        const day = clamped(year, sm, sd);
        if (day >= lo && day <= to) out.push(day);
      }
    }
  }
  return out;
}

/** Это последняя дата платежа: дальше по месяцу «until» платежей нет. */
export function isLastOccurrence(p, day) {
  if (p.repeat === 'once' || !/^\d{4}-\d{2}$/.test(p.until ?? '')) return false;
  return occurrences(p, addDays(day, 1), monthRange(p.until).to).length === 0;
}

/**
 * Состояние платежа на дату: 'paid', 'skipped', 'late' (дата прошла) или 'due'.
 * liveTxIds — id неудалённых операций: если операцию оплаты удалили, платёж снова не оплачен.
 */
export function statusOf(p, day, today, liveTxIds = null) {
  const mark = p.marks?.[day];
  if (mark) {
    const txGone = mark.tx_id && liveTxIds && !liveTxIds.has(mark.tx_id);
    if (!txGone) return mark.state === 'skipped' ? 'skipped' : 'paid';
  }
  return day < today ? 'late' : 'due';
}

/** Платежи в диапазоне: [{ payment, day, status, mark }], по дате, затем по названию. */
export function schedule(payments, from, to, today, liveTxIds = null) {
  const out = [];
  for (const payment of payments) {
    if (payment.deleted) continue;
    for (const day of occurrences(payment, from, to)) {
      const status = statusOf(payment, day, today, liveTxIds);
      out.push({ payment, day, status, mark: status === 'paid' || status === 'skipped' ? payment.marks[day] : null });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.payment.name.localeCompare(b.payment.name, 'ru')));
}

/** Просроченные платежи до даты before (не включая её), не старше lookbackDays. */
export function overdue(payments, before, today, liveTxIds = null, lookbackDays = 366) {
  const to = addDays(before, -1);
  return schedule(payments, addDays(today, -lookbackDays), to, today, liveTxIds).filter((item) => item.status === 'late');
}

/**
 * Итоги по списку платежей в валюте currency. Оплаченное считается по фактической сумме операции
 * (txAmounts: id → сумма), а если операции нет — по плановой. unknown — платежи без суммы.
 */
export function scheduleSummary(items, { currency = 'KZT', txAmounts = new Map() } = {}) {
  const sum = { left: 0, paid: 0, late: 0, unknown: 0, leftCount: 0, paidCount: 0 };
  for (const { payment, status, mark } of items) {
    if (status === 'skipped' || payment.currency !== currency) continue;
    if (status === 'paid') {
      sum.paidCount++;
      sum.paid += txAmounts.get(mark?.tx_id) ?? payment.amount ?? 0;
      continue;
    }
    sum.leftCount++;
    if (status === 'late') sum.late++;
    if (payment.amount === null) sum.unknown++;
    else sum.left += payment.amount;
  }
  return sum;
}

/** Отметка платежа на дату. state: 'paid' | 'skipped' | null (снять отметку). */
export function markPlanned(p, day, state, { txId = null, now = Date.now() } = {}) {
  const marks = { ...(p.marks ?? {}) };
  if (state === null) delete marks[day];
  else marks[day] = { state, tx_id: txId, at: now };
  return { ...p, marks, updated_at: now };
}

/** Сетка месяца с понедельника: массив недель по 7 ячеек, пустые — null. */
export function monthGrid(month) {
  const { from, to } = monthRange(month);
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null)];
  for (let day = from; day <= to; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
