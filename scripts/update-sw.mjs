// Обновляет service worker после изменения файлов приложения: node scripts/update-sw.mjs
// Пересобирает список SHELL по файлам на диске и увеличивает VERSION на единицу.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, keep) {
  return readdirSync(join(ROOT, dir)).sort().flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel, keep);
    return keep(name) ? [`./${rel}`] : [];
  });
}

const shell = [
  './', './index.html', './manifest.webmanifest',
  ...walk('css', (n) => n.endsWith('.css')),
  ...walk('js', (n) => n.endsWith('.js')),
  ...walk('vendor', (n) => n.endsWith('.js')),
  ...walk('fonts', (n) => n.endsWith('.woff2')),
  ...walk('icons', (n) => n.endsWith('.png')),
];

const path = join(ROOT, 'sw.js');
let source = readFileSync(path, 'utf8');
const version = Number(source.match(/const VERSION = 'v(\d+)';/)[1]) + 1;
source = source
  .replace(/const VERSION = 'v\d+';/, `const VERSION = 'v${version}';`)
  .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n${shell.map((p) => `  '${p}',`).join('\n')}\n];`);
// На Windows файл иногда на мгновение занят (антивирус, dev-сервер): повторяем запись.
for (let attempt = 0; ; attempt++) {
  try { writeFileSync(path, source); break; } catch (error) {
    if (attempt >= 8) throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
}
console.log(`sw.js: VERSION v${version}, файлов в SHELL: ${shell.length}`);
