// «Проверить» (операции без данных и неразобранные записи) и правила разбора.
import { h, clear, toast } from './dom.js';
import { icon } from '../icons.js';
import { screenHeader, listItem } from './screen.js';
import { openSheet, pickSheet, confirmSheet } from './sheet.js';
import { formatMoney } from '../money.js';
import { TYPE_LABELS, plural } from '../model.js';
import {
  FREEDOM_PRESET, RULE_SOURCES, RULE_TYPES, addPreset, applyRule, escapeRegex, firstLine, matchAccount,
  newParseRule, normalizeMerchant, validateRule,
} from '../parser.js';
import { learnMerchant, processInbox } from '../inbox.js';
import { promptSheet } from './editors.js';

const REASONS = { no_rule: 'нет правила', no_amount: 'нет суммы', empty: 'пусто' };
const when = (item) => (item.time ?? item.received_at ?? '').replace('T', ' ').slice(0, 16);

/** Текст о результате разбора для всплывающего сообщения. */
export function describeProcessing(result) {
  const parts = [];
  if (result.created) parts.push(`создано операций: ${result.created}`);
  if (result.merged) parts.push(`объединено: ${result.merged}`);
  if (result.review + result.unparsed) parts.push(`на проверку: ${result.review + result.unparsed}`);
  if (result.ignored) parts.push(`скрыто как не операции: ${result.ignored}`);
  if (parts.length === 0) return 'Новых записей нет';
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}

// ---------- «Проверить» ----------

export async function renderReview(root, ctx) {
  const { db } = ctx;
  const [txs, inbox, categories, accounts] = await Promise.all([
    db.getAll('transactions'), db.getAll('inbox'), db.getAll('categories'), db.getAll('accounts'),
  ]);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const review = txs.filter((t) => !t.deleted && t.status === 'needs_review').sort((a, b) => b.date.localeCompare(a.date));
  const unparsed = inbox.filter((i) => i.status === 'needs_review' && !i.ignored).sort((a, b) => when(b).localeCompare(when(a)));

  async function retry() {
    const result = await processInbox(db, { retry: true });
    toast(describeProcessing(result));
    ctx.render();
  }

  async function openUnparsed(item) {
    const picked = await pickSheet({
      title: 'Неразобранная запись',
      items: [
        { value: 'manual', label: 'Создать операцию вручную', icon: 'plus' },
        { value: 'rule', label: 'Создать правило по этой записи', icon: 'table' },
        { value: 'ignore', label: 'Это не операция', icon: 'eye-off' },
        { value: 'always', label: 'Всегда скрывать такие записи', icon: 'eye-off', color: '#F87171' },
      ],
    });
    if (picked?.value === 'manual') ctx.navigate(`#/add?inbox=${item.id}`);
    if (picked?.value === 'rule') {
      const saved = await editRule(ctx, { sample: item.text, source: item.source });
      if (saved) await retry();
    }
    if (picked?.value === 'always') {
      // Правило «не операция» по первой строке записи: например, «Кешбэк за покупку».
      const head = firstLine(item.text);
      const saved = await editRule(ctx, {
        sample: item.text, source: item.source,
        preset: { type: 'ignore', name: `Не операция: ${head}`.slice(0, 60), match: `^\\s*${escapeRegex(head)}`, order: -1 },
      });
      if (saved) await retry();
    }
    if (picked?.value === 'ignore') {
      await db.put('inbox', { ...item, status: 'done', ignored: true, updated_at: Date.now() });
      ctx.render();
    }
  }

  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Проверить'),
    review.length + unparsed.length === 0 && h('p', { class: 'empty', text: 'Проверять нечего' }),

    review.length > 0 && h('div', { class: 'group-title', text: 'Операции: не хватает данных' }),
    review.length > 0 && h('div', { class: 'list' }, review.map((tx) => listItem({
      iconName: categoriesById.get(tx.category_id)?.icon ?? 'dots',
      color: categoriesById.get(tx.category_id)?.color ?? '#FBBF24',
      label: tx.note || tx.merchant || TYPE_LABELS[tx.type],
      sub: [tx.date.replace('T', ' ').slice(0, 16), accountsById.get(tx.account_id)?.name,
        !tx.category_id && tx.type !== 'transfer' ? 'нет категории' : null,
        tx.type === 'transfer' && !tx.to_account_id ? 'нет счёта зачисления' : null,
        !tx.account_id ? 'нет счёта' : null].filter(Boolean).join(' · '),
      right: formatMoney(tx.type === 'expense' ? -tx.amount : tx.amount, tx.currency),
      onClick: () => ctx.navigate(`#/add/${tx.id}`),
    }))),
    review.length > 0 && h('p', { class: 'note-text', text: 'Откройте операцию, выберите категорию и сохраните. Приложение запомнит категорию для этого получателя.' }),

    unparsed.length > 0 && h('div', { class: 'group-title', text: 'Записи: не удалось разобрать' }),
    unparsed.length > 0 && h('div', { class: 'list' }, unparsed.map((item) => listItem({
      iconName: item.source === 'applepay' ? 'card' : 'phone',
      label: item.text || JSON.stringify(item.payload ?? {}),
      sub: [RULE_SOURCES[item.source] ?? item.source, when(item)].filter(Boolean).join(' · '),
      tag: REASONS[item.reason] ?? null,
      onClick: () => openUnparsed(item),
    }))),
    unparsed.length > 0 && h('button', { type: 'button', class: 'btn-secondary', text: 'Разобрать заново', onClick: retry }),
    h('p', { class: 'note-text', text: 'Сюда попадает всё, что пришло от Команд iOS и не превратилось в готовую операцию. Ничего не удаляется само.' })));
}

