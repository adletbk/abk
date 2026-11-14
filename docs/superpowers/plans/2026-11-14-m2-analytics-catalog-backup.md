# M2: аналитика, категории, счета, шаблоны, бэкап. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Экран аналитики по макету, управление категориями, счетами и шаблонами, экспорт и восстановление данных.

**Architecture:** Как в M1: чистая логика в `js/*.js` под тестами `node --test`, экраны в `js/ui/`. Новые роуты по hash. Схема IndexedDB не меняется (все хранилища созданы в v1).

**Tech Stack:** без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-11-13-finance-pwa-design.md`, исходное задание, макет `samples/mockups/Аналитика.pdf`.

## Global Constraints

Все ограничения из плана M1 действуют. Дополнительно:

- Никаких бюджетов и лимитов: аналитика показывает только факт.
- Категорию с операциями удалить нельзя: перенос операций в другую категорию или скрытие.
- Удаление категорий, счетов и шаблонов мягкое.
- csv: UTF-8 с BOM, разделитель запятая, строки через CRLF, значения с ведущим `= + - @` получают апостроф.
- JSON-бэкап содержит все хранилища, включая начальные остатки и настройки; восстановление заменяет данные целиком в одной транзакции.
- При изменении файлов оболочки: обновить `SHELL` и поднять `VERSION` в `sw.js`.

## Review Focus

1. Восстановление из повреждённого или чужого файла не должно трогать текущие данные. Тест в Task 2.
2. Бэкап из более новой версии приложения отклоняется с понятным сообщением. Тест в Task 2.
3. Месяц без операций и месяц без дохода: аналитика показывает нули и прочерки, а не `NaN`. Тест в Task 1.
4. Перенос операций при удалении категории меняет и шаблоны, ссылающиеся на неё. Тест в Task 3.
5. csv с запятыми, кавычками, переводами строк и формулами в заметке открывается без сдвига колонок. Тест в Task 2.

## Решения исполнителя

- «Инсайты»: лист с фактами за период, посчитанными на устройстве (динамика, средний расход в день, крупнейшая категория, прогноз).
- Шаблон открывает экран добавления с заполненными полями; операция создаётся по «Сохранить».
- Плитка «+ Новая» стоит последним пунктом в листе «Ещё»: ряд из пяти плиток по макету занят.
- Начальный остаток счёта вводится системной цифровой клавиатурой (`inputmode="decimal"`); своя клавиатура остаётся только для суммы операции.
- «Динамика трат» для текущего месяца сравнивает одинаковое число дней этого и прошлого месяца.
- Порядок перетаскиванием есть у категорий; счета и шаблоны идут в порядке создания.

---

### Task 1: Аналитика (`js/analytics.js`, `js/ui/chart.js`)

**Interfaces (produces):**
- `daysInMonth(month) => number`, `elapsedDays(month, today) => number`
- `monthSeries(txs, month, {today, currency, accountId}) => {days, elapsed, expense: number[], income: number[], forecast: number|null}` (накопительные ряды длиной `elapsed`)
- `spendDynamics(txs, month, opts) => {current, previous, percent: number|null}`
- `dailyAverage(txs, month, opts) => {days, average}`
- `categoryBreakdown(txs, month, opts) => [{category_id, amount, share}]`
- `savedShare({income, expense}) => number|null`
- `buildInsights(data) => string[]`
- `chartPaths(series, {width, height}) => {expense, income, forecast, dot, max}` в `js/ui/chart.js`
- `plural(n, [one, few, many])`, `monthName(month, today)` в `js/model.js`

- [ ] Тесты `tests/analytics.test.js` (ряды, прогноз, динамика, среднее, доли, пустой месяц, шаг дохода), падение, реализация, зелёные, commit.

### Task 2: Бэкап и csv (`js/backup.js`, `db.replaceAll`)

**Interfaces (produces):**
- `exportBackup(db, now) => {format:'finance-backup', version:1, exported_at, data}`
- `validateBackup(obj) => string[]`
- `importBackup(db, obj) => Promise<{counts}>` (бросает `Error` с русским сообщением при невалидном файле)
- `transactionsToCsv(txs, {from, to, categoriesById, accountsById}) => string`
- `db.replaceAll(data: Record<store, rows[]>)` в одной транзакции

- [ ] Тесты `tests/backup.test.js`, падение, реализация, зелёные, commit.

### Task 3: Справочники (`js/catalog.js`)

**Interfaces (produces):**
- `PALETTE: string[]`, `CATEGORY_ICONS`, `ACCOUNT_ICONS`
- `moveItem(list, from, to, now) => list` (переставляет и проставляет `order`, `updated_at` у изменённых)
- `usageCount(txs, field) => Map<id, number>`
- `reassignCategory(db, fromId, toId, now)` (операции и шаблоны, затем мягкое удаление категории)
- `templateFromTransaction(fields, name, now)`, `fieldsFromTemplate(template)`

- [ ] Тесты `tests/catalog.test.js`, падение, реализация, зелёные, commit.

### Task 4: Экраны

- `#/analytics` по макету: баланс, «Отложено N% дохода», график, две плитки, категории с полосой.
- `#/settings`: Счета, Категории, Шаблоны, Экспорт и бэкап; строки будущих вех помечены.
- `#/categories`: вкладки Расход / Доход, перетаскивание, редактор (название, иконка, цвет, тип при создании), скрытие, удаление с переносом.
- `#/accounts`: список с остатками, редактор (название, иконка, валюта при создании, начальный остаток), скрытие.
- `#/templates`: список, переименование, удаление. Создание из меню «⋮» экрана операции. Быстрый ввод с нижней панели главной.
- `#/backup`: JSON-бэкап, восстановление, csv за период.
- Главная: «Инсайты», переходы в аналитику и настройки.
- [ ] Проверка в браузере каждого экрана, консоль без ошибок, commit по экранам.

### Task 5: Оболочка и итог

- [ ] `SHELL` и `VERSION` в `sw.js`, README (бэкап, статус вех), `npm test`, офлайн-проверка, commit, push, остановка.
