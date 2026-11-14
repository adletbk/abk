/**
 * Финансы: web app для личной Google Таблицы.
 *
 * Установка описана в docs/setup-google.md. Коротко: откройте таблицу → Расширения →
 * Apps Script, вставьте этот файл, выполните функцию setup(), затем разверните как
 * веб-приложение с доступом «Все».
 *
 * Токен хранится только в свойствах скрипта (Script Properties, ключ TOKEN).
 * В этом файле токена нет и быть не должно.
 *
 * Имена листов и колонок менять нельзя: на них опираются формулы сводки и приложение.
 * Если схему нужно изменить, увеличьте SCHEMA_VERSION и добавьте миграцию.
 */

var SCHEMA_VERSION = 1;
var MAX_BODY_BYTES = 2 * 1024 * 1024;
var MAX_BATCH = 500;
var MAX_TEXT = 4000;
var LOCK_WAIT_MS = 20000;
var SUMMARY_SHEET = 'Сводка по месяцам';
var SUMMARY_CURRENCY = 'KZT';

var TYPE_LABELS = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };
var SOURCE_LABELS = {
  manual: 'Вручную', applepay: 'Apple Pay', notification: 'Уведомление банка',
  import: 'Импорт выписки', sms: 'SMS',
};
var STATUS_LABELS = { ok: 'ок', needs_review: 'проверить' };
var INBOX_SOURCES = ['applepay', 'notification', 'sms'];
var INBOX_STATUSES = ['new', 'fetched', 'done', 'needs_review'];
var YES = 'да';
var NO = 'нет';

// ---------- схема листов ----------

