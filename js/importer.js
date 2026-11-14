// Импорт операций из xlsx и csv: чтение файла, сопоставление колонок, дедупликация.
// Библиотека SheetJS передаётся параметром: в браузере она подгружается только на экране импорта.
import { localIso, newTransaction, uuid } from './model.js';
import { parseLooseAmount } from './parser.js';
import { PALETTE } from './catalog.js';

const MAX_ROWS = 50000;
const DEFAULT_TIME = '12:00:00'; // у строк без времени: середина дня, чтобы порядок внутри дня был устойчивым
const pad = (n) => String(n).padStart(2, '0');
const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const isEmpty = (cell) => cell === null || cell === undefined || String(cell).trim() === '';

/** Поля операции, которые можно сопоставить с колонками файла. */
export const FIELDS = {
  date: 'Дата', time: 'Время', amount: 'Сумма', type: 'Тип', category: 'Категория', account: 'Счёт',
  to_account: 'Счёт зачисления', currency: 'Валюта', note: 'Заметка', tags: 'Теги',
};
export const KINDS = {
  expense: 'Все строки — расходы', income: 'Все строки — доходы', transfer: 'Все строки — переводы',
  sign: 'По знаку суммы: минус — расход', column: 'По колонке «Тип»', skip: 'Не импортировать этот лист',
};

// ---------- csv ----------

export function decodeText(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1251').decode(bytes); // старые выгрузки банков и Excel
  }
  return text.replace(/^﻿/, '');
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const delimiter of [',', ';', '\t']) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === delimiter && !quoted) count++;
    }
    if (count > bestCount) { best = delimiter; bestCount = count; }
  }
  return best;
}

/** Разбор csv с кавычками и переводами строк внутри полей. Разделитель определяется сам. */
export function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row);
      row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows.at(-1).every(isEmpty)) rows.pop();
  return rows;
}

// ---------- даты ----------

