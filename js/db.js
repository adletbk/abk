// Единственная точка доступа к IndexedDB.
//
// Схема версионируется списком MIGRATIONS: номер версии = индекс + 1. Чтобы изменить
// схему, ДОБАВЬ функцию в конец списка. Существующие миграции не редактируются,
// иначе у установленного приложения пропадут или сломаются данные.
//
// encode/decode — место под будущее шифрование на устройстве: все записи и чтения
// проходят через эту пару функций.

export const DB_NAME = 'finance';

const ENTITY_STORES = ['categories', 'accounts', 'templates', 'inbox', 'rules'];

export const MIGRATIONS = [
  // v1
  (db) => {
    const transactions = db.createObjectStore('transactions', { keyPath: 'id' });
    transactions.createIndex('date', 'date');
    transactions.createIndex('updated_at', 'updated_at');
    transactions.createIndex('fingerprint', 'fingerprint');
    transactions.createIndex('status', 'status');
    for (const name of ENTITY_STORES) {
      db.createObjectStore(name, { keyPath: 'id' }).createIndex('updated_at', 'updated_at');
    }
    db.createObjectStore('settings', { keyPath: 'key' });
  },
  // v2: плановые платежи (календарь платежей). Только на устройстве, в таблицу не уходят.
  (db) => {
    db.createObjectStore('planned', { keyPath: 'id' }).createIndex('updated_at', 'updated_at');
  },
];

const encode = (store, value) => value;
const decode = (store, value) => value;

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export function openDb({ name = DB_NAME, migrations = MIGRATIONS, indexedDB = globalThis.indexedDB } = {}) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, migrations.length);
    request.onupgradeneeded = (event) => {
      for (let v = event.oldVersion; v < migrations.length; v++) {
        migrations[v](request.result, request.transaction);
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('База данных занята другой вкладкой'));
    request.onsuccess = () => {
      const idb = request.result;
      // Другая вкладка открыла новую версию: уступаем, чтобы не блокировать обновление.
      idb.onversionchange = () => idb.close();
      resolve(wrap(idb));
    };
  });
}

function wrap(idb) {
  /** Выполняет fn в одной транзакции; результат отдаётся после её завершения. */
  const run = (store, mode, fn) => new Promise((resolve, reject) => {
    const tx = idb.transaction(store, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция прервана'));
    try {
      Promise.resolve(fn(tx.objectStore(store))).then((value) => { result = value; }, (error) => {
        try { tx.abort(); } catch { /* уже завершена */ }
        reject(error);
      });
    } catch (error) {
      try { tx.abort(); } catch { /* уже завершена */ }
      reject(error);
    }
  });

  const db = {
    storeNames: () => [...idb.objectStoreNames].sort(),
    close: () => idb.close(),

    getAll: (store) => run(store, 'readonly', async (s) => (await done(s.getAll())).map((v) => decode(store, v))),
    get: (store, key) => run(store, 'readonly', async (s) => {
      const value = await done(s.get(key));
      return value === undefined ? undefined : decode(store, value);
    }),
    put: (store, value) => run(store, 'readwrite', (s) => { s.put(encode(store, value)); }),
    putMany: (store, values) => run(store, 'readwrite', (s) => {
      for (const value of values) s.put(encode(store, value));
    }),
    /** Физическое удаление. Только для тестовых данных; данные пользователя удаляются мягко. */
    removeMany: (store, keys) => run(store, 'readwrite', (s) => { for (const key of keys) s.delete(key); }),
    /** Мягкое удаление: запись остаётся с флагом deleted и временем. */
    softDelete: (store, id, now = Date.now()) => run(store, 'readwrite', async (s) => {
      const value = await done(s.get(id));
      if (value === undefined) return;
      s.put(encode(store, { ...decode(store, value), deleted: true, deleted_at: now, updated_at: now }));
    }),

    /** Заменяет содержимое нескольких хранилищ одной транзакцией (восстановление из бэкапа). */
    replaceAll: (data) => new Promise((resolve, reject) => {
      const names = Object.keys(data);
      const tx = idb.transaction(names, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Транзакция прервана'));
      try {
        for (const name of names) {
          const store = tx.objectStore(name);
          store.clear();
          for (const value of data[name]) store.put(encode(name, value));
        }
      } catch (error) {
        try { tx.abort(); } catch { /* уже завершена */ }
        reject(error);
      }
    }),

    getSetting: async (key, fallback) => {
      const row = await db.get('settings', key);
      return row === undefined ? fallback : row.value;
    },
    setSetting: (key, value) => db.put('settings', { key, value }),
  };
  return db;
}
