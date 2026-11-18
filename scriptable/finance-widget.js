// Финансы: доход и расход за сегодня и месяц. Виджет для приложения Scriptable (iOS).
//
// Данные берутся из вашей Google Таблицы (действие summary скрипта apps-script/Code.gs).
// Нужен токен виджета (функция setupWidget в Apps Script): он позволяет только получать итоги.
// Адрес и токен хранятся в Связке ключей Scriptable. В этом файле их нет и быть не должно.
//
// Установка: docs/widget.md. Размеры: маленький, средний, экран блокировки (прямоугольный и строка).

// Счета, которые не входят в итоги, — как «вне общего баланса» в приложении.
// Названия точно как в таблице, например: ['Депозит']
const EXCLUDE_ACCOUNTS = [];

const KEY_URL = 'finance.widget.url';
const KEY_TOKEN = 'finance.widget.token';
const CACHE_FILE = 'finance-widget-cache.json';
const REFRESH_MINUTES = 15;

const C = {
  bg: '#000000', text: '#FAFAFA', text2: '#A3A3A3', text3: '#737373',
  income: '#10B981', expense: '#FB923C', red: '#F87171', sep: '#262626',
};
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const NBSP = ' ';

// ---------- даты и суммы ----------

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 1245000 (минимальные единицы) → «12 450». Копейки в виджете не показываются. */
function money(minor) {
  const whole = String(Math.round(Math.abs(minor) / 100));
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
const expenseText = (minor, unit = true) => `${minor ? '−' : ''}${money(minor)}${unit ? `${NBSP}₸` : ''}`;
const incomeText = (minor, unit = true) => `+${money(minor)}${unit ? `${NBSP}₸` : ''}`;
/** Коротко для круглого виджета: 950, 12,4К, 1,2М. */
function compact(minor) {
  const v = Math.round(Math.abs(minor) / 100);
  if (v < 1000) return String(v);
  const short = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  if (v < 1000000) return `${short(v / 1000)}К`;
  return `${short(v / 1000000)}М`;
}
function signedText(minor) {
  return `${minor < 0 ? '−' : '+'}${money(minor)}${NBSP}₸`;
}

/** Когда данные последний раз попали в таблицу: «14:32», «вчера 21:10», «16 нояб. 21:10». */
function whenText(ms, now = new Date()) {
  if (!ms) return '—';
  const d = new Date(ms);
  if (dayKey(d) === dayKey(now)) return hhmm(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return `вчера ${hhmm(d)}`;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${hhmm(d)}`;
}

// ---------- данные ----------

function settings() {
  if (!Keychain.contains(KEY_URL) || !Keychain.contains(KEY_TOKEN)) return null;
  return { url: Keychain.get(KEY_URL), token: Keychain.get(KEY_TOKEN) };
}

async function fetchSummary({ url, token }, today) {
  const request = new Request(url);
  request.method = 'POST';
  request.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  request.body = JSON.stringify({ token, action: 'summary', today, exclude_accounts: EXCLUDE_ACCOUNTS });
  request.timeoutInterval = 20;
  const json = await request.loadJSON();
  if (!json || json.ok !== true) throw new Error((json && json.message) || 'Таблица не ответила');
  return json;
}

function cachePath() {
  const fm = FileManager.local();
  return { fm, path: fm.joinPath(fm.documentsDirectory(), CACHE_FILE) };
}
function readCache() {
  const { fm, path } = cachePath();
  if (!fm.fileExists(path)) return null;
  try { return JSON.parse(fm.readString(path)); } catch (error) { return null; }
}
function writeCache(data) {
  const { fm, path } = cachePath();
  fm.writeString(path, JSON.stringify(data));
}

/** Свежие данные или последние сохранённые с пометкой offline. */
async function load(today) {
  const config = settings();
  if (!config) return { state: 'setup' };
  try {
    const data = await fetchSummary(config, today);
    writeCache(data);
    return { state: 'ok', data };
  } catch (error) {
    const cached = readCache();
    if (!cached) return { state: 'error', message: String(error.message || error) };
    // Вчерашние итоги за «сегодня» не показываем: день и месяц сверяются с текущей датой.
    if (cached.today !== today) cached.day = null;
    if (cached.month !== today.slice(0, 7)) cached.period = null;
    return { state: 'offline', data: cached, message: String(error.message || error) };
  }
}

// ---------- отрисовка ----------

function text(stack, value, { size = 12, weight = 'regular', color = C.text, scale = 0.6, right = false } = {}) {
  const t = stack.addText(value);
  const fonts = { regular: Font.systemFont, medium: Font.mediumSystemFont, semibold: Font.semiboldSystemFont, bold: Font.boldSystemFont };
  t.font = fonts[weight](size);
  t.textColor = new Color(color);
  t.lineLimit = 1;
  t.minimumScaleFactor = scale;
  if (right) t.rightAlignText();
  return t;
}

function header(stack, label) {
  const row = stack.addStack();
  row.centerAlignContent();
  const badge = row.addStack();
  badge.size = new Size(16, 16);
  badge.cornerRadius = 5;
  badge.backgroundColor = new Color(C.income);
  badge.centerAlignContent();
  text(badge, '₸', { size: 11, weight: 'bold', color: '#000000' });
  row.addSpacer(5);
  text(row, label.toUpperCase(), { size: 11, weight: 'semibold', color: C.text2 });
}

/** Строка «подпись … сумма». */
function line(stack, label, value, color) {
  const row = stack.addStack();
  row.centerAlignContent();
  text(row, label, { size: 12, color: C.text2 });
  row.addSpacer();
  text(row, value, { size: 16, weight: 'semibold', color, right: true });
}

/** Полоса долей расхода и дохода. */
function flowBar(income, expense, width) {
  if (income + expense === 0) return null;
  const height = 5;
  const gap = 3;
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  let parts;
  if (!income) parts = [[0, width, C.expense]];
  else if (!expense) parts = [[0, width, C.income]];
  else {
    const usable = width - gap;
    const min = 4;
    const e = Math.min(Math.max(Math.round(usable * expense / (income + expense)), min), usable - min);
    parts = [[0, e, C.expense], [e + gap, usable - e, C.income]];
  }
  for (const [x, w, color] of parts) {
    if (w <= 0) continue;
    const path = new Path();
    path.addRoundedRect(new Rect(x, 0, w, height), 2.5, 2.5);
    ctx.addPath(path);
    ctx.setFillColor(new Color(color));
    ctx.fillPath();
  }
  return ctx.getImage();
}

function footer(stack, result, now) {
  const note = result.state === 'offline' ? `Нет связи · данные ${whenText(result.data.updated_at, now)}`
    : `Обновлено ${whenText(result.data.updated_at, now)}`;
  text(stack, note, { size: 10, color: result.state === 'offline' ? C.red : C.text3 });
}

function message(widget, title, body) {
  header(widget, 'Финансы');
  widget.addSpacer();
  text(widget, title, { size: 14, weight: 'semibold' });
  widget.addSpacer(4);
  const t = text(widget, body, { size: 11, color: C.text2, scale: 0.8 });
  t.lineLimit = 4;
  widget.addSpacer();
}

function small(widget, result, now) {
  const day = result.data.day;
  header(widget, 'Сегодня');
  widget.addSpacer();
  text(widget, 'Расход', { size: 12, color: C.text2 });
  text(widget, day ? expenseText(day.expense) : '—', { size: 26, weight: 'bold', color: C.expense, scale: 0.5 });
  const row = widget.addStack();
  text(row, 'Доход ', { size: 12, color: C.text2 });
  text(row, day ? incomeText(day.income) : '—', { size: 12, weight: 'medium', color: C.income });
  widget.addSpacer();
  footer(widget, result, now);
}

function medium(widget, result, now) {
  const { day, period, month } = result.data;
  const cols = widget.addStack();
  cols.layoutHorizontally();

  const left = cols.addStack();
  left.layoutVertically();
  header(left, 'Сегодня');
  left.addSpacer();
  line(left, 'Расход', day ? expenseText(day.expense, false) : '—', C.expense);
  left.addSpacer(4);
  line(left, 'Доход', day ? incomeText(day.income, false) : '—', C.income);
  left.addSpacer();
  text(left, day ? `${day.count} ${plural(day.count, ['операция', 'операции', 'операций'])}` : ' ', { size: 10, color: C.text3 });

  cols.addSpacer(12);
  const sep = cols.addStack();
  sep.size = new Size(1, 104);
  sep.backgroundColor = new Color(C.sep);
  cols.addSpacer(12);

  const right = cols.addStack();
  right.layoutVertically();
  const monthIndex = Number(String(month || '').slice(5, 7)) - 1;
  text(right, (MONTHS[monthIndex] || 'Месяц').toUpperCase(), { size: 11, weight: 'semibold', color: C.text2 });
  right.addSpacer();
  line(right, 'Расход', period ? expenseText(period.expense, false) : '—', C.expense);
  right.addSpacer(4);
  line(right, 'Доход', period ? incomeText(period.income, false) : '—', C.income);
  const bar = period && flowBar(period.income, period.expense, 130);
  if (bar) {
    right.addSpacer(6);
    const image = right.addImage(bar);
    image.imageSize = new Size(130, 5);
  }
  right.addSpacer(6);
  if (period) {
    const rest = period.income - period.expense;
    const share = period.income > 0 ? ` · ${Math.round(rest * 100 / period.income)}%` : '';
    const row = right.addStack();
    text(row, 'Остаток', { size: 11, color: C.text2 });
    row.addSpacer();
    text(row, `${signedText(rest)}${share}`, { size: 11, weight: 'medium', color: rest < 0 ? C.red : C.income, right: true });
  }
  right.addSpacer();

  widget.addSpacer(4);
  footer(widget, result, now);
}

function rectangular(widget, result) {
  const { day, period, month } = result.data;
  const monthIndex = Number(String(month || '').slice(5, 7)) - 1;
  text(widget, `Сегодня · ${(MONTHS[monthIndex] || '').toLowerCase()}`, { size: 12, color: C.text });
  text(widget, day ? expenseText(day.expense) : '—', { size: 18, weight: 'bold', scale: 0.6 });
  text(widget, period ? `${expenseText(period.expense, false)} / ${incomeText(period.income, false)}` : '—', { size: 12 });
}

function plural(n, [one, few, many]) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

function build(result, family, now) {
  const widget = new ListWidget();
  const accessory = String(family).startsWith('accessory');
  if (!accessory) {
    widget.backgroundColor = new Color(C.bg);
    widget.setPadding(14, 15, 12, 15);
  }
  widget.refreshAfterDate = new Date(now.getTime() + REFRESH_MINUTES * 60 * 1000);

  if (result.state === 'setup' || result.state === 'error') {
    if (accessory) { text(widget, result.state === 'setup' ? 'Финансы: настройте' : 'Финансы: нет связи', { size: 12 }); return widget; }
    if (result.state === 'setup') message(widget, 'Нужна настройка', 'Откройте этот скрипт в Scriptable и введите адрес таблицы и токен виджета.');
    else message(widget, 'Нет данных', result.message);
    return widget;
  }
  if (family === 'accessoryInline') {
    const day = result.data.day;
    text(widget, day ? `${expenseText(day.expense)} сегодня` : 'Финансы', { size: 12 });
  } else if (family === 'accessoryCircular') {
    const day = result.data.day;
    text(widget, 'сегодня', { size: 10 });
    text(widget, day ? compact(day.expense) : '—', { size: 15, weight: 'bold', scale: 0.5 });
  } else if (family === 'accessoryRectangular') {
    rectangular(widget, result);
  } else if (family === 'small') {
    small(widget, result, now);
  } else {
    medium(widget, result, now);
  }
  return widget;
}

// ---------- настройка ----------

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;

async function setup() {
  const current = settings();
  const alert = new Alert();
  alert.title = 'Виджет «Финансы»';
  alert.message = 'Адрес веб-приложения из Apps Script и токен виджета (функция setupWidget). Основной токен сюда не вводите.';
  alert.addTextField('https://script.google.com/macros/s/…/exec', current ? current.url : '');
  alert.addSecureTextField('Токен виджета', '');
  alert.addAction('Сохранить');
  alert.addCancelAction('Отмена');
  if ((await alert.presentAlert()) === -1) return false;
  const url = alert.textFieldValue(0).trim();
  const token = alert.textFieldValue(1).trim() || (current ? current.token : '');
  const problem = !URL_RE.test(url) ? 'Адрес должен быть вида https://script.google.com/macros/s/…/exec'
    : !TOKEN_RE.test(token) ? 'Токен — 64 символа: цифры и латинские буквы a–f' : null;
  if (problem) { await notice('Не сохранено', problem); return false; }
  try {
    await fetchSummary({ url, token }, dayKey(new Date()));
  } catch (error) {
    await notice('Таблица не приняла запрос', `${error.message || error}. Проверьте адрес, токен виджета и что скрипт развёрнут заново после обновления.`);
    return false;
  }
  Keychain.set(KEY_URL, url);
  Keychain.set(KEY_TOKEN, token);
  await notice('Готово', 'Теперь добавьте виджет Scriptable на экран «Домой» и выберите в нём этот скрипт.');
  return true;
}

async function notice(title, body) {
  const alert = new Alert();
  alert.title = title;
  alert.message = body;
  alert.addAction('OK');
  await alert.presentAlert();
}

async function forget() {
  for (const key of [KEY_URL, KEY_TOKEN]) if (Keychain.contains(key)) Keychain.remove(key);
  const { fm, path } = cachePath();
  if (fm.fileExists(path)) fm.remove(path);
  await notice('Удалено', 'Адрес, токен и сохранённые итоги удалены с этого устройства.');
}

// ---------- запуск ----------

async function main() {
  const now = new Date();
  if (config.runsInWidget) {
    const result = await load(dayKey(now));
    Script.setWidget(build(result, config.widgetFamily || 'small', now));
    return;
  }
  if (!settings()) {
    if (!(await setup())) return;
  }
  const menu = new Alert();
  menu.title = 'Виджет «Финансы»';
  menu.addAction('Показать маленький');
  menu.addAction('Показать средний');
  menu.addAction('Изменить адрес и токен');
  menu.addDestructiveAction('Удалить настройки');
  menu.addCancelAction('Закрыть');
  const choice = await menu.presentAlert();
  if (choice === 0 || choice === 1) {
    const widget = build(await load(dayKey(now)), choice === 0 ? 'small' : 'medium', now);
    if (choice === 0) await widget.presentSmall(); else await widget.presentMedium();
  } else if (choice === 2) {
    await setup();
  } else if (choice === 3) {
    await forget();
  }
}

await main();
Script.complete();
