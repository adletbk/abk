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
  ['Транспорт', 'car bus train-front plane bike fuel car-taxi-front ship truck tram-front map-pin car-front bus-front plane-landing motorbike ev-charger traffic-cone sailboat rocket cable-car navigation route train-track parking-meter scooter ticket-check'],
  ['Дом', 'house sofa bed lamp bath washing-machine wrench hammer plug lightbulb key-round paint-roller droplets flame wifi tv door-open armchair refrigerator microwave air-vent heater fan bed-double shower-head toilet spray-can lamp-desk lamp-floor blinds router satellite-dish fence house-plug drill construction lamp-ceiling bed-single house-plus'],
  ['Покупки', 'shopping-bag shirt gift gem watch glasses package tag store scissors smartphone laptop headphones footprints tablet monitor keyboard mouse speaker gamepad barcode ticket-percent crown sparkles brush handbag smartphone-charging tv-minimal'],
  ['Здоровье', 'heart-pulse pill stethoscope syringe activity hospital dna cross thermometer bandage brain eye tablets ambulance microscope ear briefcase-medical cigarette scan-heart pill-bottle'],
  ['Спорт', 'dumbbell trophy medal volleyball waves-horizontal mountain target timer biceps-flexed flag person-standing goal'],
  ['Развлечения', 'gamepad-2 film ticket popcorn drama mic camera palette book-open party-popper dices clapperboard tv-minimal-play guitar piano drum radio book-heart library puzzle ferris-wheel roller-coaster joystick disc-3 theater tickets tent-tree'],
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
    'home-credit': [p('M3.500 17.500H6.700A8 8 0 1 1 17.300 17.500H20.500', { 'stroke-width': '3' }), p('M9 11.500h6a3 3 0 0 1-6 0z', { fill: 'currentColor' })],
    // Bank CenterCredit: два вложенных треугольника со скруглёнными углами.
    bcc: [p('M10.300 4.200 3.300 16.100A2 2 0 0 0 5 19.100h14a2 2 0 0 0 1.700-3L13.700 4.200a2 2 0 0 0-3.400 0z'), p('M11.300 9.100 8.300 14.100a.9.9 0 0 0 .8 1.400h5.800a.9.9 0 0 0 .8-1.400l-2.900-5a.9.9 0 0 0-1.500 0z', THIN)],
    // Alatau City Bank (бывший Jusan): три полосы, сужающиеся книзу.
    alatau: [p('M4 6.500h16'), p('M6.500 12h11'), p('M9.500 17.500h5')],
    // Bereke Bank: две полосы-капсулы, верхняя длиннее.
    bereke: [['rect', { x: '3', y: '5', width: '18', height: '6', rx: '3' }], ['rect', { x: '3', y: '13', width: '12', height: '6', rx: '3' }]],
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
    paypal: [p('M8 21V4h6.500a4.500 4.500 0 0 1 0 9H8')],
    amazon: [['circle', { cx: '11.300', cy: '9.300', r: '3.300' }], p('M14.600 5.500v7.500'), p('M4 16.500c5 3.300 11 3.300 16 0'), p('M17.500 15.300l2.800.800-.900 2.700')],
    wildberries: [SQUARE, p('M6 9.500l1.300 5 1.400-4 1.400 4 1.300-5', THIN), p('M14 9.500v5h2.300a1.250 1.250 0 0 0 0-2.500H14h2a1.250 1.250 0 0 0 0-2.500z', THIN)],
    uber: [SQUARE, p('M8.500 8v5a3.500 3.500 0 0 0 7 0V8')],
    glovo: [['circle', { cx: '12', cy: '9.500', r: '6.500' }], ['circle', { cx: '12', cy: '9.500', r: '2' }], p('M12 20.500h.01')],
    airbnb: [p('M12 18.500c-1.800-2.200-3-4-3-5.700a3 3 0 0 1 6 0c0 1.700-1.200 3.500-3 5.700zm0 0c-1.500 1.700-3 2.500-4.500 2.500-2.500 0-4-2.200-3-4.800C5.800 12.800 9 6.500 10 4.800c.900-1.700 3.100-1.700 4 0 1 1.700 4.200 8 5.500 11.400 1 2.600-.5 4.800-3 4.800-1.500 0-3-.800-4.500-2.500z')],
    booking: [SQUARE, p('M8.500 7.500v9h3.500a2.500 2.500 0 0 0 0-5H8.500h3a2 2 0 0 0 0-4z'), p('M16.500 16.500h.01')],
    mcdonalds: [p('M3.500 19c0-8 1.300-14 4.200-14 2.400 0 3.700 4 4.300 9 .600-5 1.900-9 4.300-9 2.900 0 4.200 6 4.200 14')],
    kfc: [p('M2.500 8v8', THIN), p('M7 8l-4.500 4.500', THIN), p('M4.300 10.800 7 16', THIN), p('M10 16V8h4', THIN), p('M10 12h3', THIN), p('M21.500 9.500a3.300 4 0 1 0 0 5', THIN)],
    starbucks: [ring('9.500'), ring('5.500'), p('M12 9.300l.800 1.700h1.800l-1.400 1.200.500 1.800-1.700-1-1.700 1 .500-1.800-1.400-1.200h1.800z', { 'stroke-width': '1.200' })],
    steam: [ring('9.500'), ['circle', { cx: '15', cy: '9.500', r: '2.500' }], ['circle', { cx: '9.300', cy: '15.300', r: '1.800' }], p('M3 13l4.700 1.700'), p('M11 14.300l2.300-2.800')],
    xbox: [ring('9.500'), p('M7 5.500c2 .500 3.800 2 5 3.500 1.200-1.500 3-3 5-3.500'), p('M5.500 18.500c.500-4 3-7.500 6.500-9.500 3.500 2 6 5.500 6.500 9.500')],
    nintendo: [p('M10 3H7.500A4.500 4.500 0 0 0 3 7.500v9A4.500 4.500 0 0 0 7.500 21H10z'), p('M14 3h2.500A4.500 4.500 0 0 1 21 7.500v9a4.500 4.500 0 0 1-4.500 4.500H14z'), p('M6.500 8h.01'), p('M17.500 13h.01')],
    twitch: [p('M6 3 3.500 7.500V19H8v3l3-3h4l5.500-5.500V3z'), p('M11 7.500v5'), p('M16 7.500v5')],
    discord: [p('M8.500 5.500C7 5.800 5.700 6.300 4.500 7 3 10 2.500 13.500 3 17c1.500 1.200 3 1.800 4.500 2.200l1-1.700'), p('M15.500 5.500c1.500.300 2.800.800 4 1.500 1.500 3 2 6.500 1.500 10-1.500 1.200-3 1.800-4.500 2.200l-1-1.700'), p('M8 6.200c2.600-.700 5.400-.700 8 0'), p('M7.500 17c3 1 6 1 9 0'), ['circle', { cx: '9', cy: '12.500', r: '1.200' }], ['circle', { cx: '15', cy: '12.500', r: '1.200' }]],
    facebook: [ring('9.500'), p('M15.300 7.500h-1a2.300 2.300 0 0 0-2.300 2.300v11.200'), p('M9.500 13h5.500')],
    'google-play': [p('M5 3.500v17l15-8.500z'), p('M5 3.500l9.500 11.600'), p('M5 20.500l9.500-11.600')],
    microsoft: [['rect', { x: '3', y: '3', width: '7.500', height: '7.500', rx: '1' }], ['rect', { x: '13.500', y: '3', width: '7.500', height: '7.500', rx: '1' }], ['rect', { x: '3', y: '13.500', width: '7.500', height: '7.500', rx: '1' }], ['rect', { x: '13.500', y: '13.500', width: '7.500', height: '7.500', rx: '1' }]],
    adobe: [p('M3 20 9.500 4h5L21 20h-4l-5-11.500L9.500 15H13l1.800 5')],
    notion: [SQUARE, p('M9 16V8l6 8V8')],
    chatgpt: [p('M12 2.500l8.200 4.750v9.500L12 21.500l-8.200-4.750v-9.500z'), p('M12 7.500l3.900 2.250v4.500L12 16.500l-3.900-2.250v-4.500z')],
    claude: [p('M12 3v6'), p('M12 15v6'), p('M3 12h6'), p('M15 12h6'), p('M5.600 5.600l4.300 4.300'), p('M14.100 14.100l4.300 4.300'), p('M5.600 18.400l4.300-4.300'), p('M14.100 9.900l4.300-4.300')],
    nike: [p('M21 7 8 16.500c-3 1.800-6-.500-4-4.500-.500 2.500 1 3.500 3.500 2.500z')],
    adidas: [p('M5.500 19l-1.500-2.600', { 'stroke-width': '2.800' }), p('M11.500 19 8 13', { 'stroke-width': '2.800' }), p('M17.500 19 12 9.500', { 'stroke-width': '2.800' })],
    ikea: [['rect', { x: '2', y: '6', width: '20', height: '12', rx: '1.500' }], ['ellipse', { cx: '12', cy: '12', rx: '7.500', ry: '3.800' }]],
    beeline: [ring('9.500'), p('M4 7.500h16'), p('M2.500 12h19'), p('M4 16.500h16')],
    // Onay: транспортная карта (условный знак).
    onay: [['rect', { x: '2.500', y: '5', width: '19', height: '14', rx: '3' }], ['circle', { cx: '8', cy: '12', r: '2.600' }], p('M13.500 10h4.500'), p('M13.500 14h3')],
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
