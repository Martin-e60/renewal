// Bank-statement parsing and transaction analysis. Shared by the browser (reading and
// mapping the CSV file) and the server (validation, categories, duplicates, subscriptions).
import {validDate, dayDifference, nextRenewal, addDays} from './dates.js';

export const CATEGORIES = ['Food & groceries','Transport','Shopping','Entertainment','Bills & utilities','Health','Other'];
export const KINDS = ['expense','income','transfer','refund'];
export const COLUMN_ROLES = ['ignore','date','counterparty','description','amount','debit','credit','direction','currency','note'];
export const MAX_IMPORT_ROWS = 5000;

// ---------- File reading ----------

export function decodeStatement(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  // Bulgarian bank exports are frequently Windows-1251 rather than UTF-8.
  try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { return new TextDecoder('windows-1251').decode(bytes); }
}

function countOutsideQuotes(line, delimiter) {
  let quoted = false, count = 0;
  for (const c of line) { if (c === '"') quoted = !quoted; else if (c === delimiter && !quoted) count++; }
  return count;
}

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
  let best = ',', bestScore = -1;
  for (const delimiter of [',', ';', '\t', '|']) {
    const freq = new Map();
    for (const line of lines) { const n = countOutsideQuotes(line, delimiter); if (n) freq.set(n, (freq.get(n) || 0) + 1); }
    // The delimiter whose per-line count is most consistent wins.
    const [count = 0, times = 0] = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] || [];
    const score = times * 1000 + count;
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

export function parseCsv(text, delimiter = ',') {
  const rows = [];
  let cells = [], cell = '', quoted = false, line = 1, start = 1;
  const pushCell = () => { cells.push(cell.trim()); cell = ''; };
  const pushRow = () => { pushCell(); if (cells.some(Boolean)) rows.push({line:start, cells}); cells = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (c === '\n') line++; if (c !== '\r') cell += c; }
      continue;
    }
    if (c === '"' && !cell.trim()) { quoted = true; cell = ''; continue; }
    if (c === delimiter) { pushCell(); continue; }
    if (c === '\r') continue;
    if (c === '\n') { pushRow(); line++; start = line; continue; }
    cell += c;
  }
  if (cell || cells.length) pushRow();
  return rows;
}

export function readStatement(text) {
  let body = String(text || ''), delimiter = null;
  const sep = body.match(/^sep=(.)\r?\n/i);
  if (sep) { delimiter = sep[1]; body = body.slice(sep[0].length); }
  delimiter = delimiter || detectDelimiter(body);
  return {delimiter, rows:parseCsv(body, delimiter)};
}

// ---------- Values ----------

const CURRENCY_SYMBOLS = {'€':'EUR','$':'USD','us$':'USD','£':'GBP','лв':'BGN','¥':'JPY','zł':'PLN','kč':'CZK','lei':'RON','₺':'TRY','₴':'UAH','fr':'CHF','ft':'HUF'};

export function normalizeCurrency(value) {
  const text = String(value ?? '').trim().replace(/\.$/, '');
  if (!text) return null;
  if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase();
  return CURRENCY_SYMBOLS[text.toLowerCase()] || null;
}

function toNumber(n) {
  const lastComma = n.lastIndexOf(','), lastDot = n.lastIndexOf('.');
  let whole = n, fraction = '';
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = Math.max(lastComma, lastDot), thousands = decimal === lastComma ? '.' : ',';
    whole = n.slice(0, decimal); fraction = n.slice(decimal + 1);
    if (whole.includes(thousands === '.' ? ',' : '.')) return null;
    whole = whole.split(thousands).join('');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const parts = n.split(lastComma >= 0 ? ',' : '.');
    // "12,50" and "0.125" are decimals; "1,234" and "1.234.567" are thousands.
    if (parts.length === 2 && !(parts[1].length === 3 && parts[0] && parts[0] !== '0')) { whole = parts[0] || '0'; fraction = parts[1]; }
    else { if (!parts[0] || parts.slice(1).some(p => p.length !== 3)) return null; whole = parts.join(''); }
  }
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  return Number(whole + (fraction ? '.' + fraction : ''));
}

