// Набор иконок: собственные контуры на сетке 24×24, обводка 2px. Без внешних ресурсов.

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  // интерфейс
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z', 'M20 20l-3.6-3.6'],
  chart: ['M5 20v-7', 'M12 20V5', 'M19 20v-11'],
  settings: ['M4 7h8', 'M18 7h2', 'M4 17h2', 'M12 17h8',
    'M15 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z', 'M9 14.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5z'],
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
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  shirt: ['M8 4l-5 3l2 4l2-1v10h10V10l2 1l2-4l-5-3a3 3 0 0 1-6 0z'],
  play: ['M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M10 9l5 3l-5 3z'],
  gift: ['M4 9h16v4H4z', 'M6 13v7h12v-7', 'M12 9v11', 'M12 9c-2 0-4-1-4-3s3-2 4 3c1-5 4-5 4-3s-2 3-4 3z'],
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
  for (const d of ICONS[name] ?? ICONS.dots) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
