// Редакторы в листах: категория, счёт, ввод названия.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { ICON_GROUPS } from '../icons-data.js';
import { openSheet, pickSheet, confirmSheet } from './sheet.js';
import { uuid, plural, TYPE_LABELS } from '../model.js';
import { CURRENCIES, amountToText, parseMoneyInput } from '../money.js';
import { PALETTE, CATEGORY_ICONS, ACCOUNT_ICONS, usageCount, reassignCategory, validParents } from '../catalog.js';

const nextOrder = (rows) => rows.reduce((max, row) => Math.max(max, row.order ?? -1), -1) + 1;
// После отрисовки: в момент первого вызова лист ещё не в документе.
const reveal = (el) => requestAnimationFrame(() => el?.scrollIntoView({ block: 'nearest', inline: 'center' }));

/** Лента цветов с горизонтальной прокруткой. Цвет, которого нет в палитре, добавляется в начало. */
function colorStrip({ get, set }) {
  const strip = h('div', { class: 'color-strip', role: 'group', 'aria-label': 'Цвет' });
  const colors = PALETTE.includes(get()) ? PALETTE : [get(), ...PALETTE];
  const paint = () => {
    clear(strip).append(...colors.map((color) => h('button', {
      type: 'button', class: 'color-chip', 'aria-pressed': String(get() === color), 'aria-label': `Цвет ${color}`,
      style: { '--c': color }, onClick: () => { set(color); paint(); },
    })));
    reveal(strip.querySelector('[aria-pressed="true"]'));
  };
  paint();
  return strip;
}

/** Иконки по разделам с горизонтальной прокруткой. basic — привычные иконки приложения, они идут первым разделом. */
function iconPicker({ get, set, basic }) {
  const picker = h('div', { class: 'icon-picker', role: 'group', 'aria-label': 'Иконка' });
  const groups = [{ name: 'Основные', icons: basic }, ...ICON_GROUPS];
  const paint = () => {
    clear(picker).append(...groups.map((group) => h('div', { class: 'icon-section' },
      h('div', { class: 'icon-section-title', text: group.name }),
      h('div', { class: 'icon-section-grid' }, group.icons.map((name) => h('button', {
        type: 'button', 'aria-pressed': String(get() === name), 'aria-label': `Иконка ${name.replace(/^lu-/, '')}`,
        onClick: () => { set(name); paint(); },
      }, icon(name, 22)))))));
    reveal(picker.querySelector('[aria-pressed="true"]'));
  };
  paint();
  return picker;
}

/** Плашка с иконкой и поле названия в одной строке, как в шапке редактора. */
function nameRow(draft, placeholder, label) {
  const badge = h('span', { class: 'cat-badge' });
  const input = h('input', {
    class: 'name-input', type: 'text', value: draft.name, placeholder, maxlength: '30',
    autocomplete: 'off', enterkeyhint: 'done', 'aria-label': label,
  });
  const paint = () => {
    badge.style.setProperty('--c', draft.color);
    clear(badge).append(icon(draft.icon, 24));
  };
  paint();
  return { el: h('div', { class: 'name-row' }, badge, input), input, paint };
}

function switchRow({ label, sub, get, set }) {
  const button = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-label': label });
  const paint = () => button.setAttribute('aria-checked', String(get()));
  button.addEventListener('click', () => { set(!get()); paint(); });
  paint();
  return h('div', { class: 'form-line' },
    h('span', { class: 'form-line-main' }, h('span', { text: label }), sub && h('span', { class: 'form-line-sub', text: sub })),
    button);
}

/** Ввод короткого текста. Возвращает строку или null. */
export function promptSheet({ title, value = '', placeholder = '', submitLabel = 'Сохранить', maxlength = 40 }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', {
      class: 'field-input', type: 'text', value, placeholder, maxlength: String(maxlength),
      autocomplete: 'off', enterkeyhint: 'done', 'aria-label': title,
      onKeydown: (event) => { if (event.key === 'Enter') submit(); },
    });
    const submit = () => {
      const text = input.value.trim();
      if (!text) { toast('Введите название'); return; }
      result = text;
      close();
    };
    const close = openSheet({
      title,
      content: h('div', { class: 'form' }, input,
        h('button', { type: 'button', class: 'btn-primary', text: submitLabel, onClick: submit })),
      onClose: () => resolve(result),
    });
    input.focus();
  });
}

// ---------- категория ----------

/**
 * Создание или правка категории. Возвращает сохранённую категорию,
 * 'deleted' после удаления или null, если лист закрыли.
 */
