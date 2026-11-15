// Справочники: категории, счета, шаблоны. Операции над ними без DOM.
import { uuid } from './model.js';

// Палитра по кругу оттенков: в каждой паре сначала насыщенный цвет, потом светлый.
// В конце — землистые и нейтральные. Все цвета читаются на тёмных карточках.
export const PALETTE = [
  '#FF453A', '#FF8A80', '#FF6B35', '#FFA07A', '#FF9F0A', '#FFC266', '#FFD60A', '#FFE873',
  '#C6E81D', '#DDF57A', '#7FE03A', '#B4F08A', '#30D158', '#86E8A0', '#10B981', '#6EE7B7',
  '#14D2B8', '#7FE8DA', '#22D3EE', '#8AE6F5', '#0A9BFF', '#7CC8FF', '#4C8DFF', '#9DBEFF',
  '#6366F1', '#A5A7FF', '#8B5CF6', '#C4A8FF', '#B45CFF', '#D9A6FF', '#E040FB', '#F0A0FF',
  '#FF4D94', '#FF9CC4', '#F43F5E', '#FDA4AF',
  '#C8905F', '#E0B48A', '#A68A64', '#D4C4A0', '#8FA3B8', '#A3A3A3',
];

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

// ---------- подкатегории ----------

const liveParent = (category, byId) => {
  const parent = category?.parent_id ? byId.get(category.parent_id) : null;
  return parent && !parent.deleted ? parent : null;
};

/** Список для показа: категории верхнего уровня по порядку, подкатегории сразу после родителя. У каждой есть depth. */
export function orderedCategories(list) {
  const byId = new Map(list.map((c) => [c.id, c]));
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  const out = [];
  for (const top of list.filter((c) => !liveParent(c, byId)).sort(byOrder)) {
    out.push({ ...top, depth: 0 });
    for (const child of list.filter((c) => liveParent(c, byId)?.id === top.id).sort(byOrder)) out.push({ ...child, depth: 1 });
  }
  return out;
}

/** «Родитель / Подкатегория» или просто название. */
export function categoryPath(id, byId) {
  const category = byId.get(id);
  if (!category) return '';
  const parent = liveParent(category, byId);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}

/** Категория верхнего уровня, в которую входит эта (для сводок по категориям). */
export function rollupId(id, byId) {
  if (!id) return null;
  return liveParent(byId.get(id), byId)?.id ?? id;
}

/** Кого можно назначить родителем: категории верхнего уровня того же типа. Вложенность — один уровень. */
export function validParents(category, list) {
  if (list.some((c) => c.parent_id === category.id && !c.deleted)) return [];
  return list
    .filter((c) => !c.deleted && !c.parent_id && c.type === category.type && c.id !== category.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
