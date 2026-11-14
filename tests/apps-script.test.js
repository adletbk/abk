// Тесты протокола: настоящий apps-script/Code.gs поверх таблицы в памяти.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from './helpers/gas.js';

const tx = (extra = {}) => ({
  id: 'tx-1', date: '2026-11-13T14:10:05', amount: 845050, currency: 'KZT', type: 'expense',
  category_id: 'cat-food', category: 'Еда', account_id: 'acc-card', account: 'Карта',
  to_account_id: null, to_account: '', note: 'Магазин', source: 'applepay', fingerprint: '',
  status: 'ok', deleted: false, deleted_at: null, updated_at: 1000, ...extra,
});

// ---------- токен ----------

test('запрос без токена и с неверным токеном отклоняется для каждого действия', () => {
  const gas = createGas();
  for (const action of ['ping', 'add', 'upsert', 'pull', 'delete', 'нет такого']) {
    for (const token of [undefined, '', 'wrong', 'test-token ', 'test-toke']) {
      const res = gas.call({ action, text: 'x', source: 'sms', transactions: [tx()] }, token);
      assert.deepEqual([res.ok, res.error], [false, 'unauthorized'], `${action} / ${token}`);
    }
  }
  assert.equal(gas.sheets.size, 0, 'без токена таблица не трогается');
});

test('пока токен не задан в Script Properties, всё отклоняется', () => {
  const gas = createGas({ token: null });
  assert.equal(gas.call({ action: 'ping' }, 'что угодно').error, 'not_configured');
  assert.equal(gas.call({ action: 'ping' }, undefined).error, 'not_configured');
});

test('ответ всегда JSON с полем ok, даже на мусор в теле', () => {
  const gas = createGas();
  for (const body of ['', 'не json', '[]', 'null', '42', '{"token":"test-token"}']) {
    const { json, mime } = gas.post(body);
    assert.equal(json.ok, false, body);
    assert.equal(typeof json.error, 'string');
    assert.equal(mime, 'application/json');
  }
  assert.equal(gas.call({ action: 'нет такого' }).error, 'unknown_action');
  assert.equal(gas.context.doPost(undefined).content.includes('"ok":false'), true);
});

test('токен не попадает в ответы и журнал', () => {
  const gas = createGas({ token: 'очень-секретный-токен' });
  const raws = [
    gas.post(JSON.stringify({ token: 'очень-секретный-токен', action: 'ping' })).raw,
    gas.post(JSON.stringify({ token: 'очень-секретный-токен', action: 'нет' })).raw,
    gas.post(JSON.stringify({ token: 'неверный', action: 'ping' })).raw,
  ];
  assert.ok(raws.every((raw) => !raw.includes('секретный')));
  assert.ok(!gas.log().join('\n').includes('секретный'));
});

// ---------- ping и листы ----------

test('ping: проверка связи и токена', () => {
  const gas = createGas();
  const res = gas.call({ action: 'ping' });
  assert.deepEqual([res.ok, res.server_time, res.schema], [true, gas.now(), 1]);
});

test('первая запись создаёт листы с заголовками', () => {
  const gas = createGas();
  gas.call({ action: 'pull', since: 0 });
  assert.deepEqual([...gas.sheets.keys()].sort(),
    ['accounts', 'categories', 'inbox', 'templates', 'transactions', 'Сводка по месяцам'].sort());
  assert.deepEqual(gas.sheet('transactions').rows[0].slice(0, 13), [
    'Дата', 'Время', 'Месяц', 'Сумма', 'Валюта', 'Тип', 'Категория', 'Счёт', 'Счёт зачисления',
    'Заметка', 'Источник', 'Статус', 'Удалена',
  ]);
  assert.deepEqual(gas.sheet('transactions').rows[0].slice(13),
    ['id', 'category_id', 'account_id', 'to_account_id', 'fingerprint', 'updated_at', 'deleted_at', 'synced_at', 'key']);
  assert.equal(gas.sheet('transactions').frozen, 1);
  assert.equal(gas.props.get('SCHEMA_VERSION'), '1');
});

