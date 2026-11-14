// Синхронизация с Google Таблицей через web app на Apps Script.
//
// Источник правды — устройство. Таблица хранит копию и принимает сырые записи
// от Команд iOS (лист inbox). Протокол описан в docs/setup-google.md.

const STORES = ['categories', 'accounts', 'templates', 'transactions']; // порядок отправки
const CHUNK = 200;
const TIMEOUT_MS = 30000;

const MESSAGES = {
  unauthorized: 'Неверный токен',
  not_configured: 'В Apps Script не задан токен. Выполните функцию setup() в редакторе скрипта',
  busy: 'Таблица занята другой записью. Повторите через минуту',
  network: 'Нет связи с Google Таблицей',
  bad_response: 'Сервер ответил не так, как ожидалось. Проверьте адрес веб-приложения и доступ «Все»',
  bad_url: 'Адрес должен начинаться с https://script.google.com/macros/s/ и заканчиваться на /exec',
};

export class SyncError extends Error {
  constructor(code, message) {
    super(message || MESSAGES[code] || code);
    this.name = 'SyncError';
    this.code = code;
  }
}

/** Принимаем только адрес развёрнутого веб-приложения Apps Script. */
export function isSyncUrl(url) {
  return typeof url === 'string'
    && /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/?#]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
}

/**
 * Транспорт: POST с Content-Type text/plain и JSON в теле (так браузер не шлёт preflight).
 * Токен едет в теле запроса, в адрес он не попадает.
 */
export function createTransport(url, token, fetchImpl = (...args) => globalThis.fetch(...args)) {
  if (!isSyncUrl(url)) throw new SyncError('bad_url');
  return async function transport(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let raw;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, ...body }),
        redirect: 'follow',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      raw = await response.text();
    } catch {
      throw new SyncError('network');
    } finally {
      clearTimeout(timer);
    }
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      // Неверный адрес или доступ не «Все»: Google отдаёт HTML-страницу входа или ошибки.
      throw new SyncError('bad_response');
    }
    if (json === null || typeof json !== 'object' || typeof json.ok !== 'boolean') throw new SyncError('bad_response');
    if (!json.ok) {
      const code = typeof json.error === 'string' ? json.error : 'internal';
      throw new SyncError(code, MESSAGES[code] ?? `Ошибка сервера: ${json.message ?? code}`);
    }
    return json;
  };
}

// ---------- форматы записей ----------

const common = (row) => ({
  deleted: Boolean(row.deleted), deleted_at: row.deleted_at ?? null, updated_at: row.updated_at,
});

/**
 * Запись для отправки. Локальные поля (начальный остаток, пометка demo) не включаются.
 * Вместе с id уходят названия категории и счетов: таблицу читают человек и ИИ.
 */
export function toWire(store, row, { categoriesById, accountsById }) {
  const names = () => ({
    category_id: row.category_id ?? null,
    category: categoriesById.get(row.category_id)?.name ?? '',
    account_id: row.account_id ?? null,
    account: accountsById.get(row.account_id)?.name ?? '',
    to_account_id: row.to_account_id ?? null,
    to_account: accountsById.get(row.to_account_id)?.name ?? '',
  });
  switch (store) {
    case 'transactions': return {
      id: row.id, date: row.date, amount: row.amount, currency: row.currency, type: row.type,
      ...names(), note: row.note ?? '', source: row.source ?? 'manual', fingerprint: row.fingerprint ?? '',
      status: row.status ?? 'ok', ...common(row),
    };
    case 'categories': return {
      id: row.id, name: row.name, type: row.type, icon: row.icon ?? '', color: row.color ?? '',
      order: row.order ?? 0, hidden: Boolean(row.hidden), ...common(row),
    };
    case 'accounts': return {
      id: row.id, name: row.name, currency: row.currency, icon: row.icon ?? '',
      order: row.order ?? 0, hidden: Boolean(row.hidden), ...common(row),
    };
    case 'templates': return {
      id: row.id, name: row.name, type: row.type, amount: row.amount ?? 0, currency: row.currency ?? 'KZT',
      ...names(), note: row.note ?? '', ...common(row),
    };
    default: throw new Error(`Неизвестное хранилище: ${store}`);
  }
}

/** Запись из таблицы → локальная. Локальные поля берутся из существующей записи. */
export function fromWire(store, wire, local) {
  const { category, account, to_account, ...row } = wire;
  if (store === 'accounts') return { ...row, initial_balance: local?.initial_balance ?? 0 };
  return row;
}

