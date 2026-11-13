import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, keypadReduce, parseAmount, amountToText } from '../js/money.js';

const NB = ' ';

test('formatMoney: тенге без дробной части', () => {
  assert.equal(formatMoney(10770000), `107${NB}700${NB}₸`);
  assert.equal(formatMoney(0), `0${NB}₸`);
});
test('formatMoney: дробная часть показывается, только если не ноль', () => {
  assert.equal(formatMoney(10770050), `107${NB}700,50${NB}₸`);
  assert.equal(formatMoney(5), `0,05${NB}₸`);
});
test('formatMoney: знак', () => {
  assert.equal(formatMoney(-150000), `−1${NB}500${NB}₸`);
  assert.equal(formatMoney(150000, 'KZT', { sign: true }), `+1${NB}500${NB}₸`);
  assert.equal(formatMoney(0, 'KZT', { sign: true }), `0${NB}₸`);
});
test('formatMoney: другая валюта', () => {
  assert.equal(formatMoney(1999, 'USD'), `19,99${NB}$`);
});

test('keypadReduce: без ведущих нулей', () => {
  assert.equal(keypadReduce('', '0'), '0');
  assert.equal(keypadReduce('0', '0'), '0');
  assert.equal(keypadReduce('0', '5'), '5');
});
test('keypadReduce: запятая', () => {
  assert.equal(keypadReduce('', ','), '0,');
  assert.equal(keypadReduce('1,5', ','), '1,5');
  assert.equal(keypadReduce('0', ','), '0,');
});
test('keypadReduce: не больше двух знаков после запятой', () => {
  assert.equal(keypadReduce('1,5', '5'), '1,55');
  assert.equal(keypadReduce('1,55', '5'), '1,55');
});
test('keypadReduce: не больше 12 цифр целой части', () => {
  assert.equal(keypadReduce('123456789012', '3'), '123456789012');
  assert.equal(keypadReduce('123456789012', ','), '123456789012,');
});
test('keypadReduce: стирание', () => {
  assert.equal(keypadReduce('1,', 'back'), '1');
  assert.equal(keypadReduce('', 'back'), '');
});
test('keypadReduce: неизвестная клавиша игнорируется', () => {
  assert.equal(keypadReduce('12', 'x'), '12');
});

test('parseAmount: минимальные единицы, целое', () => {
  assert.equal(parseAmount('107700'), 10770000);
  assert.equal(parseAmount('0,5'), 50);
  assert.equal(parseAmount('12,'), 1200);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('0,07'), 7);
  assert.equal(parseAmount('1,15'), 115); // без ошибок плавающей точки
});
test('amountToText: обратно в текст клавиатуры', () => {
  assert.equal(amountToText(10770000), '107700');
  assert.equal(amountToText(10770050), '107700,50');
  assert.equal(amountToText(0), '');
});
