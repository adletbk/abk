# M1: каркас PWA и ручной ввод. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устанавливаемое офлайн-PWA с главной и экраном добавления операции на тестовых данных в IndexedDB.

**Architecture:** Один `index.html`, ES-модули без сборки, навигация по hash. Чистая логика (`money`, `model`, `selectors`) отделена от DOM и покрыта тестами `node --test`. Весь доступ к данным через `js/db.js` с версиями схемы.

**Tech Stack:** HTML, CSS, JavaScript (ES2022 modules), IndexedDB, Service Worker, Node 26 `node --test`, dev-зависимость `fake-indexeddb`.

**Spec:** `docs/superpowers/specs/2026-11-13-finance-pwa-design.md` и исходное задание пользователя (экраны, палитра, шрифт).

## Global Constraints

- Никаких сторонних скриптов, CDN, аналитики, внешних шрифтов. В рантайме ноль зависимостей.
- CSP meta дословно: `default-src 'self'; connect-src https://script.google.com https://script.googleusercontent.com; img-src 'self' data:; base-uri 'none'; form-action 'none'`. Никаких inline-скриптов, inline-стилей в разметке и `style`-атрибутов через `setAttribute` (цвета задаются через `el.style.setProperty`).
- Все пути относительные (`./`), сайт живёт в подпапке GitHub Pages.
- Палитра: фон `#000000`, карточки `#171717`, поднятые `#262626`, текст `#FAFAFA`, второстепенный `#A3A3A3`, неактивное `#737373`, доход `#10B981`, расход `#FB923C`, синий `#60A5FA`, фиолетовый `#A78BFA`, красный `#F87171`, жёлтый `#FBBF24`.
- Таблетки `border-radius: 999px`, карточки 16–20px, касания не меньше 44×44px, без `:hover`, контраст не ниже 4.5:1.
- Шрифт: `'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif`; веса 400/500/600/700; WOFF2 в `fonts/`, подмножества latin и cyrillic, `font-display: swap`; суммы `font-variant-numeric: tabular-nums`; крупные числа вес 700, `letter-spacing: -0.03em`.
- Язык интерфейса русский. Валюта по умолчанию KZT, формат «107 700 ₸».
- Суммы: целые минимальные единицы (×100). `date`: `ГГГГ-ММ-ДДTЧЧ:ММ:СС` локальное. `updated_at`: ms UTC.
- Удаление только мягкое: `deleted: true`, `deleted_at`.
- Бюджетов и лимитов нет. Токена и данных в репозитории нет. `samples/` и `node_modules/` в `.gitignore`.
- Коммиты маленькие, сообщение заканчивается строкой `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. Ввод суммы: ведущие нули, вторая запятая, больше двух знаков после запятой, пустая сумма при «Сохранить». Ожидание: лишний ввод игнорируется, ноль не сохраняется. Тест в Task 2 (`keypadReduce`).
2. Граница месяца и дня: операция `2026-10-31T23:59:59` не попадает в ноябрь, `2026-11-01T00:00:00` попадает. Тест в Task 3.
3. Переводы и удалённые операции не входят в доход, расход и баланс месяца; перевод не меняет общий остаток. Тест в Task 3.
4. Обновление схемы БД сохраняет данные: открыть v1, записать, открыть с дополнительной миграцией v2, данные на месте. Тест в Task 4.
5. Список предкеша service worker расходится с файлами: любой отсутствующий файл ломает установку SW и офлайн. Тест в Task 7 сверяет список с диском.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `index.html` | оболочка, мета-теги PWA, CSP, подключение `css/app.css` и `js/app.js` |
| `manifest.webmanifest` | имя «Финансы», `display: standalone`, цвета `#000000`, иконки |
| `sw.js` | предкеш оболочки, cache-first для своего origin, чистка старых кешей |
| `css/fonts.css`, `css/app.css` | `@font-face`; токены, компоненты, экраны |
| `fonts/` | WOFF2 IBM Plex Sans, `OFL.txt` |
| `icons/` | `apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` |
| `js/money.js` | формат и разбор сумм, редьюсер клавиатуры |
| `js/model.js` | создание и проверка операции, uuid, даты |
| `js/selectors.js` | итоги месяца, группы по дням, остатки, поиск |
| `js/db.js` | открытие БД, миграции, CRUD |
| `js/seed.js` | категории и счета по умолчанию, тестовые операции |
| `js/icons.js` | набор SVG-иконок как строки путей, `icon(name)` → `SVGElement` |
| `js/ui/dom.js` | `h(tag, props, ...children)`, `clear(el)`, `toast(text)` |
| `js/ui/home.js`, `js/ui/add.js`, `js/ui/keypad.js`, `js/ui/sheet.js` | экраны и компоненты |
| `js/app.js` | запуск, роутер, регистрация SW, `storage.persist()` |
| `scripts/serve.mjs`, `scripts/make-icons.mjs`, `scripts/check-glyphs.mjs` | dev-сервер, генерация PNG, проверка ₸ |
| `tests/*.test.js` | тесты |

