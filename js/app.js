// Запуск приложения: база, роутер по hash, service worker.
import { openDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import { localIso, monthKey } from './model.js';
import { h, clear, toast } from './ui/dom.js';
import { renderHome } from './ui/home.js';
import { renderAdd } from './ui/add.js';

const root = document.getElementById('app');

async function main() {
  const db = await openDb();
  await seedIfEmpty(db);

  const state = {
    month: monthKey(localIso(new Date())),
    accountId: null,
    query: '',
    searchOpen: false,
  };
  let depth = 0;   // сколько переходов сделано внутри приложения
  let renderSeq = 0;

  const ctx = {
    db,
    state,
    navigate(hash) { depth++; location.hash = hash; },
    /** Назад на главную без лишних записей в истории. */
    back() {
      if (depth > 0) { depth--; history.back(); } else { location.replace('#/'); }
    },
    async render() {
      const seq = ++renderSeq;
      const route = location.hash.match(/^#\/add(?:\/([\w-]+))?$/);
      const target = document.createElement('div');
      if (route) await renderAdd(target, ctx, { id: route[1] ?? null });
      else await renderHome(target, ctx);
      if (seq !== renderSeq) return; // пришёл более новый рендер
      clear(root).append(...target.childNodes);
    },
  };

  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); ctx.render(); });
  await ctx.render();

  requestPersistence(db);
  registerServiceWorker();
}

/** Просим браузер не вытеснять данные. Имеет смысл только у установленного приложения. */
async function requestPersistence(db) {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!standalone || !navigator.storage?.persist) return;
  try {
    const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    await db.setSetting('persisted', persisted);
  } catch (error) {
    console.warn('storage.persist', error);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register('./sw.js');
    const offerUpdate = (worker) => toast('Доступно обновление', {
      duration: 0,
      action: { label: 'Обновить', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
    });
    if (registration.waiting && hadController) offerUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return; // первая установка: перезагрузка не нужна
      reloaded = true;
      location.reload();
    });
  } catch (error) {
    console.warn('service worker', error);
  }
}

main().catch((error) => {
  console.error(error);
  clear(root).append(h('p', { class: 'fatal', text: 'Не удалось открыть базу данных. Закройте другие вкладки приложения и откройте его снова.' }));
});
