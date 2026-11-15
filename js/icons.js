// Набор иконок: собственные контуры на сетке 24×24, обводка 2px. Без внешних ресурсов.

import { ICON_NODES } from './icons-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  // интерфейс
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z', 'M20 20l-3.6-3.6'],
  bars: ['M5 20v-7', 'M12 20V5', 'M19 20v-11'],
  flow: ['M3 6c9 0 9 12 18 12', 'M3 18c9 0 9-12 18-12', 'M3 12h18'],
  pie: ['M11 5a8 8 0 1 0 8 8h-8z', 'M15 3.5a6 6 0 0 1 5.5 5.5H15z'],
  settings: ['M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z', 'M12 3v2.5', 'M12 18.5V21', 'M3 12h2.5', 'M18.5 12H21',
    'M5.6 5.6l1.8 1.8', 'M16.6 16.6l1.8 1.8', 'M5.6 18.4l1.8-1.8', 'M16.6 7.4l1.8-1.8'],
  sparkles: ['M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z', 'M18 15v4', 'M16 17h4'],
  more: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
  'arrow-in': ['M17 7L7 17', 'M7 9v8h8'],
  'arrow-out': ['M7 17L17 7', 'M9 7h8v8'],
  sync: ['M4 12a8 8 0 0 1 13.7-5.6L20 9', 'M20 4v5h-5', 'M20 12a8 8 0 0 1-13.7 5.6L4 15', 'M4 20v-5h5'],
  bolt: ['M13 3L5 14h6l-1 7l8-11h-6z'],
  'chevron-left': ['M15 6l-6 6l6 6'],
  'chevron-right': ['M9 6l6 6l-6 6'],
  backspace: ['M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z', 'M12 9.5l5 5', 'M17 9.5l-5 5'],
  transfer: ['M4 8h14', 'M15 5l3 3l-3 3', 'M20 16H6', 'M9 13l-3 3l3 3'],
  trash: ['M5 7h14', 'M10 7V4h4v3', 'M7 7l1 13h8l1-13'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  calendar: ['M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  // счета
  card: ['M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M3 10h18'],
  cash: ['M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z',
    'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z'],
  layers: ['M12 4l9 5l-9 5l-9-5z', 'M3 14l9 5l9-5'],
  // категории
  cart: ['M3 4h2.5l2.2 10.5h10.2L20 7H6.4', 'M8 19a1 1 0 1 0 2 0a1 1 0 0 0-2 0z', 'M16 19a1 1 0 1 0 2 0a1 1 0 0 0-2 0z'],
  cup: ['M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 10h2a2 2 0 0 1 0 4h-2', 'M8 3v2', 'M12 3v2'],
  bus: ['M6 4h12a2 2 0 0 1 2 2v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2z', 'M4 11h16',
    'M7 17v2', 'M17 17v2', 'M8 14h.01', 'M16 14h.01'],
  home: ['M4 11l8-7l8 7', 'M6 10v9h12v-9', 'M10 19v-5h4v5'],
  phone: ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M11 18h2'],
  pulse: ['M3 12h4l2-3l3 6l2-3h7'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  shirt: ['M8 4l-5 3l2 4l2-1v10h10V10l2 1l2-4l-5-3a3 3 0 0 1-6 0z'],
  play: ['M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M10 9l5 3l-5 3z'],
  gift: ['M4 9h16v4H4z', 'M6 13v7h12v-7', 'M12 9v11', 'M12 9c-2 0-4-1-4-3s3-2 4 3c1-5 4-5 4-3s-2 3-4 3z'],
  car: ['M5 16V11l2-5h10l2 5v5', 'M3 16h18', 'M7 16v2', 'M17 16v2', 'M5 11h14'],
  book: ['M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z', 'M5 18a2 2 0 0 1 2-2h12', 'M9 8h6'],
  star: ['M12 4l2.5 5l5.5.8l-4 3.9l.9 5.5L12 16.6l-4.9 2.6l.9-5.5l-4-3.9l5.5-.8z'],
  drag: ['M5 9h14', 'M5 15h14'],
  eye: ['M2.5 12S6 5.5 12 5.5S21.5 12 21.5 12S18 18.5 12 18.5S2.5 12 2.5 12z', 'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z'],
  'eye-off': ['M4 4l16 16', 'M9.5 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.7', 'M6.2 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.3-.6'],
  download: ['M12 4v11', 'M7.5 11l4.5 4.5l4.5-4.5', 'M5 20h14'],
  upload: ['M12 16V5', 'M7.5 9L12 4.5L16.5 9', 'M5 20h14'],
  table: ['M4 5h16v14H4z', 'M4 10h16', 'M4 15h16', 'M10 5v14'],
  dots: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  wallet: ['M4 7a2 2 0 0 1 2-2h11v3', 'M4 7v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-1z', 'M16 13.5h.01'],
  briefcase: ['M5 8h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M9 8V5h6v3', 'M4 13h16'],
};

export const ICON_NAMES = Object.keys(ICONS);

export function icon(name, size = 24) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Имена с префиксом lu- — из набора Lucide (js/icons-data.js), остальные нарисованы здесь.
  const nodes = ICON_NODES[name];
  if (nodes) {
    for (const [tag, attrs] of nodes) {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      svg.append(el);
    }
    return svg;
  }
  for (const d of ICONS[name] ?? ICONS.dots) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
