// Нижняя панель вкладок: разделы приложения. Видна только на экранах верхнего уровня.
import { h } from './dom.js';
import { icon } from '../icons.js';

export const TABS = [
  { hash: '#/', label: 'Операции', icon: 'lu-receipt-text' },
  { hash: '#/analytics', label: 'Аналитика', icon: 'pie' },
  { hash: '#/planned', label: 'Календарь', icon: 'lu-calendar' },
  { hash: '#/settings', label: 'Настройки', icon: 'settings' },
];

/** Вкладка для адреса или null, если это внутренний экран. Пустой адрес — главная. */
export function tabOf(hash) {
  const value = hash === '' || hash === '#' ? '#/' : hash;
  return TABS.find((tab) => tab.hash === value) ?? null;
}

/**
 * Панель вкладок. alert — красная точка на «Настройках» (ошибка синхронизации).
 * Нажатие на текущую вкладку прокручивает экран наверх.
 */
export function tabBar(ctx, current, { alert = null } = {}) {
  return h('nav', { class: 'tabbar', 'aria-label': 'Разделы' }, TABS.map((tab) => {
    const on = tab === current;
    const dot = tab.hash === '#/settings' && alert;
    return h('button', {
      type: 'button', class: 'tab' + (on ? ' on' : ''), 'aria-current': on ? 'page' : null,
      'aria-label': dot ? `${tab.label}: ${alert}` : tab.label,
      onClick: () => (on ? window.scrollTo({ top: 0, behavior: 'smooth' }) : ctx.tab(tab.hash)),
    }, h('span', { class: 'tab-icon' }, icon(tab.icon, 24), dot && h('i', { class: 'tab-dot' })), h('span', { text: tab.label }));
  }));
}
