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

/** 10770000 → «107 700 ₸». Дробная часть показывается, только если она не нулевая. */
export function formatMoney(minor, currency = DEFAULT_CURRENCY, opts = {}) {
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let text = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  if (frac) text += ',' + String(frac).padStart(2, '0');
  const sign = minor < 0 ? MINUS : opts.sign && minor > 0 ? '+' : '';
  return sign + text + NBSP + currencySymbol(currency);
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

/** Минимальные единицы → текст клавиатуры (для правки операции). */
export function amountToText(minor) {
  if (!minor) return '';
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  return frac ? `${whole},${String(frac).padStart(2, '0')}` : String(whole);
}