var DEFS = {
  transactions: {
    columns: ['Дата', 'Время', 'Месяц', 'Сумма', 'Валюта', 'Тип', 'Категория', 'Счёт', 'Счёт зачисления',
      'Заметка', 'Источник', 'Статус', 'Удалена',
      'id', 'category_id', 'account_id', 'to_account_id', 'fingerprint', 'updated_at', 'deleted_at', 'synced_at', 'key'],
    numeric: ['Сумма'],
    deletedColumn: 'Удалена',
    validate: function (r) {
      return isId(r.id) && isTime(r.updated_at)
        && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(r.date)
        && isAmount(r.amount) && isCurrency(r.currency) && has(TYPE_LABELS, r.type)
        && has(SOURCE_LABELS, r.source) && has(STATUS_LABELS, r.status || 'ok')
        && isOptionalId(r.category_id) && isId(r.account_id) && isOptionalId(r.to_account_id)
        && isText(r.note, 2000) && isText(r.category, 200) && isText(r.account, 200) && isText(r.to_account, 200)
        && isText(r.fingerprint, 200);
    },
    toRow: function (r, now) {
      var day = r.date.slice(0, 10);
      var type = TYPE_LABELS[r.type];
      var deleted = r.deleted ? YES : NO;
      return {
        'Дата': day, 'Время': (r.date.slice(11) + ':00').slice(0, 8), 'Месяц': day.slice(0, 7),
        'Сумма': r.amount / 100, 'Валюта': r.currency, 'Тип': type,
        'Категория': r.category || '', 'Счёт': r.account || '', 'Счёт зачисления': r.to_account || '',
        'Заметка': r.note || '', 'Источник': SOURCE_LABELS[r.source], 'Статус': STATUS_LABELS[r.status || 'ok'],
        'Удалена': deleted,
        id: r.id, category_id: r.category_id || '', account_id: r.account_id, to_account_id: r.to_account_id || '',
        fingerprint: r.fingerprint || '', updated_at: r.updated_at, deleted_at: r.deleted_at || '', synced_at: now,
        key: summaryKey(day.slice(0, 7), type, r.currency, deleted),
      };
    },
    fromRow: function (o) {
      return {
        id: text(o.id), date: text(o['Дата']) + 'T' + text(o['Время']),
        amount: Math.round(Number(o['Сумма']) * 100), currency: text(o['Валюта']),
        type: reverse(TYPE_LABELS, o['Тип']),
        category_id: orNull(o.category_id), category: text(o['Категория']),
        account_id: text(o.account_id), account: text(o['Счёт']),
        to_account_id: orNull(o.to_account_id), to_account: text(o['Счёт зачисления']),
        note: text(o['Заметка']), source: reverse(SOURCE_LABELS, o['Источник']),
        fingerprint: text(o.fingerprint), status: reverse(STATUS_LABELS, o['Статус']),
        deleted: o['Удалена'] === YES, deleted_at: numOrNull(o.deleted_at), updated_at: Number(o.updated_at),
      };
    },
  },

  categories: {
    columns: ['Название', 'Тип', 'Иконка', 'Цвет', 'Порядок', 'Скрыта', 'Удалена', 'id', 'updated_at', 'deleted_at', 'synced_at'],
    numeric: [],
    deletedColumn: 'Удалена',
    validate: function (r) {
      return isId(r.id) && isTime(r.updated_at) && isName(r.name) && (r.type === 'expense' || r.type === 'income')
        && isText(r.icon, 40) && isText(r.color, 20);
    },
    toRow: function (r, now) {
      return {
        'Название': r.name, 'Тип': TYPE_LABELS[r.type], 'Иконка': r.icon || '', 'Цвет': r.color || '',
        'Порядок': Number(r.order) || 0, 'Скрыта': r.hidden ? YES : NO, 'Удалена': r.deleted ? YES : NO,
        id: r.id, updated_at: r.updated_at, deleted_at: r.deleted_at || '', synced_at: now,
      };
    },
    fromRow: function (o) {
      return {
        id: text(o.id), name: text(o['Название']), type: reverse(TYPE_LABELS, o['Тип']), icon: text(o['Иконка']),
        color: text(o['Цвет']), order: Number(o['Порядок']) || 0, hidden: o['Скрыта'] === YES,
        deleted: o['Удалена'] === YES, deleted_at: numOrNull(o.deleted_at), updated_at: Number(o.updated_at),
      };
    },
  },

  // Начальный остаток счёта сюда не пишется: он хранится только на устройстве.
  accounts: {
    columns: ['Название', 'Валюта', 'Иконка', 'Порядок', 'Скрыт', 'Удалён', 'id', 'updated_at', 'deleted_at', 'synced_at'],
    numeric: [],
    deletedColumn: 'Удалён',
    validate: function (r) {
      return isId(r.id) && isTime(r.updated_at) && isName(r.name) && isCurrency(r.currency) && isText(r.icon, 40);
    },
    toRow: function (r, now) {
      return {
        'Название': r.name, 'Валюта': r.currency, 'Иконка': r.icon || '', 'Порядок': Number(r.order) || 0,
        'Скрыт': r.hidden ? YES : NO, 'Удалён': r.deleted ? YES : NO,
        id: r.id, updated_at: r.updated_at, deleted_at: r.deleted_at || '', synced_at: now,
      };
    },
    fromRow: function (o) {
      return {
        id: text(o.id), name: text(o['Название']), currency: text(o['Валюта']), icon: text(o['Иконка']),
        order: Number(o['Порядок']) || 0, hidden: o['Скрыт'] === YES,
        deleted: o['Удалён'] === YES, deleted_at: numOrNull(o.deleted_at), updated_at: Number(o.updated_at),
      };
    },
  },

  templates: {
    columns: ['Название', 'Тип', 'Сумма', 'Валюта', 'Категория', 'Счёт', 'Счёт зачисления', 'Заметка', 'Удалён',
      'id', 'category_id', 'account_id', 'to_account_id', 'updated_at', 'deleted_at', 'synced_at'],
    numeric: ['Сумма'],
    deletedColumn: 'Удалён',
    validate: function (r) {
      return isId(r.id) && isTime(r.updated_at) && isName(r.name) && has(TYPE_LABELS, r.type)
        && isAmount(r.amount || 0) && isCurrency(r.currency || 'KZT')
        && isOptionalId(r.category_id) && isOptionalId(r.account_id) && isOptionalId(r.to_account_id)
        && isText(r.note, 2000) && isText(r.category, 200) && isText(r.account, 200) && isText(r.to_account, 200);
    },
    toRow: function (r, now) {
      return {
        'Название': r.name, 'Тип': TYPE_LABELS[r.type], 'Сумма': (r.amount || 0) / 100, 'Валюта': r.currency || 'KZT',
        'Категория': r.category || '', 'Счёт': r.account || '', 'Счёт зачисления': r.to_account || '',
        'Заметка': r.note || '', 'Удалён': r.deleted ? YES : NO,
        id: r.id, category_id: r.category_id || '', account_id: r.account_id || '', to_account_id: r.to_account_id || '',
        updated_at: r.updated_at, deleted_at: r.deleted_at || '', synced_at: now,
      };
    },
    fromRow: function (o) {
      return {
        id: text(o.id), name: text(o['Название']), type: reverse(TYPE_LABELS, o['Тип']),
        amount: Math.round(Number(o['Сумма']) * 100), currency: text(o['Валюта']),
        category_id: orNull(o.category_id), category: text(o['Категория']),
        account_id: orNull(o.account_id), account: text(o['Счёт']),
        to_account_id: orNull(o.to_account_id), to_account: text(o['Счёт зачисления']),
        note: text(o['Заметка']), deleted: o['Удалён'] === YES,
        deleted_at: numOrNull(o.deleted_at), updated_at: Number(o.updated_at),
      };
    },
  },

  inbox: {
    columns: ['Получено', 'Источник', 'Текст', 'Статус', 'Время события', 'id', 'fingerprint', 'payload', 'processed_at'],
    numeric: [],
  },
};

