// Лист снизу: выбор из списка и подтверждение.
import { h } from './dom.js';
import { icon } from '../icons.js';

/** Открывает лист с произвольным содержимым. Возвращает функцию закрытия. */
export function openSheet({ title, content, onClose = null }) {
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', { class: 'sheet-title', text: title }), content);
  const backdrop = h('div', { class: 'sheet-backdrop' }, sheet);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    backdrop.remove();
    onClose?.();
  };
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  document.body.append(backdrop);
  return close;
}

/**
 * Выбор одного значения. items: [{ value, label, right?, icon?, color? }].
 * Возвращает Promise со значением или undefined, если лист закрыли.
 */
export function pickSheet({ title, items, selected }) {
  return new Promise((resolve) => {
    let result;
    const list = h('div', {}, items.map((item) => h('button', {
      type: 'button',
      class: 'sheet-item',
      onClick: () => { result = item; close(); },
    },
    item.icon && h('span', { class: 'cat-badge', style: item.color ? { '--c': item.color } : null }, icon(item.icon, 22)),
    h('span', { class: 'label', text: item.label }),
    item.right && h('span', { class: 'right', text: item.right }),
    h('span', { class: 'check' }, item.value === selected ? icon('check') : null))));
    const close = openSheet({ title, content: list, onClose: () => resolve(result) });
  });
}

/** Подтверждение действия. Возвращает Promise<boolean>. */
export function confirmSheet({ title, text, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const content = h('div', {},
      text && h('p', { class: 'sheet-text', text }),
      h('div', { class: 'sheet-actions' },
        h('button', {
          type: 'button',
          class: 'btn-secondary' + (danger ? ' btn-danger' : ''),
          text: confirmLabel,
          onClick: () => { result = true; close(); },
        }),
        h('button', { type: 'button', class: 'btn-secondary', text: 'Отмена', onClick: () => close() })));
    const close = openSheet({ title, content, onClose: () => resolve(result) });
  });
}