---

### Task 1: Репозиторий и инструменты

**Files:** Create `package.json`, `.gitignore`, `scripts/serve.mjs`, `.claude/launch.json`, `README.md` (заготовка).

**Interfaces:** Produces: `npm test` (= `node --test tests/`), `npm run serve` (статика из корня на `http://localhost:4173`).

- [ ] **Step 1:** `package.json`: `"type": "module"`, `"private": true`, scripts `test`, `serve`; devDependencies `fake-indexeddb`. `.gitignore`: `node_modules/`, `samples/`, `*.local.*`, `.DS_Store`.
- [ ] **Step 2:** `scripts/serve.mjs`: `node:http`, отдаёт файлы из корня репозитория, правильные MIME для `.js .css .html .webmanifest .woff2 .png .svg`, запрет выхода за корень (`..`), порт из `PORT` или 4173.
- [ ] **Step 3:** `.claude/launch.json` с конфигурацией `finance-pwa` → `node scripts/serve.mjs`, порт 4173.
- [ ] **Step 4:** `npm install`; `npm test` завершается без ошибок (тестов ещё нет).
- [ ] **Step 5:** Commit `chore: каркас репозитория и dev-сервер`.

### Task 2: Деньги и клавиатура суммы (`js/money.js`)

**Files:** Create `js/money.js`, `tests/money.test.js`.

**Interfaces:** Produces:
- `CURRENCIES: { KZT: {symbol:'₸', digits:2}, USD: {'$'}, EUR: {'€'}, RUB: {'₽'} }`
- `formatMoney(minor: number, currency = 'KZT', opts?: {sign?: boolean}) => string` — разделитель тысяч U+00A0, перед знаком валюты U+00A0, дробная часть через запятую только если не ноль; `sign: true` даёт «+» для положительных, минус всегда U+2212.
- `keypadReduce(text: string, key: '0'..'9' | ',' | 'back') => string` — состояние клавиатуры как строка.
- `parseAmount(text: string) => number` — минимальные единицы, целое.

- [ ] **Step 1: Тесты** (точные ожидания):

```js
assert.equal(formatMoney(10770000), '107 700 ₸');
assert.equal(formatMoney(10770050), '107 700,50 ₸');
assert.equal(formatMoney(0), '0 ₸');
assert.equal(formatMoney(-150000), '−' + '1 500 ₸');
assert.equal(formatMoney(150000, 'KZT', {sign: true}), '+1 500 ₸');
assert.equal(formatMoney(1999, 'USD'), '19,99 $');
// клавиатура
assert.equal(keypadReduce('', '0'), '0');
assert.equal(keypadReduce('0', '0'), '0');      // без ведущих нулей
assert.equal(keypadReduce('0', '5'), '5');
assert.equal(keypadReduce('', ','), '0,');
assert.equal(keypadReduce('1,5', ','), '1,5');  // вторая запятая игнорируется
assert.equal(keypadReduce('1,55', '5'), '1,55'); // не больше двух знаков
assert.equal(keypadReduce('1,', 'back'), '1');
assert.equal(keypadReduce('', 'back'), '');
assert.equal(keypadReduce('123456789012', '3'), '123456789012'); // не больше 12 цифр целой части
assert.equal(parseAmount('107700'), 10770000);
assert.equal(parseAmount('0,5'), 50);
assert.equal(parseAmount('12,'), 1200);
assert.equal(parseAmount(''), 0);
```