// ---------- синхронизация ----------

const isPushable = (store, row) => !(store === 'transactions' && row.demo === true);

async function changedSince(db, mark) {
  const changes = {};
  for (const store of STORES) {
    changes[store] = (await db.getAll(store)).filter((row) => isPushable(store, row) && row.updated_at > mark);
  }
  return changes;
}

/** Есть ли на устройстве изменения, которые ещё не ушли в таблицу. */
export async function hasLocalChanges(db) {
  const changes = await changedSince(db, await db.getSetting('sync_push_mark', 0));
  return STORES.some((store) => changes[store].length > 0);
}

/** Настройки подключения или null, если синхронизация не настроена. */
export async function getSyncConfig(db) {
  const [url, token] = await Promise.all([db.getSetting('sync_url', ''), db.getSetting('sync_token', '')]);
  return isSyncUrl(url) && token ? { url, token } : null;
}

/**
 * Один проход: отправить локальные изменения, забрать изменения и inbox из таблицы.
 * При ошибке метки не сдвигаются: следующая попытка повторит отправку (она идемпотентна).
 */
export async function syncNow(db, transport, now = Date.now()) {
  try {
    const result = await runSync(db, transport, now);
    await db.setSetting('sync_last_at', now);
    await db.setSetting('sync_last_result', result);
    await db.setSetting('sync_error', null);
    return result;
  } catch (error) {
    const known = error instanceof SyncError ? error : new SyncError('internal', 'Сбой синхронизации');
    if (!(error instanceof SyncError)) console.error(error);
    await db.setSetting('sync_error', { code: known.code, message: known.message, at: now });
    throw known;
  }
}

async function runSync(db, transport, now) {
  const result = { pushed: {}, pulled: {}, inbox: 0, rejected: 0, duplicates: [] };

  // 1. Отправка
  const changes = await changedSince(db, await db.getSetting('sync_push_mark', 0));
  const lookups = {
    categoriesById: new Map((await db.getAll('categories')).map((c) => [c.id, c])),
    accountsById: new Map((await db.getAll('accounts')).map((a) => [a.id, a])),
  };
  for (const store of STORES) {
    const rows = changes[store].map((row) => toWire(store, row, lookups));
    result.pushed[store] = rows.length;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const response = await transport({ action: 'upsert', [store]: rows.slice(i, i + CHUNK) });
      const summary = response.results?.[store];
      result.rejected += summary?.rejected?.length ?? 0;
      result.duplicates.push(...(summary?.duplicates ?? []));
    }
  }
  // «− 1»: запись, изменённая в ту же миллисекунду, уйдёт в следующий раз, а не потеряется.
  await db.setSetting('sync_push_mark', now - 1);

  // 2. Получение
  const pulled = await transport({ action: 'pull', since: await db.getSetting('sync_pull_mark', 0) });
  for (const store of STORES) {
    const incoming = Array.isArray(pulled[store]) ? pulled[store] : [];
    const localById = new Map((await db.getAll(store)).map((row) => [row.id, row]));
    const fresh = incoming
      .filter((wire) => !(localById.get(wire.id)?.updated_at >= wire.updated_at))
      .map((wire) => fromWire(store, wire, localById.get(wire.id)));
    if (fresh.length) await db.putMany(store, fresh);
    result.pulled[store] = fresh.length;
  }
  if (typeof pulled.server_time === 'number') await db.setSetting('sync_pull_mark', pulled.server_time);

  // 3. Inbox: сначала сохраняем у себя, потом подтверждаем. Если приложение закроется
  //    между этими шагами, запись придёт ещё раз и узнается по id.
  const inbox = Array.isArray(pulled.inbox) ? pulled.inbox : [];
  if (inbox.length) {
    const known = new Set((await db.getAll('inbox')).map((item) => item.id));
    const fresh = inbox.filter((item) => !known.has(item.id)).map((item) => ({
      id: item.id, text: item.text ?? '', source: item.source, time: item.time ?? null,
      received_at: item.received_at ?? null, payload: item.payload ?? null, status: 'new', updated_at: now,
    }));
    if (fresh.length) await db.putMany('inbox', fresh);
    result.inbox = fresh.length;
    for (let i = 0; i < inbox.length; i += CHUNK) {
      await transport({ action: 'upsert', inbox: inbox.slice(i, i + CHUNK).map((item) => ({ id: item.id, status: 'fetched' })) });
    }
  }
  return result;
}