test('сводка по месяцам считается формулами, в листах данных формул нет', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx()] });
  const summary = gas.sheet('Сводка по месяцам');
  assert.ok(summary.formulas.length >= 4);
  assert.ok(summary.formulas.every((f) => f.formula.includes('transactions!')));
  for (const name of ['transactions', 'categories', 'accounts', 'templates', 'inbox']) {
    assert.deepEqual(gas.sheet(name).formulas, [], name);
  }
});

test('чужой лист с тем же именем не перезаписывается', () => {
  const gas = createGas();
  gas.context.SpreadsheetApp.getActiveSpreadsheet().insertSheet('transactions')
    .getRange(1, 1, 1, 2).setValues([['Мои', 'данные']]);
  const res = gas.call({ action: 'upsert', transactions: [tx()] });
  assert.deepEqual([res.ok, res.error], [false, 'schema_mismatch']);
  assert.deepEqual(gas.sheet('transactions').rows, [['Мои', 'данные']]);
});

// ---------- upsert ----------

test('upsert: строка операции читается человеком', () => {
  const gas = createGas();
  const res = gas.call({ action: 'upsert', transactions: [tx()] });
  assert.equal(res.ok, true);
  assert.deepEqual(res.results.transactions, { created: 1, updated: 0, skipped: 0, rejected: [], duplicates: [] });
  const [row] = gas.sheet('transactions').objects();
  assert.deepEqual({
    date: row['Дата'], time: row['Время'], month: row['Месяц'], amount: row['Сумма'], currency: row['Валюта'],
    type: row['Тип'], category: row['Категория'], account: row['Счёт'], to: row['Счёт зачисления'],
    note: row['Заметка'], source: row['Источник'], status: row['Статус'], deleted: row['Удалена'],
  }, {
    date: '2026-11-13', time: '14:10:05', month: '2026-11', amount: 8450.5, currency: 'KZT',
    type: 'Расход', category: 'Еда', account: 'Карта', to: '', note: 'Магазин', source: 'Apple Pay',
    status: 'ок', deleted: 'нет',
  });
  assert.equal(typeof row['Сумма'], 'number', 'сумма числом, без пробелов и символов');
  assert.deepEqual([row.id, row.category_id, row.account_id, row.key],
    ['tx-1', 'cat-food', 'acc-card', '2026-11|Расход|KZT|нет']);
  assert.equal(row.synced_at, String(gas.now()));
});

test('upsert: доход, перевод, статус «проверить»', () => {
  const gas = createGas();
  gas.call({
    action: 'upsert',
    transactions: [
      tx({ id: 'a', type: 'income', category: 'Зарплата', amount: 52000000, source: 'import' }),
      tx({ id: 'b', type: 'transfer', category_id: null, category: '', to_account_id: 'acc-cash', to_account: 'Наличные', source: 'manual' }),
      tx({ id: 'c', status: 'needs_review', source: 'notification' }),
    ],
  });
  const rows = gas.sheet('transactions').objects();
  assert.deepEqual(rows.map((r) => [r['Тип'], r['Сумма'], r['Источник'], r['Статус'], r['Счёт зачисления']]), [
    ['Доход', 520000, 'Импорт выписки', 'ок', ''],
    ['Перевод', 8450.5, 'Вручную', 'ок', 'Наличные'],
    ['Расход', 8450.5, 'Уведомление банка', 'проверить', ''],
  ]);
});

test('upsert: повторная отправка того же id не создаёт дубль', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx()] });
  gas.call({ action: 'upsert', transactions: [tx()] });
  const res = gas.call({ action: 'upsert', transactions: [tx({ note: 'Исправлено', updated_at: 2000 })] });
  assert.equal(res.results.transactions.updated, 1);
  const rows = gas.sheet('transactions').objects();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Заметка'], 'Исправлено');
});

test('upsert: один id дважды в одной пачке — одна строка', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx(), tx({ note: 'вторая', updated_at: 1500 })] });
  const rows = gas.sheet('transactions').objects();
  assert.deepEqual(rows.map((r) => r['Заметка']), ['вторая']);
});