- [ ] **Step 2:** `npm test` падает (модуля нет).
- [ ] **Step 3:** Реализовать. `parseAmount` считает целыми числами, без `parseFloat * 100`.
- [ ] **Step 4:** `npm test` зелёный.
- [ ] **Step 5:** Commit `feat: формат сумм и логика цифровой клавиатуры`.

### Task 3: Модель и выборки (`js/model.js`, `js/selectors.js`)

**Files:** Create `js/model.js`, `js/selectors.js`, `tests/model.test.js`, `tests/selectors.test.js`.

**Interfaces:** Produces:
- `uuid() => string` (`crypto.randomUUID`)
- `localIso(d: Date) => 'YYYY-MM-DDTHH:mm:ss'`, `dayKey(iso) => 'YYYY-MM-DD'`, `monthKey(iso) => 'YYYY-MM'`
- `newTransaction(fields, now = Date.now()) => Transaction` — заполняет `id`, `currency:'KZT'`, `type:'expense'`, `category_id:null`, `account_id`, `to_account_id:null`, `note:''`, `source:'manual'`, `fingerprint:''`, `status:'ok'`, `deleted:false`, `deleted_at:null`, `updated_at: now`.
- `validateTransaction(tx) => string[]` — русские сообщения: `'Введите сумму'` (amount не целое или ≤ 0), `'Выберите счёт'`, `'Выберите счёт зачисления'` (transfer без `to_account_id` или тот же счёт), `'Выберите категорию'` (не transfer и нет категории).
- `monthSummary(txs, month: 'YYYY-MM', {currency='KZT', accountId=null}) => {income, expense, balance}`
- `groupByDay(txs, month, {accountId, query, categoriesById}) => [{day, total, items}]` — дни по убыванию, операции внутри дня по убыванию `date`; `total` = доходы − расходы дня; `query` ищет без учёта регистра в заметке и названии категории.
- `accountBalances(accounts, txs) => Map<id, minor>` и `totalBalance(accounts, txs, currency='KZT') => minor` — начальный остаток + доходы − расходы ± переводы.
- `SOURCE_LABELS = {manual:'вручную', applepay:'Apple Pay', notification:'уведомление банка', import:'импорт'}`
- `dayTitle(day, today) => 'Сегодня' | 'Вчера' | '12 ноября, чт'`; `monthTitle('2026-11') => 'ноябрь'`.

- [ ] **Step 1: Тесты.** Набор-фикстура: доход 500 000,00 1 ноября; расход 4 500,00 `2026-11-01T00:00:00`; расход 1 000,00 `2026-10-31T23:59:59`; перевод 20 000,00 между счетами A→B 5 ноября; удалённый расход 9 999,00 5 ноября; расход 10,00 USD 6 ноября. Проверки:
  - `monthSummary(txs,'2026-11')` → `{income: 50000000, expense: 450000, balance: 49550000}` (перевод, удалённая, USD, октябрь не входят).
  - `groupByDay` за ноябрь: дни `['2026-11-06','2026-11-05','2026-11-01']`; в дне 5 ноября только перевод, `total` 0; USD-операция есть в `items`, но `total` дня 6 ноября равен 0.
  - `accountBalances`: A с начальным 100 000,00 получает доход и расходы и отдаёт 20 000,00; B получает 20 000,00; `totalBalance` не меняется от перевода.
  - `groupByDay(..., {query:'КОФЕ'})` находит операцию с заметкой «кофе с собой».
  - `validateTransaction`: по одному тесту на каждое сообщение; корректная операция → `[]`.
  - `dayTitle('2026-11-13','2026-11-13')` → `'Сегодня'`; `dayTitle('2026-11-12','2026-11-13')` → `'Вчера'`; `dayTitle('2026-11-03','2026-11-13')` → `'3 ноября, вт'`.
