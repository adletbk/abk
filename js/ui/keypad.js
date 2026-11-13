// Своя цифровая клавиатура: системная для суммы не открывается.
import { h } from './dom.js';
import { icon } from '../icons.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'];
const LABELS = { '000': 'три нуля', back: 'стереть' };

export function createKeypad({ onKey }) {
  return h('div', { class: 'keypad' }, KEYS.map((key) => h('button', {
    type: 'button',
    'aria-label': LABELS[key] ?? key,
    onClick: () => onKey(key),
  }, key === 'back' ? icon('backspace', 26) : key)));
}
