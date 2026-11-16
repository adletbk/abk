// Полный JSON-бэкап (с восстановлением) и csv операций.
import { SOURCE_LABELS, TYPE_LABELS, dayKey } from './model.js';

export const BACKUP_FORMAT = 'finance-backup';
export const BACKUP_VERSION = 1;

const STORES = ['transactions', 'categories', 'accounts', 'templates', 'inbox', 'rules', 'planned', 'settings'];
const keyOf = (store) => (store === 'settings' ? 'key' : 'id');

/** Снимок всех данных устройства, включая начальные остатки и настройки. */
export async function exportBackup(db, now = Date.now()) {
  const data = {};
  for (const store of STORES) data[store] = await db.getAll(store);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: new Date(now).toISOString(), data };
}

/** Список проблем файла; пустой список — файл можно восстанавливать. */
export function validateBackup(obj) {
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(obj) || obj.format !== BACKUP_FORMAT || !Number.isInteger(obj.version) || obj.version < 1) {
    return ['Это не файл бэкапа приложения'];
  }
  if (obj.version > BACKUP_VERSION) {
    return ['Бэкап создан в более новой версии приложения. Обновите приложение и повторите'];
  }
  if (!isObject(obj.data)) return ['Файл бэкапа повреждён: data'];
  for (const store of STORES) {
    const rows = obj.data[store];
    if (rows === undefined) continue;
    const valid = Array.isArray(rows)
      && rows.every((row) => isObject(row) && typeof row[keyOf(store)] === 'string' && row[keyOf(store)] !== '');
    if (!valid) return [`Файл бэкапа повреждён: ${store}`];
  }
  return [];
}

/**
 * Заменяет все данные устройства содержимым бэкапа одной транзакцией.
 * При невалидном файле бросает ошибку и ничего не меняет.
 */
export async function importBackup(db, obj) {
  const errors = validateBackup(obj);
  if (errors.length) throw new Error(errors[0]);
  const data = {};
  const counts = {};
  for (const store of STORES) {
    data[store] = obj.data[store] ?? [];
    counts[store] = data[store].length;
  }
  await db.replaceAll(data);
  return { counts };
}

// ---------- csv ----------

const CSV_HEADER = ['Дата', 'Время', 'Сумма', 'Валюта', 'Тип', 'Категория', 'Счёт', 'Счёт зачисления', 'Заметка', 'Источник'];

/** Текстовое поле: без переводов строк, с защитой от формул и экранированием. */
function csvText(value) {
  let text = String(value ?? '').replace(/\s*\r?\n\s*/g, ' ');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Минимальные единицы → число с точкой: 845050 → «8450.5». */
function csvAmount(minor) {
  const frac = String(minor % 100).padStart(2, '0').replace(/0+$/, '');
  return `${Math.floor(minor / 100)}${frac ? `.${frac}` : ''}`;
}

/**
 * csv операций за период (границы включительно, формат ГГГГ-ММ-ДД).
 * UTF-8 с BOM, запятая, CRLF: открывается в Excel и Numbers.
 */
export function transactionsToCsv(txs, { from = null, to = null, categoriesById, accountsById }) {
  const rows = txs
    .filter((tx) => !tx.deleted && (!from || dayKey(tx.date) >= from) && (!to || dayKey(tx.date) <= to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((tx) => [
      dayKey(tx.date),
      tx.date.slice(11, 16),
      csvAmount(tx.amount),
      tx.currency,
      TYPE_LABELS[tx.type] ?? tx.type,
      csvText(categoriesById.get(tx.category_id)?.name),
      csvText(accountsById.get(tx.account_id)?.name),
      csvText(accountsById.get(tx.to_account_id)?.name),
      csvText(tx.note),
      csvText(SOURCE_LABELS[tx.source] ?? tx.source),
    ].join(','));
  return '﻿' + [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}
