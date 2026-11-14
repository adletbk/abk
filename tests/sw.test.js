// Список предкеша в sw.js должен точно совпадать с файлами оболочки:
// отсутствующий файл ломает установку service worker, пропущенный — офлайн-режим.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function shellFromSw() {
  const source = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const block = source.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'в sw.js есть const SHELL = [...]');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function walk(dir, keep) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel, keep);
    return keep(name) ? [`./${rel}`] : [];
  });
}

test('sw.js: версия кеша задана', () => {
  assert.match(readFileSync(join(ROOT, 'sw.js'), 'utf8'), /const VERSION = 'v\d+';/);
});

test('sw.js: каждый путь из SHELL существует', () => {
  for (const path of shellFromSw()) {
    if (path === './') continue;
    assert.ok(existsSync(join(ROOT, path)), `нет файла ${path}`);
  }
});

test('sw.js: все файлы оболочки есть в SHELL', () => {
  const expected = [
    './', './index.html', './manifest.webmanifest',
    ...walk('js', (n) => n.endsWith('.js')),
    ...walk('vendor', (n) => n.endsWith('.js')),
    ...walk('css', (n) => n.endsWith('.css')),
    ...walk('fonts', (n) => n.endsWith('.woff2')),
    ...walk('icons', (n) => n.endsWith('.png')),
  ].sort();
  assert.deepEqual(shellFromSw().sort(), expected);
});

test('sw.js: в SHELL нет дублей', () => {
  const shell = shellFromSw();
  assert.equal(new Set(shell).size, shell.length);
});