- [ ] **Step 2:** тесты падают. **Step 3:** реализовать. **Step 4:** зелёные.
- [ ] **Step 5:** Commit `feat: модель операции и выборки для главной`.

### Task 4: IndexedDB (`js/db.js`, `js/seed.js`)

**Files:** Create `js/db.js`, `js/seed.js`, `tests/db.test.js`.

**Interfaces:** Produces:
- `DB_NAME = 'finance'`, `MIGRATIONS: Array<(db, tx) => void>` (индекс + 1 = версия).
- `openDb({name = DB_NAME, migrations = MIGRATIONS, indexedDB = globalThis.indexedDB}) => Promise<Db>`
- `Db`: `getAll(store)`, `get(store, key)`, `put(store, value)`, `putMany(store, values)`, `softDelete(store, id, now)`, `getSetting(key, fallback)`, `setSetting(key, value)`, `close()`.
- Схема v1: `transactions` (keyPath `id`; индексы `date`, `updated_at`, `fingerprint`, `status`), `categories`, `accounts`, `templates`, `inbox`, `rules` (все keyPath `id`), `settings` (keyPath `key`).
- `seedIfEmpty(db, now) => Promise<boolean>`: если `accounts` пуст, пишет счета «Карта» и «Наличные» (KZT, `initial_balance: 0`), категории и ~25 тестовых операций текущего и прошлого месяца (у всех `note` осмысленная, источники разные: manual, applepay, notification), ставит настройку `demo: true`.
- `clearDemo(db)`: физически удаляет операции с `demo: true` (это тестовые данные, не данные пользователя) и снимает настройку.
- Категории по умолчанию. Расход: Продукты, Кафе, Транспорт, Дом, Связь, Здоровье, Одежда, Развлечения, Подарки, Другое. Доход: Зарплата, Подработка, Другое. У каждой `icon` (имя из `js/icons.js`), `color` из палитры, `type`, `order`, `hidden:false`.

- [ ] **Step 1: Тесты** на `fake-indexeddb` (новый экземпляр `IDBFactory` на каждый тест): put/get/getAll; `softDelete` ставит `deleted:true`, `deleted_at`, `updated_at` и не удаляет запись; `putMany` атомарен; `seedIfEmpty` второй раз возвращает `false` и не дублирует; `clearDemo` оставляет операцию без `demo`.
  Миграция: открыть с `MIGRATIONS`, записать операцию, закрыть; открыть с `[...MIGRATIONS, (db) => db.createObjectStore('x', {keyPath:'id'})]`; операция на месте, хранилище `x` существует.
- [ ] **Step 2–4:** падение, реализация (`onupgradeneeded` прогоняет миграции от `oldVersion` до новой), зелёные.
- [ ] **Step 5:** Commit `feat: IndexedDB с миграциями и тестовыми данными`.

### Task 5: Шрифты, иконки, оболочка

**Files:** Create `fonts/*.woff2`, `fonts/OFL.txt`, `css/fonts.css`, `scripts/check-glyphs.mjs`, `scripts/make-icons.mjs`, `icons/*.png`, `manifest.webmanifest`, `index.html`, `css/app.css` (токены и база).

