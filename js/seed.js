// Данные первого запуска: счета и категории по умолчанию, тестовые операции.
import { newTransaction, localIso } from './model.js';

const GREEN = '#10B981', ORANGE = '#FB923C', BLUE = '#60A5FA', PURPLE = '#A78BFA',
  RED = '#F87171', YELLOW = '#FBBF24', GRAY = '#A3A3A3';

const CATEGORIES = [
  ['cat-food', 'Продукты', 'cart', GREEN, 'expense'],
  ['cat-cafe', 'Кафе', 'cup', ORANGE, 'expense'],
  ['cat-transport', 'Транспорт', 'bus', BLUE, 'expense'],
  ['cat-home', 'Дом', 'home', PURPLE, 'expense'],
  ['cat-phone', 'Связь', 'phone', BLUE, 'expense'],
  ['cat-health', 'Здоровье', 'heart', RED, 'expense'],
  ['cat-clothes', 'Одежда', 'shirt', PURPLE, 'expense'],
  ['cat-fun', 'Развлечения', 'play', YELLOW, 'expense'],
  ['cat-gifts', 'Подарки', 'gift', RED, 'expense'],
  ['cat-other', 'Другое', 'dots', GRAY, 'expense'],
  ['cat-salary', 'Зарплата', 'wallet', GREEN, 'income'],
  ['cat-side', 'Подработка', 'briefcase', BLUE, 'income'],
  ['cat-other-income', 'Другое', 'dots', GRAY, 'income'],
];

const ACCOUNTS = [
  ['acc-card', 'Карта', 'card'],
  ['acc-cash', 'Наличные', 'cash'],
];

// [дней назад, часов назад, тип, сумма в тенге, категория, счёт, заметка, источник]
const DEMO = [
  [0, 1, 'expense', 1250, 'cat-cafe', 'acc-card', 'Кофе с собой', 'applepay'],
  [0, 3, 'expense', 8740, 'cat-food', 'acc-card', 'Продукты на неделю', 'applepay'],
  [1, 2, 'expense', 450, 'cat-transport', 'acc-card', 'Автобус', 'manual'],
  [1, 6, 'expense', 5600, 'cat-cafe', 'acc-card', 'Обед', 'notification'],
  [2, 4, 'expense', 3990, 'cat-phone', 'acc-card', 'Тариф на месяц', 'notification'],
  [3, 2, 'expense', 12500, 'cat-fun', 'acc-card', 'Кино и ужин', 'applepay'],
  [3, 8, 'transfer', 30000, null, 'acc-card', 'Снял наличные', 'manual'],
  [4, 5, 'expense', 2300, 'cat-food', 'acc-cash', 'Базар', 'manual'],
  [5, 3, 'expense', 18900, 'cat-clothes', 'acc-card', 'Кроссовки', 'applepay'],
  [6, 1, 'expense', 6400, 'cat-health', 'acc-card', 'Аптека', 'applepay'],
  [7, 7, 'income', 45000, 'cat-side', 'acc-card', 'Проект', 'notification'],
  [8, 2, 'expense', 9200, 'cat-food', 'acc-card', 'Продукты', 'applepay'],
  [9, 4, 'expense', 1800, 'cat-transport', 'acc-card', 'Такси', 'notification'],
  [10, 3, 'expense', 85000, 'cat-home', 'acc-card', 'Коммунальные услуги', 'notification'],
  [11, 6, 'expense', 15000, 'cat-gifts', 'acc-card', 'Подарок на день рождения', 'manual'],
  [12, 2, 'income', 520000, 'cat-salary', 'acc-card', 'Зарплата', 'notification'],
  [14, 5, 'expense', 7300, 'cat-food', 'acc-card', 'Продукты', 'applepay'],
  [16, 3, 'expense', 4200, 'cat-cafe', 'acc-card', 'Завтрак', 'applepay'],
  [19, 2, 'expense', 2700, 'cat-other', 'acc-cash', 'Хозтовары', 'manual'],
  [22, 4, 'expense', 11200, 'cat-food', 'acc-card', 'Продукты', 'applepay'],
  [25, 6, 'expense', 3500, 'cat-fun', 'acc-card', 'Подписка на музыку', 'notification'],
  [28, 3, 'expense', 6800, 'cat-transport', 'acc-card', 'Проездной', 'manual'],
  [33, 2, 'expense', 9900, 'cat-health', 'acc-card', 'Стоматолог', 'applepay'],
  [38, 5, 'expense', 84000, 'cat-home', 'acc-card', 'Коммунальные услуги', 'notification'],
  [42, 2, 'income', 520000, 'cat-salary', 'acc-card', 'Зарплата', 'notification'],
];

const HOUR = 3600 * 1000;

/** Заполняет пустую базу. Возвращает true, если данные были созданы. */
export async function seedIfEmpty(db, now = Date.now()) {
  if ((await db.getAll('accounts')).length > 0) return false;

  await db.putMany('accounts', ACCOUNTS.map(([id, name, icon], order) => ({
    id, name, icon, currency: 'KZT', initial_balance: 0, order,
    hidden: false, deleted: false, deleted_at: null, updated_at: now,
  })));
  await db.putMany('categories', CATEGORIES.map(([id, name, icon, color, type], order) => ({
    id, name, icon, color, type, order,
    hidden: false, deleted: false, deleted_at: null, updated_at: now,
  })));
  await db.putMany('transactions', DEMO.map(([days, hours, type, tenge, category_id, account_id, note, source]) =>
    newTransaction({
      date: localIso(new Date(now - days * 24 * HOUR - hours * HOUR)),
      amount: tenge * 100,
      type, category_id, account_id, note, source,
      to_account_id: type === 'transfer' ? 'acc-cash' : null,
      demo: true,
    }, now)));
  await db.setSetting('demo', true);
  return true;
}

/** Убирает тестовые операции. Счета и категории остаются. */
export async function clearDemo(db) {
  const demo = (await db.getAll('transactions')).filter((t) => t.demo === true);
  await db.removeMany('transactions', demo.map((t) => t.id));
  await db.setSetting('demo', false);
}
