// Настройки и справочники: счета, категории, шаблоны.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { screenHeader, listItem } from './screen.js';
import { pickSheet, confirmSheet } from './sheet.js';
import { editCategory, editAccount, promptSheet } from './editors.js';
import { formatMoney } from '../money.js';
import { TYPE_LABELS } from '../model.js';
import { accountBalances } from '../selectors.js';
import { moveItem } from '../catalog.js';
import { reviewCounts } from '../inbox.js';

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export async function renderSettings(root, ctx) {
  const { db } = ctx;
  let persisted = null;
  try { persisted = await navigator.storage?.persisted?.(); } catch { /* недоступно */ }
  const lastBackup = await db.getSetting('last_backup_at', null);
  const [syncUrl, syncAt, syncError, inbox] = await Promise.all([
    db.getSetting('sync_url', ''), db.getSetting('sync_last_at', null), db.getSetting('sync_error', null), db.getAll('inbox'),
  ]);
  const review = await reviewCounts(db);
  const syncStatus = !syncUrl ? 'Не настроена' : syncError ? `Ошибка: ${syncError.message}`
    : syncAt ? `Последняя: ${new Date(syncAt).toLocaleString('ru-RU')}` : 'Подключена';

  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Настройки'),
    h('div', { class: 'group-title', text: 'Данные' }),
    h('div', { class: 'list' },
      listItem({ iconName: 'wallet', color: '#10B981', label: 'Счета', onClick: () => ctx.navigate('#/accounts') }),
      listItem({ iconName: 'cart', color: '#FB923C', label: 'Категории', onClick: () => ctx.navigate('#/categories') }),
      listItem({ iconName: 'bolt', color: '#FBBF24', label: 'Шаблоны', onClick: () => ctx.navigate('#/templates') }),
      listItem({
        iconName: 'download', color: '#60A5FA', label: 'Экспорт и бэкап',
        sub: lastBackup ? `Последний бэкап: ${new Date(lastBackup).toLocaleDateString('ru-RU')}` : 'Бэкап ещё не делался',
        onClick: () => ctx.navigate('#/backup'),
      }),
      listItem({
        iconName: 'upload', color: '#A78BFA', label: 'Импорт', sub: 'Файлы xlsx и csv, выгрузка Money Manager',
        onClick: () => ctx.navigate('#/import'),
      })),
    h('div', { class: 'group-title', text: 'Облако' }),
    h('div', { class: 'list' },
      listItem({ iconName: 'sync', color: '#10B981', label: 'Синхронизация', sub: syncStatus, onClick: () => ctx.navigate('#/sync') }),
      ),
    h('div', { class: 'group-title', text: 'Автоматические траты' }),
    h('div', { class: 'list' },
      listItem({
        iconName: 'check', color: '#FBBF24', label: 'Проверить', sub: 'Неразобранное и операции без категории',
        tag: review.total ? String(review.total) : null, onClick: () => ctx.navigate('#/review'),
      }),
      listItem({ iconName: 'table', color: '#60A5FA', label: 'Правила разбора', onClick: () => ctx.navigate('#/rules') }),
      listItem({
        iconName: 'phone', color: '#A78BFA', label: 'Входящие', sub: 'Все записи от Команд iOS',
        tag: inbox.length ? String(inbox.length) : null, onClick: () => ctx.navigate('#/inbox'),
      })),

    h('div', { class: 'group-title', text: 'Об этом устройстве' }),
    h('p', {
      class: 'note-text',
      text: persisted === true
        ? 'Хранилище защищено от автоматической очистки.'
        : 'Данные лежат в памяти этого устройства. Если удалить иконку приложения с экрана «Домой», они удалятся вместе с ней. Делайте бэкап.',
    })));
}

// ---------- Категории ----------