export function parseAmount(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const letters = text.replace(/[\d\s.,'’+\-−()\u00a0\u202f]/g, '');
  let currency = null, marker = 0;
  if (letters) {
    if (/^(dr|db|d)$/i.test(letters)) marker = -1;
    else if (/^(cr|c)$/i.test(letters)) marker = 1;
    else { currency = normalizeCurrency(letters); if (!currency) return null; }
  }
  // Trailing separators belong to currency text such as "лв." and are never decimals.
  let n = text.replace(/[^\d.,+\-−()]/g, '').replace(/[.,]+$/, ''), negative = false;
  if (/^\(.*\)$/.test(n)) { negative = true; n = n.slice(1, -1); }
  if (/^[+\-−]/.test(n)) { negative = n[0] !== '+'; n = n.slice(1); }
  else if (/[+\-−]$/.test(n)) { negative = !n.endsWith('+'); n = n.slice(0, -1); }
  if (!/^[\d.,]+$/.test(n) || !/\d/.test(n)) return null;
  const number = toNumber(n);
  if (number === null) return null;
  return {value:marker ? marker * number : negative ? -number : number, currency};
}

export function parseDirection(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (/^(d|dr|db|dt|debit|débito|debito|д|дт|дебит|out|s|soll|cargo|-)$/.test(v)) return -1;
  if (/^(c|cr|ct|kt|credit|crédito|credito|к|кт|кредит|in|h|haben|abono|\+)$/.test(v)) return 1;
  return null;
}

const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function isoDate(y, m, d) {
  const value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return validDate(value) ? value : null;
}

// order: 'DMY' (31.12.2026) or 'MDY' (12/31/2026). Year-first dates are always read as Y-M-D.
export function parseDate(value, order = 'DMY') {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?=$|[\sT,])/))) return isoDate(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})\.?(?=$|[\sT,])/))) {
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    return order === 'MDY' ? isoDate(year, m[1], m[2]) : isoDate(year, m[2], m[1]);
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return isoDate(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{4})/)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) return isoDate(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s(\d{1,2}),?\s(\d{4})/)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) return isoDate(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  return null;
}

export function detectDateOrder(values) {
  let order = 'DMY';
  for (const v of values) {
    const m = String(v).trim().match(/^(\d{1,2})[-./](\d{1,2})[-./]/);
    if (!m) continue;
    if (Number(m[1]) > 12) return 'DMY';
    if (Number(m[2]) > 12) order = 'MDY';
  }
  return order;
}

// ---------- Column detection ----------

const HEADER_KEYWORDS = {
  date:['date','дата','datum','fecha','вальор','buchungstag','wertstellung'],
  ignore:['balance','running balance','салдо','наличност','разполагаема','kontostand','saldo','rate','exchange rate','курс','kurs','fee','fees','такса','такси','комисиона','gebühr','gebuehr','comisión','comision','iban','bic','swift','account','сметка','сметката','konto','cuenta','card number','карта','state','status','статус','estado','reference number','id'],
  direction:['debit/credit','d/c','dr/cr','д/к','дт/кт','дебит/кредит','soll/haben','cargo/abono','type','тип','вид','direction','направление','indicator'],
  debit:['debit','дебит','дт','money out','paid out','out','withdrawal','outflow','soll','cargo','ausgang','разход'],
  credit:['credit','кредит','кт','money in','paid in','in','deposit','inflow','haben','abono','eingang','приход'],
  currency:['currency','валута','währung','waehrung','moneda','ccy','curr','divisa'],
  amount:['amount','sum','summe','сума','сумата','стойност','betrag','importe','cantidad','value'],
  counterparty:['counterparty','payee','merchant','beneficiary','recipient','name','контрагент','получател','наредител','търговец','име','empfänger','empfaenger','auftraggeber','beneficiario','ordenante','comercio'],
  description:['description','details','detail','narrative','reference','memo','purpose','описание','основание','детайли','пояснение','информация','bezeichnung','verwendungszweck','beschreibung','buchungstext','concepto','descripción','descripcion','detalle','text'],
  note:['category','категория','kategorie','categoría','categoria']
};
const ROLE_ORDER = ['date','ignore','direction','debit','credit','currency','amount','counterparty','description','note'];
const SINGLE_ROLES = ['date','amount','debit','credit','direction','currency'];

