// Генерирует css/fonts.css для локальных WOFF2 IBM Plex Sans: node scripts/make-fonts-css.mjs
// Диапазоны unicode-range взяты из CSS пакета @ibm/plex-sans 1.1.0.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WEIGHTS = [[400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold']];
const SUBSETS = [
  ['Latin1', 'U+0000, U+000D, U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, ' +
    'U+2013-2014, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+2074, ' +
    'U+20AC, U+2122, U+2212, U+FB01-FB02'],
  ['Cyrillic', 'U+0400-045F, U+0472-0473, U+0490-049D, U+04A0-04A5, U+04AA-04AB, U+04AE-04B3, ' +
    'U+04B6-04BB, U+04C0-04C2, U+04CF-04D9, U+04DC-04DF, U+04E2-04E9, U+04EE-04F5, U+04F8-04F9'],
  // Из Latin2 нужны только знаки валют: тенге ₸ (U+20B8), рубль ₽ (U+20BD) и соседние.
  ['Latin2', 'U+20A0-20AB, U+20AD-20CF'],
];

let css = '/* IBM Plex Sans, SIL Open Font License 1.1 (fonts/OFL.txt). Файл создан scripts/make-fonts-css.mjs */\n';
for (const [weight, name] of WEIGHTS) {
  for (const [subset, range] of SUBSETS) {
    css += `@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('../fonts/IBMPlexSans-${name}-${subset}.woff2') format('woff2');
  unicode-range: ${range};
}
`;
  }
}
writeFileSync(fileURLToPath(new URL('../css/fonts.css', import.meta.url)), css);
console.log('css/fonts.css');
