// Запуск приложения: база, роутер по hash, service worker.
import { openDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import { todayKey } from './model.js';
import { h, clear, toast } from './ui/dom.js';
import { renderHome } from './ui/home.js';
import { renderAdd } from './ui/add.js';
import { renderAnalytics } from './ui/analytics.js';
import { renderSettings, renderCategories, renderAccounts, renderTemplates } from './ui/settings.js';
import { renderBackup } from './ui/backup.js';
import { renderSync, renderInbox, scheduleSync } from './ui/sync.js';
import { renderReview, renderRules } from './ui/review.js';
import { processInbox } from './inbox.js';
import { FREEDOM_HISTORY, FREEDOM_PRESET, upgradePreset } from './parser.js';
import { renderImport } from './ui/import.js';
import { renderInsights, renderDay } from './ui/insights.js';
import { renderPlanned } from './ui/planned.js';

const SCREENS = {
  analytics: renderAnalytics,
  settings: renderSettings,
  categories: renderCategories,
  accounts: renderAccounts,
  templates: renderTemplates,
  backup: renderBackup,
  sync: renderSync,
  inbox: renderInbox,
  review: renderReview,
  rules: renderRules,
  import: renderImport,
  insights: renderInsights,
  planned: renderPlanned,
};

const root = document.getElementById('app');

async function main() {
  const db = await openDb();
  await seedIfEmpty(db);

  // Вид периода запоминается между запусками; листание всегда начинается с сегодняшнего дня.
  const saved = await db.getSetting('period', null);
  const custom = saved?.from && saved?.to ? { from: saved.from, to: saved.to } : null;
  const state = {
    period: saved?.kind === 'custom' && custom ? { kind: 'custom', ...custom } : { kind: saved?.kind ?? 'month', anchor: todayKey() },
    custom,
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
    /** auto: false — не планировать фоновую синхронизацию (рендер вызван самой синхронизацией). */
    async render({ auto = true } = {}) {
      const seq = ++renderSeq;
      const add = location.hash.match(/^#\/add(?:\/([\w-]+))?(?:\?(t|inbox|plan)=([\w-]+))?$/);
      const screen = SCREENS[location.hash.slice(2)];
      const day = location.hash.match(/^#\/day\/(\d{4}-\d{2}-\d{2})$/);
      const target = document.createElement('div');
      if (add) {
        await renderAdd(target, ctx, {
          id: add[1] ?? null,
          templateId: add[2] === 't' ? add[3] : null,
          inboxId: add[2] === 'inbox' ? add[3] : null,
          planRef: add[2] === 'plan' ? add[3] : null,
        });
      }
      else if (day) await renderDay(target, ctx, day[1]);
      else if (screen) await screen(target, ctx);
      else await renderHome(target, ctx);
      if (seq !== renderSeq) return; // пришёл более новый рендер
      clear(root).append(...target.childNodes);
      if (auto) scheduleSync(ctx); // после любого изменения экраны перерисовываются
    },
  };

  // Записи, которые забрали из таблицы, но не успели разобрать (приложение закрыли).
  const upgraded = await upgradePreset(db, FREEDOM_PRESET, FREEDOM_HISTORY).catch(() => 0);
  await processInbox(db, { retry: upgraded > 0 }).catch((error) => console.warn('разбор входящих', error));

  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); ctx.render(); });
  await ctx.render();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(ctx);
  });
  window.addEventListener('online', () => scheduleSync(ctx));

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
  // При локальной разработке кеш мешает видеть свежие файлы. Проверить офлайн-режим: откройте /?sw
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) return;
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