const words = text => String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const wordMatches = (word, keyword) => keyword.length < 4 ? word === keyword : word.startsWith(keyword);
function hasKeyword(headerWords, keyword) {
  const kw = words(keyword);
  for (let i = 0; i + kw.length <= headerWords.length; i++) if (kw.every((k, j) => wordMatches(headerWords[i + j], k))) return true;
  return false;
}
export function headerRole(cell) {
  const w = words(cell || '');
  if (!w.length) return null;
  return ROLE_ORDER.find(role => HEADER_KEYWORDS[role].some(k => hasKeyword(w, k))) || null;
}

// Returns a proposed column mapping. `confident` is false whenever the essentials were
// guessed from content rather than recognised headers; the UI then asks the user.
export function detectColumns(rows, forcedHeader) {
  let headerIndex = forcedHeader ?? rows.slice(0, 30).findIndex(r => {
    const roles = r.cells.map(headerRole);
    return roles.includes('date') && roles.some(x => ['amount','debit','credit','description','counterparty'].includes(x));
  });
  if (!Number.isInteger(headerIndex) || headerIndex < -1 || headerIndex >= rows.length) headerIndex = -1;
  // Unrecognised header names: a first row without dates or numbers is still the header row.
  if (forcedHeader === undefined && headerIndex === -1 && rows.length > 1 && !rows[0].cells.some(v => parseDate(v, 'DMY') || parseDate(v, 'MDY') || parseAmount(v))) headerIndex = 0;
  const data = rows.slice(headerIndex + 1, headerIndex + 61);
  const width = Math.max(0, ...rows.slice(Math.max(headerIndex, 0), headerIndex + 61).map(r => r.cells.length));
  const column = i => data.map(r => (r.cells[i] || '').trim()).filter(Boolean);
  const share = (values, check) => values.length ? values.filter(check).length / values.length : 0;
  const isDate = v => !!(parseDate(v, 'DMY') || parseDate(v, 'MDY'));
  const isAmount = v => parseAmount(v) !== null;
  const indexes = [...Array(width).keys()];
  const mapping = indexes.map(i => headerIndex >= 0 ? headerRole(rows[headerIndex].cells[i]) : null);
  const used = new Set();
  for (const i of indexes) {
    let role = mapping[i];
    const values = column(i);
    // A recognised header only needs most values to fit; footers and junk rows are flagged later.
    if (role === 'date' && share(values, isDate) < 0.6) role = null;
    if (['amount','debit','credit'].includes(role) && values.length && share(values, isAmount) < 0.6) role = null;
    if (role === 'direction' && share(values, v => parseDirection(v) !== null) < 0.8) role = values.length ? 'note' : null;
    if (role === 'currency' && share(values, v => !!normalizeCurrency(v)) < 0.8) role = null;
    if (SINGLE_ROLES.includes(role)) { if (used.has(role)) role = 'ignore'; else used.add(role); }
    mapping[i] = role;
  }
  let guessed = false;
  const free = i => mapping[i] === null;
  if (!used.has('date')) {
    const i = indexes.find(i => free(i) && column(i).length && share(column(i), isDate) >= 0.8);
    if (i !== undefined) { mapping[i] = 'date'; used.add('date'); guessed = true; }
  }
  if (!['amount','debit','credit'].some(r => used.has(r))) {
    const numeric = indexes.filter(i => free(i) && column(i).length && share(column(i), isAmount) >= 0.8);
    if (numeric.length) { mapping[numeric[0]] = 'amount'; used.add('amount'); guessed = true; }
  }
  if (!used.has('currency')) {
    const i = indexes.find(i => free(i) && column(i).length && share(column(i), v => !!normalizeCurrency(v)) >= 0.8);
    if (i !== undefined) { mapping[i] = 'currency'; used.add('currency'); guessed = true; }
  }
  if (!mapping.some(r => r === 'description' || r === 'counterparty')) {
    const letters = i => { const v = column(i); return v.length ? v.reduce((n, x) => n + (x.match(/\p{L}/gu) || []).length, 0) / v.length : 0; };
    const best = indexes.filter(free).sort((a, b) => letters(b) - letters(a))[0];
    if (best !== undefined && letters(best) >= 3) { mapping[best] = 'description'; guessed = true; }
  }
  const final = mapping.map(r => r || 'ignore');
  const complete = final.includes('date') && (final.includes('description') || final.includes('counterparty')) && ['amount','debit','credit'].some(r => final.includes(r));
  return {headerIndex, mapping:final, dateOrder:detectDateOrder(column(final.indexOf('date'))), confident:complete && headerIndex >= 0 && !guessed};
}

