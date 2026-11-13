// Модель операции, даты и подписи. Без DOM и без хранилища.

export const uuid = () => crypto.randomUUID();

const pad = (n) => String(n).padStart(2, '0');

/** Локальное время строкой «ГГГГ-ММ-ДДTЧЧ:ММ:СС» без часового пояса. */
export function localIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export const dayKey = (iso) => iso.slice(0, 10);
export const monthKey = (iso) => iso.slice(0, 7);
export const todayKey = () => dayKey(localIso(new Date()));

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function newTransaction(fields = {}, now = Date.now()) {
  return {
    id: uuid(),
    date: localIso(new Date(now)),
    amount: 0,
    currency: 'KZT',
    type: 'expense',
    category_id: null,
    account_id: null,
    to_account_id: null,
    note: '',
    source: 'manual',
    fingerprint: '',
    status: 'ok',
    deleted: false,
    deleted_at: null,
    ...fields,
    updated_at: now,
  };
}

/** Возвращает список сообщений об ошибках; пустой список — операция корректна. */
export function validateTransaction(tx) {
  const errors = [];
  if (!Number.isInteger(tx.amount) || tx.amount <= 0) errors.push('Введите сумму');
  if (!tx.account_id) errors.push('Выберите счёт');
  if (tx.type === 'transfer') {
    if (!tx.to_account_id || tx.to_account_id === tx.account_id) errors.push('Выберите счёт зачисления');
  } else if (!tx.category_id) {
    errors.push('Выберите категорию');
  }
  return errors;
}

export const SOURCE_LABELS = {
  manual: 'вручную',
  applepay: 'Apple Pay',
  notification: 'уведомление банка',
  import: 'импорт',
};

export const TYPE_LABELS = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август',
  'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
  'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** «Сегодня», «Вчера» или «3 ноября, вт» (с годом, если он не текущий). */
export function dayTitle(day, today) {
  if (day === today) return 'Сегодня';
  if (day === shiftDay(today, -1)) return 'Вчера';
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const year = day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`;
  return `${d} ${MONTHS_GEN[m - 1]}${year}, ${weekday}`;
}

/** «ноябрь» (с годом, если он не текущий). */
export function monthTitle(month, today) {
  const [y, m] = month.split('-').map(Number);
  return month.slice(0, 4) === today.slice(0, 4) ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}