export function editCategory(ctx, { category = null, type = 'expense', parentId = null } = {}) {
  const { db } = ctx;
  return new Promise((resolve) => {
    let result = null;
    let all = [];
    const draft = category ? { ...category } : {
      id: uuid(), name: '', icon: 'lu-shapes', color: PALETTE[20], type, parent_id: parentId, order: null,
      hidden: false, deleted: false, deleted_at: null,
    };
    const head = nameRow(draft, 'Название', 'Название категории');

    const parentButton = h('button', { type: 'button', class: 'parent-btn', onClick: pickParent });
    const paintParent = () => {
      const parent = all.find((c) => c.id === draft.parent_id && !c.deleted);
      parentButton.textContent = parent ? `Входит в «${parent.name}»` : '+ Родительская категория';
      parentButton.classList.toggle('set', Boolean(parent));
      typeSeg.hidden = Boolean(category) || Boolean(parent); // тип подкатегории задаёт родитель
    };
    async function pickParent() {
      const options = validParents(draft, all);
      if (options.length === 0) {
        toast(all.some((c) => c.parent_id === draft.id && !c.deleted)
          ? 'У этой категории есть подкатегории: вложить её нельзя' : 'Нет категорий, в которые можно вложить эту');
        return;
      }
      const picked = await pickSheet({
        title: 'Родительская категория', selected: draft.parent_id ?? null,
        items: [{ value: null, label: 'Без родителя', icon: 'layers' },
          ...options.map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color }))],
      });
      if (!picked) return;
      draft.parent_id = picked.value;
      paintParent();
    }

    const typeSeg = h('div', { class: 'seg-plain', role: 'group', 'aria-label': 'Тип категории' });
    const paintType = () => clear(typeSeg).append(...['expense', 'income'].map((t) => h('button', {
      type: 'button', text: TYPE_LABELS[t], 'aria-pressed': String(draft.type === t),
      onClick: () => { draft.type = t; draft.parent_id = null; paintType(); paintParent(); },
    })));
    paintType();

    async function save(patch = {}) {
      const text = head.input.value.trim();
      if (!text) { toast('Введите название'); return; }
      Object.assign(draft, patch, { name: text, updated_at: Date.now() });
      const siblings = (await db.getAll('categories')).filter((c) => c.type === draft.type && (c.parent_id ?? null) === (draft.parent_id ?? null));
      const moved = category && (category.parent_id ?? null) !== (draft.parent_id ?? null);
      if (draft.order == null || moved) draft.order = nextOrder(siblings.filter((c) => c.id !== draft.id));
      await db.put('categories', draft);
      result = draft;
      close();
    }
    async function remove() {
      if (all.some((c) => c.parent_id === category.id && !c.deleted)) {
        toast('Сначала перенесите или удалите подкатегории', { duration: 4000 });
        return;
      }
      if (await deleteCategoryFlow(ctx, category)) { result = 'deleted'; close(); }
    }

    const content = h('div', { class: 'form' },
      parentButton,
      head.el,
      typeSeg,
      colorStrip({ get: () => draft.color, set: (v) => { draft.color = v; head.paint(); } }),
      iconPicker({ get: () => draft.icon, set: (v) => { draft.icon = v; head.paint(); }, basic: CATEGORY_ICONS }),
      h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: () => save() }),
      category && h('div', { class: 'form-row' },
        h('button', {
          type: 'button', class: 'btn-secondary', text: category.hidden ? 'Показать' : 'Скрыть',
          onClick: () => save({ hidden: !category.hidden }),
        }),
        h('button', { type: 'button', class: 'btn-secondary btn-danger', text: 'Удалить', onClick: remove })));
    const close = openSheet({
      title: category ? 'Категория' : 'Новая категория', content, tall: true, onClose: () => resolve(result),
    });
    db.getAll('categories').then((rows) => { all = rows; paintParent(); });
    paintParent();
  });
}

/**
 * Удаление категории. С операциями удалить нельзя: предлагаем перенести их или скрыть категорию.
 * Возвращает true, если категория удалена или скрыта.
 */
async function deleteCategoryFlow(ctx, category) {
  const { db } = ctx;
  const count = usageCount(await db.getAll('transactions'), 'category_id').get(category.id) ?? 0;
  if (count === 0) {
    const yes = await confirmSheet({ title: `Удалить категорию «${category.name}»?`, confirmLabel: 'Удалить', danger: true });
    if (yes) await db.softDelete('categories', category.id);
    return yes;
  }
  const choice = await pickSheet({
    title: `В категории ${count} ${plural(count, ['операция', 'операции', 'операций'])}`,
    items: [
      { value: 'move', label: 'Перенести в другую категорию', icon: 'transfer' },
      { value: 'hide', label: 'Скрыть категорию', icon: 'eye-off' },
    ],
  });
  if (choice?.value === 'hide') {
    await db.put('categories', { ...category, hidden: true, updated_at: Date.now() });
    toast('Категория скрыта. Операции остались в ней');
    return true;
  }
  if (choice?.value === 'move') {
    const others = (await db.getAll('categories'))
      .filter((c) => c.type === category.type && !c.deleted && c.id !== category.id)
      .sort((a, b) => a.order - b.order);
    if (others.length === 0) { toast('Нет другой категории этого типа'); return false; }
    const target = await pickSheet({
      title: 'Куда перенести операции',
      items: others.map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color })),
    });
    if (!target) return false;
    const moved = await reassignCategory(db, category.id, target.value);
    toast(`Перенесено в «${target.label}»: ${moved}`);
    return true;
  }
  return false;
}

// ---------- счёт ----------

