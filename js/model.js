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
  manual: 'Вручную',
  applepay: 'Apple Pay',
  notification: 'Уведомление банка',
  import: 'Импорт выписки',
};

export const TYPE_LABELS = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август',
  'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
  'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

/** Форма слова по числу: plural(13, ['день', 'дня', 'дней']) → «дней». */
export function plural(n, [one, few, many]) {
  const d = Math.abs(n) % 10;
  const dd = Math.abs(n) % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

/** «Ноябрь», «Декабрь 2025». */
export function monthName(month, today) {
  return capitalize(monthTitle(month, today));
}

function relativeDay(day, today) {
  return day === today ? 'Сегодня' : day === shiftDay(today, -1) ? 'Вчера' : null;
}
function dateText(day, today) {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}${day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`}`;
}

/** Заголовок дня в списке: «Пт, 13 ноября · Сегодня», «Вт, 3 ноября». */
export function dayTitle(day, today) {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = capitalize(WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
  const relative = relativeDay(day, today);
  return `${weekday}, ${dateText(day, today)}${relative ? ` · ${relative}` : ''}`;
}

/** Короткая подпись дня для чипа даты: «Сегодня», «Вчера», «3 ноября». */
export function dayShort(day, today) {
  return relativeDay(day, today) ?? dateText(day, today);
}

/** Подпись периода: «Этот месяц», «Октябрь», «Декабрь 2025». */
export function periodTitle(month, today) {
  return month === today.slice(0, 7) ? 'Этот месяц' : capitalize(monthTitle(month, today));
}

/** «ноябрь» (с годом, если он не текущий). */
export function monthTitle(month, today) {
  const [y, m] = month.split('-').map(Number);
  return month.slice(0, 4) === today.slice(0, 4) ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}
