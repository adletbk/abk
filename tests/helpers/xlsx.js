// Загружает vendor/xlsx.mini.min.js так же, как браузер: скриптом с глобальной переменной XLSX.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const sandbox = {};
vm.runInNewContext(readFileSync(fileURLToPath(new URL('../../vendor/xlsx.mini.min.js', import.meta.url)), 'utf8'), sandbox);
export const XLSX = sandbox.XLSX;

/** Собирает xlsx-файл в памяти: { 'Имя листа': [[ячейки строки], ...] } → Uint8Array. */
export function makeXlsx(sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}

// Выгрузка в формате образца пользователя, с выдуманными данными.
const EXPENSE_HEADER = ['Дата и время', 'Категория', 'Счет', 'Сумма в валюте учета', 'Валюта учета',
  'Сумма в валюте счета', 'Валюта счета', 'Сумма операции в валюте операции', 'Валюта операции', 'Теги', 'Комментарий'];
const TRANSFER_HEADER = ['Дата и время', 'Исходящий счет', 'Входящий счет', 'Сумма в исходящей валюте счета',
  'Валюта исходящего счета', 'Сумма во входящей валюте счета', 'Валюта входящего счета', 'Комментарий'];

export function moneyManagerSample() {
  return makeXlsx({
    'Расходы': [
      ['Список расходов за период 1 ноября 2026 г. - 30 ноября 2026 г.'],
      EXPENSE_HEADER,
      [46338, 'Такси', 'Карта А', 1550, 'KZT', 1550, 'KZT', '', '', '', ''],
      [46338, 'Еда', 'Карта А', 6900, 'KZT', 6900, 'KZT', '', '', '', ''],
      [46335, 'Дом', 'Карта Б', 5945.67, 'KZT', 5945.67, 'KZT', '', '', '', 'Интернет'],
      [46335, 'Перевод', 'Карта А', 100000, 'KZT', 100000, 'KZT', '', '', 'семья', 'Маме'],
      [46332, 'Рассрочка', 'Карта Б', 7084, 'KZT', 7084, 'KZT', '', '', '', ''],
      [46332, 'Рассрочка', 'Карта Б', 7084, 'KZT', 7084, 'KZT', '', '', '', ''],
    ],
    'Доходы': [
      ['Список доходов за период 1 ноября 2026 г. - 30 ноября 2026 г.'],
      EXPENSE_HEADER,
      [46332, 'Зарплата', 'Карта Б', 700000.62, 'KZT', 700000.62, 'KZT', '', '', '', ''],
      [46338, 'Перевод', 'Карта А', 19000, 'KZT', 19000, 'KZT', '', '', '', ''],
    ],
    'Переводы': [
      ['Список переводов за период 1 ноября 2026 г. - 30 ноября 2026 г.'],
      TRANSFER_HEADER,
      [46338, 'Карта Б', 'Карта А', 40000, 'KZT', '', '', ''],
      [46332, 'Карта Б', 'Депозит', 200000, 'KZT', '', '', 'Накопления'],
    ],
  });
}