// ---------- правила ----------

export async function renderRules(root, ctx) {
  const { db } = ctx;
  const [rules, categories] = await Promise.all([db.getAll('rules'), db.getAll('categories')]);
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const parse = rules.filter((r) => r.kind !== 'merchant' && !r.deleted)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name)));
  const merchants = rules.filter((r) => r.kind === 'merchant' && !r.deleted).sort((a, b) => a.merchant.localeCompare(b.merchant));

  async function addMerchant() {
    const name = await promptSheet({ title: 'Получатель', placeholder: 'например: Yozh na mametova shop', submitLabel: 'Дальше' });
    if (!name || !normalizeMerchant(name)) return;
    const picked = await pickSheet({
      title: `Категория для «${name}»`,
      items: categories.filter((c) => !c.deleted && !c.hidden && c.type === 'expense').sort((a, b) => a.order - b.order)
        .map((c) => ({ value: c.id, label: c.name, icon: c.icon, color: c.color })),
    });
    if (!picked) return;
    await learnMerchant(db, name, picked.value);
    const result = await processInbox(db, { retry: true });
    if (result.created || result.merged) toast(describeProcessing(result));
    ctx.render();
  }

  async function openMerchant(rule) {
    const yes = await confirmSheet({
      title: `Забыть категорию для «${rule.merchant}»?`,
      text: 'Следующая операция с этим получателем снова попадёт в «Проверить».',
      confirmLabel: 'Забыть', danger: true,
    });
    if (yes) { await db.softDelete('rules', rule.id); ctx.render(); }
  }

  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Правила разбора'),
    h('p', { class: 'note-text', text: 'Правило говорит, как достать из текста уведомления сумму, получателя и счёт. Правила применяются по порядку; подходит первое, которое нашло сумму. Готовых правил для банка пока нет: они появятся по вашим образцам уведомлений.' }),
    parse.length
      ? h('div', { class: 'list' }, parse.map((rule) => listItem({
        iconName: 'table', color: '#60A5FA', label: rule.name,
        sub: `${RULE_TYPES[rule.type]} · ${rule.sources.map((s) => RULE_SOURCES[s] ?? s).join(', ')}`,
        tag: rule.enabled === false ? 'выкл' : null,
        onClick: async () => { if (await editRule(ctx, { rule })) ctx.render(); },
      })))
      : h('p', { class: 'empty', text: 'Правил пока нет' }),
    h('button', {
      type: 'button', class: 'btn-secondary', text: 'Новое правило',
      onClick: async () => { if (await editRule(ctx, { order: parse.length })) ctx.render(); },
    }),
    h('button', {
      type: 'button', class: 'btn-secondary', text: 'Добавить готовые правила Freedom Bank',
      onClick: async () => {
        const added = await addPreset(db, FREEDOM_PRESET);
        const result = await processInbox(db, { retry: true });
        toast(added ? `Добавлено правил: ${added}. ${describeProcessing(result)}` : 'Эти правила уже есть');
        ctx.render();
      },
    }),

    h('div', { class: 'group-title', text: 'Получатели и категории' }),
    merchants.length
      ? h('div', { class: 'list' }, merchants.map((rule) => listItem({
        iconName: categoriesById.get(rule.category_id)?.icon ?? 'dots',
        color: categoriesById.get(rule.category_id)?.color,
        label: rule.merchant, right: categoriesById.get(rule.category_id)?.name ?? '—',
        onClick: () => openMerchant(rule),
      })))
      : h('p', { class: 'note-text', text: 'Пока пусто. Список пополняется сам, когда вы выбираете категорию у автоматической операции.' }),
    h('button', { type: 'button', class: 'btn-secondary', text: 'Добавить получателя', onClick: addMerchant }),
    merchants.length > 0 && h('p', { class: 'note-text', text: `Запомнено: ${merchants.length} ${plural(merchants.length, ['получатель', 'получателя', 'получателей'])}.` })));
}

