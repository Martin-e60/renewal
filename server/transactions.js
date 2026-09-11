import crypto from 'node:crypto';
import {validDate, dayDifference} from '../public/assets/dates.js';
import {CATEGORIES, KINDS, MAX_IMPORT_ROWS, analyzeTransaction, detectRecurring, fingerprintBases, seriesKeyOf, knownMerchant} from '../public/assets/transactions.js';

const cents = value => Math.round(value * 100);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const isSpending = kind => kind === 'expense' || kind === 'refund';
const validHash = value => /^[a-f0-9]{64}$/.test(String(value || '')) ? value : null;
const cleanText = (value, max) => String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max);
function groupBy(items, key) { const map = new Map(); for (const item of items) { const k = key(item); if (!map.has(k)) map.set(k, []); map.get(k).push(item); } return map; }

export function createTransactions({db, json, getCurrentUser, readBody, accountData, writeAccount, checkedSubscriptions}) {
  for (const statement of `CREATE TABLE IF NOT EXISTS bank_accounts(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,name));
  CREATE TABLE IF NOT EXISTS statement_imports(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,file_name TEXT NOT NULL,file_hash TEXT,imported INTEGER NOT NULL,skipped INTEGER NOT NULL,created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,import_id TEXT REFERENCES statement_imports(id) ON DELETE SET NULL,fingerprint TEXT NOT NULL,date TEXT NOT NULL,description TEXT NOT NULL,merchant TEXT NOT NULL,merchant_key TEXT NOT NULL,amount_cents INTEGER NOT NULL,currency TEXT NOT NULL,kind TEXT NOT NULL,category TEXT,created_at INTEGER NOT NULL,UNIQUE(account_id,fingerprint));
  CREATE INDEX IF NOT EXISTS transactions_user_date ON transactions(user_id,date);
  CREATE TABLE IF NOT EXISTS subscription_series(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,series_key TEXT NOT NULL,status TEXT NOT NULL,merchant TEXT NOT NULL,currency TEXT NOT NULL,cycle TEXT,category TEXT,amount_cents INTEGER,subscription_uid TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,series_key))`.split(';').map(v => v.trim()).filter(Boolean)) db.exec(statement);

  const accountsOf = userId => db.prepare('SELECT id,name,created_at AS createdAt FROM bank_accounts WHERE user_id=? ORDER BY name').all(userId);
  // Personal merchant rules only affect future analysis; saved transactions keep their edits.
  db.exec('CREATE TABLE IF NOT EXISTS transaction_category_rules(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,merchant_key TEXT NOT NULL,merchant TEXT NOT NULL,category TEXT NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(user_id,merchant_key))');
  const rulesOf = userId => db.prepare('SELECT id,merchant_key AS merchantKey,merchant,category FROM transaction_category_rules WHERE user_id=? ORDER BY merchant').all(userId);
  const importsOf = userId => db.prepare('SELECT id,account_id AS accountId,file_name AS fileName,imported,skipped,created_at AS createdAt FROM statement_imports WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(userId);
  const transactionsOf = userId => db.prepare('SELECT id,account_id AS accountId,import_id AS importId,date,description,merchant,merchant_key AS merchantKey,amount_cents AS amountCents,currency,kind,category FROM transactions WHERE user_id=? ORDER BY date DESC,created_at DESC,id')
    .all(userId).map(({amountCents, ...t}) => ({...t, amount:Number(amountCents) / 100}));

  // Detected series plus the user's decisions. Confirmed series stay listed even if a later
  // import breaks the regular pattern.
  function seriesOf(userId, transactions = transactionsOf(userId)) {
    const decisions = new Map(db.prepare('SELECT * FROM subscription_series WHERE user_id=?').all(userId).map(d => [d.series_key, d]));
    const series = detectRecurring(transactions).map(s => { const d = decisions.get(s.seriesKey); return {...s, status:d?.status || 'possible', category:d?.category || s.category, subscriptionUid:d?.subscription_uid || null}; });
    for (const d of decisions.values()) {
      if (d.status !== 'confirmed' || series.some(s => s.seriesKey === d.series_key)) continue;
      const items = transactions.filter(t => seriesKeyOf(t) === d.series_key).sort((a, b) => a.date.localeCompare(b.date));
      series.push({seriesKey:d.series_key, merchant:d.merchant, currency:d.currency, cycle:d.cycle, amount:Number(d.amount_cents) / 100, count:items.length, firstDate:items[0]?.date || null, lastDate:items.at(-1)?.date || null, nextDate:null, category:d.category, status:'confirmed', subscriptionUid:d.subscription_uid});
    }
    return series;
  }

  function cleanRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw Error('The statement has no valid transactions.');
    if (rows.length > MAX_IMPORT_ROWS) throw Error('Import up to 5,000 transactions at a time.');
    return rows.map(r => {
      const description = cleanText(r?.description, 300), note = cleanText(r?.note, 200), amount = Math.round(Number(r?.amount) * 100) / 100, currency = String(r?.currency ?? '').toUpperCase();
      if (!validDate(r?.date) || !(description || note) || typeof r.amount !== 'number' || !Number.isFinite(amount) || !amount || Math.abs(amount) > 1e9 || !/^[A-Z]{3}$/.test(currency)) throw Error('The statement contains an invalid transaction.');
      return {line:Number.isSafeInteger(r.line) && r.line > 0 ? r.line : null, date:r.date, description:description || note, note, amount, currency, include:r.include !== false, kind:KINDS.includes(r.kind) ? r.kind : null, category:CATEGORIES.includes(r.category) ? r.category : null};
    });
  }

  function resolveAccount(userId, body, create) {
    if (body.accountId) {
      const account = db.prepare('SELECT id,name FROM bank_accounts WHERE id=? AND user_id=?').get(String(body.accountId), userId);
      if (!account) throw Error('Choose one of your accounts.');
      return account;
    }
    const name = cleanText(body.accountName, 200).replace(/\s+/g, ' ');
    if (!name || name.length > 80) throw Error('Enter an account name (up to 80 characters).');
    const existing = db.prepare('SELECT id,name FROM bank_accounts WHERE user_id=? AND name=?').get(userId, name);
    if (existing || !create) return existing || {id:null, name};
    if (db.prepare('SELECT COUNT(*) AS n FROM bank_accounts WHERE user_id=?').get(userId).n >= 50) throw Error('Maximum 50 accounts.');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO bank_accounts(id,user_id,name,created_at) VALUES(?,?,?,?)').run(id, userId, name, Date.now());
    return {id, name};
  }

  // Categories, own-account transfers and duplicates for rows that are not saved yet.
  function analyze(userId, account, rows) {
    const bases = fingerprintBases(rows);
    const rules = new Map(rulesOf(userId).map(r => [r.merchantKey, r.category]));
    const existing = account.id ? db.prepare('SELECT fingerprint,date,description,amount_cents AS amountCents,currency FROM transactions WHERE user_id=? AND account_id=?').all(userId, account.id) : [];
    const saved = new Set(existing.map(t => t.fingerprint)), sameAmount = groupBy(existing, t => `${t.currency}|${t.amountCents}`);
    const others = db.prepare('SELECT t.id,t.date,t.amount_cents AS amountCents,t.currency,a.name AS accountName FROM transactions t JOIN bank_accounts a ON a.id=t.account_id WHERE t.user_id=? AND t.account_id<>?').all(userId, account.id || '');
    const otherAmount = groupBy(others, t => `${t.currency}|${t.amountCents}`);
    return rows.map((row, i) => {
      const analysis = analyzeTransaction(row), amountCents = cents(row.amount), fingerprint = hash(bases[i].key);
      // The same amount leaving one of the user's accounts and arriving in another is a transfer.
      const transfer = analysis.kind !== 'refund' ? (otherAmount.get(`${row.currency}|${-amountCents}`) || []).find(t => Math.abs(dayDifference(t.date, row.date)) <= 3) : null;
      const kind = transfer ? 'transfer' : analysis.kind, imported = saved.has(fingerprint);
      const similar = imported ? null : (sameAmount.get(`${row.currency}|${amountCents}`) || []).find(t => Math.abs(dayDifference(t.date, row.date)) <= 1);
      return {line:row.line, date:row.date, description:row.description, note:row.note, amount:row.amount, currency:row.currency, merchant:analysis.merchant, merchantKey:analysis.merchantKey, kind, category:isSpending(kind) ? rules.get(analysis.merchantKey) || analysis.category : null, fingerprint,
        duplicate:imported ? 'imported' : similar ? 'possible' : bases[i].occurrence > 0 ? 'file' : null, duplicateOf:similar ? {date:similar.date, description:similar.description} : null, transferAccount:transfer?.accountName || null, transferWith:transfer?.id || null, include:!imported && !similar};
    });
  }

  function preview(user, body) {
    const rows = cleanRows(body.rows), account = resolveAccount(user.id, body, false), analyzed = analyze(user.id, account, rows);
    const fresh = analyzed.filter(t => t.duplicate !== 'imported'), keys = new Set(fresh.map(seriesKeyOf));
    const series = seriesOf(user.id, [...transactionsOf(user.id), ...fresh]).filter(s => keys.has(s.seriesKey)), detected = new Set(series.map(s => s.seriesKey));
    const fileHash = validHash(body.fileHash);
    const previousImport = account.id && fileHash ? db.prepare('SELECT file_name AS fileName,created_at AS createdAt FROM statement_imports WHERE user_id=? AND account_id=? AND file_hash=? ORDER BY created_at DESC LIMIT 1').get(user.id, account.id, fileHash) || null : null;
    return {account, rows:analyzed.map(t => ({...t, seriesKey:detected.has(seriesKeyOf(t)) ? seriesKeyOf(t) : null})), series, previousImport};
  }

  // Confirmed EUR subscriptions join the existing renewal tracker (radar, calendar, reminders).
  function trackSubscription(userId, series, category) {
    if (series.currency !== 'EUR' || !series.cycle || !series.lastDate) return {uid:null, created:false};
    const current = accountData(userId);
    const match = current.subscriptions.find(s => s.name.trim().toLowerCase() === series.merchant.toLowerCase());
    if (match) return {uid:match.uid, created:false};
    const known = knownMerchant(series.merchant);
    const item = {uid:'tx-' + crypto.randomUUID(), id:'custom', name:series.merchant.slice(0, 120), customName:'', category, price:series.amount, cycle:series.cycle, renewalDate:series.lastDate, lastUsedDate:null, lastReviewedDate:null, priceHistory:[], color:known?.color || '#6956E8', logo:known?.logo || series.merchant[0].toUpperCase()};
    writeAccount(userId, {...current, subscriptions:checkedSubscriptions([...current.subscriptions, item])}, current.version + 1);
    return {uid:item.uid, created:true};
  }

  function decide(userId, series, status, requestedCategory) {
    if (status === 'possible') { db.prepare('DELETE FROM subscription_series WHERE user_id=? AND series_key=?').run(userId, series.seriesKey); return false; }
    const category = CATEGORIES.includes(requestedCategory) ? requestedCategory : CATEGORIES.includes(series.category) ? series.category : 'Other';
    const tracked = status === 'confirmed' ? trackSubscription(userId, series, category) : {uid:null, created:false};
    db.prepare('INSERT INTO subscription_series(user_id,series_key,status,merchant,currency,cycle,category,amount_cents,subscription_uid,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,series_key) DO UPDATE SET status=excluded.status,merchant=excluded.merchant,currency=excluded.currency,cycle=excluded.cycle,category=excluded.category,amount_cents=excluded.amount_cents,subscription_uid=COALESCE(excluded.subscription_uid,subscription_series.subscription_uid),updated_at=excluded.updated_at')
      .run(userId, series.seriesKey, status, series.merchant, series.currency, series.cycle || null, category, cents(series.amount || 0), tracked.uid, Date.now());
    if (status === 'confirmed') db.prepare("UPDATE transactions SET category=? WHERE user_id=? AND merchant_key||'|'||currency=? AND kind IN ('expense','refund')").run(category, userId, series.seriesKey);
    return tracked.created;
  }

  function importStatement(user, body) {
    const rows = cleanRows(body.rows), fileName = cleanText(body.fileName, 240) || 'statement.csv';
    const decisions = body.decisions && typeof body.decisions === 'object' && !Array.isArray(body.decisions) ? body.decisions : {};
    db.exec('BEGIN');
    try {
      const account = resolveAccount(user.id, body, true), analyzed = analyze(user.id, account, rows), importId = crypto.randomUUID(), now = Date.now();
      db.prepare('INSERT INTO statement_imports(id,user_id,account_id,file_name,file_hash,imported,skipped,created_at) VALUES(?,?,?,?,?,0,0,?)').run(importId, user.id, account.id, fileName, validHash(body.fileHash), now);
      // The unique (account, fingerprint) key makes a repeated upload skip rows already saved.
      const insert = db.prepare('INSERT OR IGNORE INTO transactions(id,user_id,account_id,import_id,fingerprint,date,description,merchant,merchant_key,amount_cents,currency,kind,category,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const markTransfer = db.prepare("UPDATE transactions SET kind='transfer',category=NULL WHERE id=? AND user_id=? AND kind IN ('expense','income')");
      let imported = 0, skipped = 0;
      analyzed.forEach((t, i) => {
        const choice = rows[i];
        if (!choice.include) { skipped++; return; }
        const kind = choice.kind || t.kind, category = isSpending(kind) ? choice.category || t.category || 'Other' : null;
        if (Number(insert.run(crypto.randomUUID(), user.id, account.id, importId, t.fingerprint, t.date, t.description, t.merchant, t.merchantKey, cents(t.amount), t.currency, kind, category, now).changes) > 0) {
          imported++;
          // Both sides of a transfer between the user's own accounts stop counting as spending/income.
          if (kind === 'transfer' && t.transferWith) markTransfer.run(t.transferWith, user.id);
        } else skipped++;
      });
      if (imported) db.prepare('UPDATE statement_imports SET imported=?,skipped=? WHERE id=?').run(imported, skipped, importId);
      else db.prepare('DELETE FROM statement_imports WHERE id=?').run(importId);
      const series = seriesOf(user.id);
      let subscriptionsAdded = 0;
      for (const [key, decision] of Object.entries(decisions)) {
        const s = series.find(x => x.seriesKey === key);
        if (s && ['confirmed','rejected'].includes(decision?.status) && decide(user.id, s, decision.status, decision.category)) subscriptionsAdded++;
      }
      db.exec('COMMIT');
      return {imported, skipped, bankAccountId:account.id, subscriptionsAdded, account:{accountId:user.id, ...accountData(user.id)}};
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function decideSeries(user, body) {
    const status = String(body.status || '');
    if (!['confirmed','rejected','possible'].includes(status)) throw Error('Choose a valid decision.');
    const series = seriesOf(user.id).find(s => s.seriesKey === body.seriesKey);
    if (!series) { const e = Error('This possible subscription is no longer available.'); e.status = 404; throw e; }
    db.exec('BEGIN');
    try { const subscriptionAdded = decide(user.id, series, status, body.category); db.exec('COMMIT'); return {subscriptionAdded, account:{accountId:user.id, ...accountData(user.id)}}; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function updateTransaction(user, id, body) {
    const row = db.prepare('SELECT kind,category FROM transactions WHERE id=? AND user_id=?').get(id, user.id);
    if (!row) { const e = Error('Transaction not found.'); e.status = 404; throw e; }
    const kind = body.kind === undefined ? row.kind : body.kind;
    if (!KINDS.includes(kind)) throw Error('Choose a valid type.');
    let category = null;
    if (isSpending(kind)) {
      category = body.category === undefined ? row.category || 'Other' : body.category;
      if (!CATEGORIES.includes(category)) throw Error('Choose a valid category.');
    }
    db.prepare('UPDATE transactions SET kind=?,category=? WHERE id=? AND user_id=?').run(kind, category, id, user.id);
    return {id, kind, category};
  }

  function addManualTransaction(user, body) {
    const id = String(body.requestId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('Invalid transaction request.');
    const [row] = cleanRows([body]);
    if (!KINDS.includes(body.kind)) throw Error('Choose a valid type.');
    if ((row.kind === 'expense' && row.amount >= 0) || (['income','refund'].includes(row.kind) && row.amount <= 0)) throw Error('The amount does not match the transaction type.');
    if (isSpending(row.kind) && body.category !== undefined && !CATEGORIES.includes(body.category)) throw Error('Choose a valid category.');
    db.exec('BEGIN');
    try {
      const account = resolveAccount(user.id, body, true);
      const existing = db.prepare('SELECT id FROM transactions WHERE user_id=? AND account_id=? AND fingerprint=?').get(user.id, account.id, 'manual:' + id);
      if (existing) { db.exec('COMMIT'); return {id:existing.id, bankAccountId:account.id, created:false}; }
      const analysis = analyzeTransaction(row), rule = rulesOf(user.id).find(r => r.merchantKey === analysis.merchantKey);
      const category = isSpending(row.kind) ? row.category || rule?.category || analysis.category || 'Other' : null;
      const transactionId = crypto.randomUUID();
      db.prepare('INSERT INTO transactions(id,user_id,account_id,import_id,fingerprint,date,description,merchant,merchant_key,amount_cents,currency,kind,category,created_at) VALUES(?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)')
        .run(transactionId, user.id, account.id, 'manual:' + id, row.date, row.description, analysis.merchant, analysis.merchantKey, cents(row.amount), row.currency, row.kind, category, Date.now());
      db.exec('COMMIT');
      return {id:transactionId, bankAccountId:account.id, created:true};
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function bulkCategory(user, body) {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > MAX_IMPORT_ROWS || body.ids.some(id => typeof id !== 'string')) throw Error('Select transactions to update.');
    if (!CATEGORIES.includes(body.category)) throw Error('Choose a valid category.');
    if (body.rememberRule !== undefined && typeof body.rememberRule !== 'boolean') throw Error('Invalid rule choice.');
    const ids = [...new Set(body.ids)];
    db.exec('BEGIN');
    try {
      const get = db.prepare('SELECT id,kind,merchant,merchant_key AS merchantKey FROM transactions WHERE id=? AND user_id=?');
      const rows = ids.map(id => get.get(id, user.id));
      if (rows.some(r => !r)) { const e = Error('Transaction not found.'); e.status = 404; throw e; }
      if (rows.some(r => !isSpending(r.kind))) throw Error('Select only expenses and refunds for categorization.');
      const update = db.prepare('UPDATE transactions SET category=? WHERE id=? AND user_id=?');
      const saveRule = db.prepare('INSERT INTO transaction_category_rules(id,user_id,merchant_key,merchant,category,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,merchant_key) DO UPDATE SET merchant=excluded.merchant,category=excluded.category,updated_at=excluded.updated_at');
      const merchants = new Map(rows.map(r => [r.merchantKey, r.merchant]));
      for (const row of rows) update.run(body.category, row.id, user.id);
      if (body.rememberRule) for (const [key, merchant] of merchants) saveRule.run(crypto.randomUUID(), user.id, key, merchant, body.category, Date.now());
      db.exec('COMMIT');
      return {updated:ids.length, rulesSaved:body.rememberRule ? merchants.size : 0};
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function removeRule(user, id) {
    const removed = Number(db.prepare('DELETE FROM transaction_category_rules WHERE id=? AND user_id=?').run(id, user.id).changes);
    if (!removed) { const e = Error('Category rule not found.'); e.status = 404; throw e; }
    return {removed};
  }

  function removeImport(user, id) {
    if (!db.prepare('SELECT 1 FROM statement_imports WHERE id=? AND user_id=?').get(id, user.id)) { const e = Error('Import not found.'); e.status = 404; throw e; }
    db.exec('BEGIN');
    try {
      const removed = Number(db.prepare('DELETE FROM transactions WHERE import_id=? AND user_id=?').run(id, user.id).changes);
      db.prepare('DELETE FROM statement_imports WHERE id=? AND user_id=?').run(id, user.id);
      db.exec('COMMIT');
      return {removed};
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  async function handle(req, res, url) {
    if (url.pathname !== '/api/transactions' && !url.pathname.startsWith('/api/transactions/')) return false;
    const user = getCurrentUser(req);
    if (!user) { json(res, 401, {error:'You need to be signed in.'}); return true; }
    try {
      if (url.pathname === '/api/transactions' && req.method === 'GET') {
        const transactions = transactionsOf(user.id);
        const freshness = db.prepare('SELECT a.id AS accountId,(SELECT MAX(created_at) FROM statement_imports WHERE user_id=a.user_id AND account_id=a.id) AS lastImportAt,(SELECT MAX(date) FROM transactions WHERE user_id=a.user_id AND account_id=a.id AND import_id IS NOT NULL) AS lastImportedTransactionDate,(SELECT MAX(date) FROM transactions WHERE user_id=a.user_id AND account_id=a.id) AS lastTransactionDate FROM bank_accounts a WHERE a.user_id=?').all(user.id);
        json(res, 200, {accounts:accountsOf(user.id), transactions, series:seriesOf(user.id, transactions), imports:importsOf(user.id), rules:rulesOf(user.id), freshness});
        return true;
      }
      const importMatch = url.pathname.match(/^\/api\/transactions\/imports\/([0-9a-f-]{36})$/), itemMatch = url.pathname.match(/^\/api\/transactions\/([0-9a-f-]{36})$/);
      const ruleMatch = url.pathname.match(/^\/api\/transactions\/rules\/([0-9a-f-]{36})$/);
      if (ruleMatch && req.method === 'DELETE') { json(res, 200, removeRule(user, ruleMatch[1])); return true; }
      if (importMatch && req.method === 'DELETE') { json(res, 200, removeImport(user, importMatch[1])); return true; }
      if (!['POST','PATCH'].includes(req.method)) { json(res, 405, {error:'Method not allowed.'}); return true; }
      const body = await readBody(req, user.id);
      if (url.pathname === '/api/transactions/manual' && req.method === 'POST') { json(res, 200, addManualTransaction(user, body)); return true; }
      if (url.pathname === '/api/transactions/bulk-category' && req.method === 'POST') { json(res, 200, bulkCategory(user, body)); return true; }
      if (url.pathname === '/api/transactions/preview' && req.method === 'POST') { json(res, 200, preview(user, body)); return true; }
      if (url.pathname === '/api/transactions/import' && req.method === 'POST') { json(res, 200, importStatement(user, body)); return true; }
      if (url.pathname === '/api/transactions/series' && req.method === 'POST') { json(res, 200, decideSeries(user, body)); return true; }
      if (itemMatch && req.method === 'PATCH') { json(res, 200, updateTransaction(user, itemMatch[1], body)); return true; }
      json(res, 404, {error:'Not found.'});
      return true;
    } catch (e) { json(res, e.status || 400, {error:e.message === 'Invalid JSON' ? 'Invalid request.' : e.message}); return true; }
  }

  return {handle};
}
