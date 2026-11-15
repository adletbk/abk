// Импорт xlsx и csv: файл → колонки → предпросмотр → отчёт.
import { h, clear, toast } from './dom.js';
import { screenHeader, listItem } from './screen.js';
import { pickSheet } from './sheet.js';
import { formatMoney } from '../money.js';
import { TYPE_LABELS, plural, todayKey } from '../model.js';
import { revealDay } from '../period.js';
import {
  FIELDS, KINDS, MONEY_MANAGER, applyImport, buildDrafts, guessMapping, matchProfile, planImport,
  readCsv, readWorkbook, signature,
} from '../importer.js';

const PREVIEW_ROWS = 15;
const ERROR_ROWS = 20;
const rowsWord = (n) => plural(n, ['строка', 'строки', 'строк']);
const opsWord = (n) => plural(n, ['операция', 'операции', 'операций']);

// Состояние мастера живёт, пока открыт экран импорта и его шаги.
let session = null;
const fresh = () => ({ step: 'file', fileName: '', sheets: [], mappings: [], profile: null, remember: true, plan: null, errors: [], report: null });

let xlsxLoading = null;
/** SheetJS лежит в репозитории (vendor/) и подгружается только здесь, когда нужен xlsx. */
function loadXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  xlsxLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/xlsx.mini.min.js';
    script.onload = () => resolve(globalThis.XLSX);
    script.onerror = () => { xlsxLoading = null; reject(new Error('Не удалось загрузить модуль чтения xlsx')); };
    document.head.append(script);
  });
  return xlsxLoading;
}

const headersOf = (sheet, mapping) => (mapping.headerRow >= 0 ? sheet.rows[mapping.headerRow].map((cell) => String(cell ?? '').trim()) : []);

/** Сохранённое сопоставление хранит названия колонок, а не их номера. */
function toSaved(sheet, mapping) {
  const headers = headersOf(sheet, mapping);
  return {
    kind: mapping.kind, defaultAccount: mapping.defaultAccount, defaultCurrency: mapping.defaultCurrency, dateOrder: mapping.dateOrder,
    columns: Object.fromEntries(Object.entries(mapping.columns).map(([field, index]) => [field, headers[index]])),
  };
}
function fromSaved(sheet, guessed, saved) {
  const headers = headersOf(sheet, guessed);
  const columns = {};
  for (const [field, header] of Object.entries(saved.columns)) {
    const index = headers.indexOf(header);
    if (index !== -1) columns[field] = index;
  }
  return { ...guessed, ...saved, columns };
}

