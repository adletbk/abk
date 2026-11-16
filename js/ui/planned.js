// Календарь платежей: сетка месяца, платежи выбранного дня и месяца, редактор платежа.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { screenHeader } from './screen.js';
import { openSheet, pickSheet, confirmSheet } from './sheet.js';
import { colorStrip, iconPicker } from './editors.js';
import { formatMoney, amountToText, parseMoneyInput } from '../money.js';
import { capitalize, dayShort, dayTitle, monthTitle, plural, shiftMonth, todayKey } from '../model.js';
import { diffDays } from '../period.js';
import { CATEGORY_ICONS, PALETTE, orderedCategories } from '../catalog.js';
import {
  REPEATS, newPlanned, validatePlanned, schedule, overdue, scheduleSummary, markPlanned, monthGrid, monthRange,
} from '../planned.js';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const FALLBACK = { icon: 'lu-calendar', color: '#737373' };
const DAYS = ['день', 'дня', 'дней'];

export async function renderPlanned(root, ctx) {
  const { db, state } = ctx;
  const today = todayKey();
  const [payments, txs, categories, accounts] = await Promise.all([
    db.getAll('planned'), db.getAll('transactions'), db.getAll('categories'), db.getAll('accounts'),
  ]);
  const month = state.planMonth ?? today.slice(0, 7);
  const range = monthRange(month);
  const selected = state.planDay && state.planDay.slice(0, 7) === month ? state.planDay
    : month === today.slice(0, 7) ? today : null;

  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const live = txs.filter((tx) => !tx.deleted);
  const liveIds = new Set(live.map((tx) => tx.id));
  const txAmounts = new Map(live.map((tx) => [tx.id, tx.amount]));

  const active = payments.filter((p) => !p.deleted);
  const items = schedule(active, range.from, range.to, today, liveIds);
  const earlier = month === today.slice(0, 7) ? overdue(active, range.from, today, liveIds) : [];
  const sum = scheduleSummary(items, { txAmounts });
  const lateTotal = sum.late + earlier.length;

  const look = (p) => {
    const category = categoriesById.get(p.category_id);
    return { icon: p.icon ?? category?.icon ?? FALLBACK.icon, color: p.color ?? category?.color ?? FALLBACK.color };
  };
  const amountText = (item) => {
    const paid = item.status === 'paid' ? txAmounts.get(item.mark?.tx_id) : undefined;
    const amount = paid ?? item.payment.amount;
    return amount == null ? '—' : formatMoney(amount, item.payment.currency);
  };
  const whereText = (p) => [categoriesById.get(p.category_id)?.name, accountsById.get(p.account_id)?.name].filter(Boolean).join(' · ');
  function whenText(item) {
    const date = dayShort(item.day, today);
    if (item.status === 'paid') return `Оплачено · ${date}`;
    if (item.status === 'skipped') return `Пропущен · ${date}`;
    const days = diffDays(today, item.day);
    if (days < 0) return `Просрочен на ${-days} ${plural(-days, DAYS)} · до ${date}`;
    if (days === 0) return 'Оплатить сегодня';
    return `до ${date} · через ${days} ${plural(days, DAYS)}`;
  }

  const rerender = () => ctx.render();
  const save = async (payment) => { await db.put('planned', payment); await rerender(); };
  const pay = (item) => ctx.navigate(`#/add?plan=${item.payment.id}_${item.day}`);

  async function openActions(item) {
    const open = item.status === 'due' || item.status === 'late';
    const picked = await pickSheet({
      title: `${item.payment.name} · ${dayShort(item.day, today)}`,
      items: [
        open && { value: 'pay', label: 'Оплатить: создать расход', icon: 'arrow-out', color: '#10B981' },
        open && { value: 'paid', label: 'Уже оплачено, без операции', icon: 'check', color: '#60A5FA' },
        open && { value: 'skip', label: 'Пропустить в этот раз', icon: 'close', color: '#737373' },
        item.status === 'paid' && item.mark?.tx_id && { value: 'tx', label: 'Открыть операцию', icon: 'arrow-out', color: '#10B981' },
        !open && { value: 'unmark', label: item.status === 'paid' ? 'Снять отметку об оплате' : 'Вернуть платёж', icon: 'close', color: '#737373' },
        { value: 'edit', label: 'Изменить платёж', icon: 'lu-pen', color: '#A78BFA' },
      ].filter(Boolean),
    });
    if (!picked) return;
    if (picked.value === 'pay') pay(item);
    if (picked.value === 'tx') ctx.navigate(`#/add/${item.mark.tx_id}`);
    if (picked.value === 'paid') await save(markPlanned(item.payment, item.day, 'paid'));
    if (picked.value === 'skip') await save(markPlanned(item.payment, item.day, 'skipped'));
    if (picked.value === 'unmark') await save(markPlanned(item.payment, item.day, null));
    if (picked.value === 'edit') await edit(item.payment);
  }
  async function edit(payment = null, day = null) {
    const result = await editPlanned(ctx, { payment, day, categories, accounts });
    if (result) await rerender();
  }

  function row(item, sub) {
    const { payment, status } = item;
    const paint = look(payment);
    const open = status === 'due' || status === 'late';
    return h('div', { class: `plan-row ${status}` },
      h('button', { type: 'button', class: 'plan-main', onClick: () => openActions(item) },
        h('span', { class: 'cat-badge', style: { '--c': paint.color } }, icon(paint.icon, 22)),
        h('span', { class: 'plan-text' },
          h('span', { class: 'plan-name', text: payment.name }),
          h('span', { class: 'plan-sub', text: sub })),
        h('span', { class: 'plan-amount num', text: amountText(item) })),
      open
        ? h('button', { type: 'button', class: 'plan-pay', text: 'Оплатить', onClick: () => pay(item) })
        : h('span', { class: 'plan-done', role: 'img', 'aria-label': status === 'paid' ? 'Оплачено' : 'Пропущен' },
          icon(status === 'paid' ? 'check' : 'close', 18)));
  }
  const list = (rows) => h('div', { class: 'plan-list' }, rows);

  // --- сетка месяца ---
  const byDay = new Map();
  for (const item of items) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  const cell = (day) => {
    if (!day) return h('span', { class: 'plan-day blank' });
    const dayItems = (byDay.get(day) ?? []).filter((item) => item.status !== 'skipped');
    const cls = ['plan-day', day === today && 'today', day === selected && 'sel', day < today && 'past'].filter(Boolean).join(' ');
    const label = `${dayTitle(day, today)}${dayItems.length ? `, платежей: ${dayItems.length}` : ''}`;
    return h('button', {
      type: 'button', class: cls, 'aria-label': label, 'aria-pressed': String(day === selected),
      onClick: () => { state.planDay = day; rerender(); },
    },
    h('span', { text: String(Number(day.slice(8))) }),
    h('span', { class: 'plan-dots' },
      dayItems.slice(0, 3).map((item) => h('span', { class: `plan-dot ${item.status}`, style: { '--c': look(item.payment).color } })),
      dayItems.length > 3 && h('span', { class: 'plan-more', text: '+' })));
  };
  const grid = h('div', { class: 'plan-grid' },
    WEEKDAYS.map((name) => h('span', { class: 'plan-wd', text: name })),
    monthGrid(month).flat().map(cell));

  const shift = (delta) => { state.planMonth = shiftMonth(month, delta); state.planDay = null; rerender(); };
  const [year] = month.split('-');
  const title = `${capitalize(monthTitle(month, `${year}-01-01`))} ${year}`;
  const pill = h('div', { class: 'period' },
    h('button', { type: 'button', 'aria-label': 'Предыдущий месяц', onClick: () => shift(-1) }, icon('chevron-left', 18)),
    h('button', {
      type: 'button', class: 'period-title', text: title, 'aria-label': `${title}. Вернуться к текущему месяцу`,
      onClick: () => { state.planMonth = null; state.planDay = null; rerender(); },
    }),
    h('button', { type: 'button', 'aria-label': 'Следующий месяц', onClick: () => shift(1) }, icon('chevron-right', 18)));

  const stat = (label, value, cls = '') => h('div', { class: 'plan-stat' },
    h('span', { class: 'plan-stat-label', text: label }), h('span', { class: `plan-stat-value num ${cls}`, text: value }));
  const summary = h('div', { class: 'plan-summary' },
    stat('Осталось оплатить', formatMoney(sum.left) + (sum.unknown ? ' + ?' : '')),
    stat('Оплачено', formatMoney(sum.paid)),
    stat('Просрочено', String(lateTotal), lateTotal ? 'late' : ''));

  const selectedItems = selected ? items.filter((item) => item.day === selected) : [];
  const rest = items.filter((item) => item.day !== selected);
  const addButton = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Новый платёж', onClick: () => edit(null, selected ?? range.from) }, icon('plus'));

  async function openAll() {
    const picked = await pickSheet({
      title: 'Все платежи',
      items: [...active].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((p) => ({
        value: p.id, label: p.name, icon: look(p).icon, color: look(p).color,
        right: `${REPEATS.find((r) => r.value === p.repeat)?.label ?? ''}${p.amount == null ? '' : ` · ${formatMoney(p.amount, p.currency)}`}`,
      })),
    });
    if (picked) await edit(active.find((p) => p.id === picked.value));
  }

  clear(root).append(h('div', { class: 'screen screen-planned' },
    screenHeader(ctx, 'Календарь платежей', addButton),
    h('div', { class: 'plan-period' }, pill),
    summary,
    sum.unknown > 0 && h('p', { class: 'note-text', text: `«+ ?» — ${sum.unknown} ${plural(sum.unknown, ['платёж', 'платежа', 'платежей'])} без суммы: она вводится при оплате.` }),
    grid,
    active.length === 0 && h('div', { class: 'plan-empty' },
      h('p', { class: 'note-text', text: 'Платежей пока нет. Добавьте подписку, аренду или кредит — в нужный день они появятся в календаре. Плановый платёж не меняет остатки, пока вы его не оплатили.' }),
      h('button', { type: 'button', class: 'btn-primary', text: 'Добавить платёж', onClick: () => edit(null, selected ?? range.from) })),
    earlier.length > 0 && h('div', { class: 'group-title late', text: 'Просрочено в прошлых месяцах' }),
    earlier.length > 0 && list(earlier.map((item) => row(item, whenText(item)))),
    selected && active.length > 0 && h('div', { class: 'group-title', text: dayTitle(selected, today) }),
    selected && active.length > 0 && (selectedItems.length
      ? list(selectedItems.map((item) => row(item, item.status === 'due' || item.status === 'late' ? whereText(item.payment) || whenText(item) : whenText(item))))
      : h('p', { class: 'note-text', text: 'На этот день платежей нет.' })),
    rest.length > 0 && h('div', { class: 'group-title', text: selected ? 'Остальные в этом месяце' : 'Платежи месяца' }),
    rest.length > 0 && list(rest.map((item) => row(item, whenText(item)))),
    active.length > 0 && h('button', { type: 'button', class: 'btn-secondary', text: `Все платежи · ${active.length}`, onClick: openAll })));
}