const SUMMARY_ROW = /^(opening|closing|начално|крайно|общо|total|saldo|balance|салдо|оборот)/i;

// Turns CSV rows into transactions. Invalid rows keep an `error` (a fixed UI string) and
// the offending `value`, so the review table can explain why they are skipped.
export function applyMapping(rows, {headerIndex = -1, mapping = [], dateOrder = 'DMY', currency = 'EUR'} = {}) {
  const cols = role => mapping.map((r, i) => r === role ? i : -1).filter(i => i >= 0);
  const [dateCol] = cols('date'), [amountCol] = cols('amount'), [debitCol] = cols('debit'), [creditCol] = cols('credit'), [directionCol] = cols('direction'), [currencyCol] = cols('currency');
  const textCols = [...cols('counterparty'), ...cols('description')], noteCols = cols('note');
  const fallbackCurrency = normalizeCurrency(currency) || 'EUR';
  const cell = (cells, i) => i === undefined ? '' : String(cells[i] ?? '').trim();
  const parse = ({line, cells}) => {
    const fail = (error, value = '') => ({line, raw:cells.join(' | '), error, value});
    const dateText = cell(cells, dateCol);
    if (!dateText) return fail('Missing date');
    const date = parseDate(dateText, dateOrder);
    if (!date) return fail('Invalid date', dateText);
    let amount = null, amountCurrency = null;
    if (amountCol !== undefined) {
      const text = cell(cells, amountCol);
      if (text) { const p = parseAmount(text); if (!p) return fail('Invalid amount', text); amount = p.value; amountCurrency = p.currency; }
    } else {
      for (const [i, sign] of [[creditCol, 1], [debitCol, -1]]) {
        const text = cell(cells, i);
        if (!text) continue;
        const p = parseAmount(text);
        if (!p) return fail('Invalid amount', text);
        if (p.value === 0) continue;
        amount = (amount || 0) + sign * Math.abs(p.value);
        amountCurrency = amountCurrency || p.currency;
      }
    }
    if (amount === null) return fail('Missing amount');
    const direction = parseDirection(cell(cells, directionCol));
    if (direction) amount = Math.abs(amount) * direction;
    amount = Math.round(amount * 100) / 100;
    if (!amount) return fail('Amount is zero');
    let rowCurrency = amountCurrency || fallbackCurrency;
    const currencyText = cell(cells, currencyCol);
    if (currencyText) { rowCurrency = normalizeCurrency(currencyText); if (!rowCurrency) return fail('Unknown currency', currencyText); }
    const clean = list => list.map(i => cell(cells, i)).filter(Boolean).join(' · ').replace(/\s+/g, ' ');
    const description = clean(textCols).slice(0, 300), note = clean(noteCols).slice(0, 200);
    if (!description && !note) return fail('Missing description');
    if (SUMMARY_ROW.test(description)) return fail('Balance or total row', description);
    return {line, date, description:description || note, note, amount, currency:rowCurrency};
  };
  return rows.slice(headerIndex + 1).filter(r => r.cells.some(Boolean)).map(parse);
}