- [ ] **Step 1:** Временно `npm pack @ibm/plex-sans` в scratch-папку (в зависимости не добавлять), скопировать в `fonts/` WOFF2 подмножеств latin и cyrillic для весов 400/500/600/700 и текст лицензии OFL. `css/fonts.css`: по `@font-face` на вес и подмножество с `unicode-range` из пакета.
- [ ] **Step 2:** `scripts/check-glyphs.mjs`: читает таблицу `cmap` WOFF2/TTF исходника и печатает, в каком файле есть U+20B8. Если ни в одном из выбранных подмножеств его нет, добавить подмножество, где он есть (в Plex это обычно `currency`/`latin-ext`), отдельным `@font-face` с `unicode-range: U+20B8`. Если его нет в Plex совсем, знак берётся из `system-ui` по стеку; записать результат в README.
- [ ] **Step 3:** `scripts/make-icons.mjs`: чистый Node (`zlib`), рисует PNG: чёрный фон, изумрудный `#10B981` знак (три столбца диаграммы), размеры 180, 192, 512 и maskable 512 с полями 20%.
- [ ] **Step 4:** `manifest.webmanifest`: `name` «Финансы», `short_name` «Финансы», `lang: ru`, `start_url: './'`, `scope: './'`, `display: standalone`, `background_color` и `theme_color` `#000000`, иконки.
- [ ] **Step 5:** `index.html`: `lang="ru"`, CSP из Global Constraints, `viewport` с `viewport-fit=cover, width=device-width, initial-scale=1`, `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-mobile-web-app-title`, `theme-color`, `apple-touch-icon`, manifest, `<main id="app">`, `<script type="module" src="./js/app.js">`.
- [ ] **Step 6:** `css/app.css`: CSS-переменные палитры, сброс, `html, body` фон `#000`, `padding` с `env(safe-area-inset-*)`, `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`, `user-select: none` вне полей ввода, класс `.num` с `tabular-nums`.
- [ ] **Step 7:** Commit `feat: оболочка PWA, шрифт IBM Plex Sans, иконки`.

### Task 6: Экраны

**Files:** Create `js/icons.js`, `js/ui/dom.js`, `js/ui/sheet.js`, `js/ui/keypad.js`, `js/ui/home.js`, `js/ui/add.js`, `js/app.js`; modify `css/app.css`.

**Interfaces:**
- Consumes: всё из Tasks 2–4.
- Produces: `renderHome(root, ctx)`, `renderAdd(root, ctx, {id?})`, где `ctx = {db, navigate(hash), state}`; `state = {month: 'YYYY-MM', accountId: null | id, query: ''}`. `openSheet({title, content}) => close()`. `createKeypad({onKey}) => HTMLElement`.
- Роуты: `#/` главная, `#/add` новая операция, `#/add/<id>` правка.

- [ ] **Step 1: Главная.**
  - Шапка: чип «Все счета · ‹остаток›» (открывает лист выбора счёта: «Все счета» и каждый счёт с остатком), кнопки поиска (раскрывает поле ввода над списком), аналитики и настроек (в M1 показывают `toast('Появится в M2')`).
  - Блок «Баланс за ‹месяц›»: стрелки ‹ › меняют месяц; крупное число (`balance`, 44px, вес 700); под ним доход зелёным и расход оранжевым.
  - Плашка «Это тестовые данные. Удалить» при `demo: true` → подтверждение в листе → `clearDemo`.
  - Список по дням: заголовок дня (`dayTitle`) и подитог справа; строка операции: плашка-иконка категории в её цвете, название категории (для перевода «Счёт → Счёт»), под ним заметка и пометка источника через « · », справа сумма (доход зелёный с «+», расход цвета текста с «−», перевод серый). Тап открывает `#/add/<id>`.
  - Пустой месяц: «Нет операций за ‹месяц›».
  - Нижняя плавающая панель над `safe-area-inset-bottom`: шаблоны (toast «Появится в M2»), «+» (→ `#/add`), синхронизация (toast «Появится в M3»). Кнопки 56px, панель-таблетка `#171717`.
