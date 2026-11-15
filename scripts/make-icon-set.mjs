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
  ['Финансы', 'wallet credit-card banknote coins piggy-bank landmark receipt hand-coins badge-percent chart-line vault circle-dollar-sign'],
  ['Еда', 'shopping-basket shopping-cart utensils coffee pizza beer wine cake-slice apple sandwich ice-cream-cone cup-soda croissant egg-fried fish carrot'],
  ['Транспорт', 'car bus train-front plane bike fuel car-taxi-front ship truck tram-front map-pin'],
  ['Дом', 'house sofa bed lamp bath washing-machine wrench hammer plug lightbulb key-round paint-roller droplets flame wifi tv'],
  ['Покупки', 'shopping-bag shirt gift gem watch glasses package tag store scissors smartphone laptop headphones footprints'],
  ['Здоровье', 'heart-pulse pill stethoscope syringe activity hospital dna cross thermometer bandage brain eye'],
  ['Спорт', 'dumbbell trophy medal volleyball waves-horizontal mountain target timer'],
  ['Развлечения', 'gamepad-2 film ticket popcorn drama mic camera palette book-open party-popper dices'],
  ['Путешествия', 'plane-takeoff luggage map compass tent hotel tree-palm globe sun umbrella'],
  ['Семья', 'baby users heart dog cat paw-print bone school graduation-cap backpack'],
  ['Работа', 'briefcase building pen book calculator presentation mail phone printer'],
  ['Природа', 'leaf flower tree-pine trees cloud moon snowflake sprout'],
  ['Разное', 'star circle-question-mark repeat shield lock bell zap layers ellipsis shapes hand-heart handshake percent calendar clock'],
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
if (missing.length) console.warn('Нет в наборе:', missing.join(', '));

const out = `// Иконки для категорий и счетов: выборка из набора Lucide ${version} (лицензия ISC, vendor/Lucide-LICENSE.txt).
// Файл создан scripts/make-icon-set.mjs. Не редактируйте вручную.

export const ICON_GROUPS = ${JSON.stringify(groups, null, 2)};

export const ICON_NODES = ${JSON.stringify(data)};
`;
writeFileSync(fileURLToPath(new URL('../js/icons-data.js', import.meta.url)), out);
console.log(`js/icons-data.js: ${Object.keys(data).length} иконок в ${groups.length} группах`);