export async function renderImport(root, ctx) {
  const { db, state } = ctx;
  session ??= fresh();
  const s = session;
  const rerender = () => ctx.render({ auto: false });
  const restart = () => { session = fresh(); rerender(); };

  async function openFile(file) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const sheets = isZip ? readWorkbook(await loadXlsx(), bytes) : readCsv(bytes, file.name);
      if (!sheets.some((sheet) => sheet.rows.length > 1)) { toast('В файле нет строк с данными'); return; }
      session = { ...fresh(), fileName: file.name, sheets };
      const known = matchProfile(sheets, MONEY_MANAGER);
      if (known) {
        Object.assign(session, { mappings: known, profile: MONEY_MANAGER.name });
        await preview();
        return;
      }
      const saved = await db.getSetting('import_profiles', {});
      let restored = false;
      session.mappings = guessMapping(sheets).map((guessed, i) => {
        const profile = saved?.[signature(headersOf(sheets[i], guessed))];
        if (!profile) return guessed;
        restored = true;
        return fromSaved(sheets[i], guessed, profile);
      });
      if (restored) session.profile = 'сохранённое сопоставление';
      session.step = 'map';
      rerender();
    } catch (error) {
      console.error(error);
      toast(error.message || 'Не удалось прочитать файл', { duration: 5000 });
    }
  }

  function mappingProblem() {
    const active = session.mappings.filter((m) => m.kind !== 'skip');
    if (active.length === 0) return 'Все листы пропущены: импортировать нечего';
    for (const m of active) {
      const has = (field) => m.columns[field] !== undefined && m.columns[field] !== null;
      if (!has('date')) return `Лист «${m.sheet}»: выберите колонку с датой`;
      if (!has('amount')) return `Лист «${m.sheet}»: выберите колонку с суммой`;
      if (m.kind === 'column' && !has('type')) return `Лист «${m.sheet}»: выберите колонку «Тип» или другой способ определить тип`;
      if (m.kind === 'transfer' && !has('to_account')) return `Лист «${m.sheet}»: для переводов нужна колонка «Счёт зачисления»`;
      if (!has('account') && !m.defaultAccount) return `Лист «${m.sheet}»: выберите колонку со счётом или счёт по умолчанию`;
    }
    return null;
  }

  async function preview() {
    const problem = mappingProblem();
    if (problem) { toast(problem, { duration: 4500 }); return; }
    const { drafts, errors } = buildDrafts(session.sheets, session.mappings);
    Object.assign(session, { plan: await planImport(db, drafts), errors, step: 'preview' });
    rerender();
  }

  async function runImport() {
    const s2 = session;
    if (s2.remember && !s2.profile) {
      const saved = { ...(await db.getSetting('import_profiles', {})) };
      s2.mappings.forEach((mapping, i) => {
        if (mapping.kind !== 'skip') saved[signature(headersOf(s2.sheets[i], mapping))] = toSaved(s2.sheets[i], mapping);
      });
      await db.setSetting('import_profiles', saved);
    }
    // План считаем заново прямо перед записью: пока экран был открыт, данные могли измениться.
    const { drafts, errors } = buildDrafts(s2.sheets, s2.mappings);
    const plan = await planImport(db, drafts);
    const report = await applyImport(db, plan);
    const latest = plan.transactions.map((tx) => tx.date).sort().at(-1);
    if (latest) state.period = revealDay(state.period, latest.slice(0, 10), todayKey());
    Object.assign(session, { report: { ...report, errors: errors.length, total: plan.total + errors.length }, step: 'done' });
    ctx.render(); // с автосинхронизацией: новые операции уйдут в таблицу
  }

  // ---------- шаг 1: файл ----------
  function fileStep() {
    const input = h('input', {
      class: 'visually-hidden', type: 'file', 'aria-label': 'Файл для импорта',
      accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      onChange: () => { const file = input.files?.[0]; input.value = ''; if (file) openFile(file); },
    });
    return [
      h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: 'Файл' }),
        h('p', { class: 'card-text', text: 'Подходят файлы .xlsx и .csv. Выгрузка Money Manager распознаётся сама; для других файлов нужно один раз указать, в какой колонке что лежит.' }),
        h('label', { class: 'btn-primary btn-file' }, 'Выбрать файл', input)),
      h('p', { class: 'note-text', text: 'Файл читается на устройстве и никуда не отправляется. Повторный импорт того же файла не создаёт дублей.' }),
    ];
  }

  // ---------- шаг 2: колонки ----------
  function mapStep() {
    const accountsPromise = db.getAll('accounts');
    const cards = s.mappings.map((mapping, index) => {
      const sheet = s.sheets[index];
      const headers = headersOf(sheet, mapping);
      const dataRows = Math.max(0, sheet.rows.length - mapping.headerRow - 1);

      async function pickKind() {
        const picked = await pickSheet({
          title: 'Как определить тип операции', selected: mapping.kind,
          items: Object.entries(KINDS).map(([value, label]) => ({ value, label })),
        });
        if (picked) { mapping.kind = picked.value; rerender(); }
      }
      async function pickColumn(field) {
        const picked = await pickSheet({
          title: `Колонка: ${FIELDS[field]}`, selected: mapping.columns[field] ?? null,
          items: [{ value: null, label: 'Не использовать' }, ...headers.map((label, i) => ({ value: i, label: label || `Колонка ${i + 1}` })).filter((item) => headers[item.value])],
        });
        if (!picked) return;
        if (picked.value === null) delete mapping.columns[field]; else mapping.columns[field] = picked.value;
        rerender();
      }
      async function pickDefaultAccount() {
        const accounts = (await accountsPromise).filter((a) => !a.deleted);
        const picked = await pickSheet({
          title: 'Счёт для всех строк', selected: mapping.defaultAccount,
          items: [{ value: null, label: 'Не задан' }, ...accounts.map((a) => ({ value: a.name, label: a.name, icon: a.icon || 'wallet' }))],
        });
        if (picked) { mapping.defaultAccount = picked.value; rerender(); }
      }

      const skipped = mapping.kind === 'skip';
      return h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: s.sheets.length > 1 ? `Лист «${sheet.name}»` : 'Колонки' }),
        h('p', { class: 'card-text muted', text: mapping.headerRow < 0 ? 'Заголовки не найдены.' : `${dataRows} ${rowsWord(dataRows)} с данными.` }),
        h('div', { class: 'list' },
          listItem({ label: 'Тип операции', sub: KINDS[mapping.kind], onClick: pickKind }),
          !skipped && Object.keys(FIELDS).map((field) => listItem({
            label: FIELDS[field],
            sub: mapping.columns[field] !== undefined ? `«${headers[mapping.columns[field]]}»` : 'не используется',
            onClick: () => pickColumn(field),
          })),
          !skipped && mapping.columns.account === undefined && listItem({
            label: 'Счёт для всех строк', sub: mapping.defaultAccount ?? 'не задан', onClick: pickDefaultAccount,
          }),
          !skipped && listItem({
            label: 'Даты через косую черту', sub: mapping.dateOrder === 'MDY' ? 'месяц/день/год' : 'день/месяц/год',
            onClick: () => { mapping.dateOrder = mapping.dateOrder === 'MDY' ? 'DMY' : 'MDY'; rerender(); },
          })));
    });
    return [
      h('p', { class: 'note-text', text: `Файл: ${s.fileName}.${s.profile ? ` Применено ${s.profile}.` : ' Колонки угаданы по названиям — проверьте их.'}` }),
      ...cards,
      h('button', {
        type: 'button', class: 'btn-secondary', 'aria-pressed': String(s.remember),
        text: s.remember ? '✓ Запомнить для таких файлов' : 'Не запоминать сопоставление',
        onClick: () => { s.remember = !s.remember; rerender(); },
      }),
      h('button', { type: 'button', class: 'btn-primary', text: 'Дальше: предпросмотр', onClick: preview }),
      h('button', { type: 'button', class: 'btn-secondary', text: 'Выбрать другой файл', onClick: restart }),
    ];
  }

  // ---------- шаг 3: предпросмотр ----------
  async function previewStep() {
    const { plan, errors } = s;
    const [categories, accounts] = await Promise.all([db.getAll('categories'), db.getAll('accounts')]);
    const categoryName = new Map([...categories, ...plan.newCategories].map((c) => [c.id, c.name]));
    const accountName = new Map([...accounts, ...plan.newAccounts].map((a) => [a.id, a.name]));
    const count = plan.transactions.length;
    const names = (rows) => rows.map((row) => row.name).join(', ');
    return [
      h('p', { class: 'note-text', text: `Файл: ${s.fileName}.${s.profile ? ` Распознан формат: ${s.profile}.` : ''}` }),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: 'Что будет сделано' }),
        h('div', { class: 'cat-rows' },
          h('div', { class: 'cat-row' }, h('span', { class: 'cat-row-name', text: 'Новых операций' }), h('span', { class: 'cat-row-amount income', text: String(count) })),
          h('div', { class: 'cat-row' }, h('span', { class: 'cat-row-name', text: 'Дубли (пропускаются)' }), h('span', { class: 'cat-row-amount', text: String(plan.duplicates) })),
          h('div', { class: 'cat-row' }, h('span', { class: 'cat-row-name', text: 'Ошибки (пропускаются)' }), h('span', { class: 'cat-row-amount' + (errors.length ? ' expense' : ''), text: String(errors.length) }))),
        plan.newAccounts.length > 0 && h('p', { class: 'card-text', text: `Будут созданы счета: ${names(plan.newAccounts)}.` }),
        plan.newCategories.length > 0 && h('p', { class: 'card-text', text: `Будут созданы категории: ${names(plan.newCategories)}.` })),
      errors.length > 0 && h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: 'Ошибки' }),
        errors.slice(0, ERROR_ROWS).map((e) => h('p', { class: 'card-text', text: `${s.sheets.length > 1 ? `«${e.sheet}», ` : ''}строка ${e.line}: ${e.message}` })),
        errors.length > ERROR_ROWS && h('p', { class: 'card-text muted', text: `…и ещё ${errors.length - ERROR_ROWS}.` })),
      count > 0 && h('div', { class: 'group-title', text: count > PREVIEW_ROWS ? `Первые ${PREVIEW_ROWS} из ${count}` : 'Операции' }),
      count > 0 && h('div', { class: 'list' }, plan.transactions.slice(0, PREVIEW_ROWS).map((tx) => listItem({
        label: tx.type === 'transfer' ? `${accountName.get(tx.account_id)} → ${accountName.get(tx.to_account_id)}` : tx.note || categoryName.get(tx.category_id) || 'Без категории',
        sub: [tx.date.replace('T', ' ').slice(0, 16), TYPE_LABELS[tx.type], categoryName.get(tx.category_id), tx.type === 'transfer' ? null : accountName.get(tx.account_id)].filter(Boolean).join(' · '),
        right: formatMoney(tx.type === 'expense' ? -tx.amount : tx.amount, tx.currency),
      }))),
      h('button', {
        type: 'button', class: 'btn-primary', text: count ? `Импортировать ${count} ${opsWord(count)}` : 'Новых операций нет',
        onClick: () => (count ? runImport() : toast('Импортировать нечего')),
      }),
      h('button', { type: 'button', class: 'btn-secondary', text: 'Настроить колонки', onClick: () => { s.step = 'map'; s.profile = null; rerender(); } }),
      h('button', { type: 'button', class: 'btn-secondary', text: 'Выбрать другой файл', onClick: restart }),
    ];
  }

  // ---------- шаг 4: отчёт ----------
  function doneStep() {
    const r = s.report;
    const line = (label, value, cls = '') => h('div', { class: 'cat-row' }, h('span', { class: 'cat-row-name', text: label }), h('span', { class: `cat-row-amount ${cls}`, text: String(value) }));
    return [
      h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: 'Импорт завершён' }),
        h('div', { class: 'cat-rows' },
          line('Строк в файле', r.total),
          line('Создано операций', r.created, 'income'),
          line('Пропущено дублей', r.duplicates),
          line('Строк с ошибками', r.errors, r.errors ? 'expense' : ''),
          line('Новых счетов', r.accounts),
          line('Новых категорий', r.categories))),
      r.accounts > 0 && h('p', { class: 'note-text', text: 'У новых счетов начальный остаток равен нулю. Его можно задать в Настройки → Счета.' }),
      r.categories > 0 && h('p', { class: 'note-text', text: 'Новым категориям назначены стандартная иконка и цвет. Изменить их можно в Настройки → Категории.' }),
      h('button', { type: 'button', class: 'btn-primary', text: 'На главную', onClick: () => { session = null; location.replace('#/'); } }),
      h('button', { type: 'button', class: 'btn-secondary', text: 'Импортировать ещё файл', onClick: restart }),
    ];
  }

  const body = s.step === 'map' ? mapStep() : s.step === 'preview' ? await previewStep() : s.step === 'done' ? doneStep() : fileStep();
  clear(root).append(h('div', { class: 'screen' }, screenHeader(ctx, 'Импорт'), body));
}
