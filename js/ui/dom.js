// Мелкие помощники для DOM. Стили задаются через CSSOM (style.setProperty),
// потому что CSP запрещает inline-стили в разметке.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'value') el.value = value;
    else if (key === 'style') for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

let toastEl = null;
let toastTimer = 0;

/** Короткое сообщение внизу экрана. action: { label, onClick } — необязательная кнопка. */
export function toast(text, { action = null, duration = 2500 } = {}) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  toastEl = h('div', { class: 'toast', role: 'status' }, h('span', { text }));
  if (action) {
    toastEl.append(h('button', {
      type: 'button',
      text: action.label,
      onClick: () => { toastEl?.remove(); action.onClick(); },
    }));
  }
  document.body.append(toastEl);
  if (duration > 0) toastTimer = setTimeout(() => toastEl?.remove(), duration);
}