// ---------- Analysis ----------

const KNOWN_MERCHANTS = [
  ['Netflix', /netflix/, 'Entertainment', '#E50914', 'N'],
  ['Spotify', /spotify/, 'Entertainment', '#1ED760', 'spotify'],
  ['Disney+', /disney\s*(\+|plus)|disneyplus/, 'Entertainment', '#113CCF', 'D+'],
  ['YouTube Premium', /youtube/, 'Entertainment', '#FF0000', '▶'],
  ['Amazon Prime', /prime\s*video|amazon\s*prime|primevideo/, 'Entertainment', '#00A8E1', 'P'],
  ['HBO Max', /(^|[^a-z0-9])hbo|(^|[^a-z0-9])max\.com/, 'Entertainment'],
  ['Apple', /apple\.com|itunes|apple\s+services/, 'Entertainment'],
  ['Google One', /google\s*\*?\s*one|google\s*storage/, 'Other', '#4285F4', 'G'],
  ['Adobe', /adobe/, 'Other', '#FA0F00', 'A'],
  ['Microsoft 365', /microsoft|msft/, 'Other', '#F25022', 'M'],
  ['Notion', /(^|[^a-z0-9])notion/, 'Other', '#111111', 'N'],
  ['ChatGPT', /openai|chatgpt/, 'Other'],
  ['Claude', /anthropic|claude\.ai/, 'Other'],
  ['Steam', /steampowered|steam\s*(games|purchase)/, 'Entertainment'],
  ['PlayStation', /playstation|sony\s+interactive/, 'Entertainment'],
  ['Uber Eats', /uber\s*\*?\s*eats/, 'Food & groceries'],
  ['Uber', /(^|[^a-z0-9])uber/, 'Transport'],
  ['Bolt Food', /bolt\s*food/, 'Food & groceries'],
  ['Bolt', /(^|[^a-z0-9])bolt(\.eu)?([^a-z0-9]|$)/, 'Transport'],
  ['Glovo', /glovo/, 'Food & groceries'],
  ['Wolt', /(^|[^a-z0-9])wolt/, 'Food & groceries'],
  ['Foodpanda', /foodpanda|takeaway\.com/, 'Food & groceries'],
  ['Amazon', /amazon|amzn/, 'Shopping'],
  ['eMAG', /(^|[^a-z0-9])emag/, 'Shopping'],
  ['IKEA', /(^|[^a-z0-9])ikea/, 'Shopping'],
  ['Lidl', /lidl/, 'Food & groceries'],
  ['Kaufland', /kaufland/, 'Food & groceries'],
  ['Billa', /(^|[^a-z0-9])billa/, 'Food & groceries'],
  ['Fantastico', /fantastico|фантастико/, 'Food & groceries'],
  ['Vivacom', /vivacom|виваком/, 'Bills & utilities'],
  ['Yettel', /yettel|telenor|йетел|теленор/, 'Bills & utilities'],
  ['A1', /(^|[^a-z0-9])a1([^a-z0-9]|$)|mobiltel|мобилтел/, 'Bills & utilities'],
  ['Shell', /(^|[^a-z0-9])shell/, 'Transport'],
  ['OMV', /(^|[^a-z0-9])omv/, 'Transport'],
  ['Lukoil', /lukoil|лукойл/, 'Transport']
].map(([name, match, category, color, logo]) => ({name, match, category, color, logo}));

