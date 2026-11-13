import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localIso, dayKey, monthKey, shiftMonth, newTransaction, validateTransaction,
  dayTitle, dayShort, monthTitle, periodTitle, SOURCE_LABELS,
} from '../js/model.js';

test('localIso: локальное время без пояса', () => {
  assert.equal(localIso(new Date(2026, 10, 3, 9, 5, 7)), '2026-11-03T09:05:07');
});
test('dayKey и monthKey', () => {
  assert.equal(dayKey('2026-11-03T09:05:07'), '2026-11-03');
  assert.equal(monthKey('2026-11-03T09:05:07'), '2026-11');
});
test('shiftMonth: переход через год', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-11', 0), '2026-11');
});

test('newTransaction: значения по умолчанию', () => {
  const now = new Date(2026, 10, 13, 12, 0, 0).getTime();
  const tx = newTransaction({ amount: 125000, account_id: 'a', category_id: 'c' }, now);
  assert.match(tx.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...tx, id: 'x' }, {
    id: 'x', date: '2026-11-13T12:00:00', amount: 125000, currency: 'KZT', type: 'expense',
    category_id: 'c', account_id: 'a', to_account_id: null, note: '', source: 'manual',
    fingerprint: '', status: 'ok', deleted: false, deleted_at: null, updated_at: now,
  });
});

const ok = { amount: 100, type: 'expense', account_id: 'a', category_id: 'c', to_account_id: null };
test('validateTransaction: корректная операция', () => {
  assert.deepEqual(validateTransaction(ok), []);
  assert.deepEqual(validateTransaction({ ...ok, type: 'transfer', category_id: null, to_account_id: 'b' }), []);
});
test('validateTransaction: сумма', () => {
  assert.deepEqual(validateTransaction({ ...ok, amount: 0 }), ['Введите сумму']);
  assert.deepEqual(validateTransaction({ ...ok, amount: 1.5 }), ['Введите сумму']);
  assert.deepEqual(validateTransaction({ ...ok, amount: -5 }), ['Введите сумму']);
});
test('validateTransaction: счёт', () => {
  assert.deepEqual(validateTransaction({ ...ok, account_id: null }), ['Выберите счёт']);
});
test('validateTransaction: категория', () => {
  assert.deepEqual(validateTransaction({ ...ok, category_id: null }), ['Выберите категорию']);
});
test('validateTransaction: перевод', () => {
  const t = { ...ok, type: 'transfer', category_id: null };
  assert.deepEqual(validateTransaction(t), ['Выберите счёт зачисления']);
  assert.deepEqual(validateTransaction({ ...t, to_account_id: 'a' }), ['Выберите счёт зачисления']);
});

test('dayTitle', () => {
  assert.equal(dayTitle('2026-11-13', '2026-11-13'), 'Пт, 13 ноября · Сегодня');
  assert.equal(dayTitle('2026-11-12', '2026-11-13'), 'Чт, 12 ноября · Вчера');
  assert.equal(dayTitle('2026-11-03', '2026-11-13'), 'Вт, 3 ноября');
  assert.equal(dayTitle('2026-10-31', '2026-11-01'), 'Сб, 31 октября · Вчера');
  assert.equal(dayTitle('2025-12-31', '2026-11-13'), 'Ср, 31 декабря 2025');
});
test('dayShort', () => {
  assert.equal(dayShort('2026-11-13', '2026-11-13'), 'Сегодня');
  assert.equal(dayShort('2026-11-12', '2026-11-13'), 'Вчера');
  assert.equal(dayShort('2026-11-03', '2026-11-13'), '3 ноября');
  assert.equal(dayShort('2025-12-31', '2026-11-13'), '31 декабря 2025');
});
test('periodTitle', () => {
  assert.equal(periodTitle('2026-11', '2026-11-13'), 'Этот месяц');
  assert.equal(periodTitle('2026-10', '2026-11-13'), 'Октябрь');
  assert.equal(periodTitle('2025-12', '2026-11-13'), 'Декабрь 2025');
});
test('monthTitle', () => {
  assert.equal(monthTitle('2026-11', '2026-11-13'), 'ноябрь');
  assert.equal(monthTitle('2025-12', '2026-11-13'), 'декабрь 2025');
});
test('SOURCE_LABELS', () => {
  assert.deepEqual(SOURCE_LABELS, {
    manual: 'Вручную', applepay: 'Apple Pay', notification: 'Уведомление банка', import: 'Импорт выписки',
  });
});
