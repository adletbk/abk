// Импорт xlsx и csv. Файлы собираются в памяти; данные выдуманные, структура — как в образце пользователя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../js/db.js';
import { seedIfEmpty, clearDemo } from '../js/seed.js';
import { newTransaction } from '../js/model.js';
import { XLSX, makeXlsx, moneyManagerSample } from './helpers/xlsx.js';
import {
  parseCsv, decodeText, excelSerialToParts, parseDateCell, guessDateOrder, detectHeaderRow, signature,
  readWorkbook, readCsv, MONEY_MANAGER, matchProfile, guessMapping, buildDrafts, fingerprintOf,
  planImport, applyImport,
} from '../js/importer.js';

const NOW = new Date(2026, 10, 14, 12, 0, 0).getTime();
async function device() {
  const db = await openDb({ indexedDB: new IDBFactory() });
  await seedIfEmpty(db, NOW);
  await clearDemo(db);
  return db;
}
const live = async (db) => (await db.getAll('transactions')).filter((t) => !t.deleted);

// ---------- csv ----------

test('parseCsv: запятая, кавычки, переводы строк внутри поля', () => {
  assert.deepEqual(parseCsv('a,b,c\r\n1,"x, ""y""",3\n4,"две\nстроки",6\n'), [
    ['a', 'b', 'c'], ['1', 'x, "y"', '3'], ['4', 'две\nстроки', '6'],
  ]);
});
test('parseCsv: разделитель определяется сам (точка с запятой, табуляция)', () => {
  assert.deepEqual(parseCsv('Дата;Сумма;Заметка\n01.11.2026;1 500,50;обед'), [['Дата', 'Сумма', 'Заметка'], ['01.11.2026', '1 500,50', 'обед']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});
test('parseCsv: пустые строки в конце не дают лишних записей, пустой файл — пустой список', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n\n\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv(''), []);
});
test('decodeText: BOM убирается, windows-1251 распознаётся', () => {
  const utf8 = new TextEncoder().encode('﻿Дата,Сумма');
  assert.equal(decodeText(utf8), 'Дата,Сумма');
  const cp1251 = new Uint8Array([0xc4, 0xe0, 0xf2, 0xe0, 0x2c, 0xd1, 0xf3, 0xec, 0xec, 0xe0]); // «Дата,Сумма»
  assert.equal(decodeText(cp1251), 'Дата,Сумма');
});

// ---------- даты ----------

test('excelSerialToParts: дата без времени и с временем', () => {
  assert.deepEqual(excelSerialToParts(46338), { day: '2026-11-12', time: null });
  assert.deepEqual(excelSerialToParts(46327), { day: '2026-11-01', time: null });
  assert.deepEqual(excelSerialToParts(46338.59375), { day: '2026-11-12', time: '14:15:00' });
  assert.deepEqual(excelSerialToParts(46338.99999), { day: '2026-11-12', time: '23:59:59' });
});
test('parseDateCell: числа Excel, ISO, точки и косые', () => {
  assert.deepEqual(parseDateCell(46338), { day: '2026-11-12', time: null });
  assert.deepEqual(parseDateCell('2026-11-12'), { day: '2026-11-12', time: null });
  assert.deepEqual(parseDateCell('2026-11-12T14:10:05'), { day: '2026-11-12', time: '14:10:05' });
  assert.deepEqual(parseDateCell('2026-11-12 14:10'), { day: '2026-11-12', time: '14:10:00' });
  assert.deepEqual(parseDateCell('12.11.2026'), { day: '2026-11-12', time: null });
  assert.deepEqual(parseDateCell('12.11.2026 9:05'), { day: '2026-11-12', time: '09:05:00' });
  assert.deepEqual(parseDateCell('12/11/2026'), { day: '2026-11-12', time: null });
  assert.deepEqual(parseDateCell('11/12/2026', 'MDY'), { day: '2026-11-12', time: null });
  assert.deepEqual(parseDateCell('11/12/26', 'MDY'), { day: '2026-11-12', time: null });
  assert.deepEqual(parseDateCell(new Date(2026, 10, 12, 14, 10, 5)), { day: '2026-11-12', time: '14:10:05' });
});
test('parseDateCell: не дата', () => {
  for (const value of ['', null, undefined, 'вчера', '32.01.2026', '12.13.2026', '2026-02-30', -5, 0, 9999999]) {
    assert.equal(parseDateCell(value), null, String(value));
  }
});
test('guessDateOrder: по значениям больше 12', () => {
  assert.equal(guessDateOrder(['01/02/2026', '25/02/2026']), 'DMY');
  assert.equal(guessDateOrder(['01/02/2026', '02/25/2026']), 'MDY');
  assert.equal(guessDateOrder(['01/02/2026', '03/04/2026']), 'DMY', 'неоднозначно — день первым, как принято в русских выгрузках');
  assert.equal(guessDateOrder([46338, '2026-11-12']), 'DMY');
});