function validDay(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Число Excel (дни с 30.12.1899) → дата и время. Целое число — дата без времени. */
export function excelSerialToParts(serial) {
  const days = Math.floor(serial);
  const date = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const fraction = serial - days;
  if (fraction === 0) return { day, time: null };
  const seconds = Math.min(86399, Math.round(fraction * 86400));
  return { day, time: `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` };
}

/**
 * Ячейка с датой → { day, time }. Понимает числа Excel, объекты Date, ISO,
 * «ДД.ММ.ГГГГ» и даты через косую черту (order: 'DMY' или 'MDY'). null — не дата.
 */
export function parseDateCell(value, order = 'DMY') {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = localIso(value);
    return { day: iso.slice(0, 10), time: iso.slice(11) };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 1 && value < 2958466 ? excelSerialToParts(value) : null;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const timeOf = (h, m, s) => (h === undefined ? null : `${pad(Number(h))}:${m}:${s ?? '00'}`);
  const TIME = '(?:[T ]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?';

  let m = text.match(new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${TIME}`));
  if (m) {
    const day = validDay(Number(m[1]), Number(m[2]), Number(m[3]));
    return day ? { day, time: timeOf(m[4], m[5], m[6]) } : null;
  }
  m = text.match(new RegExp(`^(\\d{1,2})([./-])(\\d{1,2})\\2(\\d{4}|\\d{2})${TIME}$`));
  if (m) {
    const year = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
    const monthFirst = order === 'MDY' && m[2] === '/';
    const day = validDay(year, Number(monthFirst ? m[1] : m[3]), Number(monthFirst ? m[3] : m[1]));
    return day ? { day, time: timeOf(m[5], m[6], m[7]) } : null;
  }
  return null;
}

/** Порядок «день/месяц» или «месяц/день» по значениям колонки. При неоднозначности — день первым. */
export function guessDateOrder(values) {
  let monthFirst = false;
  for (const value of values) {
    const m = typeof value === 'string' && value.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) return 'DMY';
    if (Number(m[2]) > 12) monthFirst = true;
  }
  return monthFirst ? 'MDY' : 'DMY';
}

// ---------- структура файла ----------

/** Строка заголовков: первая строка, где не меньше двух непустых ячеек и все они — текст, а не числа. */
export function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].filter((cell) => !isEmpty(cell));
    if (cells.length >= 2 && cells.every((cell) => typeof cell === 'string' && Number.isNaN(Number(cell.replace(',', '.'))))) return i;
  }
  return -1;
}

/** Подпись набора колонок: по ней запоминается сопоставление для таких же файлов. */
export function signature(headers) {
  return headers.map(norm).filter(Boolean).sort().join('|');
}

/** Читает xlsx в список листов с сырыми значениями ячеек. */
export function readWorkbook(XLSX, bytes) {
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) throw new Error('Файл не похож на xlsx. Поддерживаются файлы .xlsx и .csv');
  let book;
  try {
    book = XLSX.read(bytes, { type: 'array' });
  } catch {
    throw new Error('Не удалось прочитать файл xlsx: он повреждён или защищён паролем');
  }
  // Array.from: копируем в обычные массивы, не зависящие от того, как загружена библиотека.
  return Array.from(book.SheetNames, (name) => ({
    name,
    rows: Array.from(
      XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: '' }).slice(0, MAX_ROWS),
      (row) => Array.from(row),
    ),
  }));
}

export function readCsv(bytes, name) {
  return [{ name, rows: parseCsv(decodeText(bytes)).slice(0, MAX_ROWS) }];
}

// ---------- профили ----------

const MM_COMMON = {
  date: 'Дата и время', category: 'Категория', account: 'Счет', amount: 'Сумма в валюте счета',
  currency: 'Валюта счета', tags: 'Теги', note: 'Комментарий',
};

/** Выгрузка Money Manager: три листа, первая строка — название отчёта, вторая — заголовки. */
export const MONEY_MANAGER = {
  id: 'money-manager',
  name: 'Money Manager',
  sheets: [
    { name: 'Расходы', kind: 'expense', columns: MM_COMMON, required: ['date', 'account', 'amount'] },
    { name: 'Доходы', kind: 'income', columns: MM_COMMON, required: ['date', 'account', 'amount'] },
    {
      name: 'Переводы', kind: 'transfer', required: ['date', 'account', 'to_account', 'amount'],
      columns: {
        date: 'Дата и время', account: 'Исходящий счет', to_account: 'Входящий счет',
        amount: 'Сумма в исходящей валюте счета', currency: 'Валюта исходящего счета', note: 'Комментарий',
      },
    },
  ],
};

/**
 * Проверяет, подходит ли файл под профиль. Колонки ищутся по названиям, порядок не важен.
 * Возвращает сопоставления по листам или null.
 */
export function matchProfile(sheets, profile) {
  const mappings = [];
  for (const sheet of sheets) {
    const spec = profile.sheets.find((s) => norm(s.name) === norm(sheet.name));
    if (!spec) continue;
    const headerRow = detectHeaderRow(sheet.rows);
    if (headerRow === -1) return null;
    const headers = sheet.rows[headerRow].map(norm);
    const columns = {};
    for (const [field, header] of Object.entries(spec.columns)) {
      const index = headers.indexOf(norm(header));
      if (index !== -1) columns[field] = index;
      else if (spec.required.includes(field)) return null;
    }
    mappings.push({ sheet: sheet.name, headerRow, kind: spec.kind, columns, defaultAccount: null, defaultCurrency: 'KZT', dateOrder: 'DMY' });
  }
  return mappings.length ? mappings : null;
}

const GUESS = [
  ['to_account', /зачислени|входящ|получател|куда|to.?account/],
  ['date', /^(дата|date)/],
  ['time', /^(время|time)$/],
  ['amount', /сумма|amount|^sum/],
  ['type', /^(тип|type|вид)/],
  ['category', /категори|category/],
  ['account', /^(сч[её]т|account|кошел[её]к|карта)/],
  ['currency', /валюта|currency/],
  ['note', /заметк|комментари|описани|назначени|note|memo|comment|description/],
  ['tags', /^(теги|tags|метки)$/],
];

/** Начальное сопоставление для незнакомого файла: колонки угадываются по названиям. */
export function guessMapping(sheets) {
  return sheets.map((sheet) => {
    const headerRow = detectHeaderRow(sheet.rows);
    const base = { sheet: sheet.name, headerRow, columns: {}, defaultAccount: null, defaultCurrency: 'KZT', dateOrder: 'DMY' };
    if (headerRow === -1) return { ...base, kind: 'skip' };
    const headers = sheet.rows[headerRow].map(norm);
    const used = new Set();
    for (const [field, pattern] of GUESS) {
      const index = headers.findIndex((header, i) => header && !used.has(i) && pattern.test(header));
      if (index !== -1) { base.columns[field] = index; used.add(index); }
    }
    if (base.columns.date !== undefined) {
      base.dateOrder = guessDateOrder(sheet.rows.slice(headerRow + 1).map((row) => row[base.columns.date]));
    }
    return { ...base, kind: base.columns.type !== undefined ? 'column' : 'sign' };
  });
}

// ---------- строки → черновики операций ----------

const TYPE_WORDS = [
  ['expense', /^(расход|expense|exp\b|списани|оплат|покупк|-)/],
  ['income', /^(доход|income|inc\b|поступлени|зачислени|пополнени|\+)/],
  ['transfer', /^(перевод|transfer)/],
];

function readAmount(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) return null;
    return { minor: Math.round(Math.abs(value) * 100), negative: value < 0 };
  }
  const minor = parseLooseAmount(value);
  return minor === null ? null : { minor, negative: /^\s*[-−(]/.test(String(value)) };
}

/**
 * Превращает строки листов в черновики операций по сопоставлению колонок.
 * Возвращает { drafts: [{ sheet, line, draft }], errors: [{ sheet, line, message }] }.
 * line — номер строки в файле, начиная с 1. Пустые строки пропускаются.
 */
export function buildDrafts(sheets, mappings) {
  const drafts = [];
  const errors = [];
  for (const mapping of mappings) {
    if (mapping.kind === 'skip' || mapping.headerRow < 0) continue;
    const sheet = sheets.find((s) => s.name === mapping.sheet);
    if (!sheet) continue;
    const { columns } = mapping;
    for (let i = mapping.headerRow + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      if (row.every(isEmpty)) continue;
      const line = i + 1;
      const cell = (field) => (columns[field] === undefined || columns[field] === null ? '' : row[columns[field]] ?? '');
      const text = (field) => String(cell(field)).trim();
      const fail = (message) => errors.push({ sheet: sheet.name, line, message });

      const date = parseDateCell(cell('date'), mapping.dateOrder ?? 'DMY');
      if (!date) { fail(isEmpty(cell('date')) ? 'Нет даты' : `Не удалось прочитать дату: «${text('date')}»`); continue; }
      const extraTime = text('time').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      const time = date.time ?? (extraTime ? `${pad(Number(extraTime[1]))}:${extraTime[2]}:${extraTime[3] ?? '00'}` : DEFAULT_TIME);

      const amount = readAmount(cell('amount'));
      if (!amount) { fail(isEmpty(cell('amount')) ? 'Нет суммы' : `Не удалось прочитать сумму: «${text('amount')}»`); continue; }

      let type = mapping.kind;
      if (mapping.kind === 'sign') type = amount.negative ? 'expense' : 'income';
      if (mapping.kind === 'column') {
        type = TYPE_WORDS.find(([, pattern]) => pattern.test(norm(cell('type'))))?.[0];
        if (!type) { fail(`Не удалось определить тип: «${text('type')}»`); continue; }
      }

      const account = text('account') || mapping.defaultAccount || '';
      if (!account) { fail('Нет счёта'); continue; }
      const toAccount = type === 'transfer' ? text('to_account') : '';
      if (type === 'transfer' && !toAccount) { fail('Нет счёта зачисления'); continue; }

      const currency = /^[A-Za-z]{3}$/.test(text('currency')) ? text('currency').toUpperCase() : mapping.defaultCurrency || 'KZT';
      drafts.push({
        sheet: sheet.name, line,
        draft: {
          date: `${date.day}T${time}`, amount: amount.minor, currency, type,
          category: type === 'transfer' ? '' : text('category'), account, to_account: toAccount,
          note: [text('note'), text('tags')].filter(Boolean).join(' · ').slice(0, 200),
        },
      });
    }
  }
  return { drafts, errors };
}

// ---------- отпечаток и дубли ----------

/** Быстрый 53-битный хеш строки (cyrb53). Не криптографический: нужен только для сравнения строк. */
function hash53(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const draftKey = (d) => [d.date, d.type, d.amount, d.currency, norm(d.account), norm(d.to_account), norm(d.category), d.note.trim()].join('|');

/**
 * Отпечаток строки файла. occurrence — номер такой же строки в файле (0, 1, …):
 * две одинаковые покупки в один день остаются двумя операциями, а при повторном
 * импорте того же файла обе узнаются.
 */
export function fingerprintOf(draft, occurrence) {
  return `import:${hash53(draftKey(draft))}:${occurrence}`;
}

/**
 * Готовит импорт, ничего не записывая: что создать, сколько дублей, какие счета и
 * категории появятся. Дубль — операция с таким же отпечатком, включая удалённые.
 */
export async function planImport(db, drafts) {
  const [categories, accounts, txs] = await Promise.all([db.getAll('categories'), db.getAll('accounts'), db.getAll('transactions')]);
  const known = new Set(txs.map((tx) => tx.fingerprint).filter(Boolean));
  const accountByName = new Map(accounts.filter((a) => !a.deleted).map((a) => [norm(a.name), a]));
  const categoryByKey = new Map(categories.filter((c) => !c.deleted).map((c) => [`${c.type}|${norm(c.name)}`, c]));
  const plan = { total: drafts.length, duplicates: 0, transactions: [], newCategories: [], newAccounts: [] };
  const seen = new Map();
  let accountOrder = accounts.reduce((max, a) => Math.max(max, a.order ?? 0), -1);
  const categoryOrder = { expense: 0, income: 0 };
  for (const c of categories) categoryOrder[c.type] = Math.max(categoryOrder[c.type] ?? 0, (c.order ?? 0) + 1);

  const account = (name, currency) => {
    const key = norm(name);
    if (!accountByName.has(key)) {
      const created = {
        id: uuid(), name: name.trim(), icon: 'wallet', currency, initial_balance: 0, order: ++accountOrder,
        hidden: false, deleted: false, deleted_at: null, updated_at: 0,
      };
      accountByName.set(key, created);
      plan.newAccounts.push(created);
    }
    return accountByName.get(key).id;
  };
  const category = (name, type) => {
    if (!name) return null;
    const key = `${type}|${norm(name)}`;
    if (!categoryByKey.has(key)) {
      const created = {
        id: uuid(), name: name.trim(), icon: 'dots', color: PALETTE[plan.newCategories.length % PALETTE.length], type,
        order: categoryOrder[type]++, hidden: false, deleted: false, deleted_at: null, updated_at: 0,
      };
      categoryByKey.set(key, created);
      plan.newCategories.push(created);
    }
    return categoryByKey.get(key).id;
  };

  for (const { draft } of drafts) {
    const key = draftKey(draft);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const fingerprint = fingerprintOf(draft, occurrence);
    if (known.has(fingerprint)) { plan.duplicates++; continue; }
    const isTransfer = draft.type === 'transfer';
    const categoryId = isTransfer ? null : category(draft.category, draft.type);
    plan.transactions.push(newTransaction({
      date: draft.date, amount: draft.amount, currency: draft.currency, type: draft.type,
      category_id: categoryId, account_id: account(draft.account, draft.currency),
      to_account_id: isTransfer ? account(draft.to_account, draft.currency) : null,
      note: draft.note, source: 'import', fingerprint,
      status: isTransfer || categoryId ? 'ok' : 'needs_review',
    }, 0));
  }
  return plan;
}

/** Записывает подготовленный импорт. Возвращает отчёт. */
export async function applyImport(db, plan, now = Date.now()) {
  const stamp = (rows) => rows.map((row) => ({ ...row, updated_at: now }));
  await db.putMany('categories', stamp(plan.newCategories));
  await db.putMany('accounts', stamp(plan.newAccounts));
  await db.putMany('transactions', stamp(plan.transactions));
  return {
    created: plan.transactions.length, duplicates: plan.duplicates,
    categories: plan.newCategories.length, accounts: plan.newAccounts.length,
  };
}