test('upsert: устаревшая запись не затирает новую', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx({ note: 'новая', updated_at: 5000 })] });
  const res = gas.call({ action: 'upsert', transactions: [tx({ note: 'старая', updated_at: 4000 })] });
  assert.equal(res.results.transactions.skipped, 1);
  assert.equal(gas.sheet('transactions').objects()[0]['Заметка'], 'новая');
});

test('upsert: идемпотентность по fingerprint', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx({ id: 'first', fingerprint: 'fp-1' })] });
  const res = gas.call({
    action: 'upsert',
    transactions: [tx({ id: 'second', fingerprint: 'fp-1' }), tx({ id: 'third', fingerprint: 'fp-2' }), tx({ id: 'fourth', fingerprint: 'fp-2' })],
  });
  assert.deepEqual(res.results.transactions.duplicates, [{ id: 'second', existing_id: 'first' }, { id: 'fourth', existing_id: 'third' }]);
  assert.deepEqual(gas.sheet('transactions').objects().map((r) => r.id), ['first', 'third']);
  // та же операция с тем же id обновляется как обычно
  assert.equal(gas.call({ action: 'upsert', transactions: [tx({ id: 'first', fingerprint: 'fp-1', updated_at: 9000 })] }).results.transactions.updated, 1);
});

test('upsert: некорректные записи отклоняются по одной, остальные пишутся', () => {
  const gas = createGas();
  const res = gas.call({
    action: 'upsert',
    transactions: [
      tx({ id: 'ok' }),
      tx({ id: '' }),
      tx({ id: 'bad id!' }),
      tx({ id: 'bad-date', date: '13.11.2026' }),
      tx({ id: 'bad-amount', amount: 12.5 }),
      tx({ id: 'bad-type', type: 'gift' }),
      tx({ id: 'bad-time', updated_at: 'вчера' }),
      'не объект',
    ],
  });
  assert.equal(res.ok, true);
  assert.equal(res.results.transactions.created, 1);
  assert.equal(res.results.transactions.rejected.length, 7);
  assert.deepEqual(gas.sheet('transactions').objects().map((r) => r.id), ['ok']);
});

test('upsert: не массив и слишком большая пачка — bad_request', () => {
  const gas = createGas();
  assert.equal(gas.call({ action: 'upsert', transactions: 'x' }).error, 'bad_request');
  const many = Array.from({ length: 501 }, (_, i) => tx({ id: `t${i}` }));
  assert.equal(gas.call({ action: 'upsert', transactions: many }).error, 'bad_request');
  assert.equal(gas.sheet('transactions')?.objects().length ?? 0, 0);
});

test('защита от формул: значения с = + - @ пишутся с апострофом и читаются обратно как были', () => {
  const gas = createGas();
  const notes = ['=HYPERLINK("http://evil","x")', '+7 700 000', '-скидка', '@user', ' =не формула', 'обычная'];
  gas.call({
    action: 'upsert',
    transactions: notes.map((note, i) => tx({ id: `n${i}`, note, category: i === 0 ? '=cmd' : 'Еда' })),
    categories: [{ id: 'c1', name: '=SUM(1)', type: 'expense', icon: '@x', color: '#10B981', order: 0, hidden: false, deleted: false, deleted_at: null, updated_at: 1 }],
  });
  const raw = gas.sheet('transactions').rawObjects();
  assert.deepEqual(raw.map((r) => r['Заметка']),
    ["'=HYPERLINK(\"http://evil\",\"x\")", "'+7 700 000", "'-скидка", "'@user", ' =не формула', 'обычная']);
  assert.equal(raw[0]['Категория'], "'=cmd");
  assert.equal(gas.sheet('categories').rawObjects()[0]['Название'], "'=SUM(1)");
  assert.equal(gas.sheet('categories').rawObjects()[0]['Иконка'], "'@x");
  assert.deepEqual(gas.sheet('transactions').formulas, []);
  assert.deepEqual(gas.sheet('categories').formulas, []);

  gas.tick();
  const pulled = gas.call({ action: 'pull', since: 0 });
  assert.deepEqual(pulled.transactions.map((t) => t.note), notes);
  assert.equal(pulled.categories[0].name, '=SUM(1)');
});