var UPSERT_ORDER = ['categories', 'accounts', 'templates', 'transactions'];

// ---------- вход ----------

function doPost(e) {
  return respond(handle(e));
}

function doGet() {
  return respond(failure('bad_request', 'Используйте POST с JSON в теле запроса.'));
}

function respond(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function failure(code, message) {
  return { ok: false, error: code, message: message || code };
}

/** Ошибка с кодом протокола. */
function ApiError(code, message) {
  this.code = code;
  this.message = message || code;
}

function handle(e) {
  try {
    var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!expected) return failure('not_configured', 'Токен не задан. Выполните функцию setup() в редакторе Apps Script.');

    var body = parseBody(e);
    if (!body) return failure('bad_request', 'Тело запроса должно быть JSON-объектом.');
    if (!safeEqual(body.token, expected)) return failure('unauthorized', 'Неверный токен.');

    var now = Date.now();
    switch (body.action) {
      case 'ping': return { ok: true, server_time: now, schema: SCHEMA_VERSION };
      case 'add': return withLock(function () { return actionAdd(body, now); });
      case 'upsert': return withLock(function () { return actionUpsert(body, now); });
      case 'pull': return withLock(function () { return actionPull(body, now); });
      case 'delete': return withLock(function () { return actionDelete(body, now); });
      default: return failure('unknown_action', 'Неизвестное действие.');
    }
  } catch (err) {
    if (err instanceof ApiError) return failure(err.code, err.message);
    return failure('internal', String((err && err.message) || err));
  }
}

