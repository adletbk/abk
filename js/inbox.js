// Обработка входящих записей: операции, «Проверить», дедупликация, автокатегория.
import { newTransaction } from './model.js';
import { ACCOUNT_RANK, normalizeMerchant, parseInboxItem } from './parser.js';

/** Окно, в котором Apple Pay и уведомление банка считаются одной покупкой. */
export const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const MIN_PARTIAL_MATCH = 4;

const toMs = (date) => new Date(date).getTime();

// Слова, по которым получателей сравнивать нельзя: домены, правовые формы, платёжные шлюзы.
const GENERIC_WORDS = new Set(['www', 'com', 'net', 'org', 'тоо', 'too', 'ооо', 'ип', 'llp', 'ltd', 'llc', 'inc', 'jetpay', 'cloudpayments', 'payment', 'pay']);
const words = (value) => value.split(' ').filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC_WORDS.has(w));

/** Получатели не противоречат друг другу: один пуст, один входит в другой или есть общее слово. */
export function merchantsCompatible(a, b) {
  const x = normalizeMerchant(a);
  const y = normalizeMerchant(b);
  if (!x || !y || x === y || x.includes(y) || y.includes(x)) return true;
  const other = new Set(words(y));
  return words(x).some((w) => other.has(w));
}

/**
 * Ищет уже созданную автоматически операцию о той же покупке из ДРУГОГО источника:
 * те же сумма, валюта и тип, близкое время.
 * Получатель сверяется, но Apple Pay и банк часто пишут его по-разному («Dodo Pizza» и
 * «Jetpay.kz*dodo.kz»): если в окне ровно одна такая операция, она считается той же покупкой
 * даже при несовпадающем получателе. Две одинаковые записи из одного источника — это две покупки.
 */
export function findDuplicate(candidate, txs, { windowMs = DEDUP_WINDOW_MS } = {}) {
  const at = toMs(candidate.date);
  const near = [];
  for (const tx of txs) {
    if (tx.deleted || !Array.isArray(tx.sources) || tx.sources.length === 0) continue; // ручные не трогаем
    if (tx.sources.includes(candidate.source)) continue;
    if (tx.amount !== candidate.amount || tx.currency !== candidate.currency || tx.type !== candidate.type) continue;
    const gap = Math.abs(toMs(tx.date) - at);
    if (gap <= windowMs) near.push({ tx, gap });
  }
  near.sort((a, b) => a.gap - b.gap);
  const compatible = near.find(({ tx }) => merchantsCompatible(tx.merchant, candidate.merchant));
  if (compatible) return compatible.tx;
  return near.length === 1 ? near[0].tx : null;
}

// ---------- автокатегория «получатель → категория» ----------

const merchantRuleId = (normalized) => `merchant:${normalized}`;

/** Категория по получателю: точное совпадение, затем вхождение (от четырёх символов). */
export function categoryForMerchant(merchant, rules) {
  const name = normalizeMerchant(merchant);
  if (!name) return null;
  const known = rules.filter((r) => r.kind === 'merchant' && !r.deleted && r.merchant && r.category_id);
  const exact = known.find((r) => r.merchant === name);
  if (exact) return exact.category_id;
  const partial = known
    .filter((r) => r.merchant.length >= MIN_PARTIAL_MATCH && name.length >= MIN_PARTIAL_MATCH
      && (name.includes(r.merchant) || r.merchant.includes(name)))
    .sort((a, b) => b.merchant.length - a.merchant.length)[0];
  return partial?.category_id ?? null;
}

/** Запоминает категорию получателя. Вызывается, когда пользователь правит категорию вручную. */
export async function learnMerchant(db, merchant, categoryId, now = Date.now()) {
  const name = normalizeMerchant(merchant);
  if (!name || !categoryId) return;
  await db.put('rules', {
    id: merchantRuleId(name), kind: 'merchant', merchant: name, category_id: categoryId,
    deleted: false, deleted_at: null, updated_at: now,
  });
}

// ---------- запомненные карты Apple Pay ----------

/**
 * Запоминает, к какому счёту относится карта из Apple Pay («Freedom Bank Kazakhstan» → «Deposit Card»).
 * Вызывается, когда пользователь меняет счёт у операции Apple Pay вручную.
 */
export async function learnCard(db, card, accountId, now = Date.now()) {
  const name = normalizeMerchant(card);
  if (!name || !accountId) return;
  await db.put('rules', {
    id: `card:${name}`, kind: 'card', card: name, label: String(card).trim(), account_id: accountId,
    deleted: false, deleted_at: null, updated_at: now,
  });
}

// ---------- обработка ----------

/** Сколько всего ждёт проверки: операции без данных и неразобранные записи. */
export async function reviewCounts(db) {
  const transactions = (await db.getAll('transactions')).filter((t) => !t.deleted && t.status === 'needs_review').length;
  const inbox = (await db.getAll('inbox')).filter((i) => i.status === 'needs_review' && !i.ignored).length;
  return { transactions, inbox, total: transactions + inbox };
}

