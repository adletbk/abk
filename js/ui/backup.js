// Экспорт: полный JSON-бэкап с восстановлением и csv операций за период.
import { h, clear, toast } from './dom.js';
import { screenHeader } from './screen.js';
import { confirmSheet } from './sheet.js';
import { exportBackup, validateBackup, importBackup, transactionsToCsv } from '../backup.js';
import { daysInMonth } from '../analytics.js';
import { localIso, monthKey, plural, todayKey } from '../model.js';

/**
 * Отдаёт файл пользователю. На iPhone открывает системное меню «Поделиться»
 * (оттуда «Сохранить в Файлы»), в остальных браузерах скачивает файл.
 * Возвращает false, если пользователь отменил.
 */
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.maxTouchPoints > 0 && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (error) {
      if (error.name === 'AbortError') return false;
      // иначе пробуем обычное скачивание
    }
  }
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

export async function renderBackup(root, ctx) {
  const { db, state } = ctx;
  const today = todayKey();
  const lastBackup = await db.getSetting('last_backup_at', null);

  async function saveBackup() {
    const backup = await exportBackup(db);
    const saved = await saveFile(`finance-backup-${today}.json`, JSON.stringify(backup), 'application/json');
    if (!saved) return;
    await db.setSetting('last_backup_at', Date.now());
    toast('Бэкап сохранён');
    ctx.render();
  }

  async function restore(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast('Файл не читается: это не JSON');
      return;
    }
    const errors = validateBackup(parsed);
    if (errors.length) { toast(errors[0], { duration: 5000 }); return; }
    const count = parsed.data.transactions?.length ?? 0;
    const yes = await confirmSheet({
      title: 'Восстановить из бэкапа?',
      text: `В файле ${count} ${plural(count, ['операция', 'операции', 'операций'])}, бэкап от `
        + `${new Date(parsed.exported_at).toLocaleString('ru-RU')}. Все текущие данные на этом устройстве будут заменены. Отменить это нельзя.`,
      confirmLabel: 'Заменить данные', danger: true,
    });
    if (!yes) return;
    try {
      await importBackup(db, parsed);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Не удалось восстановить данные', { duration: 5000 });
      return;
    }
    state.accountId = null;
    state.month = monthKey(localIso(new Date()));
    toast('Данные восстановлены');
    ctx.back();
  }

  const fileInput = h('input', {
    class: 'visually-hidden', type: 'file', accept: '.json,application/json', 'aria-label': 'Файл бэкапа',
    onChange: () => { const file = fileInput.files?.[0]; fileInput.value = ''; if (file) restore(file); },
  });

  // csv за период: по умолчанию выбранный на главной месяц
  const from = h('input', { class: 'field-input', type: 'date', value: `${state.month}-01`, 'aria-label': 'С даты' });
  const to = h('input', {
    class: 'field-input', type: 'date', 'aria-label': 'По дату',
    value: `${state.month}-${String(daysInMonth(state.month)).padStart(2, '0')}`,
  });
  async function saveCsv() {
    if (!from.value || !to.value || from.value > to.value) { toast('Проверьте даты периода'); return; }
    const [txs, categories, accounts] = await Promise.all([
      db.getAll('transactions'), db.getAll('categories'), db.getAll('accounts'),
    ]);
    const csv = transactionsToCsv(txs, {
      from: from.value, to: to.value,
      categoriesById: new Map(categories.map((c) => [c.id, c])),
      accountsById: new Map(accounts.map((a) => [a.id, a])),
    });
    const rows = csv.split('\r\n').length - 2;
    if (rows === 0) { toast('За этот период операций нет'); return; }
    if (await saveFile(`finance-${from.value}_${to.value}.csv`, csv, 'text/csv')) {
      toast(`В файле ${rows} ${plural(rows, ['операция', 'операции', 'операций'])}`);
    }
  }

  clear(root).append(h('div', { class: 'screen' },
    screenHeader(ctx, 'Экспорт и бэкап'),

    h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Полный бэкап' }),
      h('p', { class: 'card-text', text: 'Один JSON-файл со всеми операциями, счетами, категориями, шаблонами, начальными остатками и настройками. Сохраните его в «Файлы» или iCloud Drive.' }),
      h('p', { class: 'card-text muted', text: lastBackup ? `Последний бэкап: ${new Date(lastBackup).toLocaleString('ru-RU')}` : 'Бэкап ещё не делался.' }),
      h('button', { type: 'button', class: 'btn-primary', text: 'Сохранить бэкап', onClick: saveBackup }),
      h('label', { class: 'btn-secondary btn-file' }, 'Восстановить из файла', fileInput)),

    h('section', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Операции в csv' }),
      h('p', { class: 'card-text', text: 'Таблица операций за период для Excel и Numbers. Удалённые операции в файл не попадают.' }),
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'С' }), from),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'По' }), to)),
      h('button', { type: 'button', class: 'btn-secondary', text: 'Сохранить csv', onClick: saveCsv }))));
}