export function knownMerchant(name) { return KNOWN_MERCHANTS.find(m => m.name === name) || null; }

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ASCII keywords must start a word ("taxi" must not match "maxitaxi..."), Cyrillic ones are substrings.
const keywordRegExp = list => new RegExp(list.map(k => /^[\x00-\x7f]+$/.test(k) ? `(?:^|[^a-z0-9])${escapeRegExp(k)}` : escapeRegExp(k)).join('|'), 'u');
const CATEGORY_RULES = [
  ['Health', ['pharmacy','apotheke','farmacia','clinic','klinik','clínica','hospital','dental','dentist','doctor','medical','laborator','optic','synevo','cibalab','sopharma','subra','mareshki','аптека','аптеки','клиника','болница','дентал','зъболекар','лекар','медицин','лаборатор','оптика','марешки']],
  ['Bills & utilities', ['electric','energy','energo','heating','utility','utilities','internet','telecom','broadband','insurance','allianz','generali','bulstrad','evn','electrohold','toplofikacia','sofiyska voda','strom','stadtwerke','miete','versicherung','iberdrola','endesa','alquiler','seguro','електро','енерго','евн','сметка ток','парно','интернет','топлофикация','софийска вода','водоснабдяване','наем','застраховка','данък','такса смет','мтел']],
  ['Food & groceries', ['supermarket','minimarket','market','grocery','groceries','restaurant','cafe','café','coffee','bakery','pizza','burger','sushi','kebab','bistro','grill','food','mcdonald','kfc','starbucks','subway','domino','metro cash','t market','t-market','lebensmittel','bäckerei','rewe','edeka','aldi','penny','mercadona','carrefour','supermercado','restaurante','panader','хранителни','супермаркет','пекарна','ресторант','кафе','пица','бистро','механа','закуски','баничарница']],
  ['Transport', ['fuel','petrol','gas station','rompetrol','eko bulgaria','parking','taxi','metro','train','railway','rail','airline','ryanair','wizz','easyjet','lufthansa','flight','toll','vignette','bgtoll','bdz','tankstelle','aral','bahn','gasolinera','repsol','cepsa','renfe','транспорт','бдж','винетка','паркинг','такси','гориво','бензин','бензиностанция','метро','автобус','градска мобилност']],
  ['Entertainment', ['cinema','kino','theatre','theater','concert','twitch','xbox','nintendo','game','gaming','ticket','eventim','museum','bowling','кино','театър','концерт','билет','музей','боулинг']],
  ['Shopping', ['zara','h&m','hm.com','aliexpress','temu','shein','jumbo','technopolis','technomarket','zora','decathlon','pepco','jysk','praktiker','bricolage','ozone','answear','about you','notino','douglas','drogerie','lilly','mall','store','shop','outlet','технополис','техномаркет','джъмбо','магазин']]
].map(([category, list]) => [category, keywordRegExp(list)]);

const TRANSFER_WORDS = keywordRegExp(['own account','between accounts','between own','internal transfer','to savings','from savings','savings','top-up','top up','topup','exchanged to','currency exchange','собствена сметка','собствени сметки','между сметки','захранване','спестов','обмяна','umbuchung','eigenes konto','traspaso','entre cuentas','cuenta propia']);
const REFUND_WORDS = keywordRegExp(['refund','reversal','reversed','returned','chargeback','cashback','cash back','възстановяване','възстановена','възстановени','възстановен','сторно','върнат','върната','rückerstattung','erstattung','gutschrift','reembolso','devolución','devolucion']);

export function categorize(text) {
  const t = String(text || '').toLowerCase();
  const known = KNOWN_MERCHANTS.find(m => m.match.test(t));
  if (known) return known.category;
  return CATEGORY_RULES.find(([, re]) => re.test(t))?.[0] || 'Other';
}

export function classifyKind(amount, text) {
  const t = String(text || '').toLowerCase();
  if (TRANSFER_WORDS.test(t)) return 'transfer';
  if (amount > 0) return REFUND_WORDS.test(t) ? 'refund' : 'income';
  return 'expense';
}

const NOISE = new Set(['pos','atm','card','cards','payment','payments','purchase','purchases','transaction','transfer','debit','credit','contactless','online','www','com','net','org','eu','bg','bgr','bul','bulgaria','bgn','eur','usd','gbp','sofia','sofiya','plovdiv','varna','burgas','ltd','llc','inc','gmbh','ood','eood','ead','ad','sa','srl','paypal','sumup','sq','zettle','izettle','the','and','to','from','via','for','by','of','at','in','on','with','issued','ref','reference','nr','no','плащане','плащания','покупка','карта','картово','пос','трансакция','транзакция','превод','теглене','банкомат','софия','пловдив','варна','бургас','оод','еоод','еад','ад','ет','от','към','на','за','по']);