/**
 * Создание или правка планового платежа. Возвращает сохранённый платёж,
 * 'deleted' после удаления или null, если лист закрыли.
 */
export function editPlanned(ctx, { payment = null, day = null, categories, accounts }) {
  const { db } = ctx;
  return new Promise((resolve) => {
    let result = null;
    const draft = payment ? { ...payment } : newPlanned({ start: day ?? todayKey() });
    const expense = orderedCategories(categories.filter((c) => !c.deleted && !c.hidden && c.type === 'expense'));
    const usable = accounts.filter((a) => !a.deleted && !a.hidden).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const categoryOf = () => categories.find((c) => c.id === draft.category_id);
    const accountOf = () => accounts.find((a) => a.id === draft.account_id);
    if (!payment) db.getSetting('last_account_id', null).then((id) => {
      if (!draft.account_id && usable.some((a) => a.id === id)) { draft.account_id = id; paintLines(); }
    });

    const badge = h('span', { class: 'cat-badge' });
    const name = h('input', {
      class: 'name-input', type: 'text', value: draft.name, placeholder: 'Название: Netflix, аренда…', maxlength: '40',
      autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Название платежа',
    });
    const paintBadge = () => {
      const category = categoryOf();
      badge.style.setProperty('--c', draft.color ?? category?.color ?? FALLBACK.color);
      clear(badge).append(icon(draft.icon ?? category?.icon ?? FALLBACK.icon, 24));
    };

    const amount = h('input', {
      class: 'line-input num', type: 'text', inputmode: 'decimal', placeholder: 'при оплате',
      value: draft.amount ? amountToText(draft.amount) : '', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Сумма',
    });
    const start = h('input', { class: 'line-input plan-date', type: 'date', value: draft.start ?? '', 'aria-label': 'Оплатить до' });
    const note = h('input', {
      class: 'line-input', type: 'text', value: draft.note ?? '', placeholder: 'необязательно', maxlength: '200',
      autocomplete: 'off', 'aria-label': 'Заметка',
    });
    const categoryButton = h('button', { type: 'button', class: 'line-value', onClick: pickCategory });
    const accountButton = h('button', { type: 'button', class: 'line-value', onClick: pickAccount });
    const lookButton = h('button', { type: 'button', class: 'line-value', onClick: pickLook });
    function paintLines() {
      categoryButton.textContent = categoryOf()?.name ?? 'Выбрать';
      accountButton.textContent = accountOf()?.name ?? 'Не выбран';
      lookButton.textContent = draft.icon || draft.color ? 'Свои' : 'Как у категории';
      paintBadge();
    }
    async function pickCategory() {
      const picked = await pickSheet({
        title: 'Категория', selected: draft.category_id,
        items: expense.map((c) => ({ value: c.id, label: `${c.depth ? '— ' : ''}${c.name}`, icon: c.icon, color: c.color })),
      });
      if (!picked) return;
      draft.category_id = picked.value;
      if (!name.value.trim()) name.value = categoryOf()?.name ?? '';
      paintLines();
    }
    async function pickAccount() {
      const picked = await pickSheet({
        title: 'Счёт', selected: draft.account_id,
        items: usable.map((a) => ({ value: a.id, label: a.name, icon: a.icon || 'wallet', color: a.color })),
      });
      if (!picked) return;
      draft.account_id = picked.value;
      draft.currency = accountOf()?.currency ?? draft.currency;
      paintLines();
    }
    function pickLook() {
      const category = categoryOf();
      const current = { icon: draft.icon ?? category?.icon ?? FALLBACK.icon, color: draft.color ?? category?.color ?? PALETTE[20] };
      const closeLook = openSheet({
        title: 'Иконка и цвет', tall: true,
        content: h('div', { class: 'form' },
          colorStrip({ get: () => current.color, set: (v) => { current.color = v; draft.color = v; paintLines(); } }),
          iconPicker({ get: () => current.icon, set: (v) => { current.icon = v; draft.icon = v; paintLines(); }, basic: CATEGORY_ICONS }),
          h('button', { type: 'button', class: 'btn-primary', text: 'Готово', onClick: () => closeLook() }),
          h('button', {
            type: 'button', class: 'btn-secondary', text: 'Как у категории',
            onClick: () => { draft.icon = null; draft.color = null; paintLines(); closeLook(); },
          })),
      });
    }

    const seg = h('div', { class: 'plan-seg', role: 'group', 'aria-label': 'Повтор' });
    const paintSeg = () => clear(seg).append(...REPEATS.map((r) => h('button', {
      type: 'button', text: r.label, 'aria-pressed': String(draft.repeat === r.value),
      onClick: () => { draft.repeat = r.value; paintSeg(); },
    })));

    async function save() {
      const value = amount.value.trim() === '' ? 0 : parseMoneyInput(amount.value);
      if (value === null || value < 0) { toast('Сумма: введите число'); return; }
      Object.assign(draft, {
        name: name.value.trim() || categoryOf()?.name || '', amount: value === 0 ? null : value,
        start: start.value, note: note.value.trim(), updated_at: Date.now(),
      });
      const errors = validatePlanned(draft);
      if (errors.length) { toast(errors[0]); return; }
      await db.put('planned', draft);
      result = draft;
      close();
    }
    async function remove() {
      const yes = await confirmSheet({
        title: `Удалить платёж «${payment.name}»?`, confirmLabel: 'Удалить', danger: true,
        text: 'Он исчезнет из календаря. Операции, созданные при оплате, останутся.',
      });
      if (!yes) return;
      await db.softDelete('planned', payment.id);
      result = 'deleted';
      close();
    }

    paintLines(); paintSeg();
    const line = (label, control, sub = null) => h('div', { class: 'form-line' },
      h('span', { class: 'form-line-main' }, h('span', { text: label }), sub && h('span', { class: 'form-line-sub', text: sub })), control);
    const content = h('div', { class: 'form' },
      h('div', { class: 'name-row' }, badge, name),
      h('div', { class: 'form-card' },
        line('Сумма', amount),
        line('Категория', categoryButton),
        line('Счёт', accountButton),
        line(payment ? 'Первая дата' : 'Оплатить до', start)),
      seg,
      h('div', { class: 'form-card' },
        line('Иконка и цвет', lookButton),
        line('Заметка', note)),
      h('p', { class: 'field-hint', text: 'Повтор считается от выбранной даты: каждый месяц в то же число, каждую неделю в тот же день. Плановые платежи хранятся только на устройстве и в JSON-бэкапе.' }),
      h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: save }),
      payment && h('button', { type: 'button', class: 'btn-secondary btn-danger', text: 'Удалить', onClick: remove }));
    const close = openSheet({ title: payment ? 'Платёж' : 'Новый платёж', content, tall: true, onClose: () => resolve(result) });
  });
}
