// Деньги: суммы хранятся целым числом в минимальных единицах (тиын, цент).

export const DEFAULT_CURRENCY = 'KZT';

export const CURRENCIES = {
  KZT: { symbol: '₸', name: 'Тенге' },
  USD: { symbol: '$', name: 'Доллар' },
  EUR: { symbol: '€', name: 'Евро' },
  RUB: { symbol: '₽', name: 'Рубль' },
};

const NBSP = ' ';
const MINUS = '−';
const MAX_WHOLE_DIGITS = 12;

export function currencySymbol(currency) {
  return CURRENCIES[currency]?.symbol ?? currency;
}

/** 52000000 → «520 000»: модуль суммы без знака валюты. Дробная часть — только если не ноль. */
export function formatAmount(minor) {
  const abs = Math.abs(Math.trunc(minor));
  const frac = abs % 100;
  const text = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return frac ? text + ',' + String(frac).padStart(2, '0') : text;
}

/** 10770000 → «107 700 ₸». */
export function formatMoney(minor, currency = DEFAULT_CURRENCY, opts = {}) {
  const sign = minor < 0 ? MINUS : opts.sign && minor > 0 ? '+' : '';
  return sign + formatAmount(minor) + NBSP + currencySymbol(currency);
}

/** Текст на экране ввода суммы с разделителями тысяч: «107700,5» → «107 700,5». */
export function formatKeypadText(text) {
  if (text === '') return '0';
  const [whole, frac] = text.split(',');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return frac === undefined ? grouped : grouped + ',' + frac;
}

/** Состояние цифровой клавиатуры — строка вида «1250» или «0,5». */
export function keypadReduce(text, key) {
  if (key === 'back') return text.slice(0, -1);
  if (key === ',') return text.includes(',') ? text : (text === '' ? '0' : text) + ',';
  if (key === '000') {
    const blocked = text === '' || text === '0' || text.includes(',') || text.length + 3 > MAX_WHOLE_DIGITS;
    return blocked ? text : text + '000';
  }
  if (!/^\d$/.test(key)) return text;
  const [whole, frac] = text.split(',');
  if (frac !== undefined) return frac.length >= 2 ? text : text + key;
  if (text === '0') return key;
  if (whole.length >= MAX_WHOLE_DIGITS) return text;
  return text + key;
}

/** Текст клавиатуры → минимальные единицы. Только целочисленная арифметика. */
export function parseAmount(text) {
  const [whole = '', frac = ''] = text.split(',');
  return Number(whole || 0) * 100 + Number((frac + '00').slice(0, 2));
}

/**
 * Сумма, набранная текстом («2 502 000», «1500,5», «−300») → минимальные единицы.
 * Пустая строка — 0. null, если текст не похож на сумму.
 */
export function parseMoneyInput(text) {
  const clean = String(text).replace(/[\s ]/g, '').replace('−', '-').replace('.', ',');
  if (clean === '') return 0;
  const match = clean.match(/^(-?)(\d{1,12})(?:,(\d{1,2}))?$/);
  if (!match) return null;
  const minor = Number(match[2]) * 100 + Number(((match[3] ?? '') + '00').slice(0, 2));
  return match[1] ? -minor : minor;
}

/** Минимальные единицы → текст клавиатуры (для правки операции). */
export function amountToText(minor) {
  if (!minor) return '';
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  return frac ? `${whole},${String(frac).padStart(2, '0')}` : String(whole);
}
