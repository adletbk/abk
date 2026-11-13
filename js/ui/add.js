// Добавление и правка операции.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { pickSheet, confirmSheet } from './sheet.js';
import { createKeypad } from './keypad.js';
import {
  CURRENCIES, amountToText, currencySymbol, formatKeypadText, keypadReduce, parseAmount,
} from '../money.js';
import {
  TYPE_LABELS, dayKey, dayTitle, localIso, monthKey, newTransaction, todayKey, validateTransaction,
} from '../model.js';

const TYPE_ORDER = ['expense', 'income', 'transfer'];
const TYPE_CLASS = { expense: 'expense', income: 'income', transfer: '' };

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

  const defaultAccount = accountsById.has(lastAccountId) && accounts.some((a) => a.id === lastAccountId)
    ? lastAccountId : accounts[0]?.id ?? null;
  const form = existing ? {
    type: existing.type,
    text: amountToText(existing.amount),
    accountId: existing.account_id,
    toAccountId: existing.to_account_id,
    day: dayKey(existing.date),
    currency: existing.currency,
    note: existing.note ?? '',
    categoryId: existing.category_id,
  } : {
    type: 'expense',
    text: '',
    accountId: defaultAccount,
    toAccountId: null,
    day: todayKey(),
    currency: accountsById.get(defaultAccount)?.currency ?? 'KZT',
    note: '',
    categoryId: null,
  };

  // --- переключатель типа ---
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Тип операции' });
  function paintSeg() {
    clear(seg).append(...TYPE_ORDER.map((type) => h('button', {
      type: 'button', text: TYPE_LABELS[type], 'aria-pressed': String(form.type === type),
      onClick: () => setType(type),
    })));
  }
  function setType(type) {
    if (form.type === type) return;
    form.type = type;
    if (categoriesById.get(form.categoryId)?.type !== type) form.categoryId = null;
    if (type === 'transfer' && (!form.toAccountId || form.toAccountId === form.accountId)) {
      form.toAccountId = accounts.find((a) => a.id !== form.accountId)?.id ?? null;
    }
    paintSeg(); paintAmount(); paintChips(); paintCats();
  }

  // --- сумма ---
  const amount = h('div', { class: 'amount', 'aria-live': 'polite' });
  function paintAmount() {
    const text = `${formatKeypadText(form.text)} ${currencySymbol(form.currency)}`;
    amount.textContent = text;
    amount.className = ['amount', TYPE_CLASS[form.type], text.length > 11 ? 'long' : '',
      parseAmount(form.text) === 0 ? 'zero' : ''].filter(Boolean).join(' ');
  }

  // --- чипы: счёт, куда, дата, валюта ---
  const chips = h('div', { class: 'chips' });
  const accountItems = (excludeId) => accounts.filter((a) => a.id !== excludeId)
    .map((a) => ({ value: a.id, label: a.name, icon: a.icon || 'card' }));

  function paintChips() {
    const today = todayKey();
    const dateInput = h('input', {
      type: 'date', value: form.day, 'aria-label': 'Дата операции',
      onChange: () => { if (dateInput.value) { form.day = dateInput.value; paintChips(); } },
    });
    clear(chips).append(...[
      h('button', { type: 'button', class: 'chip', onClick: pickAccount },
        icon(accountsById.get(form.accountId)?.icon || 'card', 20),
        h('span', { class: 'chip-label', text: accountsById.get(form.accountId)?.name ?? 'Счёт' })),
      form.type === 'transfer' && h('button', { type: 'button', class: 'chip', onClick: pickToAccount },
        icon('transfer', 20),
        h('span', { class: 'chip-label', text: accountsById.get(form.toAccountId)?.name ?? 'Куда' })),
      h('label', { class: 'chip chip-date' },
        icon('calendar', 20),
        h('span', { class: 'chip-label', text: dayTitle(form.day, today) }),
        dateInput),
      h('button', { type: 'button', class: 'chip', 'aria-label': 'Валюта', onClick: pickCurrency },
        h('span', { class: 'chip-label', text: `${currencySymbol(form.currency)} ${form.currency}` })),
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

  // --- категории ---
  const cats = h('div', { class: 'cats', role: 'group', 'aria-label': 'Категория' });
  function paintCats() {
    const scroll = cats.scrollLeft;
    cats.hidden = form.type === 'transfer';
    clear(cats).append(...categories.filter((c) => c.type === form.type).map((c) => h('button', {
      type: 'button', class: 'cat-tile', 'aria-pressed': String(form.categoryId === c.id),
      onClick: () => { form.categoryId = c.id; paintCats(); },
    },
    h('span', { class: 'cat-badge', style: { '--c': c.color } }, icon(c.icon, 22)),
    h('span', { text: c.name }))));
    cats.scrollLeft = scroll;
  }

  // --- клавиатура и действия ---
  const keypad = createKeypad({
    onKey: (key) => { form.text = keypadReduce(form.text, key); paintAmount(); },
  });

  let saving = false;
  async function save() {
    if (saving) return;
    const time = existing ? existing.date.slice(10) : localIso(new Date()).slice(10);
    const isTransfer = form.type === 'transfer';
    const fields = {
      type: form.type,
      amount: parseAmount(form.text),
      currency: form.currency,
      account_id: form.accountId,
      to_account_id: isTransfer ? form.toAccountId : null,
      category_id: isTransfer ? null : form.categoryId,
      note: form.note.trim(),
      date: form.day + time,
    };
    const tx = existing ? { ...existing, ...fields, updated_at: Date.now() } : newTransaction(fields);
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

  async function remove() {
    const yes = await confirmSheet({ title: 'Удалить операцию?', confirmLabel: 'Удалить', danger: true });
    if (!yes) return;
    await db.softDelete('transactions', existing.id);
    ctx.back();
  }

  paintSeg(); paintAmount(); paintChips(); paintCats();

  clear(root).append(screen);
  screen.append(
    h('div', { class: 'add-top' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onClick: () => ctx.back() }, icon('close')),
      seg),
    h('div', { class: 'add-body' }, amount, chips, note, cats),
    keypad,
    h('div', { class: 'add-actions' },
      existing && h('button', { type: 'button', class: 'btn-delete', 'aria-label': 'Удалить операцию', onClick: remove }, icon('trash')),
      h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: save })));
}