function parseBody(e) {
  var contents = e && e.postData && e.postData.contents;
  if (typeof contents !== 'string' || contents.length === 0 || contents.length > MAX_BODY_BYTES) return null;
  try {
    var body = JSON.parse(contents);
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch (err) {
    return null;
  }
}

/** Сравнение без раннего выхода: время не зависит от того, где строки расходятся. */
function safeEqual(given, expected) {
  if (typeof given !== 'string') return false;
  var diff = given.length ^ expected.length;
  for (var i = 0; i < expected.length; i++) {
    diff |= (given.charCodeAt(i % (given.length || 1)) || 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_WAIT_MS);
  } catch (err) {
    throw new ApiError('busy', 'Таблица занята другой записью. Повторите позже.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- действия ----------

/** add: сырая запись от Команд iOS в лист inbox. */
function actionAdd(body, now) {
  var source = body.source;
  var payload = body.payload !== null && typeof body.payload === 'object' ? JSON.stringify(body.payload) : '';
  var rawText = typeof body.text === 'string' ? body.text.trim() : '';
  var time = typeof body.time === 'string' ? body.time.trim() : '';
  if (INBOX_SOURCES.indexOf(source) === -1) throw new ApiError('bad_request', 'Неизвестный источник.');
  if (!rawText && !payload) throw new ApiError('bad_request', 'Пустой текст.');
  if (rawText.length > MAX_TEXT || payload.length > MAX_TEXT || time.length > 40) throw new ApiError('bad_request', 'Слишком длинная запись.');
  if (body.id !== undefined && !isId(body.id)) throw new ApiError('bad_request', 'Некорректный id.');

  var sheets = ensureSheets();
  var table = readTable(sheets.inbox, DEFS.inbox);
  var fingerprint = time ? sha256(source + '\n' + rawText + '\n' + payload + '\n' + time) : '';
  for (var i = 0; i < table.objects.length; i++) {
    var row = table.objects[i];
    if ((body.id && row.id === body.id) || (fingerprint && row.fingerprint === fingerprint)) {
      return { ok: true, id: text(row.id), duplicate: true };
    }
  }
  var id = body.id || Utilities.getUuid();
  appendRows(sheets.inbox, DEFS.inbox, [{
    'Получено': new Date(now).toISOString(), 'Источник': source, 'Текст': rawText, 'Статус': 'new',
    'Время события': time, id: id, fingerprint: fingerprint, payload: payload, processed_at: '',
  }]);
  return { ok: true, id: id, duplicate: false };
}

/** upsert: создать или обновить записи пачкой. */
function actionUpsert(body, now) {
  var stores = UPSERT_ORDER.concat(['inbox']);
  for (var s = 0; s < stores.length; s++) {
    var list = body[stores[s]];
    if (list !== undefined && (!Array.isArray(list) || list.length > MAX_BATCH)) {
      throw new ApiError('bad_request', 'Поле ' + stores[s] + ' должно быть массивом не длиннее ' + MAX_BATCH + '.');
    }
  }
  var sheets = ensureSheets();
  var results = {};
  var renamed = { categories: {}, accounts: {} };
  for (var i = 0; i < UPSERT_ORDER.length; i++) {
    var name = UPSERT_ORDER[i];
    if (body[name] === undefined) continue;
    results[name] = upsertStore(sheets[name], DEFS[name], name, body[name], now, renamed);
  }
  if (Object.keys(renamed.categories).length || Object.keys(renamed.accounts).length) {
    refreshNames(sheets.transactions, renamed);
  }
  if (body.inbox !== undefined) results.inbox = updateInboxStatuses(sheets.inbox, body.inbox, now);
  return { ok: true, server_time: now, results: results };
}

function upsertStore(sheet, def, name, records, now, renamed) {
  var result = { created: 0, updated: 0, skipped: 0, rejected: [], duplicates: [] };
  var table = readTable(sheet, def);
  var byId = {};
  var byFingerprint = {};
  table.objects.forEach(function (row, index) {
    byId[text(row.id)] = { index: index, row: row };
    if (row.fingerprint) byFingerprint[text(row.fingerprint)] = text(row.id);
  });
  var dirty = {};      // индекс существующей строки → новый объект строки
  var created = [];    // новые объекты строк по порядку
  var createdById = {};

  records.forEach(function (record) {
    if (record === null || typeof record !== 'object' || !def.validate(record)) {
      result.rejected.push({ id: record && typeof record.id === 'string' ? record.id : null, reason: 'invalid' });
      return;
    }
    var existing = byId[record.id];
    var pending = createdById[record.id];
    var current = existing ? (dirty[existing.index] || existing.row) : pending;
    if (current) {
      // Более старая или та же самая версия: ничего не пишем (повторная отправка безвредна).
      if (Number(current.updated_at) >= record.updated_at) { result.skipped++; return; }
      var next = def.toRow(record, now);
      trackRename(name, current, next, renamed);
      if (existing) dirty[existing.index] = next; else replaceCreated(created, createdById, record.id, next);
      result.updated += pending && !existing ? 0 : 1;
      return;
    }
    if (name === 'transactions' && record.fingerprint && byFingerprint[record.fingerprint]) {
      result.duplicates.push({ id: record.id, existing_id: byFingerprint[record.fingerprint] });
      return;
    }
    var row = def.toRow(record, now);
    created.push(row);
    createdById[record.id] = row;
    if (record.fingerprint) byFingerprint[record.fingerprint] = record.id;
    result.created++;
  });

  Object.keys(dirty).forEach(function (index) { writeRow(sheet, def, Number(index) + 2, dirty[index]); });
  appendRows(sheet, def, created);
  return result;
}

function replaceCreated(created, createdById, id, next) {
  created[created.indexOf(createdById[id])] = next;
  createdById[id] = next;
}

function trackRename(name, before, after, renamed) {
  if ((name === 'categories' || name === 'accounts') && text(before['Название']) !== after['Название']) {
    renamed[name][after.id] = after['Название'];
  }
}

/** После переименования категории или счёта обновляет названия в уже записанных операциях. */
function refreshNames(sheet, renamed) {
  var def = DEFS.transactions;
  var table = readTable(sheet, def);
  table.objects.forEach(function (row, index) {
    var changed = false;
    if (has(renamed.categories, row.category_id)) { row['Категория'] = renamed.categories[row.category_id]; changed = true; }
    if (has(renamed.accounts, row.account_id)) { row['Счёт'] = renamed.accounts[row.account_id]; changed = true; }
    if (has(renamed.accounts, row.to_account_id)) { row['Счёт зачисления'] = renamed.accounts[row.to_account_id]; changed = true; }
    if (changed) writeRow(sheet, def, index + 2, row);
  });
}

/** Подтверждение обработки записей inbox: меняется только статус. */
function updateInboxStatuses(sheet, updates, now) {
  var def = DEFS.inbox;
  var result = { created: 0, updated: 0, skipped: 0, rejected: [], duplicates: [] };
  var table = readTable(sheet, def);
  var byId = {};
  table.objects.forEach(function (row, index) { byId[text(row.id)] = index; });
  updates.forEach(function (update) {
    var valid = update !== null && typeof update === 'object' && isId(update.id)
      && INBOX_STATUSES.indexOf(update.status) !== -1 && has(byId, update.id);
    if (!valid) {
      result.rejected.push({ id: update && typeof update.id === 'string' ? update.id : null, reason: 'invalid' });
      return;
    }
    var row = table.objects[byId[update.id]];
    row['Статус'] = update.status;
    row.processed_at = now;
    writeRow(sheet, def, byId[update.id] + 2, row);
    result.updated++;
  });
  return result;
}

/** pull: изменения после метки времени и необработанные записи inbox. */
function actionPull(body, now) {
  var since = body.since === undefined ? 0 : body.since;
  if (typeof since !== 'number' || !isFinite(since) || since < 0) throw new ApiError('bad_request', 'since должно быть числом.');
  var sheets = ensureSheets();
  var out = { ok: true, server_time: now };
  UPSERT_ORDER.forEach(function (name) {
    var def = DEFS[name];
    out[name] = readTable(sheets[name], def).objects
      .filter(function (row) { return row.id !== '' && Number(row.synced_at) > since; })
      .map(def.fromRow);
  });
  out.inbox = readTable(sheets.inbox, DEFS.inbox).objects
    .filter(function (row) { return row['Статус'] === 'new'; })
    .map(function (row) {
      return {
        id: text(row.id), text: text(row['Текст']), source: text(row['Источник']), status: 'new',
        time: text(row['Время события']) || null, received_at: text(row['Получено']), payload: parseJson(row.payload),
      };
    });
  return out;
}

/** delete: мягкое удаление по id. Строки остаются в таблице с пометкой. */
function actionDelete(body, now) {
  var def = DEFS[body.store];
  if (!def || !def.deletedColumn || !Array.isArray(body.ids) || body.ids.length > MAX_BATCH || !body.ids.every(isId)) {
    throw new ApiError('bad_request', 'Нужны store и массив ids.');
  }
  var deletedAt = isTime(body.deleted_at) ? body.deleted_at : now;
  var sheet = ensureSheets()[body.store];
  var table = readTable(sheet, def);
  var byId = {};
  table.objects.forEach(function (row, index) { byId[text(row.id)] = index; });
  var missing = [];
  var deleted = 0;
  body.ids.forEach(function (id) {
    if (!has(byId, id)) { missing.push(id); return; }
    var row = table.objects[byId[id]];
    row[def.deletedColumn] = YES;
    row.deleted_at = deletedAt;
    row.updated_at = deletedAt;
    row.synced_at = now;
    if (has(row, 'key')) row.key = summaryKey(row['Месяц'], row['Тип'], row['Валюта'], YES);
    writeRow(sheet, def, byId[id] + 2, row);
    deleted++;
  });
  return { ok: true, deleted: deleted, missing: missing };
}

// ---------- работа с листами ----------

/** Создаёт недостающие листы с заголовками. Чужой лист с тем же именем не трогает. */
function ensureSheets() {
  var props = PropertiesService.getScriptProperties();
  var stored = Number(props.getProperty('SCHEMA_VERSION') || 0);
  if (stored > SCHEMA_VERSION) {
    throw new ApiError('schema_mismatch', 'Таблица создана более новой версией скрипта. Обновите Code.gs.');
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = {};
  // Сначала проверяем все листы и только потом что-то создаём.
  Object.keys(DEFS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 0) {
      var def = DEFS[name];
      var header = sheet.getRange(1, 1, 1, def.columns.length).getValues()[0];
      var same = def.columns.every(function (column, i) { return text(header[i]) === column; });
      if (!same) {
        throw new ApiError('schema_mismatch', 'Лист «' + name + '» уже есть и его заголовки не совпадают с ожидаемыми. Переименуйте этот лист.');
      }
    }
    sheets[name] = sheet;
  });
  Object.keys(DEFS).forEach(function (name) {
    var def = DEFS[name];
    var sheet = sheets[name] || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      formatColumns(sheet, def, 1, 1);
      sheet.getRange(1, 1, 1, def.columns.length).setValues([def.columns]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    sheets[name] = sheet;
  });
  if (!ss.getSheetByName(SUMMARY_SHEET)) createSummary(ss.insertSheet(SUMMARY_SHEET));
  if (stored !== SCHEMA_VERSION) props.setProperty('SCHEMA_VERSION', String(SCHEMA_VERSION));
  return sheets;
}

/**
 * Сводка считается формулами и пересчитывается сама при каждом изменении transactions.
 * Суммы в тенге, удалённые операции и переводы не входят.
 */
function createSummary(sheet) {
  var key = function (type) { return 'A2:A&"|' + type + '|' + SUMMARY_CURRENCY + '|' + NO + '"'; };
  var sum = function (type) { return 'SUMIF(transactions!V2:V, ' + key(type) + ', transactions!D2:D)'; };
  sheet.getRange(1, 1, 1, 4).setValues([['Месяц', 'Доход', 'Расход', 'Баланс']]).setFontWeight('bold');
  sheet.getRange(2, 1).setFormula('=IFERROR(SORT(UNIQUE(FILTER(transactions!C2:C, transactions!C2:C<>"")), 1, FALSE), "")');
  sheet.getRange(2, 2).setFormula('=ARRAYFORMULA(IF(A2:A="", "", ' + sum(TYPE_LABELS.income) + '))');
  sheet.getRange(2, 3).setFormula('=ARRAYFORMULA(IF(A2:A="", "", ' + sum(TYPE_LABELS.expense) + '))');
  sheet.getRange(2, 4).setFormula('=ARRAYFORMULA(IF(A2:A="", "", ' + sum(TYPE_LABELS.income) + ' - ' + sum(TYPE_LABELS.expense) + '))');
  sheet.getRange(1, 6).setValue('Расходы по категориям и месяцам').setFontWeight('bold');
  sheet.getRange(2, 6).setFormula('=IFERROR(QUERY(transactions!A:M, "select G, sum(D) where M = \'' + NO
    + '\' and F = \'' + TYPE_LABELS.expense + '\' and E = \'' + SUMMARY_CURRENCY
    + '\' group by G pivot C label G \'Категория\'", 1), "Пока нет расходов")');
  sheet.setFrozenRows(1);
}

/** Все колонки текстовые (даты и id не превращаются в числа), кроме числовых. */
function formatColumns(sheet, def, firstRow, numRows) {
  sheet.getRange(firstRow, 1, numRows, def.columns.length).setNumberFormat('@');
  def.numeric.forEach(function (column) {
    sheet.getRange(firstRow, def.columns.indexOf(column) + 1, numRows, 1).setNumberFormat('0.##');
  });
}

/** Читает лист в список объектов «заголовок → значение». */
function readTable(sheet, def) {
  var lastRow = sheet.getLastRow();
  var values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, def.columns.length).getValues() : [];
  return {
    objects: values.map(function (row) {
      var object = {};
      def.columns.forEach(function (column, i) { object[column] = unguard(row[i]); });
      return object;
    }),
  };
}

function toCells(def, object) {
  return def.columns.map(function (column) { return guard(object[column]); });
}

function writeRow(sheet, def, rowNumber, object) {
  sheet.getRange(rowNumber, 1, 1, def.columns.length).setValues([toCells(def, object)]);
}

function appendRows(sheet, def, objects) {
  if (objects.length === 0) return;
  var firstRow = sheet.getLastRow() + 1;
  formatColumns(sheet, def, firstRow, objects.length);
  sheet.getRange(firstRow, 1, objects.length, def.columns.length)
    .setValues(objects.map(function (object) { return toCells(def, object); }));
}

// ---------- защита от формул ----------

/**
 * Значение, начинающееся с = + - @, Таблицы могут принять за формулу.
 * Ведущий апостроф заставляет считать его текстом.
 */
function guard(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

/** Обратное преобразование на случай, если апостроф сохранился в ячейке как символ. */
function unguard(value) {
  return typeof value === 'string' && /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

// ---------- мелочи ----------

function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function orNull(value) { return value === '' || value === null || value === undefined ? null : String(value); }
function numOrNull(value) { return value === '' || value === null || value === undefined ? null : Number(value); }
function reverse(labels, label) {
  for (var key in labels) if (labels[key] === label) return key;
  return text(label);
}
function isId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value); }
function isOptionalId(value) { return value === null || value === undefined || value === '' || isId(value); }
function isTime(value) { return typeof value === 'number' && isFinite(value) && value >= 0; }
function isAmount(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0 && value <= 1e15; }
function isCurrency(value) { return typeof value === 'string' && /^[A-Z]{3}$/.test(value); }
function isText(value, max) { return value === null || value === undefined || (typeof value === 'string' && value.length <= max); }
function isName(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch (err) { return null; }
}
function summaryKey(month, type, currency, deleted) { return [month, type, currency, deleted].join('|'); }

function sha256(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ((byte + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

// ---------- функции для запуска из редактора Apps Script ----------

/**
 * Первый запуск: создаёт листы и токен. Токен печатается в журнале выполнения
 * (Вид → Журналы). Скопируйте его в приложение и в Команды iOS.
 * Повторный запуск существующий токен не меняет.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  ensureSheets();
  if (!props.getProperty('TOKEN')) {
    props.setProperty('TOKEN', newToken());
    Logger.log('Создан новый токен. Скопируйте его и никому не показывайте:');
  } else {
    Logger.log('Токен уже задан:');
  }
  Logger.log(props.getProperty('TOKEN'));
  Logger.log('Листы готовы. Теперь: Развернуть → Новое развертывание → Веб-приложение, доступ «Все».');
}

/** Заменяет токен. Старый перестаёт работать сразу: обновите его в приложении и в Командах. */
function resetToken() {
  PropertiesService.getScriptProperties().setProperty('TOKEN', newToken());
  Logger.log('Новый токен:');
  Logger.log(PropertiesService.getScriptProperties().getProperty('TOKEN'));
}

function newToken() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/**
 * Проверка на настоящей таблице: пишет операцию с заметкой, похожей на формулу,
 * и убеждается, что она сохранилась текстом. Тестовая строка после проверки удаляется.
 */
function selfTest() {
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  var call = function (body) {
    body.token = token;
    return handle({ postData: { contents: JSON.stringify(body) } });
  };
  var note = '=1+1';
  var result = call({
    action: 'upsert',
    transactions: [{
      id: 'selftest', date: '2000-01-01T00:00:00', amount: 100, currency: 'KZT', type: 'expense',
      category_id: null, category: 'Проверка', account_id: 'selftest', account: 'Проверка',
      note: note, source: 'manual', status: 'ok', deleted: true, deleted_at: 1, updated_at: Date.now(),
    }],
  });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('transactions');
  var rows = readTable(sheet, DEFS.transactions).objects;
  var index = -1;
  rows.forEach(function (row, i) { if (row.id === 'selftest') index = i; });
  var stored = index === -1 ? null : rows[index]['Заметка'];
  if (index !== -1) sheet.deleteRow(index + 2);
  Logger.log('Запись: ' + JSON.stringify(result));
  Logger.log(stored === note
    ? 'OK: заметка «=1+1» сохранилась текстом, формулой не стала.'
    : 'ОШИБКА: в ячейке оказалось «' + stored + '». Сообщите об этом и не пользуйтесь синхронизацией.');
}
