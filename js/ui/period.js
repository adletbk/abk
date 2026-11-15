// Таблетка периода: стрелки листают, нажатие на название открывает выбор вида периода.
import { h, toast } from './dom.js';
import { icon } from '../icons.js';
import { openSheet, pickSheet } from './sheet.js';
import { PERIOD_KINDS, canShift, periodLabel, rangeText, resolvePeriod, shiftPeriod, txBounds } from '../period.js';

/** Отрезок дней для выбранного в приложении периода. */
export function currentPeriod(state, txs, today) {
  return resolvePeriod(state.period, today, state.period.kind === 'all' ? txBounds(txs) : null);
}

/** Меняет период и запоминает его вид, чтобы он сохранился после перезапуска. */
function setPeriod(ctx, spec) {
  ctx.state.period = spec;
  const { kind, from = null, to = null } = spec;
  ctx.db.setSetting('period', { kind, from, to }).catch((error) => console.warn('период', error));
  ctx.render();
}

function pickCustom(ctx, period) {
  const { custom } = ctx.state;
  const from = h('input', { class: 'field-input', type: 'date', value: custom?.from ?? period.from, 'aria-label': 'С даты' });
  const to = h('input', { class: 'field-input', type: 'date', value: custom?.to ?? period.to, 'aria-label': 'По дату' });
  const apply = () => {
    if (!from.value || !to.value) { toast('Выберите обе даты'); return; }
    const spec = { kind: 'custom', from: from.value <= to.value ? from.value : to.value, to: from.value <= to.value ? to.value : from.value };
    ctx.state.custom = { from: spec.from, to: spec.to };
    close();
    setPeriod(ctx, spec);
  };
  const close = openSheet({
    title: 'Свой период',
    content: h('div', { class: 'form' },
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'С' }), from),
        h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'По' }), to)),
      h('button', { type: 'button', class: 'btn-primary', text: 'Показать', onClick: apply })),
  });
}

/** period — результат currentPeriod. */
export function periodControl(ctx, period, today) {
  const { state } = ctx;
  const stepped = canShift(state.period);
  const shift = (delta) => { state.period = shiftPeriod(state.period, delta, today); ctx.render(); };

  async function pick() {
    const custom = state.custom;
    const picked = await pickSheet({
      title: 'Период', selected: state.period.kind,
      items: [
        ...PERIOD_KINDS.map(([value, label]) => ({ value, label })),
        { value: 'custom', label: custom ? `Свой: ${rangeText(custom.from, custom.to, today)}` : 'Свой период…' },
        ...(custom ? [{ value: 'custom-new', label: 'Изменить свой период…' }] : []),
      ],
    });
    if (!picked) return;
    if (picked.value === 'custom' && custom) setPeriod(ctx, { kind: 'custom', ...custom });
    else if (picked.value === 'custom' || picked.value === 'custom-new') pickCustom(ctx, period);
    else setPeriod(ctx, { kind: picked.value, anchor: today });
  }

  return h('div', { class: 'period' },
    h('button', { type: 'button', 'aria-label': 'Предыдущий период', disabled: !stepped, onClick: () => shift(-1) }, icon('chevron-left', 18)),
    h('button', { type: 'button', class: 'period-title', 'aria-label': `Период: ${periodLabel(period, today)}. Изменить`, onClick: pick },
      periodLabel(period, today)),
    h('button', { type: 'button', 'aria-label': 'Следующий период', disabled: !stepped, onClick: () => shift(1) }, icon('chevron-right', 18)));
}
