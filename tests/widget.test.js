// Виджет Scriptable: настоящий scriptable/finance-widget.js в поддельной среде Scriptable.
// Проверяется, что виджет строится для всех размеров, просит настройку, переживает отсутствие сети
// и отправляет в таблицу только то, что нужно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createGas } from './helpers/gas.js';

const CODE = readFileSync(fileURLToPath(new URL('../scriptable/finance-widget.js', import.meta.url)), 'utf8');
const URL_OK = 'https://script.google.com/macros/s/AKfy_test-123/exec';
const TOKEN = 'a'.repeat(64);

class Node {
  constructor(kind) { this.kind = kind; this.children = []; }
  addStack() { const s = new Node('stack'); this.children.push(s); return s; }
  addText(value) { const t = new Node('text'); t.value = value; t.rightAlignText = () => {}; this.children.push(t); return t; }
  addSpacer() { this.children.push(new Node('spacer')); }
  addImage(image) { const i = new Node('image'); i.image = image; this.children.push(i); return i; }
  layoutHorizontally() {} layoutVertically() {} centerAlignContent() {} setPadding() {}
  texts() { return this.children.flatMap((c) => (c.kind === 'text' ? [c.value] : c.texts())); }
}

/** Запускает скрипт. answers — ответы на окна Alert по порядку: { action, fields }. */
async function run({ family = 'small', parameter = null, inWidget = true, keychain = {}, files = {}, respond, answers = [], date = '2026-11-18T15:00:00' } = {}) {
  const requests = [];
  const shown = { widget: null, presented: null, alerts: [] };
  const store = new Map(Object.entries(keychain));
  const disk = new Map(Object.entries(files));
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(date); }
    static now() { return new Date(date).getTime(); }
  }
  class Alert {
    constructor() { this.fields = []; this.actions = []; this.values = []; }
    addTextField(p, v) { this.fields.push(v); } addSecureTextField(p, v) { this.fields.push(v); }
    addAction(a) { this.actions.push(a); } addDestructiveAction(a) { this.actions.push(a); } addCancelAction() {}
    async presentAlert() {
      shown.alerts.push({ title: this.title, message: this.message, actions: this.actions });
      const answer = answers.shift() ?? { action: -1 };
      this.values = answer.fields ?? this.fields;
      return answer.action;
    }
    textFieldValue(i) { return this.values[i] ?? ''; }
  }
  const context = vm.createContext({
    Date: FakeDate, JSON, Math, Number, String, Object, Array, Promise, Error, RegExp,
    console,
    config: { runsInWidget: inWidget, widgetFamily: family },
    args: { widgetParameter: parameter },
    Script: { setWidget: (w) => { shown.widget = w; }, complete: () => {} },
    ListWidget: class extends Node { constructor() { super('widget'); } async presentSmall() { shown.presented = ['small', this]; } async presentMedium() { shown.presented = ['medium', this]; } },
    Color: class { constructor(hex) { this.hex = hex; } },
    Font: { systemFont: (s) => s, mediumSystemFont: (s) => s, semiboldSystemFont: (s) => s, boldSystemFont: (s) => s },
    Size: class { constructor(w, h) { this.w = w; this.h = h; } },
    Rect: class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } },
    Path: class { constructor() { this.rects = []; } addRoundedRect(r) { this.rects.push(r); } },
    DrawContext: class { constructor() { this.paths = []; } addPath(p) { this.paths.push(...p.rects); } setFillColor(c) { this.color = c; } fillPath() {} getImage() { return { rects: this.paths }; } },
    Request: class {
      constructor(url) { this.url = url; }
      async loadJSON() { requests.push({ url: this.url, method: this.method, body: JSON.parse(this.body) }); return respond(JSON.parse(this.body)); }
    },
    Keychain: {
      contains: (k) => store.has(k), get: (k) => store.get(k), set: (k, v) => store.set(k, v), remove: (k) => store.delete(k),
    },
    FileManager: {
      local: () => ({
        documentsDirectory: () => '/docs', joinPath: (a, b) => `${a}/${b}`,
        fileExists: (p) => disk.has(p), readString: (p) => disk.get(p), writeString: (p, v) => disk.set(p, v), remove: (p) => disk.delete(p),
      }),
    },
    Alert,
  });
  await vm.runInContext(`(async () => {\n${CODE}\n})()`, context, { filename: 'finance-widget.js' });
  return { ...shown, requests, store, disk };
}