// ---------- структура файла ----------

test('detectHeaderRow: строка с названием отчёта пропускается', () => {
  assert.equal(detectHeaderRow([['Список расходов за период'], ['Дата', 'Категория', 'Сумма'], [46338, 'Еда', 100]]), 1);
  assert.equal(detectHeaderRow([['Дата', 'Сумма'], ['01.11.2026', 5]]), 0);
  assert.equal(detectHeaderRow([[], ['', ''], ['Дата', 'Сумма', 'Заметка']]), 2);
  assert.equal(detectHeaderRow([]), -1);
  assert.equal(detectHeaderRow([['одна ячейка']]), -1);
});
test('signature: не зависит от порядка колонок и регистра', () => {
  assert.equal(signature(['Дата', 'Сумма ', 'заметка']), signature(['ЗАМЕТКА', 'дата', 'сумма']));
  assert.notEqual(signature(['Дата', 'Сумма']), signature(['Дата', 'Сумма', 'Заметка']));
});

test('readWorkbook: листы xlsx с сырыми значениями', () => {
  const sheets = readWorkbook(XLSX, moneyManagerSample());
  assert.deepEqual(sheets.map((s) => [s.name, s.rows.length]), [['Расходы', 8], ['Доходы', 4], ['Переводы', 4]]);
  assert.deepEqual(sheets[0].rows[2].slice(0, 4), [46338, 'Такси', 'Карта А', 1550]);
  assert.equal(sheets[0].rows[4][10], 'Интернет');
});
test('readWorkbook: не xlsx — понятная ошибка', () => {
  assert.throws(() => readWorkbook(XLSX, new TextEncoder().encode('это не таблица')), /не удалось прочитать|не похож/i);
});
test('readCsv: один лист с именем файла', () => {
  const sheets = readCsv(new TextEncoder().encode('Дата;Сумма\n01.11.2026;5'), 'выписка.csv');
  assert.deepEqual(sheets, [{ name: 'выписка.csv', rows: [['Дата', 'Сумма'], ['01.11.2026', '5']] }]);
});

// ---------- профиль Money Manager ----------

test('matchProfile: выгрузка Money Manager распознаётся целиком', () => {
  const mappings = matchProfile(readWorkbook(XLSX, moneyManagerSample()), MONEY_MANAGER);
  assert.deepEqual(mappings.map((m) => [m.sheet, m.kind, m.headerRow]), [['Расходы', 'expense', 1], ['Доходы', 'income', 1], ['Переводы', 'transfer', 1]]);
  assert.deepEqual(mappings[0].columns, { date: 0, category: 1, account: 2, amount: 5, currency: 6, tags: 9, note: 10 });
  assert.deepEqual(mappings[2].columns, { date: 0, account: 1, to_account: 2, amount: 3, currency: 4, note: 7 });
});
test('matchProfile: чужой файл и файл с переставленными колонками', () => {
  assert.equal(matchProfile([{ name: 'Лист1', rows: [['Дата', 'Сумма'], ['01.11.2026', 5]] }], MONEY_MANAGER), null);
  const swapped = readWorkbook(XLSX, makeXlsx({
    'Расходы': [['Счет', 'Комментарий', 'Дата и время', 'Категория', 'Сумма в валюте счета', 'Валюта счета', 'Теги'],
      ['Карта А', 'обед', 46338, 'Еда', 1500, 'KZT', '']],
  }));
  const [mapping] = matchProfile(swapped, MONEY_MANAGER);
  assert.deepEqual([mapping.headerRow, mapping.columns.date, mapping.columns.amount, mapping.columns.account], [0, 2, 4, 0]);
});