/** Редактор правила с проверкой на примере. Возвращает правило, 'deleted' или null. */
export function editRule(ctx, { rule = null, sample = '', source = 'notification', order = 0, preset = {} } = {}) {
  const { db } = ctx;
  return new Promise((resolve) => {
    let result = null;
    let accounts = [];
    const draft = rule ? { ...rule, sources: [...rule.sources] } : newParseRule({ sources: [source in RULE_SOURCES ? source : 'notification'], order, ...preset });

    const input = (key, label, placeholder) => {
      const el = h('input', {
        class: 'field-input mono', type: 'text', value: draft[key] ?? '', placeholder,
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label,
        onInput: () => { draft[key] = el.value; check(); },
      });
      return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), el);
    };
    const name = h('input', {
      class: 'field-input', type: 'text', value: draft.name, placeholder: 'Название, например «Покупка картой»',
      maxlength: '60', autocomplete: 'off', 'aria-label': 'Название правила',
      onInput: () => { draft.name = name.value; check(); },
    });

    const sources = h('div', { class: 'seg-plain', role: 'group', 'aria-label': 'Источники' });
    const paintSources = () => clear(sources).append(...Object.entries(RULE_SOURCES).map(([key, label]) => h('button', {
      type: 'button', text: label, 'aria-pressed': String(draft.sources.includes(key)),
      onClick: () => {
        draft.sources = draft.sources.includes(key) ? draft.sources.filter((s) => s !== key) : [...draft.sources, key];
        paintSources(); check();
      },
    })));
    const types = h('div', { class: 'seg-plain', role: 'group', 'aria-label': 'Тип операции' });
    const paintTypes = () => clear(types).append(...Object.entries(RULE_TYPES).map(([key, label]) => h('button', {
      type: 'button', text: label, 'aria-pressed': String(draft.type === key),
      onClick: () => { draft.type = key; paintTypes(); check(); },
    })));

    const accountButton = h('button', { type: 'button', class: 'btn-secondary', onClick: pickAccount });
    const paintAccount = () => {
      accountButton.textContent = `Счёт: ${accounts.find((a) => a.id === draft.account_id)?.name ?? 'по тексту или последний использованный'}`;
    };
    async function pickAccount() {
      const picked = await pickSheet({
        title: 'Счёт для операций по этому правилу', selected: draft.account_id,
        items: [{ value: null, label: 'По тексту или последний использованный', icon: 'layers' },
          ...accounts.map((a) => ({ value: a.id, label: a.name, icon: a.icon || 'wallet' }))],
      });
      if (picked) { draft.account_id = picked.value; paintAccount(); check(); }
    }

    const example = h('textarea', {
      class: 'field-input field-area', placeholder: 'Вставьте сюда текст уведомления для проверки', rows: '3',
      autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Текст для проверки',
      onInput: () => check(),
    });
    example.value = sample;
    const verdict = h('p', { class: 'test-result', role: 'status' });

    function check() {
      const errors = validateRule(draft);
      if (errors.length) { verdict.textContent = errors[0]; verdict.className = 'test-result expense'; return false; }
      const text = example.value.trim();
      if (draft.type === 'ignore') {
        let hit = false;
        try { hit = new RegExp(draft.match, 'i').test(text); } catch { /* проверено выше */ }
        verdict.textContent = !text ? 'Записи, подходящие под условие, будут скрываться сами.'
          : hit ? 'Эта запись будет скрыта как «не операция».' : 'Условие не подходит к этому тексту.';
        verdict.className = 'test-result ' + (!text ? 'muted' : hit ? 'income' : 'expense');
        return true;
      }
      if (!text) { verdict.textContent = 'Вставьте пример текста, чтобы проверить правило.'; verdict.className = 'test-result muted'; return true; }
      const found = applyRule(draft, text);
      if (!found) { verdict.textContent = 'Правило не подходит к этому тексту: сумма не найдена.'; verdict.className = 'test-result expense'; return true; }
      const account = accounts.find((a) => a.id === (draft.account_id ?? matchAccount(found.accountText, accounts)));
      verdict.textContent = [
        `${TYPE_LABELS[draft.type]}: ${formatMoney(found.amount, found.currency ?? 'KZT')}`,
        `получатель: ${found.merchant || 'не найден'}`,
        `счёт: ${account?.name ?? 'последний использованный'}`,
      ].join(' · ');
      verdict.className = 'test-result income';
      return true;
    }

    async function save(patch = {}) {
      Object.assign(draft, patch);
      const errors = validateRule(draft);
      if (errors.length) { toast(errors[0]); return; }
      draft.name = draft.name.trim();
      draft.updated_at = Date.now();
      await db.put('rules', draft);
      result = draft;
      close();
    }
    async function remove() {
      const yes = await confirmSheet({ title: `Удалить правило «${rule.name}»?`, confirmLabel: 'Удалить', danger: true });
      if (!yes) return;
      await db.softDelete('rules', rule.id);
      result = 'deleted';
      close();
    }

    const content = h('div', { class: 'form' },
      name,
      h('div', { class: 'field-label', text: 'Откуда приходит текст' }), sources,
      h('div', { class: 'field-label', text: 'Что это за операция' }), types,
      input('match', 'Условие: правило применяется, если в тексте есть…', 'например: Покупка'),
      input('amount', 'Сумма (выражение с группой в скобках)', 'например: Покупка\\s+([\\d\\s.,]+)'),
      input('merchant', 'Получатель (необязательно)', 'например: в\\s+(.+?)\\.'),
      input('account', 'Счёт по тексту (необязательно)', 'например: \\*(\\d{4})'),
      accountButton,
      h('p', { class: 'field-hint', text: 'Выражения — это регулярные выражения JavaScript, регистр букв не учитывается. В скобках то, что нужно достать.' }),
      h('div', { class: 'field-label', text: 'Проверка на примере' }), example, verdict,
      h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить', onClick: () => save() }),
      rule && h('div', { class: 'form-row' },
        h('button', {
          type: 'button', class: 'btn-secondary', text: rule.enabled === false ? 'Включить' : 'Выключить',
          onClick: () => save({ enabled: rule.enabled === false }),
        }),
        h('button', { type: 'button', class: 'btn-secondary btn-danger', text: 'Удалить', onClick: remove })));

    paintSources(); paintTypes(); paintAccount();
    const close = openSheet({ title: rule ? 'Правило' : 'Новое правило', content, onClose: () => resolve(result) });
    db.getAll('accounts').then((all) => {
      accounts = all.filter((a) => !a.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      paintAccount(); check();
    });
    check();
  });
}