const configured = { 'finance.widget.url': URL_OK, 'finance.widget.token': TOKEN };
const SUMMARY = {
  ok: true, today: '2026-11-18', month: '2026-11', updated_at: new Date('2026-11-18T14:32:00').getTime(),
  day: { income: 0, expense: 1245000, count: 3 }, period: { income: 62000000, expense: 38420000, count: 41 },
};

test('виджет: без настройки просит открыть скрипт и ничего не запрашивает', async () => {
  for (const family of ['small', 'medium', 'accessoryRectangular']) {
    const { widget, requests } = await run({ family, respond: () => SUMMARY });
    assert.equal(requests.length, 0);
    assert.match(widget.texts().join(' '), /настро/i, family);
  }
});

test('виджет: запрос — только summary с датой и токеном виджета', async () => {
  const { requests } = await run({ keychain: configured, respond: () => SUMMARY });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, URL_OK);
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, { token: TOKEN, action: 'summary', today: '2026-11-18', exclude_accounts: [] });
});

test('виджет: маленький — расход и доход за сегодня, время обновления', async () => {
  const { widget } = await run({ keychain: configured, respond: () => SUMMARY });
  const texts = widget.texts();
  assert.ok(texts.includes('−12 450 ₸'), texts.join(' | '));
  assert.ok(texts.includes('+0 ₸'));
  assert.ok(texts.includes('Обновлено 14:32'));
  assert.ok(!texts.join(' ').includes(TOKEN));
});

test('виджет: средний — сегодня и месяц, полоса долей и остаток', async () => {
  const { widget } = await run({ family: 'medium', keychain: configured, respond: () => SUMMARY });
  const texts = widget.texts();
  for (const expected of ['−12 450', 'НОЯБРЬ', '−384 200', '+620 000', '+235 800 ₸ · 38%', '3 операции']) {
    assert.ok(texts.includes(expected), `${expected}: ${texts.join(' | ')}`);
  }
  const find = (node) => (node.kind === 'image' ? node : node.children.map(find).find(Boolean));
  const bar = find(widget).image.rects;
  assert.equal(bar.length, 2, 'две части: расход и доход');
  assert.ok(bar[0].w < bar[1].w, 'расход меньше дохода — оранжевая часть короче');
});

test('виджет: месяц в минусе — остаток красным без процента от нулевого дохода', async () => {
  const { widget } = await run({
    family: 'medium', keychain: configured,
    respond: () => ({ ...SUMMARY, period: { income: 0, expense: 500000, count: 1 } }),
  });
  assert.ok(widget.texts().includes('−5 000 ₸'), widget.texts().join(' | '));
});

test('виджет: экран блокировки — прямоугольный, круглый и строка', async () => {
  const rect = (await run({ family: 'accessoryRectangular', keychain: configured, respond: () => SUMMARY })).widget.texts();
  assert.deepEqual(rect, ['Сегодня · ноябрь', '−12 450 ₸', '−384 200 / +620 000']);
  const circle = (await run({ family: 'accessoryCircular', keychain: configured, respond: () => SUMMARY })).widget.texts();
  assert.deepEqual(circle, ['сегодня', '12,5К']);
  const inline = (await run({ family: 'accessoryInline', keychain: configured, respond: () => SUMMARY })).widget.texts();
  assert.deepEqual(inline, ['−12 450 ₸ сегодня']);
});

test('виджет: без сети показывает последние итоги с пометкой; вчерашний день за сегодня не выдаёт', async () => {
  const first = await run({ keychain: configured, respond: () => SUMMARY });
  const files = Object.fromEntries(first.disk);
  const fail = () => { throw new Error('The Internet connection appears to be offline.'); };

  const sameDay = await run({ keychain: configured, files, respond: fail });
  assert.ok(sameDay.widget.texts().includes('−12 450 ₸'));
  assert.ok(sameDay.widget.texts().includes('Нет связи · данные 14:32'));

  const nextDay = await run({ family: 'medium', keychain: configured, files, respond: fail, date: '2026-11-19T09:00:00' });
  const texts = nextDay.widget.texts();
  assert.ok(texts.includes('−384 200'), 'месяц тот же — итоги месяца остаются');
  assert.ok(!texts.includes('−12 450'), 'вчерашний расход не выдаётся за сегодняшний');
  assert.ok(texts.includes('Нет связи · данные вчера 14:32'));

  const nextMonth = await run({ family: 'medium', keychain: configured, files, respond: fail, date: '2026-12-01T09:00:00' });
  assert.ok(!nextMonth.widget.texts().includes('−384 200'), 'итоги прошлого месяца не выдаются за текущий');
});