export async function renderCategories(root, ctx) {
  const { db, state } = ctx;
  state.catType ??= 'expense';
  const all = (await db.getAll('categories')).filter((c) => !c.deleted);
  const list = all.filter((c) => c.type === state.catType).sort(byOrder);

  const tabs = h('div', { class: 'seg-plain', role: 'group', 'aria-label': 'Тип категорий' },
    ['expense', 'income'].map((type) => h('button', {
      type: 'button', text: TYPE_LABELS[type], 'aria-pressed': String(state.catType === type),
      onClick: () => { state.catType = type; ctx.render(); },
    })));

  const listEl = h('div', { class: 'list' });
  for (const category of list) {
    const handle = h('button', { type: 'button', class: 'drag-handle', 'aria-label': `Переместить «${category.name}»` }, icon('drag', 20));
    const row = listItem({
      lead: handle, iconName: category.icon, color: category.color, label: category.name,
      tag: category.hidden ? 'скрыта' : null,
      onClick: async () => { if (await editCategory(ctx, { category })) ctx.render(); },
    });
    row.dataset.id = category.id;
    handle.addEventListener('click', (event) => event.stopPropagation());
    handle.addEventListener('pointerdown', (event) => startDrag(event, row, handle));
    listEl.append(row);
  }

  // Перетаскивание: строка меняется местами с соседней, когда палец пересекает её середину.
  function startDrag(event, row, handle) {
    event.preventDefault();
    event.stopPropagation();
    try { handle.setPointerCapture(event.pointerId); } catch { /* указатель уже отпущен */ }
    row.classList.add('dragging');
    const from = [...listEl.children].indexOf(row);
    const move = (ev) => {
      const prev = row.previousElementSibling;
      const next = row.nextElementSibling;
      const middle = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
      if (prev && ev.clientY < middle(prev)) listEl.insertBefore(row, prev);
      else if (next && ev.clientY > middle(next)) listEl.insertBefore(next, row);
    };
    const end = async () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      row.classList.remove('dragging');
      const to = [...listEl.children].indexOf(row);
      if (to === from) return;
      const moved = moveItem(list, from, to);
      await db.putMany('categories', moved.filter((c) => !list.includes(c))); // только изменившиеся
      ctx.render();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Категории'),
    tabs,
    list.length ? listEl : h('p', { class: 'empty', text: 'Категорий этого типа нет' }),
    h('p', { class: 'note-text', text: 'Порядок меняется перетаскиванием за значок слева. Скрытые категории не предлагаются при вводе, но их операции остаются.' }),
    h('button', {
      type: 'button', class: 'btn-secondary', text: 'Новая категория',
      onClick: async () => { if (await editCategory(ctx, { type: state.catType })) ctx.render(); },
    })));
}

// ---------- Счета ----------

export async function renderAccounts(root, ctx) {
  const { db } = ctx;
  const [allAccounts, txs] = await Promise.all([db.getAll('accounts'), db.getAll('transactions')]);
  const accounts = allAccounts.filter((a) => !a.deleted).sort(byOrder);
  const balances = accountBalances(allAccounts, txs);

  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Счета'),
    h('div', { class: 'list' }, accounts.map((account) => listItem({
      iconName: account.icon || 'wallet', color: '#10B981', label: account.name,
      tag: account.hidden ? 'скрыт' : null,
      right: formatMoney(balances.get(account.id), account.currency),
      onClick: async () => { if (await editAccount(ctx, { account })) ctx.render(); },
    }))),
    h('p', { class: 'note-text', text: 'Остаток = начальный остаток + доходы − расходы ± переводы. Счёт с операциями нельзя удалить, только скрыть.' }),
    h('button', {
      type: 'button', class: 'btn-secondary', text: 'Новый счёт',
      onClick: async () => { if (await editAccount(ctx)) ctx.render(); },
    })));
}

// ---------- Шаблоны ----------

export async function renderTemplates(root, ctx) {
  const { db } = ctx;
  const [templates, categories] = await Promise.all([db.getAll('templates'), db.getAll('categories')]);
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const live = templates.filter((t) => !t.deleted).sort((a, b) => a.updated_at - b.updated_at);

  async function open(template) {
    const picked = await pickSheet({
      title: template.name,
      items: [
        { value: 'use', label: 'Создать операцию', icon: 'plus' },
        { value: 'rename', label: 'Переименовать', icon: 'book' },
        { value: 'delete', label: 'Удалить шаблон', icon: 'trash', color: '#F87171' },
      ],
    });
    if (picked?.value === 'use') ctx.navigate(`#/add?t=${template.id}`);
    if (picked?.value === 'rename') {
      const name = await promptSheet({ title: 'Название шаблона', value: template.name });
      if (name) { await db.put('templates', { ...template, name, updated_at: Date.now() }); ctx.render(); }
    }
    if (picked?.value === 'delete') {
      const yes = await confirmSheet({ title: `Удалить шаблон «${template.name}»?`, confirmLabel: 'Удалить', danger: true });
      if (yes) { await db.softDelete('templates', template.id); toast('Шаблон удалён'); ctx.render(); }
    }
  }

  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Шаблоны'),
    live.length
      ? h('div', { class: 'list' }, live.map((template) => {
        const category = categoriesById.get(template.category_id);
        return listItem({
          iconName: template.type === 'transfer' ? 'transfer' : category?.icon ?? 'bolt',
          color: template.type === 'transfer' ? '#60A5FA' : category?.color ?? '#FBBF24',
          label: template.name,
          sub: TYPE_LABELS[template.type],
          right: template.amount ? formatMoney(template.amount, template.currency) : null,
          onClick: () => open(template),
        });
      }))
      : h('p', { class: 'empty', text: 'Шаблонов пока нет' }),
    h('p', { class: 'note-text', text: 'Чтобы создать шаблон, откройте новую или существующую операцию и выберите «⋮» → «Сохранить как шаблон». Шаблоны открываются кнопкой с молнией на главной.' })));
}
