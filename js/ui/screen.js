// Общие части внутренних экранов: шапка с кнопкой «Назад», строка списка, таблетка периода.
import { h } from './dom.js';
import { icon } from '../icons.js';

export function screenHeader(ctx, title, right = null) {
  return h('header', { class: 'screen-head' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Назад', onClick: () => ctx.back() }, icon('chevron-left')),
    h('h1', { text: title }),
    right ?? h('span', { class: 'head-spacer' }));
}

/** Таблетка «‹ Ноябрь ›». */
export function periodPill(title, onPrev, onNext) {
  return h('div', { class: 'period' },
    h('button', { type: 'button', 'aria-label': 'Предыдущий месяц', onClick: onPrev }, icon('chevron-left', 18)),
    h('span', { class: 'period-title', text: title }),
    h('button', { type: 'button', 'aria-label': 'Следующий месяц', onClick: onNext }, icon('chevron-right', 18)));
}

/**
 * Строка списка. iconName и color дают плашку слева; right — текст справа;
 * tag — пометка («скрыта», «M3»); без onClick строка неактивна.
 */
export function listItem({ iconName, color, label, sub, right, tag, onClick, lead = null }) {
  const body = [
    lead,
    iconName && h('span', { class: 'cat-badge', style: color ? { '--c': color } : null }, icon(iconName, 22)),
    h('span', { class: 'item-main' },
      h('span', { class: 'item-label', text: label }),
      sub && h('span', { class: 'item-sub', text: sub })),
    tag && h('span', { class: 'item-tag', text: tag }),
    right && h('span', { class: 'item-right', text: right }),
    onClick && h('span', { class: 'item-chevron' }, icon('chevron-right', 18)),
  ];
  return onClick
    ? h('button', { type: 'button', class: 'item', onClick }, body)
    : h('div', { class: 'item disabled' }, body);
}