test('защита от формул в inbox: текст уведомления', () => {
  const gas = createGas();
  gas.call({ action: 'add', text: '=IMPORTXML("http://evil")', source: 'notification' });
  assert.equal(gas.sheet('inbox').rawObjects()[0]['Текст'], "'=IMPORTXML(\"http://evil\")");
  assert.deepEqual(gas.sheet('inbox').formulas, []);
});

test('справочники: начальный остаток счёта не пишется, даже если клиент его прислал', () => {
  const gas = createGas();
  gas.call({
    action: 'upsert',
    accounts: [{ id: 'acc-card', name: 'Карта', currency: 'KZT', icon: 'wallet', order: 0, hidden: false, deleted: false, deleted_at: null, updated_at: 1, initial_balance: 250200000 }],
  });
  const sheet = gas.sheet('accounts');
  assert.ok(!sheet.rows[0].some((h) => /остат|balance/i.test(h)));
  assert.ok(!JSON.stringify(sheet.rows).includes('2502000'));
  assert.deepEqual(sheet.objects()[0]['Название'], 'Карта');
});

test('переименование категории и счёта обновляет названия в строках операций', () => {
  const gas = createGas();
  const category = { id: 'cat-food', name: 'Еда', type: 'expense', icon: 'cart', color: '#10B981', order: 0, hidden: false, deleted: false, deleted_at: null, updated_at: 1 };
  const account = { id: 'acc-card', name: 'Карта', currency: 'KZT', icon: 'wallet', order: 0, hidden: false, deleted: false, deleted_at: null, updated_at: 1 };
  gas.call({
    action: 'upsert', categories: [category], accounts: [account],
    transactions: [tx({ id: 'a' }), tx({ id: 'b', category_id: 'cat-other', category: 'Другое' }),
      tx({ id: 'c', type: 'transfer', category_id: null, category: '', account_id: 'acc-cash', account: 'Наличные', to_account_id: 'acc-card', to_account: 'Карта' })],
  });
  gas.call({
    action: 'upsert',
    categories: [{ ...category, name: 'Продукты', updated_at: 2 }],
    accounts: [{ ...account, name: 'Kaspi', updated_at: 2 }],
  });
  const rows = gas.sheet('transactions').objects();
  assert.deepEqual(rows.map((r) => [r['Категория'], r['Счёт'], r['Счёт зачисления']]),
    [['Продукты', 'Kaspi', ''], ['Другое', 'Kaspi', ''], ['', 'Наличные', 'Kaspi']]);
});

// ---------- delete ----------

test('delete: мягкое удаление, строка остаётся с пометкой', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx({ id: 'a' }), tx({ id: 'b' })] });
  gas.tick();
  const res = gas.call({ action: 'delete', store: 'transactions', ids: ['a', 'missing-id'], deleted_at: 7000 });
  assert.deepEqual([res.ok, res.deleted, res.missing], [true, 1, ['missing-id']]);
  const rows = gas.sheet('transactions').objects();
  assert.equal(rows.length, 2, 'физически строки не удаляются');
  assert.deepEqual([rows[0]['Удалена'], rows[0].deleted_at, rows[0].updated_at, rows[0].key],
    ['да', '7000', '7000', '2026-11|Расход|KZT|да']);
  assert.equal(rows[0].synced_at, String(gas.now()));
  assert.equal(rows[1]['Удалена'], 'нет');
  assert.equal(gas.call({ action: 'delete', store: 'нет', ids: ['a'] }).error, 'bad_request');
  assert.equal(gas.call({ action: 'delete', store: 'transactions', ids: ['плохой id'] }).error, 'bad_request');
  assert.equal(gas.call({ action: 'delete', store: 'inbox', ids: ['a'] }).error, 'bad_request');
});

test('upsert с deleted: true тоже помечает строку удалённой', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx()] });
  gas.call({ action: 'upsert', transactions: [tx({ deleted: true, deleted_at: 3000, updated_at: 3000 })] });
  const [row] = gas.sheet('transactions').objects();
  assert.deepEqual([row['Удалена'], row.deleted_at], ['да', '3000']);
});

