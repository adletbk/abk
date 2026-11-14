# M3: Apps Script, синхронизация, inbox. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Облачная копия данных в личной Google Таблице через web app на Apps Script и фоновая синхронизация из приложения.

**Architecture:** `apps-script/Code.gs` — один файл, привязанный к таблице. Клиент `js/sync.js` работает через внедряемый транспорт, поэтому тесты гоняют настоящий `Code.gs` в `node:vm` с поддельными `SpreadsheetApp`, `LockService`, `PropertiesService`. Устройство остаётся источником правды; таблица — копия и почтовый ящик для Команд iOS.

**Tech Stack:** Google Apps Script (V8), `fetch`, `node:vm` для тестов.

**Spec:** исходное задание (разделы «Протокол Apps Script», «Безопасность», «Таблица должна быть удобна для анализа в Claude»).

## Global Constraints

- Токен только в Script Properties и в локальных настройках приложения. В коде, репозитории и логах его нет.
- Каждый запрос без верного токена отклоняется. Ответ всегда JSON с полем `ok`.
- Клиент шлёт `POST`, `Content-Type: text/plain`, JSON в теле. Адрес только `https://script.google.com/macros/s/…/exec`.
- Запись под `LockService`. Повтор одного `id` не создаёт дубль. Операция с уже существующим `fingerprint` не создаётся.
- Значения, начинающиеся с `= + - @`, пишутся с ведущим апострофом.
- Удаление мягкое: строки физически не удаляются.
- Начальные остатки счетов и тестовые операции (`demo`) в таблицу не уходят.
- Листы: `transactions`, `categories`, `accounts`, `templates`, `inbox`, «Сводка по месяцам». Имена листов и колонок не меняются без миграции; версия схемы хранится в Script Properties.
- Лист `transactions`: русские заголовки, названия категорий и счетов вместо id, дата `ГГГГ-ММ-ДД`, время отдельной колонкой, сумма числом, колонка «Тип», колонка «Удалена» = да/нет, служебные id справа.
- «Сводка по месяцам» считается формулами, не скриптом.

## Review Focus

1. Неверный адрес или доступ не «Все»: Google отвечает HTML-страницей. Клиент должен показать понятную ошибку, а не `Unexpected token <`. Тест в Task 3.
2. Обрыв сети посреди синхронизации: метки не сдвигаются, следующая попытка досылает всё. Тест в Task 3.
3. Устаревшая запись (меньший `updated_at`) не затирает новую. Тест в Task 2.
4. Переименование категории обновляет название в уже записанных строках `transactions`. Тест в Task 2.
5. Запись из inbox не теряется, если приложение закрылось между получением и подтверждением. Тест в Task 3.

## Протокол

Запрос: `{ token, action, ... }`. Ошибка: `{ ok: false, error: <код>, message }`.

| action | запрос | ответ |
|---|---|---|
| `ping` | — | `{ ok, server_time, schema }` |
| `add` | `{ text, source, time?, id?, payload? }` | `{ ok, id, duplicate }` |
| `upsert` | `{ transactions?, categories?, accounts?, templates?, inbox? }` | `{ ok, server_time, results: { <лист>: { created, updated, skipped, rejected[], duplicates[] } } }` |
| `pull` | `{ since }` | `{ ok, server_time, transactions, categories, accounts, templates, inbox }` (inbox только со статусом `new`) |
| `delete` | `{ store, ids, deleted_at? }` | `{ ok, deleted, missing[] }` |

Коды ошибок: `unauthorized`, `not_configured`, `bad_request`, `unknown_action`, `schema_mismatch`, `busy`, `internal`.

## Решения исполнителя

- Скрипт привязан к таблице (Расширения → Apps Script), id таблицы в коде не нужен.
- Токен создаёт функция `setup()` в редакторе Apps Script и показывает его в журнале один раз.
- Клиент отправляет удаления через `upsert` (вся запись с флагом); действие `delete` есть в протоколе для ручного использования.
- `pull` отдаёт и справочники: это нужно для восстановления на новом устройстве.
- Статусы inbox: `new` → `fetched` (приложение забрало и сохранило у себя) → `done` (разобрано, M4).
- В `transactions` есть колонка «Месяц» и служебная колонка `key`: на них опираются формулы сводки.

---

### Task 1: Поддельная среда Apps Script и тесты протокола
- [ ] `tests/helpers/gas.js`: `createGas({ token }) => { call(body), sheet(name), formulas, locks, props }`.
- [ ] `tests/apps-script.test.js`: токен, ping, создание листов, add, upsert, защита от формул, delete, pull, переименование, блокировка, плохой JSON. Падают.

### Task 2: `apps-script/Code.gs`
- [ ] `doPost`, `doGet`, `setup`, `resetToken`, `selfTest`; тесты зелёные; commit.

### Task 3: Клиент `js/sync.js`
**Interfaces:** `toWire(store, row, lookups)`, `fromWire(store, wire, local)`, `createTransport(url, token, fetchImpl)`, `syncNow(db, transport, now) => { pushed, pulled, inbox, duplicates }`, `isSyncUrl(url)`, `SyncError`.
- [ ] `tests/sync.test.js` поверх настоящего `Code.gs` в vm; падают; реализация; зелёные; commit.

### Task 4: Экраны
- [ ] `#/sync`: адрес, токен, «Проверить связь», «Синхронизировать», состояние, отключение.
- [ ] `#/inbox`: сырые входящие записи (разбор в M4).
- [ ] Кнопка синхронизации на главной, автосинхронизация при открытии и после изменений.

### Task 5: Документация и итог
- [ ] `docs/setup-google.md`, README, `node scripts/update-sw.mjs`, `npm test`, проверка в браузере, commit, push, остановка.