test('buildDrafts: строки Money Manager превращаются в операции', () => {
  const sheets = readWorkbook(XLSX, moneyManagerSample());
  const { drafts, errors } = buildDrafts(sheets, matchProfile(sheets, MONEY_MANAGER));
  assert.deepEqual(errors, []);
  assert.equal(drafts.length, 10);
  assert.deepEqual(drafts[0], {
    sheet: 'Расходы', line: 3,
    draft: { date: '2026-11-12T12:00:00', amount: 155000, currency: 'KZT', type: 'expense', category: 'Такси', account: 'Карта А', to_account: '', note: '' },
  });
  assert.deepEqual(drafts[2].draft.amount, 594567, 'дробная сумма без ошибок округления');
  assert.equal(drafts[3].draft.note, 'Маме · семья', 'теги дописываются к комментарию');
  assert.deepEqual(drafts[6].draft, {
    date: '2026-11-06T12:00:00', amount: 70000062, currency: 'KZT', type: 'income', category: 'Зарплата', account: 'Карта Б', to_account: '', note: '',
  });
  assert.deepEqual(drafts[9].draft, {
    date: '2026-11-06T12:00:00', amount: 20000000, currency: 'KZT', type: 'transfer', category: '', account: 'Карта Б', to_account: 'Депозит', note: 'Накопления',
  });
});

// ---------- произвольный файл ----------

const custom = (rows) => [{ name: 'f.csv', rows }];
const map = (extra = {}) => [{
  sheet: 'f.csv', headerRow: 0, kind: 'expense', defaultAccount: 'Карта', defaultCurrency: 'KZT',
  columns: { date: 0, amount: 1, note: 2 }, ...extra,
}];

test('guessMapping: колонки угадываются по названиям', () => {
  const [m] = guessMapping(custom([['Date', 'Amount', 'Описание', 'Категория', 'Счёт', 'Валюта', 'Тип'], ['01.11.2026', '5', 'x', 'Еда', 'Карта', 'KZT', 'расход']]));
  assert.deepEqual(m.columns, { date: 0, amount: 1, note: 2, category: 3, account: 4, currency: 5, type: 6 });
  assert.equal(m.kind, 'column');
  const [plain] = guessMapping(custom([['Дата операции', 'Сумма', 'Комментарий'], ['01.11.2026', '-5', 'x']]));
  assert.deepEqual([plain.columns, plain.kind], [{ date: 0, amount: 1, note: 2 }, 'sign']);
  assert.equal(guessMapping([{ name: 'пустой', rows: [] }])[0].kind, 'skip');
});

test('buildDrafts: csv со строковыми суммами и датами, счёт и валюта по умолчанию', () => {
  const { drafts, errors } = buildDrafts(custom([['Дата', 'Сумма', 'Заметка'], ['12.11.2026 14:10', '1 500,50', 'обед'], ['', '', ''], ['13.11.2026', '200', '']]), map());
  assert.deepEqual(errors, []);
  assert.deepEqual(drafts.map((d) => [d.line, d.draft.date, d.draft.amount, d.draft.account, d.draft.currency, d.draft.note]), [
    [2, '2026-11-12T14:10:00', 150050, 'Карта', 'KZT', 'обед'], [4, '2026-11-13T12:00:00', 20000, 'Карта', 'KZT', ''],
  ]);
});
test('buildDrafts: тип по знаку суммы и по колонке', () => {
  const bySign = buildDrafts(custom([['Дата', 'Сумма', 'Заметка'], ['12.11.2026', '-1500', 'a'], ['12.11.2026', '2000', 'b']]), map({ kind: 'sign' }));
  assert.deepEqual(bySign.drafts.map((d) => [d.draft.type, d.draft.amount]), [['expense', 150000], ['income', 200000]]);
  const rows = [['Дата', 'Сумма', 'Заметка', 'Тип', 'Куда'], ['12.11.2026', '5', '', 'Расход', ''], ['12.11.2026', '5', '', 'income', ''],
    ['12.11.2026', '5', '', 'Перевод', 'Наличные'], ['12.11.2026', '5', '', 'подарок', '']];
  const byColumn = buildDrafts(custom(rows), map({ kind: 'column', columns: { date: 0, amount: 1, note: 2, type: 3, to_account: 4 } }));
  assert.deepEqual(byColumn.drafts.map((d) => d.draft.type), ['expense', 'income', 'transfer']);
  assert.deepEqual(byColumn.errors, [{ sheet: 'f.csv', line: 5, message: 'Не удалось определить тип: «подарок»' }]);
});
test('buildDrafts: ошибки по строкам с номером строки, остальные строки читаются', () => {
  const rows = [['Дата', 'Сумма', 'Заметка'], ['вчера', '5', ''], ['12.11.2026', 'много', ''], ['12.11.2026', '0', ''], ['12.11.2026', '7', 'ок']];
  const { drafts, errors } = buildDrafts(custom(rows), map());
  assert.deepEqual(errors, [
    { sheet: 'f.csv', line: 2, message: 'Не удалось прочитать дату: «вчера»' },
    { sheet: 'f.csv', line: 3, message: 'Не удалось прочитать сумму: «много»' },
    { sheet: 'f.csv', line: 4, message: 'Не удалось прочитать сумму: «0»' },
  ]);
  assert.deepEqual(drafts.map((d) => d.line), [5]);
  const noAccount = buildDrafts(custom([['Дата', 'Сумма', 'Заметка'], ['12.11.2026', '5', '']]), map({ defaultAccount: null }));
  assert.deepEqual(noAccount.errors.map((e) => e.message), ['Нет счёта']);
  const transfer = buildDrafts(custom([['Дата', 'Сумма', 'Заметка'], ['12.11.2026', '5', '']]), map({ kind: 'transfer' }));
  assert.deepEqual(transfer.errors.map((e) => e.message), ['Нет счёта зачисления']);
});
test('buildDrafts: лист с kind = skip пропускается, порядок дат ММ/ДД задаётся настройкой', () => {
  assert.deepEqual(buildDrafts(custom([['Дата', 'Сумма'], ['12.11.2026', '5']]), map({ kind: 'skip' })), { drafts: [], errors: [] });
  const us = buildDrafts(custom([['Дата', 'Сумма', 'Заметка'], ['11/25/2026', '5', '']]), map({ dateOrder: 'MDY' }));
  assert.equal(us.drafts[0].draft.date, '2026-11-25T12:00:00');
});