// ---------- add и inbox ----------

test('add: сырая запись попадает в inbox со статусом new', () => {
  const gas = createGas();
  const res = gas.call({ action: 'add', text: 'Покупка 4 500 ₸ Magnum', source: 'notification', time: '2026-11-13T14:10:00' });
  assert.equal(res.ok, true);
  assert.equal(res.duplicate, false);
  assert.match(res.id, /^[\w-]{8,}$/);
  const [row] = gas.sheet('inbox').objects();
  assert.deepEqual([row['Источник'], row['Текст'], row['Статус'], row['Время события'], row.id],
    ['notification', 'Покупка 4 500 ₸ Magnum', 'new', '2026-11-13T14:10:00', res.id]);
});

test('add: Apple Pay шлёт поля в payload, они сохраняются как JSON', () => {
  const gas = createGas();
  gas.call({ action: 'add', source: 'applepay', text: 'Magnum 4500', payload: { amount: '4 500 ₸', merchant: 'Magnum', card: 'Kaspi Gold' } });
  assert.deepEqual(JSON.parse(gas.sheet('inbox').objects()[0].payload), { amount: '4 500 ₸', merchant: 'Magnum', card: 'Kaspi Gold' });
});

test('add: повтор той же записи (тот же id или тот же текст и время) не создаёт дубль', () => {
  const gas = createGas();
  const body = { action: 'add', text: 'Покупка 4 500 ₸', source: 'notification', time: '2026-11-13T14:10:00' };
  const first = gas.call(body);
  const second = gas.call(body);
  assert.deepEqual([second.duplicate, second.id], [true, first.id]);
  gas.call({ ...body, id: 'my-id', text: 'другая' });
  assert.equal(gas.call({ ...body, id: 'my-id', text: 'другая' }).duplicate, true);
  assert.equal(gas.sheet('inbox').objects().length, 2);
  // без времени события дедупликации по содержимому нет: две одинаковые покупки подряд возможны
  gas.call({ action: 'add', text: 'Кофе 900', source: 'sms' });
  gas.call({ action: 'add', text: 'Кофе 900', source: 'sms' });
  assert.equal(gas.sheet('inbox').objects().length, 4);
});

test('add: пустой текст, неизвестный источник и слишком длинный текст', () => {
  const gas = createGas();
  assert.equal(gas.call({ action: 'add', text: '   ', source: 'sms' }).error, 'bad_request');
  assert.equal(gas.call({ action: 'add', text: 'x', source: 'telegram' }).error, 'bad_request');
  assert.equal(gas.call({ action: 'add', text: 'x'.repeat(4001), source: 'sms' }).error, 'bad_request');
  assert.equal(gas.sheet('inbox')?.objects().length ?? 0, 0);
});

// ---------- pull ----------

test('pull: только изменённое после метки', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx({ id: 'old' })] });
  const mark = gas.now();
  gas.tick();
  gas.call({ action: 'upsert', transactions: [tx({ id: 'new', note: 'свежая' })] });
  gas.tick();
  const res = gas.call({ action: 'pull', since: mark });
  assert.equal(res.server_time, gas.now());
  assert.deepEqual(res.transactions.map((t) => t.id), ['new']);
  assert.deepEqual(res.transactions[0], tx({ id: 'new', note: 'свежая' }));
  assert.deepEqual(gas.call({ action: 'pull', since: 0 }).transactions.map((t) => t.id), ['old', 'new']);
  assert.deepEqual(gas.call({ action: 'pull', since: gas.now() }).transactions, []);
});

