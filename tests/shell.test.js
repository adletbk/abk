// Статичная оболочка index.html: видимый текст до загрузки скриптов, без форм и полей.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const body = html.slice(html.indexOf('<body'));

test('оболочка содержит название и пояснение', () => {
  assert.match(body, /<h1>Финансы<\/h1>/);
  assert.match(body, /Личный трекер доходов и расходов/);
});
test('в оболочке нет форм, полей и кнопок', () => {
  assert.doesNotMatch(body, /<(form|input|button|select|textarea|iframe)\b/i);
});
test('в оболочке нет слов, похожих на страницу входа', () => {
  assert.doesNotMatch(html, /войти|войдите|вход\b|подтверд|парол|логин|аккаунт|sign.?in|log.?in|password|verify/i);
});
test('в оболочке нет inline-скриптов и inline-стилей', () => {
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /<style\b|\sstyle=/i);
});
