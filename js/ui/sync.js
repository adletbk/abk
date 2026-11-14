// Синхронизация: запуск, экран настроек подключения и список входящих записей.
import { h, clear, toast } from './dom.js';
import { screenHeader, listItem } from './screen.js';
import { confirmSheet } from './sheet.js';
import { SyncError, createTransport, getSyncConfig, hasLocalChanges, isSyncUrl, syncNow } from '../sync.js';
import { plural } from '../model.js';
import { processInbox } from '../inbox.js';
import { describeProcessing } from './review.js';

const AUTO_DELAY_MS = 4000;       // пауза после последнего изменения
const AUTO_INTERVAL_MS = 120000;  // без изменений проверяем таблицу не чаще раза в две минуты
const SOURCE_NAMES = { applepay: 'Apple Pay', notification: 'Уведомление банка', sms: 'SMS' };

let running = null;
let timer = 0;

const total = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

function describe(result) {
  const parts = [];
  if (total(result.pushed)) parts.push(`отправлено ${total(result.pushed)}`);
  if (total(result.pulled)) parts.push(`получено ${total(result.pulled)}`);
  if (result.inbox) parts.push(`новых входящих: ${result.inbox}`);
  if (result.rejected) parts.push(`отклонено таблицей: ${result.rejected}`);
  if (parts.length === 0) return 'Всё синхронизировано';
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * Запускает синхронизацию. silent: без сообщений (фоновый запуск).
 * Возвращает результат или null, если синхронизация не выполнялась или не удалась.
 */
export async function runSync(ctx, { silent = false } = {}) {
  const config = await getSyncConfig(ctx.db);
  if (!config) {
    if (!silent) ctx.navigate('#/sync');
    return null;
  }
  if (running) return running;
  if (navigator.onLine === false) {
    if (!silent) toast('Нет сети. Данные сохранены на устройстве и уйдут позже');
    return null;
  }
  document.documentElement.classList.add('syncing');
  running = syncNow(ctx.db, createTransport(config.url, config.token))
    .then(async (result) => {
      // Новые записи от Команд iOS сразу разбираем в операции.
      const processed = result.inbox ? await processInbox(ctx.db) : null;
      if (processed && (processed.created || processed.merged || processed.unparsed)) {
        toast(describeProcessing(processed), { duration: 4000 });
        scheduleSync(ctx); // созданные операции и статусы записей уйдут следующей синхронизацией
      } else if (!silent) toast(describe(result));
      return result;
    }, (error) => {
      if (!silent) toast(error.message, { duration: 5000 });
      return null;
    })
    .finally(() => {
      running = null;
      document.documentElement.classList.remove('syncing');
    });
  const result = await running;
  // Перерисовываем только списки: экран ввода операции не трогаем, чтобы не сбросить набранное.
  const onList = !location.hash.startsWith('#/add');
  if (onList && (result === null || total(result.pulled) || result.inbox || !silent)) ctx.render({ auto: false });
  return result;
}

/** Фоновая синхронизация: после изменений и при возвращении в приложение. */
export function scheduleSync(ctx) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      if (!(await getSyncConfig(ctx.db)) || navigator.onLine === false) return;
      const last = await ctx.db.getSetting('sync_last_at', 0);
      const failed = await ctx.db.getSetting('sync_error', null);
      const due = Date.now() - Math.max(last, failed?.at ?? 0) > AUTO_INTERVAL_MS;
      if (due || (!failed && await hasLocalChanges(ctx.db))) await runSync(ctx, { silent: true });
    } catch (error) {
      console.warn('автосинхронизация', error);
    }
  }, AUTO_DELAY_MS);
}

// ---------- экран подключения ----------