// ---------- отпечаток и дубли ----------

test('fingerprintOf: одинаковые строки дают одинаковый отпечаток, номер повтора их различает', () => {
  const draft = { date: '2026-11-06T12:00:00', amount: 708400, currency: 'KZT', type: 'expense', category: 'Рассрочка', account: 'Карта Б', to_account: '', note: '' };
  assert.equal(fingerprintOf(draft, 0), fingerprintOf({ ...draft, account: 'карта б ', category: 'РАССРОЧКА' }, 0));
  assert.notEqual(fingerprintOf(draft, 0), fingerprintOf(draft, 1));
  assert.notEqual(fingerprintOf(draft, 0), fingerprintOf({ ...draft, amount: 708401 }, 0));
  assert.notEqual(fingerprintOf(draft, 0), fingerprintOf({ ...draft, note: 'x' }, 0));
  assert.match(fingerprintOf(draft, 0), /^import:[0-9a-f]{14}:0$/);
});

async function importSample(db, now = NOW) {
  const sheets = readWorkbook(XLSX, moneyManagerSample());
  const { drafts, errors } = buildDrafts(sheets, matchProfile(sheets, MONEY_MANAGER));
  const plan = await planImport(db, drafts);
  return { plan, errors, report: await applyImport(db, plan, now) };
}

