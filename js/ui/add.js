// Добавление и правка операции.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { pickSheet, confirmSheet } from './sheet.js';
import { createKeypad } from './keypad.js';
import {
  CURRENCIES, amountToText, currencySymbol, formatKeypadText, keypadReduce, parseAmount,
} from '../money.js';
import {
  TYPE_LABELS, dayKey, dayShort, localIso, monthKey, newTransaction, todayKey, validateTransaction,
} from '../model.js';

const TYPE_ORDER = ['income', 'expense', 'transfer'];
const TYPE_ICON = { income: 'arrow-in', expense: 'arrow-out', transfer: 'transfer' };
const VISIBLE_CATEGORIES = 4; // остальные открываются плиткой «Ещё»

export async function renderAdd(root, ctx, { id = null } = {}) {
  const { db, state } = ctx;
  const [allCategories, allAccounts, lastAccountId] = await Promise.all([
    db.getAll('categories'), db.getAll('accounts'), db.getSetting('last_account_id', null),
  ]);
  const existing = id ? await db.get('transactions', id) : null;
  if (id && (!existing || existing.deleted)) { ctx.back(); return; }

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
    .map((a) => ({ value: a.id, label: a.name, icon: a.icon || 'wallet' }));

  function paintChips() {
    const whenInput = h('input', {
      type: 'datetime-local', value: form.when, 'aria-label': 'Дата и время операции',
      onChange: () => { if (whenInput.value) { form.when = whenInput.value.slice(0, 16); paintChips(); } },
    });
    clear(chips).append(...[
      h('button', { type: 'button', class: 'chip chip-account', onClick: pickAccount },
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

  // --- категории: первые четыре и «Ещё» ---
  const cats = h('div', { class: 'cats', role: 'group', 'aria-label': 'Категория' });
  function paintCats() {
    cats.hidden = form.type === 'transfer';
    const ofType = categories.filter((c) => c.type === form.type);
    const needMore = ofType.length > VISIBLE_CATEGORIES + 1;
    let visible = needMore ? ofType.slice(0, VISIBLE_CATEGORIES) : ofType;
    const selected = categoriesById.get(form.categoryId);
    if (needMore && selected && !visible.includes(selected)) visible = [...visible.slice(0, -1), selected];

    const tile = (c) => h('button', {
      type: 'button', class: 'cat-tile', 'aria-pressed': String(form.categoryId === c.id),
      style: { '--c': c.color },
      onClick: () => { form.categoryId = c.id; paintCats(); },
    }, h('span', { class: 'cat-badge' }, icon(c.icon, 24)), h('span', { class: 'cat-name', text: c.name }));

    clear(cats).append(...visible.map(tile));
    if (needMore) {
      cats.append(h('button', { type: 'button', class: 'cat-tile', onClick: pickCategory },
        h('span', { class: 'cat-badge more' }, icon('dots', 24)), h('span', { class: 'cat-name', text: 'Ещё' })));
    }
  }
  async function pickCategory() {
    const picked = await pickSheet({
      title: 'Категория', selected: form.categoryId,
      items: categories.filter((c) => c.type === form.type)
        .map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color })),
    });
    if (picked) { form.categoryId = picked.value; paintCats(); }
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
    const tx = existing ? { ...existing, ...fields, demo: false, updated_at: Date.now() } : newTransaction(fields);
    const errors = validateTransaction(tx);
    if (errors.length) { toast(errors[0]); return; }
    saving = true;
    try {
      await db.put('transactions', tx);
      await db.setSetting('last_account_id', tx.account_id);
      state.month = monthKey(tx.date);
      ctx.back();
    } catch (error) {
      saving = false;
      console.error(error);
      toast('Не удалось сохранить операцию');
    }
  }

  async function openMenu() {
    const picked = await pickSheet({
      title: existing ? 'Операция' : 'Новая операция',
      items: [
        { value: 'template', label: 'Сохранить как шаблон', icon: 'bolt' },
        existing && { value: 'delete', label: 'Удалить операцию', icon: 'trash', color: '#F87171' },
      ].filter(Boolean),
    });
    if (picked?.value === 'template') toast('Шаблоны появятся в M2');
    if (picked?.value === 'delete') {
      const yes = await confirmSheet({ title: 'Удалить операцию?', confirmLabel: 'Удалить', danger: true });
      if (!yes) return;
      await db.softDelete('transactions', existing.id);
      ctx.back();
    }
  }

  paintSeg(); paintAmount(); paintChips(); paintCats();

  clear(root).append(screen);
  screen.append(
    h('div', { class: 'add-top' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onClick: () => ctx.back() }, icon('close')),
      seg,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Ещё действия', onClick: openMenu }, icon('more'))),
    h('div', { class: 'add-body' }, amount, chips, note, cats),
    keypad,
    h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: save }));
}