export function merchantOf(description) {
  const text = String(description || '');
  const known = KNOWN_MERCHANTS.find(m => m.match.test(text.toLowerCase()));
  if (known) return {name:known.name, key:known.name.toLowerCase()};
  const tokens = text.split(/[^\p{L}\p{N}&]+/u).filter(w => w.length > 1 && !/\d/.test(w) && !NOISE.has(w.toLowerCase())).slice(0, 2);
  if (!tokens.length) { const name = text.trim().slice(0, 60) || 'Unknown'; return {name, key:name.toLowerCase()}; }
  return {name:tokens.map(w => w.length > 3 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w).join(' '), key:tokens.join(' ').toLowerCase()};
}

export function analyzeTransaction({description = '', note = '', amount}) {
  const text = `${description} ${note}`;
  const merchant = merchantOf(description || note), kind = classifyKind(amount, text);
  return {merchant:merchant.name, merchantKey:merchant.key, kind, category:kind === 'expense' || kind === 'refund' ? categorize(text) : null};
}

// A stable identity per statement row. Identical rows in one file (two equal coffees on the
// same day) get increasing occurrence numbers, so re-importing the same file matches them.
export function fingerprintBases(rows) {
  const seen = new Map();
  return rows.map(r => {
    const base = [r.date, Math.round(r.amount * 100), r.currency, String(r.description).toLowerCase().replace(/\s+/g, ' ').trim()].join('|');
    const occurrence = seen.get(base) || 0;
    seen.set(base, occurrence + 1);
    return {key:`${base}#${occurrence}`, occurrence};
  });
}

export const seriesKeyOf = t => `${t.merchantKey}|${t.currency}`;

const CYCLES = [['Weekly', 5, 9], ['Monthly', 25, 36], ['Yearly', 350, 380]];
const median = values => { const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Payments to the same merchant in the same currency at a regular weekly, monthly or yearly
// interval with similar amounts. The result is only a suggestion for the user to confirm.
export function detectRecurring(transactions) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.kind !== 'expense') continue;
    const key = seriesKeyOf(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const found = [];
  for (const [seriesKey, items] of groups) {
    if (items.length < 2) continue;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => dayDifference(t.date, sorted[i].date));
    const cycle = CYCLES.find(([, min, max]) => gaps.every(g => g >= min && g <= max))?.[0];
    if (!cycle || (cycle === 'Weekly' && sorted.length < 3)) continue;
    const amounts = sorted.map(t => Math.abs(t.amount)), mid = median(amounts), tolerance = sorted.length === 2 ? 0.1 : 0.25;
    if (amounts.some(a => Math.abs(a - mid) > mid * tolerance)) continue;
    const last = sorted.at(-1), counts = new Map();
    for (const t of sorted) if (t.category) counts.set(t.category, (counts.get(t.category) || 0) + 1);
    found.push({seriesKey, merchant:last.merchant, currency:last.currency, cycle, amount:Math.abs(last.amount), count:sorted.length, firstDate:sorted[0].date, lastDate:last.date,
      nextDate:nextRenewal({renewalDate:last.date, cycle}, addDays(last.date, 1)), category:[...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Other'});
  }
  return found;
}

// Totals in cents per currency. Refunds reduce spending; income and own transfers are kept apart.
export function spendingSummary(transactions) {
  const out = {};
  for (const t of transactions) {
    const c = out[t.currency] || (out[t.currency] = {spending:0, income:0, transfers:0, categories:{}});
    const cents = Math.round(t.amount * 100);
    if (t.kind === 'expense' || t.kind === 'refund') { c.spending -= cents; const cat = t.category || 'Other'; c.categories[cat] = (c.categories[cat] || 0) - cents; }
    else if (t.kind === 'income') c.income += cents;
    else c.transfers += Math.abs(cents);
  }
  return out;
}