test('виджет: ошибка таблицы без сохранённых итогов — понятное сообщение', async () => {
  const { widget } = await run({ keychain: configured, respond: () => ({ ok: false, error: 'unauthorized', message: 'Неверный токен.' }) });
  assert.ok(widget.texts().includes('Неверный токен.'));
});

test('виджет с настоящим Code.gs: итоги из таблицы, токен виджета ничего не пишет', async () => {
  const gas = createGas();
  gas.props.set('WIDGET_TOKEN', TOKEN);
  gas.call({ action: 'upsert', transactions: [{
    id: 'a', date: '2026-11-18T09:00:00', amount: 125000, currency: 'KZT', type: 'expense', category_id: 'c',
    category: 'Еда', account_id: 'acc', account: 'Карта', note: '', source: 'manual', status: 'ok', deleted: false, updated_at: 1,
  }] });
  const { widget } = await run({ keychain: configured, respond: (body) => gas.post(JSON.stringify(body)).json });
  assert.ok(widget.texts().includes('−1 250 ₸'), widget.texts().join(' | '));
});

test('настройка: неверный адрес или токен не сохраняются; верные проверяются запросом и сохраняются', async () => {
  const bad = await run({ inWidget: false, respond: () => SUMMARY, answers: [{ action: 0, fields: ['https://example.com/exec', TOKEN] }, { action: 0 }] });
  assert.equal(bad.store.size, 0);
  assert.equal(bad.requests.length, 0);
  assert.match(bad.alerts[1].message, /script\.google\.com/);

  const rejected = await run({ inWidget: false, respond: () => ({ ok: false, message: 'Неверный токен.' }), answers: [{ action: 0, fields: [URL_OK, TOKEN] }, { action: 0 }] });
  assert.equal(rejected.store.size, 0, 'токен, который таблица не приняла, не сохраняется');

  const good = await run({ inWidget: false, respond: () => SUMMARY, answers: [{ action: 0, fields: [URL_OK, TOKEN] }, { action: 0 }, { action: 2 }] });
  assert.equal(good.store.get('finance.widget.token'), TOKEN);
  assert.equal(good.presented[0], 'medium', 'после настройки можно посмотреть виджет');

  const forgotten = await run({ inWidget: false, keychain: configured, files: { '/docs/finance-widget-cache.json': '{}' }, respond: () => SUMMARY, answers: [{ action: 4 }, { action: 0 }] });
  assert.deepEqual([forgotten.store.size, forgotten.disk.size], [0, 0]);
});

test('виджет: маленький с параметром «месяц» — итоги месяца и остаток', async () => {
  for (const parameter of ['месяц', 'Месяц', 'month']) {
    const texts = (await run({ parameter, keychain: configured, respond: () => SUMMARY })).widget.texts();
    for (const expected of ['НОЯБРЬ', '−384 200 ₸', '+620 000 ₸', '+235 800 ₸']) {
      assert.ok(texts.includes(expected), `${parameter} / ${expected}: ${texts.join(' | ')}`);
    }
    assert.ok(!texts.includes('СЕГОДНЯ'));
  }
  const day = (await run({ parameter: '', keychain: configured, respond: () => SUMMARY })).widget.texts();
  assert.ok(day.includes('СЕГОДНЯ') && day.includes('−12 450 ₸'), 'без параметра — как раньше, за сегодня');
});

test('меню: маленький за месяц можно посмотреть из Scriptable', async () => {
  const { presented } = await run({ inWidget: false, keychain: configured, respond: () => SUMMARY, answers: [{ action: 1 }] });
  assert.equal(presented[0], 'small');
  assert.ok(presented[1].texts().includes('НОЯБРЬ'));
});