test('pull: inbox только со статусом new, после подтверждения не возвращается', () => {
  const gas = createGas();
  const a = gas.call({ action: 'add', text: 'первая', source: 'sms', time: '2026-11-13T10:00:00' });
  const b = gas.call({ action: 'add', text: 'вторая', source: 'applepay', payload: { merchant: 'M' } });
  let res = gas.call({ action: 'pull', since: 0 });
  assert.deepEqual(res.inbox.map((i) => [i.id, i.text, i.source, i.status]), [[a.id, 'первая', 'sms', 'new'], [b.id, 'вторая', 'applepay', 'new']]);
  assert.deepEqual(res.inbox[1].payload, { merchant: 'M' });
  assert.equal(res.inbox[0].time, '2026-11-13T10:00:00');

  const ack = gas.call({ action: 'upsert', inbox: [{ id: a.id, status: 'fetched' }, { id: 'неизвестный', status: 'fetched' }, { id: b.id, status: 'плохой' }] });
  assert.deepEqual([ack.results.inbox.updated, ack.results.inbox.rejected.length], [1, 2]);
  res = gas.call({ action: 'pull', since: gas.now() });
  assert.deepEqual(res.inbox.map((i) => i.id), [b.id], 'inbox отдаётся независимо от метки времени');
  assert.equal(gas.sheet('inbox').objects()[0]['Текст'], 'первая', 'текст при подтверждении не теряется');
});

test('pull: справочники и шаблоны', () => {
  const gas = createGas();
  const category = { id: 'c', name: 'Еда', type: 'expense', icon: 'cart', color: '#10B981', order: 2, hidden: true, deleted: false, deleted_at: null, updated_at: 5 };
  const account = { id: 'a', name: 'Карта', currency: 'KZT', icon: 'wallet', order: 0, hidden: false, deleted: false, deleted_at: null, updated_at: 6 };
  const template = { id: 't', name: 'Кофе', type: 'expense', amount: 150000, currency: 'KZT', category_id: 'c', category: 'Еда', account_id: 'a', account: 'Карта', to_account_id: null, to_account: '', note: 'Латте', deleted: false, deleted_at: null, updated_at: 7 };
  gas.call({ action: 'upsert', categories: [category], accounts: [account], templates: [template] });
  const res = gas.call({ action: 'pull', since: 0 });
  assert.deepEqual(res.categories, [category]);
  assert.deepEqual(res.accounts, [account]);
  assert.deepEqual(res.templates, [template]);
  assert.equal(gas.call({ action: 'pull', since: 'вчера' }).error, 'bad_request');
});

// ---------- блокировка ----------

test('запись идёт под LockService, блокировка снимается и при ошибке', () => {
  const gas = createGas();
  gas.call({ action: 'upsert', transactions: [tx()] });
  gas.call({ action: 'add', text: 'x', source: 'sms' });
  gas.call({ action: 'delete', store: 'transactions', ids: ['tx-1'] });
  assert.equal(gas.locks.acquired, 3);
  assert.equal(gas.locks.released, 3);
  gas.call({ action: 'upsert', transactions: 'ошибка' });
  gas.call({ action: 'ping' });
  assert.equal(gas.locks.held, false);
  assert.equal(gas.locks.acquired, gas.locks.released);
});

test('занятая блокировка: понятная ошибка busy, данные не пишутся', () => {
  const gas = createGas();
  gas.locks.failNext = true;
  const res = gas.call({ action: 'upsert', transactions: [tx()] });
  assert.deepEqual([res.ok, res.error], [false, 'busy']);
  assert.equal(gas.sheet('transactions')?.objects().length ?? 0, 0);
});

// ---------- установка ----------

test('setup(): создаёт листы и токен, повторный запуск токен не меняет', () => {
  const gas = createGas({ token: null });
  gas.context.setup();
  const token = gas.props.get('TOKEN');
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.ok(gas.sheets.has('transactions'));
  assert.equal(gas.call({ action: 'ping' }, token).ok, true);
  gas.context.setup();
  assert.equal(gas.props.get('TOKEN'), token);
  gas.context.resetToken();
  assert.notEqual(gas.props.get('TOKEN'), token);
  assert.equal(gas.call({ action: 'ping' }, token).error, 'unauthorized');
});

test('doGet: подсказка вместо данных', () => {
  const gas = createGas();
  const out = JSON.parse(gas.context.doGet({ parameter: { token: 'test-token' } }).content);
  assert.equal(out.ok, false);
});
