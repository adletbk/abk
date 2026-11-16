// Собирает js/icons-data.js из набора Lucide (лицензия ISC): node scripts/make-icon-set.mjs <папка lucide-static>
// Нужен только при изменении списка иконок. Сам набор в репозиторий не кладётся: в него
// попадают лишь выбранные иконки, а в рантайме ничего не загружается со стороны.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) { console.error('Укажите папку распакованного пакета lucide-static'); process.exit(1); }
const nodes = JSON.parse(readFileSync(join(source, 'icon-nodes.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;

const GROUPS = [
  ['Финансы', 'wallet credit-card banknote coins piggy-bank landmark receipt hand-coins badge-percent chart-line vault circle-dollar-sign banknote-arrow-up banknote-arrow-down wallet-cards wallet-minimal receipt-text chart-pie chart-column trending-up trending-down badge-dollar-sign circle-percent bitcoin dollar-sign euro russian-ruble pound-sterling japanese-yen scale nfc qr-code arrow-left-right briefcase-business hand-helping'],
  ['Еда', 'shopping-basket shopping-cart utensils coffee pizza beer wine cake-slice apple sandwich ice-cream-cone cup-soda croissant egg-fried fish carrot beef salad soup cookie donut candy milk drumstick ham cherry grape banana citrus wheat chef-hat cooking-pot utensils-crossed martini glass-water bottle-wine hamburger ice-cream-bowl lollipop popsicle'],
  ['Транспорт', 'car bus train-front plane bike fuel car-taxi-front ship truck tram-front map-pin car-front bus-front plane-landing motorbike ev-charger traffic-cone sailboat rocket cable-car navigation route train-track'],
  ['Дом', 'house sofa bed lamp bath washing-machine wrench hammer plug lightbulb key-round paint-roller droplets flame wifi tv door-open armchair refrigerator microwave air-vent heater fan bed-double shower-head toilet spray-can lamp-desk lamp-floor blinds router satellite-dish fence house-plug drill construction'],
  ['Покупки', 'shopping-bag shirt gift gem watch glasses package tag store scissors smartphone laptop headphones footprints tablet monitor keyboard mouse speaker gamepad barcode ticket-percent crown sparkles brush handbag'],
  ['Здоровье', 'heart-pulse pill stethoscope syringe activity hospital dna cross thermometer bandage brain eye tablets ambulance microscope ear briefcase-medical cigarette scan-heart'],
  ['Спорт', 'dumbbell trophy medal volleyball waves-horizontal mountain target timer biceps-flexed flag person-standing goal'],
  ['Развлечения', 'gamepad-2 film ticket popcorn drama mic camera palette book-open party-popper dices clapperboard tv-minimal-play guitar piano drum radio book-heart library puzzle ferris-wheel roller-coaster joystick disc-3 theater'],
  ['Путешествия', 'plane-takeoff luggage map compass tent hotel tree-palm globe sun umbrella mountain-snow binoculars tickets-plane map-pinned earth sunset caravan anchor'],
  ['Семья', 'baby users heart dog cat paw-print bone school graduation-cap backpack heart-handshake user user-round contact cake rabbit bird turtle squirrel church flower-2 blocks toy-brick'],
  ['Работа и учёба', 'briefcase building pen book calculator presentation mail phone printer laptop-minimal notebook-pen pencil ruler award id-card factory warehouse hard-hat code terminal server languages newspaper megaphone'],
  ['Связь и подписки', 'phone-call message-circle send at-sign rss hard-drive card-sim signal satellite play circle-play bot cloud-upload'],
  ['Государство и документы', 'gavel file-text stamp shield-check ribbon siren'],
  ['Природа', 'leaf flower tree-pine trees cloud moon snowflake sprout tree-deciduous'],
  ['Разное', 'star circle-question-mark repeat shield lock bell zap layers ellipsis shapes hand-heart handshake percent calendar clock bookmark trash recycle hourglass infinity plus minus circle square triangle hexagon ghost key magnet'],
];

// Знаки банков и сервисов: собственные упрощённые контуры в стиле набора (сетка 24×24, обводка 2).
// К Lucide не относятся. Имена с префиксом br-.
const p = (d, extra = {}) => ['path', { d, ...extra }];
const SQUARE = ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '5' }];
const ring = (r = '9') => ['circle', { cx: '12', cy: '12', r }];
const THIN = { 'stroke-width': '1.6' };
const BRANDS = [
  ['Банки', {
    kaspi: [ring('9.5'), ['circle', { cx: '9.3', cy: '7.4', r: '1', ...THIN }], p('M6.9 11.8 9.300 10l2.900 2.300', THIN), p('M9.300 10v4.500l-1.200 4.200', THIN), p('M9.300 14.500l1.300 4.200', THIN),
      ['circle', { cx: '14.800', cy: '10.400', r: '.8', ...THIN }], p('M12.200 12.300l2.400.500 2.300-2.300', THIN), p('M14.600 12.800v2.700l-.800 3.100', THIN), p('M14.600 15.500l1 3.100', THIN)],
    freedom: [p('M4 3h16v5c0 9-8 13-8 13S4 17 4 8z'), p('M9.500 16V8H15'), p('M9.500 12h4')],
    halyk: [p('M21.500 12l-3 3v3.500H15l-3 3-3-3H5.500V15l-3-3 3-3V5.500H9l3-3 3 3h3.500V9z'), p('M16 8.500c-2.500 0-3.500 1.500-4 3.500s-1.500 3.500-4 3.500')],
    forte: [SQUARE, p('M15.500 7.400h-1.400a4.600 4.600 0 0 0-4.600 4.600'), p('M14.100 11.900a4.600 4.600 0 0 0-4.600 4.600v1')],
    'home-credit': [p('M4 5v14'), p('M4 14a3.300 3.300 0 0 1 6.600 0v5'), ['circle', { cx: '17.200', cy: '14.800', r: '4.200' }], p('M13 14.800a4.200 4.200 0 0 0 8.400 0z', { fill: 'currentColor' })],
  }],
  ['Бренды и сервисы', {
    apple: [p('M12 7.5c-1.2-.9-2.4-1.3-3.6-1.3C5.9 6.2 4 8.4 4 11.6c0 4.2 2.6 9.4 5.2 9.4 1 0 1.7-.6 2.8-.6s1.8.6 2.8.6c1.8 0 3.600-2.600 4.600-5.300-1.700-.700-2.700-2.200-2.700-4 0-1.600.800-2.900 2.100-3.700-1-1.200-2.300-1.800-3.600-1.800-1.300 0-2.100.500-3.200 1.300z'), p('M12.200 4.700c.100-1.700 1.400-3.100 3.200-3.200 0 1.800-1.400 3.200-3.200 3.200z')],
    'apple-music': [SQUARE, p('M10 16V8.500l6-1.500v7.500'), ['circle', { cx: '8.500', cy: '16', r: '1.500' }], ['circle', { cx: '14.500', cy: '15', r: '1.500' }]],
    'apple-tv': [['rect', { x: '2', y: '4', width: '20', height: '13', rx: '2.500' }], p('M8 21h8'), p('M9.300 7.500v5.200a.8.8 0 0 0 .8.8h.5'), p('M7.800 9.500h2.900'), p('M12.800 9.500l1.700 4 1.700-4')],
    netflix: [p('M7 20V4l10 16V4')],
    youtube: [['rect', { x: '2', y: '5', width: '20', height: '14', rx: '4.500' }], p('M10 9l5 3-5 3z')],
    spotify: [ring('9.500'), p('M7.300 9.600c3.200-1 6.600-.700 9.500.900'), p('M8 12.700c2.700-.800 5.500-.500 8 .800'), p('M8.700 15.600c2.100-.600 4.200-.400 6 .600')],
    telegram: [p('M21.500 3.500 2.500 11l6 2.500'), p('M21.500 3.500 18 20l-9.500-6.500'), p('M21.500 3.500 8.500 13.500V19l3.200-3.300')],
    whatsapp: [p('M3 21l1.650-4.950A9 9 0 1 1 8 19.700z'), p('M9.300 8.500c-.300 3.300 2.900 6.500 6.200 6.200l.400-1.900-1.800-.700-.900.900c-.900-.400-1.800-1.300-2.200-2.200l.900-.900-.700-1.800z')],
    instagram: [SQUARE, ['circle', { cx: '12', cy: '12', r: '4' }], p('M17 7h.01')],
    threads: [p('M17.500 7.500C16.500 4.900 14.500 3.500 12 3.500 7.500 3.500 5 7 5 12s2.500 8.500 7 8.500c3.500 0 6-1.900 6-4.700 0-2.600-2.200-4.300-5.300-4.300-2.300 0-3.900 1-3.900 2.700 0 1.400 1.200 2.400 2.900 2.400 2.300 0 3.600-1.700 3.600-4.600 0-2.400-1.200-3.800-3.300-3.800-1.300 0-2.300.500-2.900 1.500')],
    x: [p('M4 3.500h4.500L20 20.500h-4.500z'), p('M19.500 3.500l-6.300 7.200'), p('M10.600 13.500 4.500 20.500')],
    tiktok: [p('M13 3v12.500a4 4 0 1 1-4-4'), p('M13 3c.300 3 2.300 5 5.500 5.300')],
    yandex: [ring('9.500'), p('M13.500 17V7h-1.800a2.700 2.700 0 0 0-2.700 2.800c0 1.600 1.100 2.700 2.700 2.700h1.800'), p('M11.500 12.500 9 17')],
    google: [p('M18.400 6.300A8.500 8.500 0 1 0 20.500 12h-8')],
    visa: [p('M1.500 8.500l2.300 7 2.300-7', THIN), p('M8.300 8.500v7', THIN), p('M14.300 9.700c-.500-.800-1.200-1.200-2.100-1.200-1 0-1.800.600-1.800 1.600 0 2.100 4 1.300 4 3.700 0 1-.900 1.700-2 1.700-1 0-1.800-.400-2.300-1.200', THIN), p('M16.800 15.500l2.200-7 2.200 7', THIN), p('M17.600 13.300h2.800', THIN)],
    mastercard: [['circle', { cx: '9', cy: '12', r: '6' }], ['circle', { cx: '15', cy: '12', r: '6' }]],
  }],
];

const missing = [];
const data = {};
const groups = GROUPS.map(([name, list]) => ({
  name,
  icons: list.split(' ').filter((icon) => {
    if (!nodes[icon]) { missing.push(icon); return false; }
    // Оставляем только геометрию: служебные атрибуты вроде key не нужны.
    data[`lu-${icon}`] = nodes[icon].map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'key'))]);
    return true;
  }).map((icon) => `lu-${icon}`),
}));
for (const [name, icons] of BRANDS) {
  for (const [icon, list] of Object.entries(icons)) data[`br-${icon}`] = list;
  groups.push({ name, icons: Object.keys(icons).map((icon) => `br-${icon}`) });
}
if (missing.length) { console.error('Нет в наборе:', missing.join(', ')); process.exit(1); }

const out = `// Иконки для категорий и счетов. Имена lu-: выборка из набора Lucide ${version} (лицензия ISC, vendor/Lucide-LICENSE.txt).
// Имена br-: собственные упрощённые знаки банков и сервисов, к Lucide не относятся.
// Файл создан scripts/make-icon-set.mjs. Не редактируйте вручную.

export const ICON_GROUPS = ${JSON.stringify(groups, null, 2)};

export const ICON_NODES = ${JSON.stringify(data)};
`;
writeFileSync(fileURLToPath(new URL('../js/icons-data.js', import.meta.url)), out);
console.log(`js/icons-data.js: ${Object.keys(data).length} иконок в ${groups.length} группах`);
