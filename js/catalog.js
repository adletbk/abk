// Справочники: категории, счета, шаблоны. Операции над ними без DOM.
import { uuid } from './model.js';

export const PALETTE = ['#10B981', '#FB923C', '#60A5FA', '#A78BFA', '#F87171', '#FBBF24', '#A3A3A3'];

export const CATEGORY_ICONS = ['cart', 'cup', 'bus', 'car', 'home', 'phone', 'pulse', 'heart', 'shirt', 'play',
  'gift', 'book', 'star', 'wallet', 'briefcase', 'card', 'cash', 'bolt', 'dots'];
export const ACCOUNT_ICONS = ['wallet', 'card', 'cash', 'briefcase', 'layers', 'star'];

/** Переставляет элемент и нумерует список заново. updated_at меняется только у сдвинутых. */
export function moveItem(list, from, to, now = Date.now()) {
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from === target || from < 0 || from >= list.length) return list;
  const next = [...list];
  next.splice(target, 0, ...next.splice(from, 1));
  return next.map((item, order) => (item.order === order ? item : { ...item, order, updated_at: now }));
}

/**
 * Сколько живых операций ссылается на запись справочника.
 * Для счетов (field = 'account_id') учитывается и счёт зачисления перевода.
 */
export function usageCount(txs, field) {
  const counts = new Map();
  const add = (id) => { if (id) counts.set(id, (counts.get(id) ?? 0) + 1); };
  for (const tx of txs) {
    if (tx.deleted) continue;
    add(tx[field]);
    if (field === 'account_id') add(tx.to_account_id);
  }
  return counts;
}

/**
 * Переносит операции и шаблоны из одной категории в другую и мягко удаляет исходную.
 * Возвращает число перенесённых операций.
 */
export async function reassignCategory(db, fromId, toId, now = Date.now()) {
  const target = await db.get('categories', toId);
  if (fromId === toId || !target || target.deleted) throw new Error('Выберите другую категорию');
  const move = (rows) => rows.filter((row) => row.category_id === fromId)
    .map((row) => ({ ...row, category_id: toId, updated_at: now }));
  const txs = move(await db.getAll('transactions'));
  // Порядок важен: категория удаляется последней, чтобы при сбое не осталось ссылок на удалённую.
  await db.putMany('transactions', txs);
  await db.putMany('templates', move(await db.getAll('templates')));
  await db.softDelete('categories', fromId, now);
  return txs.length;
}

const TEMPLATE_FIELDS = ['type', 'amount', 'currency', 'category_id', 'account_id', 'to_account_id', 'note'];
const pickFields = (source) => Object.fromEntries(TEMPLATE_FIELDS.map((key) => [key, source[key] ?? null]));

export function templateFromTransaction(fields, name, now = Date.now()) {
  return {
    id: uuid(), name: name.trim(), ...pickFields(fields), note: fields.note ?? '',
    deleted: false, deleted_at: null, updated_at: now,
  };
}

/** Поля операции из шаблона (без даты: она ставится в момент ввода). */
export function fieldsFromTemplate(template) {
  return pickFields(template);
}