- [ ] **Step 2: Добавление.**
  - Сверху: «Закрыть» и сегмент Расход / Доход / Перевод (по умолчанию Расход).
  - Крупная сумма с ₸ (цвет по типу), обновляется от клавиатуры через `keypadReduce`.
  - Чипы: счёт (лист выбора), для перевода второй чип «Куда», дата (`<input type="date">` поверх чипа, подпись «Сегодня» / «Вчера» / дата), валюта (лист из `CURRENCIES`).
  - Заметка: `<input type="text" enterkeyhint="done">`; при фокусе своя клавиатура скрывается, при потере фокуса возвращается.
  - Категории: горизонтально прокручиваемый ряд плиток-иконок нужного типа; для перевода ряд скрыт. Плитка «+ Новая» появится в M2.
  - Клавиатура 4×3: `1–9`, `,`, `0`, `⌫`; кнопки высотой не меньше 52px; системная клавиатура для суммы не открывается (сумма не `input`).
  - «Сохранить»: `validateTransaction`; первая ошибка через `toast`; иначе `db.put` и возврат на главную. В режиме правки время суток операции сохраняется, есть кнопка «Удалить» → подтверждение → `softDelete`.
  - Последний выбранный счёт запоминается в настройке `last_account_id`.
- [ ] **Step 3: `js/app.js`.** `openDb` → `seedIfEmpty` → роутер по `hashchange`; регистрация `./sw.js`; если `matchMedia('(display-mode: standalone)')` или `navigator.standalone`, вызвать `navigator.storage.persist()` и сохранить результат в настройку `persisted`.
- [ ] **Step 4:** Проверка в браузере (ширина 390): сценарий «открыть → + → 1 250 → Кафе → Сохранить → строка в списке сегодня, баланс уменьшился на 1 250 ₸ → открыть операцию → Удалить → строка исчезла». Консоль без ошибок и без нарушений CSP.
- [ ] **Step 5:** Коммиты по экранам: `feat: главная`, `feat: экран добавления операции`.

### Task 7: Service worker и офлайн

**Files:** Create `sw.js`, `tests/sw.test.js`; modify `js/app.js`.

**Interfaces:** `sw.js` содержит `const VERSION = 'v1'` и `const SHELL = [ ... ]` (относительные пути).

- [ ] **Step 1: Тест** `tests/sw.test.js`: вытащить `SHELL` из текста `sw.js`; каждый путь существует на диске; каждый файл из `js/`, `css/`, `fonts/*.woff2`, `icons/`, плюс `index.html` и `manifest.webmanifest`, присутствует в `SHELL`. Тест падает, пока `sw.js` нет.
- [ ] **Step 2:** `sw.js`: `install` → `cache.addAll(SHELL)`; `activate` → удалить кеши с другим `VERSION`, `clients.claim()`; `fetch` → только GET своего origin: cache-first, навигация отдаёт `./index.html`; запросы на другие origin не трогаются. Новый SW ждёт (`skipWaiting` только по сообщению `{type:'SKIP_WAITING'}`); `app.js` при `updatefound` показывает toast «Доступно обновление» с действием «Обновить».
- [ ] **Step 3:** `npm test` зелёный.
- [ ] **Step 4:** Проверка в браузере: загрузить, убедиться, что SW активен и кеш заполнен; остановить dev-сервер; перезагрузить страницу; приложение открывается, операция добавляется и остаётся после перезагрузки.
- [ ] **Step 5:** Commit `feat: service worker и офлайн-режим`.

### Task 8: README и итог вехи

**Files:** Modify `README.md`.

- [ ] **Step 1:** README: что это; запуск локально (`npm run serve`); публикация на GitHub Pages; установка на iPhone (Safari → Поделиться → На экран «Домой»); обновление (при каждом изменении файлов поднимать `VERSION` в `sw.js`); предупреждение, что хранилище PWA отдельно от Safari и бэкап появится в M2; шрифт IBM Plex Sans, лицензия OFL в `fonts/OFL.txt`.
- [ ] **Step 2:** `npm test` полностью зелёный, вывод приложить к отчёту.
- [ ] **Step 3:** Commit `docs: README для M1`. Остановиться и показать результат пользователю.