export async function renderSync(root, ctx) {
  const { db } = ctx;
  const [url, token, lastAt, error, pending] = await Promise.all([
    db.getSetting('sync_url', ''), db.getSetting('sync_token', ''), db.getSetting('sync_last_at', null),
    db.getSetting('sync_error', null), hasLocalChanges(db),
  ]);
  const configured = isSyncUrl(url) && Boolean(token);

  const urlInput = h('input', {
    class: 'field-input', type: 'url', value: url, placeholder: 'https://script.google.com/macros/s/…/exec',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'url', 'aria-label': 'Адрес веб-приложения',
  });
  const tokenInput = h('input', {
    // Обычное текстовое поле: страница не должна быть похожа на форму входа.
    class: 'field-input', type: 'text', value: token, placeholder: 'Токен из журнала setup()',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Токен',
  });

  let busy = false;
  async function connect() {
    if (busy) return;
    const nextUrl = urlInput.value.trim();
    const nextToken = tokenInput.value.trim();
    if (!isSyncUrl(nextUrl)) { toast(new SyncError('bad_url').message, { duration: 5000 }); return; }
    if (!nextToken) { toast('Введите токен'); return; }
    busy = true;
    toast('Проверяю связь…', { duration: 0 });
    try {
      await createTransport(nextUrl, nextToken)({ action: 'ping' });
    } catch (err) {
      busy = false;
      toast(err.message, { duration: 6000 });
      return;
    }
    // Сохраняем только проверенные адрес и токен.
    await db.setSetting('sync_url', nextUrl);
    await db.setSetting('sync_token', nextToken);
    await db.setSetting('sync_error', null);
    busy = false;
    toast('Связь есть. Синхронизирую…');
    await runSync(ctx);
  }

  async function disconnect() {
    const yes = await confirmSheet({
      title: 'Отключить синхронизацию?',
      text: 'Адрес и токен будут удалены с этого устройства. Данные на устройстве и в таблице останутся.',
      confirmLabel: 'Отключить', danger: true,
    });
    if (!yes) return;
    for (const key of ['sync_url', 'sync_token', 'sync_error', 'sync_last_at', 'sync_last_result']) await db.setSetting(key, null);
    // Метки сбрасываем: при новом подключении всё отправится заново (повтор безвреден).
    await db.setSetting('sync_push_mark', 0);
    await db.setSetting('sync_pull_mark', 0);
    toast('Синхронизация отключена');
    ctx.render();
  }

  const status = !configured ? 'Не настроена. Данные хранятся только на этом устройстве.'
    : error ? `Ошибка: ${error.message}.`
      : lastAt ? `Последняя синхронизация: ${new Date(lastAt).toLocaleString('ru-RU')}.`
        : 'Подключена, синхронизации ещё не было.';

  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Синхронизация'),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Google Таблица' }),
      h('p', { class: 'card-text' + (configured && error ? ' expense' : ''), text: status }),
      configured && h('p', { class: 'card-text muted', text: pending ? 'Есть изменения, которые ещё не отправлены.' : 'Все изменения отправлены.' }),
      configured && h('button', { type: 'button', class: 'btn-primary', text: 'Синхронизировать сейчас', onClick: () => runSync(ctx) })),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Подключение' }),
      h('div', { class: 'form' },
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Адрес веб-приложения' }), urlInput),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Токен' }), tokenInput),
        h('p', { class: 'field-hint', text: 'Токен хранится только на этом устройстве и в свойствах вашего скрипта. Он попадает в JSON-бэкап.' }),
        h('button', { type: 'button', class: 'btn-secondary', text: configured ? 'Сохранить и проверить связь' : 'Подключить', onClick: connect }),
        configured && h('button', { type: 'button', class: 'btn-secondary btn-danger', text: 'Отключить', onClick: disconnect }))),
    h('p', { class: 'note-text', text: 'Как создать таблицу, установить скрипт и получить адрес и токен, описано в файле docs/setup-google.md в репозитории.' }),
    h('p', { class: 'note-text', text: 'В таблицу не уходят начальные остатки счетов и тестовые операции.' })));
}

// ---------- входящие ----------

export async function renderInbox(root, ctx) {
  const items = (await ctx.db.getAll('inbox')).sort((a, b) => (b.received_at ?? '').localeCompare(a.received_at ?? ''));
  const STATUS = { new: 'новая', needs_review: 'проверить', done: 'разобрано' };
  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Входящие'),
    h('p', { class: 'note-text', text: 'Все сырые записи от Команд iOS, которые приложение забрало из листа inbox, вместе с уже разобранными. То, что требует внимания, собрано в разделе «Проверить».' }),
    items.length
      ? h('div', { class: 'list' }, items.map((item) => listItem({
        iconName: item.source === 'applepay' ? 'card' : 'phone',
        label: item.text || JSON.stringify(item.payload ?? {}),
        sub: [SOURCE_NAMES[item.source] ?? item.source, (item.time ?? item.received_at ?? '').replace('T', ' ').slice(0, 16)].filter(Boolean).join(' · '),
        tag: item.ignored ? 'не операция' : STATUS[item.status] ?? item.status,
      })))
      : h('p', { class: 'empty', text: 'Входящих записей нет' }),
    items.length ? h('p', { class: 'note-text', text: `Всего: ${items.length} ${plural(items.length, ['запись', 'записи', 'записей'])}.` }) : null));
}