/** Создание или правка счёта. Возвращает счёт, 'deleted' или null. */
export function editAccount(ctx, { account = null } = {}) {
  const { db } = ctx;
  return new Promise((resolve) => {
    let result = null;
    const draft = account ? { color: '#10B981', ...account } : {
      id: uuid(), name: '', icon: 'wallet', color: PALETTE[14], currency: 'KZT', initial_balance: 0, order: null,
      exclude_from_total: false, savings: false, hint: '', hidden: false, deleted: false, deleted_at: null,
    };
    const head = nameRow(draft, 'Название', 'Название счёта');
    const balance = h('input', {
      class: 'line-input num', type: 'text', inputmode: 'decimal', placeholder: '0',
      value: draft.initial_balance < 0 ? `-${amountToText(-draft.initial_balance)}` : amountToText(draft.initial_balance),
      autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Начальный остаток',
    });
    const hint = h('input', {
      class: 'line-input', type: 'text', value: draft.hint ?? '', placeholder: 'например, 1234', maxlength: '30',
      autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Подсказка для автоматических трат',
    });
    const currencyButton = h('button', { type: 'button', class: 'line-value', onClick: pickCurrency });
    const paintCurrency = () => { currencyButton.textContent = draft.currency; };
    async function pickCurrency() {
      if (account) { toast('Валюту счёта с операциями менять нельзя: создайте новый счёт'); return; }
      const picked = await pickSheet({
        title: 'Валюта счёта', selected: draft.currency,
        items: Object.entries(CURRENCIES).map(([code, c]) => ({ value: code, label: `${c.symbol}  ${c.name}`, right: code })),
      });
      if (picked) { draft.currency = picked.value; paintCurrency(); }
    }
    paintCurrency();

    async function visibleOthers() {
      return (await db.getAll('accounts')).filter((a) => !a.deleted && !a.hidden && a.id !== draft.id).length;
    }
    async function save(patch = {}) {
      const text = head.input.value.trim();
      const initial = parseMoneyInput(balance.value);
      if (!text) { toast('Введите название'); return; }
      if (initial === null) { toast('Начальный остаток: введите число'); return; }
      if (patch.hidden && (await visibleOthers()) === 0) { toast('Нужен хотя бы один видимый счёт'); return; }
      Object.assign(draft, patch, { name: text, initial_balance: initial, hint: hint.value.trim(), updated_at: Date.now() });
      if (draft.order == null) draft.order = nextOrder(await db.getAll('accounts'));
      await db.put('accounts', draft);
      result = draft;
      close();
    }
    async function remove() {
      const count = usageCount(await db.getAll('transactions'), 'account_id').get(account.id) ?? 0;
      if (count > 0) {
        toast(`У счёта ${count} ${plural(count, ['операция', 'операции', 'операций'])}. Его можно только скрыть`);
        return;
      }
      if ((await visibleOthers()) === 0) { toast('Нужен хотя бы один видимый счёт'); return; }
      const yes = await confirmSheet({ title: `Удалить счёт «${account.name}»?`, confirmLabel: 'Удалить', danger: true });
      if (!yes) return;
      await db.softDelete('accounts', account.id);
      result = 'deleted';
      close();
    }

    const content = h('div', { class: 'form' },
      head.el,
      colorStrip({ get: () => draft.color, set: (v) => { draft.color = v; head.paint(); } }),
      iconPicker({ get: () => draft.icon, set: (v) => { draft.icon = v; head.paint(); }, basic: ACCOUNT_ICONS }),
      h('div', { class: 'form-card' },
        h('label', { class: 'form-line' }, h('span', { class: 'form-line-main', text: 'Начальный остаток' }), balance),
        h('div', { class: 'form-line' }, h('span', { class: 'form-line-main', text: 'Валюта' }), currencyButton),
        switchRow({
          label: 'Скрыть из общего баланса', sub: 'Счёт остаётся в списке, но не входит в «Все счета»',
          get: () => Boolean(draft.exclude_from_total), set: (v) => { draft.exclude_from_total = v; },
        }),
        switchRow({
          label: 'Сбережения', sub: 'Переводы на этот счёт считаются отложенными деньгами в инсайтах',
          get: () => Boolean(draft.savings), set: (v) => { draft.savings = v; },
        }),
        h('label', { class: 'form-line' }, h('span', { class: 'form-line-main', text: 'Подсказка для автотрат' }), hint)),
      h('p', { class: 'field-hint', text: 'Подсказка — текст, по которому счёт узнаётся в уведомлении: обычно последние цифры карты. Начальный остаток, цвет, отметка «Сбережения» и подсказка хранятся только на устройстве и в JSON-бэкапе.' }),
      h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: () => save() }),
      account && h('div', { class: 'form-row' },
        h('button', {
          type: 'button', class: 'btn-secondary', text: account.hidden ? 'Вернуть в списки' : 'Убрать из списков',
          onClick: () => save({ hidden: !account.hidden }),
        }),
        h('button', { type: 'button', class: 'btn-secondary btn-danger', text: 'Удалить', onClick: remove })));
    const close = openSheet({ title: account ? 'Счёт' : 'Новый счёт', content, tall: true, onClose: () => resolve(result) });
  });
}
