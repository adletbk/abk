// Поддельная среда Google Apps Script для тестов: настоящий apps-script/Code.gs
// выполняется в node:vm поверх таблицы в памяти.
//
// Что имитируется из поведения Google Таблиц:
//  - строка с ведущим апострофом записывается как текст без апострофа;
//  - строка, начинающаяся с «=», становится формулой (попадает в sheet.formulas);
//  - в ячейку с текстовым форматом «@» число попадает строкой.
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const CODE = readFileSync(fileURLToPath(new URL('../../apps-script/Code.gs', import.meta.url)), 'utf8');

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];        // значения, как их вернёт getValues()
    this.raw = [];         // что именно передали в setValues() / setFormula()
    this.formats = new Map(); // номер колонки → формат
    this.formulas = [];    // { row, col, formula }
    this.frozen = 0;
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((max, row) => Math.max(max, row.length), 0); }
  setFrozenRows(n) { this.frozen = n; }
  deleteRow(n) { this.rows.splice(n - 1, 1); this.raw.splice(n - 1, 1); }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    const cell = (grid, r, c) => {
      while (grid.length < r) grid.push([]);
      const line = grid[r - 1];
      while (line.length < c) line.push('');
      return line;
    };
    const write = (r, c, value) => {
      cell(sheet.raw, r, c)[c - 1] = value;
      let stored = value;
      if (typeof value === 'string' && value.startsWith("'")) stored = value.slice(1);
      else if (typeof value === 'string' && value.startsWith('=')) {
        sheet.formulas.push({ row: r, col: c, formula: value });
        stored = '#FORMULA';
      } else if (typeof value === 'number' && sheet.formats.get(c) === '@') stored = String(value);
      cell(sheet.rows, r, c)[c - 1] = stored;
    };
    return {
      getValues() {
        const out = [];
        for (let r = row; r < row + numRows; r++) {
          const line = [];
          for (let c = col; c < col + numCols; c++) line.push(sheet.rows[r - 1]?.[c - 1] ?? '');
          out.push(line);
        }
        return out;
      },
      setValues(matrix) {
        if (matrix.length !== numRows || matrix.some((line) => line.length !== numCols)) {
          throw new Error(`setValues: размер ${matrix.length}x${matrix[0]?.length} не совпадает с диапазоном ${numRows}x${numCols}`);
        }
        matrix.forEach((line, i) => line.forEach((value, j) => write(row + i, col + j, value)));
        return this;
      },
      setValue(value) { write(row, col, value); return this; },
      setFormula(formula) { write(row, col, formula); return this; },
      setNumberFormat(format) {
        for (let c = col; c < col + numCols; c++) sheet.formats.set(c, format);
        return this;
      },
      setFontWeight() { return this; },
    };
  }
  /** Строки данных как объекты «заголовок → значение». */
  objects() {
    const [headers, ...rows] = this.rows;
    return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  }
  rawObjects() {
    const [headers, ...rows] = this.raw;
    return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  }
}

/**
 * Создаёт изолированную «таблицу со скриптом».
 * token: значение Script Property TOKEN (null — свойство не задано).
 */
export function createGas({ token = 'test-token' } = {}) {
  const sheets = new Map();
  const props = new Map(token === null ? [] : [['TOKEN', token]]);
  const locks = { acquired: 0, released: 0, held: false, failNext: false };
  let clock = 1_800_000_000_000;

  const spreadsheet = {
    getSheetByName: (name) => sheets.get(name) ?? null,
    insertSheet: (name) => { const sheet = new FakeSheet(name); sheets.set(name, sheet); return sheet; },
  };
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(clock); }
    static now() { return clock; }
  }
  const context = vm.createContext({
    Date: FakeDate, JSON, Math, Number, String, Object, Array, Map, Set, RegExp, Error, isFinite, parseInt, parseFloat,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => props.get(key) ?? null,
        setProperty: (key, value) => { props.set(key, String(value)); },
        deleteProperty: (key) => { props.delete(key); },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (locks.failNext) { locks.failNext = false; throw new Error('Lock timeout'); }
          if (locks.held) throw new Error('Вложенная блокировка');
          locks.held = true; locks.acquired++;
        },
        releaseLock() { if (locks.held) { locks.held = false; locks.released++; } },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, mime: null, setMimeType(m) { this.mime = m; return this; } }),
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Как в Apps Script: массив байтов со знаком.
      computeDigest: (algorithm, text) => [...createHash(algorithm).update(text, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    Logger: { lines: [], log(...args) { this.lines.push(args.join(' ')); } },
  });
  vm.runInContext(CODE, context, { filename: 'Code.gs' });

  const post = (contents) => {
    const output = context.doPost({ postData: { contents } });
    return { json: JSON.parse(output.content), mime: output.mime, raw: output.content };
  };

  return {
    context,
    locks,
    props,
    sheets,
    sheet: (name) => sheets.get(name),
    /** Сдвинуть «серверное время» на ms миллисекунд. */
    tick: (ms = 1000) => { clock += ms; return clock; },
    now: () => clock,
    post,
    /** Вызов действия с токеном по умолчанию. */
    // Второй аргумент заменяет токен; явный undefined означает «без токена».
    call: (body, ...rest) => post(JSON.stringify({ token: rest.length ? rest[0] : token, ...body })).json,
    /** Запрос полями формы, как его присылает MacroDroid: Apps Script кладёт их в e.parameter. */
    form: (fields) => {
      const contents = new URLSearchParams(fields).toString();
      const output = context.doPost({ postData: { contents, type: 'application/x-www-form-urlencoded' }, parameter: { ...fields } });
      return JSON.parse(output.content);
    },
    log: () => context.Logger.lines,
  };
}
