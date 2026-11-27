// Добавление и правка операции.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { openSheet, pickSheet, confirmSheet } from './sheet.js';
import { createKeypad } from './keypad.js';
import {
  CURRENCIES, amountToText, currencySymbol, formatKeypadText, formatMoney, keypadReduce, parseAmount,
} from '../money.js';
import { editCategory, promptSheet } from './editors.js';
import { templateFromTransaction, fieldsFromTemplate, orderedCategories, templateGroups } from '../catalog.js';
import { learnCard, learnMerchant } from '../inbox.js';
import { ACCOUNT_RANK } from '../parser.js';
import { eventDate } from '../parser.js';
import { revealDay } from '../period.js';
import { markPlanned } from '../planned.js';
import {
  TYPE_LABELS, dayKey, dayShort, localIso, newTransaction, todayKey, validateTransaction,
} from '../model.js';

const TYPE_ORDER = ['income', 'expense', 'transfer'];
const TYPE_ICON = { income: 'arrow-in', expense: 'arrow-out', transfer: 'transfer' };


export async function renderAdd(root, ctx, { id = null, templateId = null, inboxId = null, planRef = null } = {}) {
  const { db, state } = ctx;
  const [allCategories, allAccounts, lastAccountId] = await Promise.all([
    db.getAll('categories'), db.getAll('accounts'), db.getSetting('last_account_id', null),
  ]);
  const existing = id ? await db.get('transactions', id) : null;
  if (id && (!existing || existing.deleted)) { ctx.back(); return; }
  const template = !id && templateId ? await db.get('templates', templateId) : null;
  // Операция вручную из неразобранной записи: текст уходит в заметку, время берётся из записи.
  const inboxItem = !id && inboxId ? await db.get('inbox', inboxId) : null;

  // Оплата планового платежа из календаря: ссылка «id_дата», поля берутся из платежа.
  const planCut = !id && planRef ? planRef.lastIndexOf('_') : -1;
  const planDay = planCut > 0 ? planRef.slice(planCut + 1) : null;
  const plan = planCut > 0 ? await db.get('planned', planRef.slice(0, planCut)) : null;

  const accounts = allAccounts.filter((a) => !a.deleted && !a.hidden).sort((a, b) => a.order - b.order);
  const accountsById = new Map(allAccounts.map((a) => [a.id, a]));
  const categories = allCategories.filter((c) => !c.deleted && !c.hidden).sort((a, b) => a.order - b.order);
  const categoriesById = new Map(allCategories.map((c) => [c.id, c]));

  const defaultAccount = accounts.some((a) => a.id === lastAccountId) ? lastAccountId : accounts[0]?.id ?? null;
  const form = existing ? {
    type: existing.type,
    text: amountToText(existing.amount),
    accountId: existing.account_id,
    toAccountId: existing.to_account_id,
    when: existing.date.slice(0, 16), // «ГГГГ-ММ-ДДTЧЧ:ММ»
    currency: existing.currency,
    note: existing.note ?? '',
    categoryId: existing.category_id,
  } : {
    type: 'expense',
    text: '',
    accountId: defaultAccount,
    toAccountId: null,
    when: localIso(new Date()).slice(0, 16),
    currency: accountsById.get(defaultAccount)?.currency ?? 'KZT',
    note: '',
    categoryId: null,
  };
  // Шаблон только заполняет форму: записывает операцию по-прежнему кнопка «Сохранить».
  let templateUsed = null;
  function applyTemplate(chosen) {
    const t = fieldsFromTemplate(chosen);
    const usable = (accountId) => (accounts.some((a) => a.id === accountId) ? accountId : null);
    Object.assign(form, {
      type: t.type,
      text: amountToText(t.amount ?? 0),
      accountId: usable(t.account_id) ?? form.accountId,
      toAccountId: usable(t.to_account_id),
      currency: t.currency ?? form.currency,
      note: t.note ?? '',
      categoryId: categories.some((c) => c.id === t.category_id) ? t.category_id : null,
    });
    templateUsed = chosen.id;
  }
  if (template && !template.deleted) applyTemplate(template);

  if (plan && !plan.deleted) {
    const accountId = accounts.some((a) => a.id === plan.account_id) ? plan.account_id : form.accountId;
    Object.assign(form, {
      type: 'expense',
      text: amountToText(plan.amount ?? 0),
      accountId,
      currency: accountsById.get(accountId)?.currency ?? plan.currency ?? form.currency,
      note: [plan.name, plan.note].filter(Boolean).join(' · ').slice(0, 200),
      categoryId: categories.some((c) => c.id === plan.category_id && c.type === 'expense') ? plan.category_id : null,
    });
  }

  if (inboxItem) {
    form.note = (inboxItem.text ?? '').slice(0, 200);
    form.when = eventDate(inboxItem).slice(0, 16);
  }

  // --- переключатель типа: у выбранного видна подпись, у остальных только иконка ---
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Тип операции' });
  function paintSeg() {
    clear(seg).append(...TYPE_ORDER.map((type) => h('button', {
      type: 'button', class: `seg-${type}`, 'aria-label': TYPE_LABELS[type],
      'aria-pressed': String(form.type === type),
      onClick: () => setType(type),
    }, icon(TYPE_ICON[type], 22), form.type === type && h('span', { text: TYPE_LABELS[type] }))));
  }
  function setType(type) {
    if (form.type === type) return;
    form.type = type;
    if (categoriesById.get(form.categoryId)?.type !== type) form.categoryId = null;
    if (type === 'transfer' && (!form.toAccountId || form.toAccountId === form.accountId)) {
      form.toAccountId = accounts.find((a) => a.id !== form.accountId)?.id ?? null;
    }
    paintSeg(); paintChips(); paintCats();
  }

  // --- сумма ---
  const amount = h('div', { class: 'amount', 'aria-live': 'polite' });
  function paintAmount() {
    const text = `${formatKeypadText(form.text)} ${currencySymbol(form.currency)}`;
    amount.textContent = text;
    amount.className = ['amount', text.length > 9 ? 'long' : '', parseAmount(form.text) === 0 ? 'zero' : '']
      .filter(Boolean).join(' ');
  }

  // --- чипы: счёт, куда, дата и время, валюта ---
  const chips = h('div', { class: 'chips' });
  const accountItems = (excludeId) => accounts.filter((a) => a.id !== excludeId)
    .map((a) => ({ value: a.id, label: a.name, icon: a.icon || 'wallet', color: a.color }));

  function paintChips() {
    const whenInput = h('input', {
      type: 'datetime-local', value: form.when, 'aria-label': 'Дата и время операции',
      onChange: () => { if (whenInput.value) { form.when = whenInput.value.slice(0, 16); paintChips(); } },
    });
    clear(chips).append(...[
      h('button', {
        type: 'button', class: 'chip chip-account', onClick: pickAccount,
        style: accountsById.get(form.accountId)?.color ? { '--c': accountsById.get(form.accountId).color } : null,
      },
      icon(accountsById.get(form.accountId)?.icon || 'wallet', 20),
        h('span', { class: 'chip-label', text: accountsById.get(form.accountId)?.name ?? 'Счёт' })),
      form.type === 'transfer' && h('button', { type: 'button', class: 'chip chip-account', onClick: pickToAccount },
        icon('transfer', 20),
        h('span', { class: 'chip-label', text: accountsById.get(form.toAccountId)?.name ?? 'Куда' })),
      h('label', { class: 'chip chip-date' },
        h('span', { class: 'chip-label', text: `${dayShort(dayKey(form.when), todayKey())} ${form.when.slice(11, 16)}` }),
        whenInput),
      h('button', {
        type: 'button', class: 'chip chip-currency', 'aria-label': `Валюта: ${form.currency}`, onClick: pickCurrency,
        text: currencySymbol(form.currency),
      }),
      !existing && h('button', {
        type: 'button', class: 'chip chip-icon' + (templateUsed ? ' on' : ''), onClick: pickTemplate,
        'aria-label': templateUsed ? 'Шаблоны: шаблон применён' : 'Шаблоны',
      }, icon('bolt', 20)),
    ].filter(Boolean));
  }
  async function pickAccount() {
    const picked = await pickSheet({ title: 'Счёт', selected: form.accountId, items: accountItems(null) });
    if (!picked) return;
    form.accountId = picked.value;
    if (!existing) form.currency = accountsById.get(picked.value)?.currency ?? form.currency;
    if (form.toAccountId === form.accountId) form.toAccountId = accounts.find((a) => a.id !== form.accountId)?.id ?? null;
    paintChips(); paintAmount();
  }
  async function pickToAccount() {
    const picked = await pickSheet({ title: 'Куда перевести', selected: form.toAccountId, items: accountItems(form.accountId) });
    if (picked) { form.toAccountId = picked.value; paintChips(); }
  }
  /** Список шаблонов: частые сверху, остальные по алфавиту, поиск при длинном списке. */
  async function pickTemplate() {
    const [templates, usage] = await Promise.all([db.getAll('templates'), db.getSetting('template_usage', {})]);
    const live = templates.filter((t) => !t.deleted);
    const body = h('div', {});
    const search = live.length > 8 && h('input', {
      class: 'field-input sheet-search', type: 'search', placeholder: 'Найти шаблон', autocomplete: 'off',
      enterkeyhint: 'search', 'aria-label': 'Найти шаблон', onInput: () => paintList(),
    });
    const item = (t) => {
      const category = categoriesById.get(t.category_id);
      const transfer = t.type === 'transfer';
      return h('button', { type: 'button', class: 'sheet-item', onClick: () => choose(t) },
        h('span', { class: 'cat-badge', style: { '--c': transfer ? '#4C8DFF' : category?.color ?? '#A3A3A3' } },
          icon(transfer ? 'transfer' : category?.icon ?? 'bolt', 22)),
        h('span', { class: 'label', text: t.name }),
        h('span', { class: 'right', text: t.amount ? formatMoney(t.amount, t.currency) : 'без суммы' }),
        h('span', { class: 'check' }, t.id === templateUsed ? icon('check') : null));
    };
    const group = (title) => h('div', { class: 'sheet-group', text: title });
    function paintList() {
      const { frequent, all } = templateGroups(live, usage, { query: search ? search.value : '' });
      clear(body).append(...[
        frequent.length > 0 && group('Часто'), ...frequent.map(item),
        frequent.length > 0 && all.length > 0 && group('Все'), ...all.map(item),
        live.length === 0 && h('p', { class: 'sheet-text', text: 'Шаблонов пока нет. Заполните операцию и выберите в меню «⋯» «Сохранить как шаблон».' }),
        live.length > 0 && frequent.length + all.length === 0 && h('p', { class: 'sheet-text', text: 'Ничего не найдено' }),
      ].filter(Boolean));
    }
    function choose(t) {
      applyTemplate(t);
      close();
      repaint();
    }
    paintList();
    const close = openSheet({
      title: 'Шаблоны', tall: live.length > 8,
      content: h('div', {}, search, body,
        templateUsed && h('button', {
          type: 'button', class: 'sheet-item', onClick: () => {
            Object.assign(form, { text: '', note: '', categoryId: null });
            templateUsed = null;
            close();
            repaint();
          },
        }, h('span', { class: 'cat-badge', style: { '--c': '#A3A3A3' } }, icon('close', 22)), h('span', { class: 'label', text: 'Очистить поля' })),
        h('button', { type: 'button', class: 'sheet-item', onClick: () => { close(); ctx.navigate('#/templates'); } },
          h('span', { class: 'cat-badge', style: { '--c': '#A3A3A3' } }, icon('settings', 22)), h('span', { class: 'label', text: 'Изменить шаблоны' }))),
    });
  }
  function repaint() {
    note.value = form.note;
    paintSeg(); paintAmount(); paintChips(); paintCats({ reveal: true });
  }

  async function pickCurrency() {
    const picked = await pickSheet({
      title: 'Валюта', selected: form.currency,
      items: Object.entries(CURRENCIES).map(([code, c]) => ({ value: code, label: `${c.symbol}  ${c.name}`, right: code })),
    });
    if (picked) { form.currency = picked.value; paintChips(); paintAmount(); }
  }

  // --- заметка ---
  const screen = h('div', { class: 'screen-add' });
  const note = h('input', {
    class: 'note', type: 'text', placeholder: 'Заметка', value: form.note, maxlength: '200',
    autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Заметка',
    onInput: () => { form.note = note.value; },
    onFocus: () => screen.classList.add('typing'),
    onBlur: () => screen.classList.remove('typing'),
    onKeydown: (event) => { if (event.key === 'Enter') note.blur(); },
  });

  // --- категории: лента с прокруткой; подкатегории идут сразу за родителем ---
  const cats = h('div', { class: 'cats', role: 'group', 'aria-label': 'Категория' });
  function paintCats({ reveal = false } = {}) {
    cats.hidden = form.type === 'transfer';
    const scroll = cats.scrollLeft;
    const tile = (c) => h('button', {
      type: 'button', class: 'cat-tile' + (c.depth ? ' sub' : ''), 'aria-pressed': String(form.categoryId === c.id),
      style: { '--c': c.color },
      onClick: () => { form.categoryId = c.id; paintCats(); },
    }, h('span', { class: 'cat-badge' }, icon(c.icon, 24)), h('span', { class: 'cat-name', text: c.name }));
    clear(cats).append(
      h('button', { type: 'button', class: 'cat-tile', 'aria-label': 'Новая категория', onClick: createCategory },
        h('span', { class: 'cat-badge more' }, icon('plus', 24)), h('span', { class: 'cat-name', text: 'Новая' })),
      ...orderedCategories(categories.filter((c) => c.type === form.type)).map(tile));
    cats.scrollLeft = scroll;
    if (reveal) cats.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  async function createCategory() {
    const created = await editCategory(ctx, { type: form.type });
    if (!created || created === 'deleted') return;
    categories.push(created);
    categoriesById.set(created.id, created);
    form.type = created.type;
    form.categoryId = created.id;
    paintSeg(); paintChips(); paintCats({ reveal: true });
  }

  // --- клавиатура и действия ---
  const keypad = createKeypad({
    onKey: (key) => { form.text = keypadReduce(form.text, key); paintAmount(); },
  });

  let saving = false;
  async function save() {
    if (saving) return;
    const seconds = existing ? existing.date.slice(16, 19) || ':00' : localIso(new Date()).slice(16, 19);
    const isTransfer = form.type === 'transfer';
    const fields = {
      type: form.type,
      amount: parseAmount(form.text),
      currency: form.currency,
      account_id: form.accountId,
      to_account_id: isTransfer ? form.toAccountId : null,
      category_id: isTransfer ? null : form.categoryId,
      note: form.note.trim(),
      date: form.when + seconds,
    };
    // Правка делает тестовую операцию своей: снимаем пометку demo, чтобы её не стёрла очистка.
    // Сохранение вручную означает, что операцию проверили.
    const tx = existing
      ? { ...existing, ...fields, demo: false, status: 'ok', account_rank: ACCOUNT_RANK.manual, updated_at: Date.now() }
      : newTransaction(inboxItem ? {
        ...fields, source: inboxItem.source === 'sms' ? 'notification' : inboxItem.source,
        sources: [inboxItem.source], inbox_ids: [inboxItem.id], fingerprint: `inbox:${inboxItem.id}`,
      } : fields);
    const errors = validateTransaction(tx);
    if (errors.length) { toast(errors[0]); return; }
    saving = true;
    try {
      await db.put('transactions', tx);
      if (templateUsed && !existing) {
        // Счётчик выборов: частые шаблоны показываются в списке первыми. Хранится только на устройстве.
        const usage = await db.getSetting('template_usage', {});
        await db.setSetting('template_usage', { ...usage, [templateUsed]: (usage[templateUsed] ?? 0) + 1 });
      }
      await db.setSetting('last_account_id', tx.account_id);
      // Запоминаем категорию получателя: следующая такая операция получит её сама.
      if (existing?.merchant && tx.category_id) await learnMerchant(db, existing.merchant, tx.category_id);
      // Счёт у операции Apple Pay исправили: в следующий раз эта карта сразу попадёт на нужный счёт.
      if (existing?.card && tx.account_id !== existing.account_id) await learnCard(db, existing.card, tx.account_id);
      if (plan && !plan.deleted && /^\d{4}-\d{2}-\d{2}$/.test(planDay)) {
        // Свежая копия: платёж могли изменить, пока был открыт этот экран.
        const fresh = await db.get('planned', plan.id) ?? plan;
        await db.put('planned', markPlanned(fresh, planDay, 'paid', { txId: tx.id }));
      }
      if (inboxItem) await db.put('inbox', { ...inboxItem, status: 'done', reason: null, tx_id: tx.id, updated_at: Date.now() });
      state.period = revealDay(state.period, dayKey(tx.date), todayKey());
      ctx.back();
    } catch (error) {
      saving = false;
      console.error(error);
      toast('Не удалось сохранить операцию');
    }
  }

  async function saveAsTemplate() {
    const isTransfer = form.type === 'transfer';
    const fields = {
      type: form.type, amount: parseAmount(form.text), currency: form.currency, account_id: form.accountId,
      to_account_id: isTransfer ? form.toAccountId : null,
      category_id: isTransfer ? null : form.categoryId, note: form.note.trim(),
    };
    const suggested = fields.note || categoriesById.get(fields.category_id)?.name || TYPE_LABELS[form.type];
    const name = await promptSheet({ title: 'Название шаблона', value: suggested });
    if (!name) return;
    await db.put('templates', templateFromTransaction(fields, name));
    toast('Шаблон сохранён');
  }

  async function openMenu() {
    const picked = await pickSheet({
      title: existing ? 'Операция' : 'Новая операция',
      items: [
        { value: 'template', label: 'Сохранить как шаблон', icon: 'bolt' },
        existing && { value: 'delete', label: 'Удалить операцию', icon: 'trash', color: '#F87171' },
      ].filter(Boolean),
    });
    if (picked?.value === 'template') await saveAsTemplate();
    if (picked?.value === 'delete') {
      const yes = await confirmSheet({ title: 'Удалить операцию?', confirmLabel: 'Удалить', danger: true });
      if (!yes) return;
      await db.softDelete('transactions', existing.id);
      ctx.back();
    }
  }

  paintSeg(); paintAmount(); paintChips(); paintCats();

  clear(root).append(screen);
  // Выбранная категория должна быть видна сразу (экран к этому моменту ещё не в документе).
  requestAnimationFrame(() => paintCats({ reveal: true }));
  screen.append(
    h('div', { class: 'add-top' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onClick: () => ctx.back() }, icon('close')),
      seg,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Ещё действия', onClick: openMenu }, icon('more'))),
    h('div', { class: 'add-body' }, amount, chips, note, cats),
    keypad,
    h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: save }));
}
