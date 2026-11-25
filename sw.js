// Service worker: кеш оболочки приложения, работа без сети.
//
// ВАЖНО: при любом изменении файлов приложения увеличь VERSION, иначе установленное
// приложение не увидит обновление. Список SHELL проверяется тестом tests/sw.test.js.
// Данные пользователя лежат в IndexedDB и при смене версии кеша не затрагиваются.

const VERSION = 'v28';
const CACHE = `finance-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/fonts.css',
  './js/adjust.js',
  './js/analytics.js',
  './js/app.js',
  './js/backup.js',
  './js/catalog.js',
  './js/category-report.js',
  './js/db.js',
  './js/icons-data.js',
  './js/icons.js',
  './js/importer.js',
  './js/inbox.js',
  './js/model.js',
  './js/money.js',
  './js/parser.js',
  './js/period.js',
  './js/planned.js',
  './js/seed.js',
  './js/selectors.js',
  './js/sync.js',
  './js/ui/add.js',
  './js/ui/analytics.js',
  './js/ui/backup.js',
  './js/ui/category.js',
  './js/ui/chart.js',
  './js/ui/dom.js',
  './js/ui/editors.js',
  './js/ui/home.js',
  './js/ui/import.js',
  './js/ui/insights.js',
  './js/ui/keypad.js',
  './js/ui/period.js',
  './js/ui/planned.js',
  './js/ui/review.js',
  './js/ui/screen.js',
  './js/ui/settings.js',
  './js/ui/sheet.js',
  './js/ui/sync.js',
  './js/ui/txrow.js',
  './vendor/xlsx.mini.min.js',
  './fonts/IBMPlexSans-Bold-Cyrillic.woff2',
  './fonts/IBMPlexSans-Bold-Latin1.woff2',
  './fonts/IBMPlexSans-Bold-Latin2.woff2',
  './fonts/IBMPlexSans-Medium-Cyrillic.woff2',
  './fonts/IBMPlexSans-Medium-Latin1.woff2',
  './fonts/IBMPlexSans-Medium-Latin2.woff2',
  './fonts/IBMPlexSans-Regular-Cyrillic.woff2',
  './fonts/IBMPlexSans-Regular-Latin1.woff2',
  './fonts/IBMPlexSans-Regular-Latin2.woff2',
  './fonts/IBMPlexSans-SemiBold-Cyrillic.woff2',
  './fonts/IBMPlexSans-SemiBold-Latin1.woff2',
  './fonts/IBMPlexSans-SemiBold-Latin2.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' — берём свежие файлы с сервера, минуя HTTP-кеш браузера.
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('finance-shell-') && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Новая версия ждёт, пока пользователь не нажмёт «Обновить» в приложении.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return; // чужие адреса не трогаем

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request.mode === 'navigate' ? './index.html' : request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch {
      return new Response('Нет сети', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
