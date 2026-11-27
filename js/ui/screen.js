// Общие части внутренних экранов: шапка с кнопкой «Назад», строка списка.
import { h } from './dom.js';
import { icon } from '../icons.js';

/** back: false — экран-вкладка, кнопки «Назад» нет. */
export function screenHeader(ctx, title, right = null, { back = true } = {}) {
  return h('header', { class: 'screen-head' },
    back ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Назад', onClick: () => ctx.back() }, icon('chevron-left')) : h('span', { class: 'head-spacer' }),
    h('h1', { text: title }),
    right ?? h('span', { class: 'head-spacer' }));
}

/**
 * Строка списка. iconName и color дают плашку слева; right — текст справа;
 * tag — пометка («скрыта», «M3»); mark — значок-пометка { icon, label }; без onClick строка неактивна.
 */
export function listItem({ iconName, color, label, sub, right, tag, mark = null, onClick, lead = null }) {
  const body = [
    lead,
    iconName && h('span', { class: 'cat-badge', style: color ? { '--c': color } : null }, icon(iconName, 22)),
    h('span', { class: 'item-main' },
      h('span', { class: 'item-label', text: label }),
      sub && h('span', { class: 'item-sub', text: sub })),
    tag && h('span', { class: 'item-tag', text: tag }),
    mark && h('span', { class: 'item-mark', role: 'img', 'aria-label': mark.label, title: mark.label }, icon(mark.icon, 18)),
    right && h('span', { class: 'item-right', text: right }),
    onClick && h('span', { class: 'item-chevron' }, icon('chevron-right', 18)),
  ];
  return onClick
    ? h('button', { type: 'button', class: 'item', onClick }, body)
    : h('div', { class: 'item disabled' }, body);
}