/**
 * Разбирает новые записи inbox. retry: заново пробует неразобранные (после правки правил).
 * Ничего не теряется: неразобранное остаётся во входящих со статусом needs_review.
 */
export async function processInbox(db, { now = Date.now(), retry = false } = {}) {
  const result = { created: 0, merged: 0, review: 0, unparsed: 0, ignored: 0 };
  const pending = (await db.getAll('inbox'))
    .filter((item) => item.status === 'new' || (retry && item.status === 'needs_review' && !item.ignored));
  if (pending.length === 0) return result;

  const [rules, accounts, txs, lastAccountId] = await Promise.all([
    db.getAll('rules'), db.getAll('accounts'), db.getAll('transactions'), db.getSetting('last_account_id', null),
  ]);
  const usable = accounts.filter((a) => !a.deleted && !a.hidden).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const defaultAccountId = usable.some((a) => a.id === lastAccountId) ? lastAccountId : usable[0]?.id ?? null;
  const context = { rules, accounts, defaultAccountId };

  // По времени события: более ранняя запись становится основой операции.
  const parsedItems = pending
    .map((item) => ({ item, parsed: parseInboxItem(item, context, now) }))
    .sort((a, b) => (a.parsed.fields?.date ?? '').localeCompare(b.parsed.fields?.date ?? ''));

  for (const { item, parsed } of parsedItems) {
    if (!parsed.ok) {
      if (item.status !== 'needs_review' || item.reason !== parsed.reason) {
        await db.put('inbox', { ...item, status: 'needs_review', reason: parsed.reason, updated_at: now });
        result.unparsed++;
      }
      continue;
    }
    if (parsed.ignore) {
      // Правило «не операция»: запись остаётся во входящих, но операции из неё не будет.
      await db.put('inbox', { ...item, status: 'done', ignored: true, reason: null, rule_id: parsed.ruleId, updated_at: now });
      result.ignored++;
      continue;
    }
    const fields = parsed.fields;
    const fingerprint = `inbox:${item.id}`;
    const done = (txId) => db.put('inbox', { ...item, status: 'done', reason: null, tx_id: txId, updated_at: now });

    // Операция из этой записи уже есть (например, пришла с другого устройства).
    const already = txs.find((tx) => tx.fingerprint === fingerprint || tx.inbox_ids?.includes(item.id));
    if (already) { await done(already.id); continue; }

    const duplicate = findDuplicate({ ...fields, source: item.source }, txs);
    if (duplicate) {
      const merged = {
        ...duplicate,
        sources: [...duplicate.sources, item.source],
        inbox_ids: [...(duplicate.inbox_ids ?? []), item.id],
        merchant: duplicate.merchant || fields.merchant,
        note: duplicate.note || duplicate.merchant || fields.merchant,
        card: duplicate.card || fields.card || undefined,
        updated_at: now,
      };
      if (merged.card === undefined) delete merged.card;
      // Счёт берётся у той записи, что определила его надёжнее: например, уведомление банка
      // с последними цифрами карты точнее, чем название карты из Apple Pay.
      if (fields.account_id && (fields.account_rank ?? 0) > (duplicate.account_rank ?? 0)) {
        merged.account_id = fields.account_id;
        merged.account_rank = fields.account_rank;
      }
      if (!merged.category_id && merged.type !== 'transfer') {
        merged.category_id = categoryForMerchant(merged.merchant, rules);
        if (merged.category_id && merged.account_id) merged.status = 'ok';
      }
      await db.put('transactions', merged);
      txs[txs.indexOf(duplicate)] = merged;
      await done(merged.id);
      result.merged++;
      continue;
    }

    const categoryId = fields.type === 'transfer' ? null : fields.category_id ?? categoryForMerchant(fields.merchant, rules);
    // Перевод требует второго счёта, которого в уведомлении нет: всегда на проверку.
    const complete = Boolean(fields.account_id) && fields.type !== 'transfer' && Boolean(categoryId);
    const tx = newTransaction({
      date: fields.date, amount: fields.amount, currency: fields.currency, type: fields.type,
      category_id: categoryId, account_id: fields.account_id, note: fields.note || fields.merchant, merchant: fields.merchant,
      account_rank: fields.account_rank ?? ACCOUNT_RANK.fallback, ...(fields.card ? { card: fields.card } : {}),
      source: item.source === 'sms' ? 'notification' : item.source,
      sources: [item.source], inbox_ids: [item.id], fingerprint,
      status: complete ? 'ok' : 'needs_review',
    }, now);
    await db.put('transactions', tx);
    txs.push(tx);
    await done(tx.id);
    result.created++;
    if (!complete) result.review++;
  }
  return result;
}