test('импорт Money Manager: операции, новые счета и категории', async () => {
  const db = await device();
  const { plan, report } = await importSample(db);
  assert.deepEqual([plan.total, plan.duplicates], [10, 0]);
  assert.deepEqual(report, { created: 10, duplicates: 0, categories: 4, accounts: 3 });

  const accounts = (await db.getAll('accounts')).filter((a) => !a.deleted);
  assert.deepEqual(accounts.map((a) => a.name).sort(), ['Депозит', 'Карта', 'Карта А', 'Карта Б', 'Наличные']);
  assert.deepEqual(accounts.find((a) => a.name === 'Депозит'), {
    ...accounts.find((a) => a.name === 'Депозит'), currency: 'KZT', initial_balance: 0, hidden: false, deleted: false, updated_at: NOW,
  });

  const categories = (await db.getAll('categories')).filter((c) => !c.deleted);
  const names = (type) => categories.filter((c) => c.type === type).map((c) => c.name);
  // «Еда», «Дом» и «Зарплата» уже были; «Перевод» создаётся отдельно для расходов и для доходов
  assert.deepEqual(names('expense').filter((n) => ['Такси', 'Перевод', 'Рассрочка', 'Еда', 'Дом'].includes(n)).sort(), ['Дом', 'Еда', 'Перевод', 'Рассрочка', 'Такси']);
  assert.deepEqual(names('income').filter((n) => ['Зарплата', 'Перевод'].includes(n)).sort(), ['Зарплата', 'Перевод']);
  assert.equal(categories.length, 13 + 4);

  const txs = await live(db);
  assert.equal(txs.length, 10);
  assert.ok(txs.every((t) => t.source === 'import' && t.status === 'ok' && t.fingerprint.startsWith('import:') && t.updated_at === NOW));
  const taxi = txs.find((t) => t.amount === 155000);
  assert.deepEqual([taxi.date, taxi.type, categories.find((c) => c.id === taxi.category_id).name, accounts.find((a) => a.id === taxi.account_id).name],
    ['2026-11-12T12:00:00', 'expense', 'Такси', 'Карта А']);
  const transfer = txs.find((t) => t.type === 'transfer' && t.amount === 20000000);
  assert.deepEqual([accounts.find((a) => a.id === transfer.account_id).name, accounts.find((a) => a.id === transfer.to_account_id).name, transfer.category_id],
    ['Карта Б', 'Депозит', null]);
  db.close();
});

test('повторный импорт того же файла не создаёт дублей', async () => {
  const db = await device();
  await importSample(db);
  const { plan, report } = await importSample(db, NOW + 1000);
  assert.deepEqual([plan.total, plan.duplicates, plan.transactions.length], [10, 10, 0]);
  assert.deepEqual(report, { created: 0, duplicates: 10, categories: 0, accounts: 0 });
  assert.equal((await live(db)).length, 10);
  assert.equal((await db.getAll('accounts')).length, 5);
  db.close();
});

test('две одинаковые строки в файле — две операции, при повторе обе узнаются', async () => {
  const db = await device();
  await importSample(db);
  const twins = (await live(db)).filter((t) => t.amount === 708400);
  assert.equal(twins.length, 2);
  assert.notEqual(twins[0].fingerprint, twins[1].fingerprint);
  db.close();
});

test('удалённая после импорта операция при повторном импорте не возвращается', async () => {
  const db = await device();
  await importSample(db);
  const [victim] = await live(db);
  await db.softDelete('transactions', victim.id, NOW + 5);
  const { report } = await importSample(db, NOW + 1000);
  assert.equal(report.created, 0);
  assert.equal((await live(db)).length, 9);
  db.close();
});

test('файл с новыми строками поверх старого: добавляются только новые', async () => {
  const db = await device();
  await importSample(db);
  const sheets = readWorkbook(XLSX, makeXlsx({
    'Расходы': [['Дата и время', 'Категория', 'Счет', 'Сумма в валюте счета', 'Валюта счета', 'Теги', 'Комментарий'],
      [46338, 'Такси', 'Карта А', 1550, 'KZT', '', ''],     // уже есть
      [46339, 'Такси', 'Карта А', 990, 'KZT', '', 'новая']],
  }));
  const { drafts } = buildDrafts(sheets, matchProfile(sheets, MONEY_MANAGER));
  const plan = await planImport(db, drafts);
  assert.deepEqual([plan.total, plan.duplicates, plan.transactions.length, plan.newCategories.length, plan.newAccounts.length], [2, 1, 1, 0, 0]);
  db.close();
});

test('планирование ничего не пишет; строка без категории идёт в «Проверить»', async () => {
  const db = await device();
  const { drafts } = buildDrafts(custom([['Дата', 'Сумма', 'Заметка'], ['12.11.2026', '500', 'без категории']]), map());
  const plan = await planImport(db, drafts);
  assert.equal((await live(db)).length, 0);
  assert.deepEqual([plan.transactions[0].category_id, plan.transactions[0].status, plan.newAccounts.length], [null, 'needs_review', 0]);
  await applyImport(db, plan, NOW);
  assert.equal((await live(db))[0].account_id, 'acc-card');
  db.close();
});

test('ручная операция с теми же данными дублем не считается', async () => {
  const db = await device();
  await db.put('transactions', newTransaction({ date: '2026-11-12T12:00:00', amount: 155000, category_id: 'cat-food', account_id: 'acc-card' }, NOW));
  const { report } = await importSample(db);
  assert.equal(report.created, 10);
  db.close();
});
