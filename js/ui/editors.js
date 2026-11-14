// Редакторы в листах: категория, счёт, ввод названия.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { openSheet, pickSheet, confirmSheet } from './sheet.js';
import { uuid, plural, TYPE_LABELS } from '../model.js';
import { CURRENCIES, amountToText, parseMoneyInput } from '../money.js';
import { PALETTE, CATEGORY_ICONS, ACCOUNT_ICONS, usageCount, reassignCategory } from '../catalog.js';

/** Сетка выбора (иконки или цвета). render(value) возвращает содержимое кнопки. */
function choiceGrid({ className, values, get, set, render, label }) {
  const grid = h('div', { class: className, role: 'group', 'aria-label': label });
  const paint = () => clear(grid).append(...values.map((value) => h('button', {
    type: 'button', 'aria-pressed': String(get() === value), 'aria-label': `${label}: ${value}`,
    onClick: () => { set(value); paint(); },
  }, render(value))));
  paint();
  return { el: grid, paint };
}

const nextOrder = (rows) => rows.reduce((max, row) => Math.max(max, row.order ?? -1), -1) + 1;

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

/**
 * Создание или правка категории. Возвращает сохранённую категорию,
 * 'deleted' после удаления или null, если лист закрыли.
 */
export function editCategory(ctx, { category = null, type = 'expense' } = {}) {
  const { db } = ctx;
  return new Promise((resolve) => {
    let result = null;
    const draft = category ? { ...category } : {
      id: uuid(), name: '', icon: 'dots', color: PALETTE[0], type, order: null,
      hidden: false, deleted: false, deleted_at: null,
    };

    const name = h('input', {
      class: 'field-input', type: 'text', value: draft.name, placeholder: 'Название', maxlength: '30',
      autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Название категории',
    });
    const typeSeg = h('div', { class: 'seg-plain', role: 'group', 'aria-label': 'Тип категории' });
    const paintType = () => clear(typeSeg).append(...['expense', 'income'].map((t) => h('button', {
      type: 'button', text: TYPE_LABELS[t], 'aria-pressed': String(draft.type === t),
      onClick: () => { draft.type = t; paintType(); },
    })));
    paintType();

    const icons = choiceGrid({
      className: 'icon-grid', values: CATEGORY_ICONS, label: 'Иконка',
      get: () => draft.icon, set: (v) => { draft.icon = v; },
      render: (v) => icon(v, 22),
    });
    const colors = choiceGrid({
      className: 'swatches', values: PALETTE, label: 'Цвет',
      get: () => draft.color, set: (v) => { draft.color = v; icons.el.style.setProperty('--c', v); },
      render: (v) => h('span', { class: 'swatch', style: { '--c': v } }),
    });
    icons.el.style.setProperty('--c', draft.color);

    async function save(patch = {}) {
      const text = name.value.trim();
      if (!text) { toast('Введите название'); return; }
      Object.assign(draft, patch, { name: text, updated_at: Date.now() });
      if (draft.order == null) {
        draft.order = nextOrder((await db.getAll('categories')).filter((c) => c.type === draft.type));
      }
      await db.put('categories', draft);
      result = draft;
      close();
    }
    async function remove() {
      if (await deleteCategoryFlow(ctx, category)) { result = 'deleted'; close(); }
    }

    const content = h('div', { class: 'form' },
      name,
      !category && typeSeg,
      h('div', { class: 'field-label', text: 'Иконка' }), icons.el,
      h('div', { class: 'field-label', text: 'Цвет' }), colors.el,
      h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: () => save() }),
      category && h('div', { class: 'form-row' },
        h('button', {
          type: 'button', class: 'btn-secondary', text: category.hidden ? 'Показать' : 'Скрыть',
          onClick: () => save({ hidden: !category.hidden }),
        }),
        h('button', { type: 'button', class: 'btn-secondary btn-danger', text: 'Удалить', onClick: remove })));
    const close = openSheet({
      title: category ? 'Категория' : 'Новая категория', content, onClose: () => resolve(result),
    });
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

/** Создание или правка счёта. Возвращает счёт, 'deleted' или null. */
export function editAccount(ctx, { account = null } = {}) {
  const { db } = ctx;
  return new Promise((resolve) => {
    let result = null;
    const draft = account ? { ...account } : {
      id: uuid(), name: '', icon: 'wallet', currency: 'KZT', initial_balance: 0, order: null,
      hidden: false, deleted: false, deleted_at: null,
    };
    const name = h('input', {
      class: 'field-input', type: 'text', value: draft.name, placeholder: 'Название', maxlength: '30',
      autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Название счёта',
    });
    const balance = h('input', {
      class: 'field-input num', type: 'text', inputmode: 'decimal', placeholder: '0',
      value: draft.initial_balance < 0 ? `-${amountToText(-draft.initial_balance)}` : amountToText(draft.initial_balance),
      autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Начальный остаток',
    });
    const hint = h('input', {
      class: 'field-input', type: 'text', value: draft.hint ?? '', placeholder: 'например, 1234', maxlength: '30',
      autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Подсказка для автоматических трат',
    });
    const icons = choiceGrid({
      className: 'icon-grid', values: ACCOUNT_ICONS, label: 'Иконка',
      get: () => draft.icon, set: (v) => { draft.icon = v; }, render: (v) => icon(v, 22),
    });
    const currency = choiceGrid({
      className: 'seg-plain', values: Object.keys(CURRENCIES), label: 'Валюта',
      get: () => draft.currency, set: (v) => { draft.currency = v; },
      render: (v) => `${CURRENCIES[v].symbol} ${v}`,
    });

    async function visibleOthers() {
      return (await db.getAll('accounts')).filter((a) => !a.deleted && !a.hidden && a.id !== draft.id).length;
    }
    async function save(patch = {}) {
      const text = name.value.trim();
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
      name,
      h('div', { class: 'field-label', text: 'Начальный остаток' }), balance,
      h('p', { class: 'field-hint', text: 'Хранится только на этом устройстве и в JSON-бэкапе. В Google Таблицу не отправляется.' }),
      h('div', { class: 'field-label', text: 'Подсказка для автоматических трат' }), hint,
      h('p', { class: 'field-hint', text: 'Текст, по которому счёт узнаётся в уведомлении или в данных Apple Pay: обычно последние цифры карты. Хранится только на устройстве.' }),
      !account && h('div', { class: 'field-label', text: 'Валюта' }), !account && currency.el,
      h('div', { class: 'field-label', text: 'Иконка' }), icons.el,
      h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: () => save() }),
      account && h('div', { class: 'form-row' },
        h('button', {
          type: 'button', class: 'btn-secondary', text: account.hidden ? 'Показать' : 'Скрыть',
          onClick: () => save({ hidden: !account.hidden }),
        }),
        h('button', { type: 'button', class: 'btn-secondary btn-danger', text: 'Удалить', onClick: remove })));
    const close = openSheet({ title: account ? 'Счёт' : 'Новый счёт', content, onClose: () => resolve(result) });
  });
}
