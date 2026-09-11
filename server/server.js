import http from 'node:http';
import {createBilling} from './billing.js';
import {createTransactions} from './transactions.js';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import Database from 'libsql';
import { loadEnvFile } from 'node:process';
import { validDate, dateKey, nextRenewal, dayDifference } from '../public/assets/dates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
try { loadEnvFile(path.join(rootDir, '.env')); } catch (error) { if(error.code !== 'ENOENT') throw error; }
const publicDir = path.join(rootDir, 'public');
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
await mkdir(dataDir, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const APP_ORIGIN = new URL(process.env.APP_ORIGIN || (process.env.CODESPACE_NAME ? `https://${process.env.CODESPACE_NAME}-${PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}` : `http://localhost:${PORT}`)).origin;
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, ...(!process.env.APP_ORIGIN && !process.env.CODESPACE_NAME ? [`http://127.0.0.1:${PORT}`] : []), ...(process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean).map(v=>new URL(v.trim()).origin)]);
const RESEND_READY=!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM);
const PASSWORD_RESET_TEMPLATE_ID=String(process.env.RESEND_PASSWORD_RESET_TEMPLATE_ID||'').trim();
const MAIL_READY = RESEND_READY || !!(process.env.MAIL_WEBHOOK_URL && process.env.MAIL_WEBHOOK_TOKEN);
if (process.env.MAIL_WEBHOOK_URL && new URL(process.env.MAIL_WEBHOOK_URL).protocol !== 'https:' && process.env.NODE_ENV === 'production') throw new Error('Mail webhook must use HTTPS');
const IS_PROD = process.env.NODE_ENV === 'production';
if(IS_PROD && new URL(APP_ORIGIN).protocol!=='https:')throw Error('Production APP_ORIGIN must use HTTPS.');
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'hello@duedar.example';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;
if ((tursoUrl && !tursoAuthToken) || (!tursoUrl && tursoAuthToken)) {
  throw new Error('Set both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, or neither for local development.');
}
// libSQL keeps the existing synchronous SQLite API, but executes against Turso
// when the two TURSO_* variables are present. Local DATA_DIR mode stays intact
// for development and automated tests.
const db = tursoUrl
  ? new Database(tursoUrl, { authToken: tursoAuthToken })
  : new Database(path.join(dataDir, 'renewalradar.db'));
function execSchema(script) {
  for (const statement of script.split(';').map((value) => value.trim()).filter(Boolean)) {
    // These pragmas configure a local SQLite file. Turso manages its own
    // storage and rejects them on its remote protocol.
    if (tursoUrl && /^PRAGMA\s/i.test(statement)) continue;
    db.exec(statement);
  }
}
execSchema(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

execSchema(`
 CREATE TABLE IF NOT EXISTS account_data (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, content BLOB NOT NULL, created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pending_email_changes (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS email_confirmations (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS reminder_deliveries (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, delivery_key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, delivery_key));
`);
const loginAttempts = new Map();
const billing=createBilling({db,appOrigin:APP_ORIGIN,json,getCurrentUser,readBody:readAuthenticatedBody,rateLimited});
const transactionsApi=createTransactions({db,json,getCurrentUser,readBody:readAuthenticatedBody,accountData,writeAccount,checkedSubscriptions});
const RESET_TTL_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(value);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, digestHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(digestHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  try { return Object.fromEntries(raw.split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    return i < 0 ? [pair, ''] : [decodeURIComponent(pair.slice(0, i)), decodeURIComponent(pair.slice(i + 1))];
  })); } catch { return {}; }
}

function sessionCookie(token, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const attrs = [
    `rr_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (IS_PROD) attrs.push('Secure');
  return attrs.join('; ');
}

function clearSessionCookie() {
  return `rr_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${IS_PROD ? '; Secure' : ''}`;
}

function getCurrentUser(req) {
  const token = parseCookies(req).rr_session;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const row = db.prepare(`
    SELECT users.id, users.name, users.email, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, now);
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, hashToken(token), now + SESSION_TTL_MS, now);
  return token;
}

async function readJsonBody(req, limit=8_000_000) {
  return await new Promise((resolve, reject) => {
    req.setEncoding('utf8');
    let raw = '',bytes=0;
    req.on('data', chunk => {
      raw += chunk;bytes+=Buffer.byteLength(chunk);
      if (bytes > limit) {
        const e=new Error('Request exceeds the size limit.');e.status=413;reject(e);raw='';req.removeAllListeners('data');req.resume();
      }
    });
    req.on('end', () => {
      try { const body=raw ? JSON.parse(raw) : {}; if(!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid JSON'); resolve(body); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function rateLimited(key, max = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  if(loginAttempts.size>10000) for(const [k,v] of loginAttempts) if(now-v.started>3600000)loginAttempts.delete(k);
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.started > windowMs) {
    loginAttempts.set(key, { count: 1, started: now });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

async function handleApi(req, res, url) {
  if (req.method !== 'GET' && !sameOrigin(req)) {
    return json(res, 403, { error: 'Request origin is not allowed.' });
  }

  if(req.method==='GET'&&url.pathname==='/api/health'){db.prepare('SELECT 1').get();return json(res,200,{ok:true});}
  if (req.method === 'GET' && url.pathname === '/api/meta') {
    return json(res, 200, { contactEmail: CONTACT_EMAIL, mailReady: MAIL_READY,analyticsEnabled:process.env.ANALYTICS_ENABLED==='true',billingReady:billing.ready });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = getCurrentUser(req);
    return json(res, 200, { user });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    let body;
    try { body = await readJsonBody(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    const email = normalizeEmail(body.email);
    const password = body.password;
    if (name.length < 2 || name.length > 80) return json(res, 400, { error: 'Enter your name.' });
    if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    if (!validPassword(password)) return json(res, 400, { error: 'Password must be 8–128 characters.' });
    if (rateLimited(`register:${req.socket.remoteAddress}`)) return json(res, 429, { error: 'Too many attempts. Try again later.' });

    try {
      const result = db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(name, email, hashPassword(password), Date.now());
      const token = createSession(Number(result.lastInsertRowid));
      return json(res, 201, { user: { id: Number(result.lastInsertRowid), name, email } }, { 'Set-Cookie': sessionCookie(token) });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: 'An account with this email already exists.' });
      console.error(error);
      return json(res, 500, { error: 'Could not create your account.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    let body;
    try { body = await readJsonBody(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
    const email = normalizeEmail(body.email);
    const password = body.password;
    const rateKey = `login:${req.socket.remoteAddress}:${email}`;
    if (rateLimited(`login-ip:${req.socket.remoteAddress}`,100) || rateLimited(rateKey)) return json(res, 429, { error: 'Too many attempts. Try again later.' });
    const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email);
    if (!validPassword(password) || !user || !verifyPassword(String(password || ''), user.password_hash)) {
      return json(res, 401, { error: 'Email or password is incorrect.' });
    }
    const token = createSession(user.id);
    loginAttempts.delete(rateKey);
    return json(res, 200, { user: { id: user.id, name: user.name, email: user.email } }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = parseCookies(req).rr_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  if (req.method === 'POST' && url.pathname === '/api/account/profile') {
    const current = getCurrentUser(req);
    if (!current) return json(res, 401, { error: 'You need to be signed in.' });
    let body;
    try { body = await readAuthenticatedBody(req,current.id); } catch { return json(res, 400, { error: 'Invalid request.' }); }
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) return json(res, 400, { error: 'Name must be 2–80 characters.' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, current.id);
    return json(res, 200, { user: { ...current, name } });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/forgot-password') {
    let body;
    try { body = await readJsonBody(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
    const email = normalizeEmail(body.email);
    if (rateLimited(`forgot:${req.socket.remoteAddress}:${email}`, 5, 30 * 60 * 1000)) {
      return json(res, 429, { error: 'Too many requests. Try again later.' });
    }
    if (!MAIL_READY) return json(res, 503, { error: 'Email delivery is not configured. Contact support to recover your account.' });
    const user = validEmail(email) ? db.prepare('SELECT id FROM users WHERE email = ?').get(email) : null;
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(user.id, hashToken(token), now + RESET_TTL_MS, now);
      const resetUrl=`${APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
const resetText=`Use this link within 30 minutes: ${resetUrl}`;
const resetTemplate=RESEND_READY&&PASSWORD_RESET_TEMPLATE_ID
  ? {id:PASSWORD_RESET_TEMPLATE_ID,variables:{RESET_URL:resetUrl}}
  : null;

try { await sendMail(email, 'Reset your Duedar password', resetText, crypto.randomUUID(), resetTemplate); }
      catch { db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(hashToken(token)); return json(res,503,{error:'Email delivery is temporarily unavailable. Try again later.'}); }
    }
    return json(res, 200, {message:'If an account exists for that email, a reset link has been sent.'});
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    let body;
    try { body = await readJsonBody(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
    const token = String(body.token || '');
    const password = body.password;
    if (!token || !validPassword(password)) return json(res, 400, { error: 'Invalid reset link or password.' });
    const now = Date.now();
    const reset = db.prepare(`
      SELECT id, user_id FROM password_resets
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
    `).get(hashToken(token), now);
    if (!reset) return json(res, 400, { error: 'This reset link is invalid or has expired.' });
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), reset.user_id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, reset.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      console.error(error);
      return json(res, 500, { error: 'Could not update your password.' });
    }
    return json(res, 200, { ok: true }, {'Set-Cookie':clearSessionCookie()});
  }

  if(await handleUsage(req,res,url))return;
  if(await billing.handle(req,res,url))return;
  if(await transactionsApi.handle(req,res,url))return;
  if(await handleAccount(req,res,url))return;
  const handled = await handleRecords(req,res,url);
  if(handled) return;
  return json(res, 404, { error: 'Not found.' });
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
}

async function serveStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  const explicitFiles = ['/robots.txt', '/sitemap.xml', '/site.webmanifest'];
  if (requested.startsWith('/assets/') || explicitFiles.includes(requested)) {
    const filePath = path.resolve(publicDir, requested.replace(/^\//, ''));
    const relative = path.relative(publicDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return true; }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return true; }
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': IS_PROD ? 'no-cache' : 'no-cache' });
      res.end(data);
      return true;
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return true; }
  }

  try {
    const html = await readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
    return true;
  } catch {
    return false;
  }
}

export async function app(req, res) {
  securityHeaders(res);
  try {
    const url = new URL(req.url, APP_ORIGIN);
    if(url.pathname==='/api/billing/webhook')return await billing.webhook(req,res);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (await serveStatic(req, res, url)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Unexpected server error.' });
  }
}

// Vercel imports `app` from an API function. Only a direct `node server/server.js`
// invocation starts a long-lived local HTTP server.
const runningDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runningDirectly) {
  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`Duedar running at ${APP_ORIGIN}`);
    if(!MAIL_READY)console.log('Email reminders and recovery are unavailable until Resend or a mail relay is configured.');
  });
}

function accountData(userId) {
  const row=db.prepare('SELECT version,payload FROM account_data WHERE user_id=?').get(userId);
  const data=row?{version:row.version,...JSON.parse(row.payload)}:{version:0,subscriptions:[],settings:{timeZone:'Europe/Sofia',reminderDays:3,emailReminders:false,emailVerified:false}};
  return {...data,proPreview:false,pro:billing.summary(userId).pro,billing:billing.summary(userId)};
}
function writeAccount(userId,data,version) {
  const {version:ignored,pro:ignoredPro,billing:ignoredBilling,accountId:ignoredAccount,...payload}=data;
  db.prepare('INSERT INTO account_data(user_id,version,payload) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,payload=excluded.payload').run(userId,version,JSON.stringify(payload));
}
function checkedSubscriptions(items) {
  if(!Array.isArray(items)||items.length>500)throw Error('Maximum 500 subscriptions.');
  const ids=new Set();
  return items.map(s=>{
    if(!s || typeof s!=='object')throw Error('Invalid subscription.');
    const uid=String(s.uid||'');
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(uid)||ids.has(uid))throw Error('Invalid or duplicate subscription ID.');ids.add(uid);
    const name=String(s.name||'').trim(), customName=String(s.customName||'').trim(), category=String(s.category||'Other').trim();
    if(!name||name.length>120||customName.length>120||!category||category.length>60)throw Error('Enter a service name (up to 120 characters).');
    if(!['Monthly','Yearly','Weekly'].includes(s.cycle))throw Error('Invalid billing cycle.');
    if(typeof s.price!=='number'||!Number.isFinite(s.price)||s.price<0||s.price>1000000)throw Error('Price must be between 0 and 1,000,000.');
    if(!validDate(s.renewalDate))throw Error('Invalid renewal date.');
    if(s.lastUsedDate!=null&&!validDate(s.lastUsedDate))throw Error('Invalid last-used date.');
    if(s.lastReviewedDate!=null&&!validDate(s.lastReviewedDate))throw Error('Invalid review date.');
    const priceHistory=Array.isArray(s.priceHistory)?s.priceHistory.slice(-100).map(h=>{
      if(!validDate(h.date)||![h.from,h.to].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000000)||!['Monthly','Weekly','Yearly'].includes(h.fromCycle)||!['Monthly','Weekly','Yearly'].includes(h.toCycle))throw Error('Invalid price history.');
      return {date:h.date,from:h.from,to:h.to,fromCycle:h.fromCycle,toCycle:h.toCycle};
    }):[];
    return {uid,id:String(s.id||'custom').slice(0,40),name,customName,category,price:Math.round(s.price*100)/100,cycle:s.cycle,renewalDate:s.renewalDate,lastUsedDate:s.lastUsedDate||null,lastReviewedDate:s.lastReviewedDate||null,priceHistory,color:/^#[0-9a-f]{6}$/i.test(s.color)?s.color:'#6956E8',logo:String(s.logo||name[0]).slice(0,12)};
  });
}
async function sendMail(to, subject, text, idempotencyKey = crypto.randomUUID(), template = null) {
  if (!MAIL_READY) throw Error('Email delivery is not configured.');

  const usingResend = RESEND_READY;
  const endpoint = usingResend
    ? 'https://api.resend.com/emails'
    : process.env.MAIL_WEBHOOK_URL;

  const body = usingResend
    ? template
      ? { from: process.env.MAIL_FROM, to: [to], subject, template }
      : { from: process.env.MAIL_FROM, to: [to], subject, text }
    : { to, subject, text };

  const token = usingResend
    ? process.env.RESEND_API_KEY
    : process.env.MAIL_WEBHOOK_TOKEN;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) throw Error('Email delivery failed.');
}

async function handleRecords(req,res,url) {
  if(!url.pathname.startsWith('/api/data')&&!url.pathname.startsWith('/api/documents')&&!url.pathname.startsWith('/api/reminders')&&url.pathname!=='/api/account/password')return false;
  const user=getCurrentUser(req);
  if(!user){json(res,401,{error:'You need to be signed in.'});return true;}
  const data=accountData(user.id);
  try {
    if(url.pathname==='/api/account/password'&&req.method==='POST'){
      const b=await readAuthenticatedBody(req,user.id);
      if(rateLimited(`password:${user.id}`,5)) {json(res,429,{error:'Too many attempts. Try again later.'});return true;}
      const row=db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
      if(!validPassword(b.currentPassword)||!verifyPassword(b.currentPassword,row.password_hash)){json(res,400,{error:'Current password is incorrect.'});return true;}
      if(!validPassword(b.password)){json(res,400,{error:'Password must be 8–128 characters.'});return true;}
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(b.password),user.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
        const token=createSession(user.id);db.exec('COMMIT');json(res,200,{ok:true},{'Set-Cookie':sessionCookie(token)});
      }catch(e){db.exec('ROLLBACK');throw e;}return true;
    }
    if(url.pathname==='/api/data'&&req.method==='GET'){json(res,200,{accountId:user.id,...data});return true;}
    if(url.pathname==='/api/data'&&req.method==='PUT'){
      const b=await readAuthenticatedBody(req,user.id);
      // Re-read after awaiting the body: another tab may have saved meanwhile.
      const current=accountData(user.id);
      if(b.version!==current.version){json(res,409,{error:'Your account changed in another tab or device. Reload the latest data before saving.'});return true;}
      const subscriptions=checkedSubscriptions(b.subscriptions);
      const timeZone=String(b.settings?.timeZone||'Europe/Sofia');
      try{new Intl.DateTimeFormat('en',{timeZone}).format();}catch{throw Error('Invalid time zone.');}
      const reminderDays=Number(b.settings?.reminderDays??3);
      if(!Number.isInteger(reminderDays)||reminderDays<0||reminderDays>30)throw Error('Reminder lead time must be 0–30 days.');
      const archived=checkedSubscriptions(b.archived===undefined?(current.archived||[]):b.archived);if(archived.some(s=>subscriptions.some(a=>a.uid===s.uid)))throw Error('An archived subscription cannot also be active.');
      const updated={subscriptions,archived,settings:{timeZone,reminderDays,emailVerified:current.settings.emailVerified===true,emailReminders:MAIL_READY&&current.settings.emailVerified===true&&b.settings?.emailReminders===true},proPreview:false};
      writeAccount(user.id,updated,current.version+1);json(res,200,{accountId:user.id,...accountData(user.id)});return true;
    }
    if(url.pathname==='/api/reminders/verify'&&req.method==='POST'){
      if(!MAIL_READY){json(res,503,{error:'Email delivery is not configured.'});return true;}
      if(rateLimited(`verify:${user.id}`,3)){json(res,429,{error:'Too many requests. Try again later.'});return true;}
      const token=crypto.randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO email_confirmations(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),user.id,Date.now()+1800000);
      await sendMail(user.email,'Confirm renewal reminders',`To verify your email, sign in and open ${APP_ORIGIN}/dashboard/settings?verify=${token}. The link expires in 30 minutes. You can then enable email reminders in Settings.`);
      json(res,200,{ok:true});return true;
    }
    if(url.pathname==='/api/reminders/confirm'&&req.method==='POST'){
      const b=await readAuthenticatedBody(req,user.id),row=db.prepare('SELECT * FROM email_confirmations WHERE token_hash=? AND user_id=? AND expires_at>?').get(hashToken(String(b.token||'')),user.id,Date.now());
      if(!row){json(res,400,{error:'This verification link is invalid or has expired.'});return true;}
      const current=accountData(user.id);current.settings.emailVerified=true;
      writeAccount(user.id,current,current.version+1);db.prepare('DELETE FROM email_confirmations WHERE user_id=?').run(user.id);
      json(res,200,{...current,version:current.version+1});return true;
    }
    if(url.pathname==='/api/documents'&&req.method==='GET'){
      const docs=db.prepare('SELECT id,name,length(content) AS bytes,created_at AS createdAt FROM documents WHERE user_id=? ORDER BY created_at DESC').all(user.id);json(res,200,{documents:docs});return true;
    }
    if(url.pathname==='/api/documents'&&req.method==='POST'){
      const b=await readAuthenticatedBody(req,user.id),name=String(b.name||'').trim();
      if(!name||name.length>240||/[\x00-\x1f]/.test(name)||typeof b.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.base64))throw Error('Invalid file.');
      const content=Buffer.from(b.base64,'base64');
      if(!content.length||content.length>5*1024*1024)throw Error('Choose a non-empty file up to 5 MB.');
      const used=db.prepare('SELECT COALESCE(SUM(length(content)),0) AS bytes FROM documents WHERE user_id=?').get(user.id).bytes;
      if(used+content.length>50*1024*1024)throw Error('Document storage limit is 50 MB per account.');
      const id=crypto.randomUUID();db.prepare('INSERT INTO documents(id,user_id,name,content,created_at) VALUES(?,?,?,?,?)').run(id,user.id,name,content,Date.now());
      json(res,201,{id});return true;
    }
    const docMatch=url.pathname.match(/^\/api\/documents\/([a-zA-Z0-9-]+)$/);
    if(docMatch&&['GET','DELETE'].includes(req.method)){
      const doc=db.prepare('SELECT * FROM documents WHERE id=? AND user_id=?').get(docMatch[1],user.id);
      if(!doc){json(res,404,{error:'Document not found.'});return true;}
      if(req.method==='DELETE'){db.prepare('DELETE FROM documents WHERE id=? AND user_id=?').run(doc.id,user.id);json(res,200,{ok:true});return true;}
      const content=asBuffer(doc.content);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.name).replace(/'/g,'%27')}`,'Cache-Control':'no-store','Content-Length':content.length});res.end(content);return true;
    }
    json(res,404,{error:'Not found.'});return true;
  }catch(e){json(res,e.status||400,{error:e.message==='Invalid JSON'?'Invalid request.':e.message});return true;}
}

let remindersRunning=false;
export async function deliverReminders(){
  if(!MAIL_READY||remindersRunning)return;remindersRunning=true;
  try{
    const rows=db.prepare('SELECT a.user_id,a.payload,u.email FROM account_data a JOIN users u ON u.id=a.user_id').all();
    for(const row of rows){
      const data=JSON.parse(row.payload);if(!data.settings?.emailVerified||!data.settings?.emailReminders)continue;
      const today=dateKey(new Date(),data.settings.timeZone);
      for(const snapshot of data.subscriptions){
        const freshUser=db.prepare('SELECT email FROM users WHERE id=?').get(row.user_id);if(!freshUser||freshUser.email!==row.email)break;
        const fresh=accountData(row.user_id);if(!fresh.settings.emailVerified||!fresh.settings.emailReminders)break;
        const s=fresh.subscriptions.find(s=>s.uid===snapshot.uid);if(!s)continue;
        const due=nextRenewal(s,today),days=dayDifference(due,today);if(days>fresh.settings.reminderDays)continue;
        const key=`${s.uid}:${due}`;
        if(db.prepare('SELECT 1 FROM reminder_deliveries WHERE user_id=? AND delivery_key=?').get(row.user_id,key))continue;
        try{
          await sendMail(row.email,`Renewal reminder: ${s.name}`,`${s.name}${s.customName?' ('+s.customName+')':''}: EUR ${s.price.toFixed(2)} is scheduled for ${due}. Review it at ${APP_ORIGIN}/dashboard/subscriptions?subscription=${encodeURIComponent(s.uid)}`,`${row.user_id}:${key}`);
          db.prepare('INSERT OR IGNORE INTO reminder_deliveries(user_id,delivery_key,created_at) VALUES(?,?,?)').run(row.user_id,key,Date.now());
        }catch{console.error('A reminder could not be delivered; the next run will retry.');}
      }
    }
  }finally{remindersRunning=false;}
}
if (!process.env.VERCEL) {
  setInterval(()=>deliverReminders().catch(()=>console.error('Reminder worker failed.')),Math.max(1000,Number(process.env.REMINDER_INTERVAL_MS)||60000)).unref();
}

async function readAuthenticatedBody(req,userId,limit){
  const body=await readJsonBody(req,limit);
  if(getCurrentUser(req)?.id!==userId){const e=Error('Your session has expired. Sign in again.');e.status=401;throw e;}
  return body;
}
function requirePassword(userId,password){
  if(rateLimited(`sensitive:${userId}`,8)){const e=Error('Too many attempts. Try again later.');e.status=429;throw e;}
  const user=db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId);
  if(!user||!validPassword(password)||!verifyPassword(password,user.password_hash)){const e=Error('Current password is incorrect.');e.status=400;throw e;}
}
async function handleAccount(req,res,url){
 const paths=new Set(['/api/account/export','/api/account/import','/api/account/delete','/api/account/sessions','/api/account/sessions/revoke-others','/api/account/email','/api/account/email/confirm']);
 if(!paths.has(url.pathname))return false;
 const user=getCurrentUser(req);if(!user){json(res,401,{error:'You need to be signed in.'});return true;}
 try{
  if(url.pathname==='/api/account/export'&&req.method==='GET'){
   const profile=db.prepare('SELECT name,email,created_at AS createdAt FROM users WHERE id=?').get(user.id);
   const documents=db.prepare('SELECT name,content,created_at AS createdAt FROM documents WHERE user_id=?').all(user.id).map(d=>({name:d.name,createdAt:d.createdAt,base64:asBuffer(d.content).toString('base64')}));
   json(res,200,{format:'duedar-backup',schemaVersion:1,exportedAt:new Date().toISOString(),profile,data:accountData(user.id),documents},{'Content-Disposition':'attachment; filename="duedar-backup.json"'});return true;
  }
  if(url.pathname==='/api/account/sessions'&&req.method==='GET'){
   const hash=hashToken(parseCookies(req).rr_session);
   const sessions=db.prepare('SELECT token_hash,created_at AS createdAt,expires_at AS expiresAt FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC').all(user.id,Date.now()).map(s=>({createdAt:s.createdAt,expiresAt:s.expiresAt,current:s.token_hash===hash}));json(res,200,{sessions});return true;
  }
  if(req.method!=='POST'){json(res,405,{error:'Method not allowed.'});return true;}
  const body=await readAuthenticatedBody(req,user.id,url.pathname==='/api/account/import'?80*1024*1024:undefined);
  if(url.pathname==='/api/account/delete'){
   requirePassword(user.id,body.password);
   if(body.confirmEmail!==user.email)throw Error('Type your account email to confirm deletion.');
   // Foreign-key cascades include subscriptions, files, sessions and verification tokens.
   await billing.deleteAccount(user.id,()=>db.prepare('DELETE FROM users WHERE id=?').run(user.id));
   json(res,200,{ok:true},{'Set-Cookie':clearSessionCookie()});return true;
  }
  if(url.pathname==='/api/account/sessions/revoke-others'){
   requirePassword(user.id,body.password);
   const currentHash=hashToken(parseCookies(req).rr_session);
   db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id,currentHash);
   json(res,200,{ok:true});return true;
  }
  if(url.pathname==='/api/account/import'){
   const backup=body.backup;if(!backup||typeof backup!=='object')throw Error('Invalid backup file.');
   if(backup.format&&(!['duedar-backup','renewalradar-backup'].includes(backup.format)||backup.schemaVersion!==1))throw Error('Unsupported backup version.');
   const source=backup.format?backup.data:backup;
   const incoming=checkedSubscriptions(source?.subscriptions),current=accountData(user.id);
   if(body.version!==current.version){json(res,409,{error:'Your account changed in another tab or device. Reload the latest data before saving.'});return true;}
   const existingIds=new Set(current.subscriptions.map(s=>s.uid)),added=incoming.filter(s=>!existingIds.has(s.uid));
   const subscriptions=checkedSubscriptions([...current.subscriptions,...added]);
   const activeIds=new Set(subscriptions.map(s=>s.uid));const oldArchive=current.archived||[],archiveIds=new Set(oldArchive.map(s=>s.uid));
   const importedArchive=checkedSubscriptions(source.archived||[]).filter(s=>!activeIds.has(s.uid)&&!archiveIds.has(s.uid));
   const archived=checkedSubscriptions([...oldArchive.filter(s=>!activeIds.has(s.uid)),...importedArchive]);
   const sourceDocs=backup.format?backup.documents||[]:[];
   if(!Array.isArray(sourceDocs)||sourceDocs.length>500)throw Error('Maximum 500 documents per account.');
   const existingDocs=db.prepare('SELECT name,content FROM documents WHERE user_id=?').all(user.id);
   const signature=(name,bytes)=>crypto.createHash('sha256').update(name).update('\0').update(bytes).digest('hex');
   const signatures=new Set(existingDocs.map(d=>signature(d.name,asBuffer(d.content))));let total=existingDocs.reduce((sum,d)=>sum+asBuffer(d.content).length,0),toAdd=[];
   for(const d of sourceDocs){
    if(!d||typeof d.name!=='string'||!d.name.trim()||d.name.length>240||/[\x00-\x1f]/.test(d.name)||typeof d.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(d.base64))throw Error('Invalid document in backup.');
    const bytes=Buffer.from(d.base64,'base64');if(!bytes.length||bytes.length>5*1024*1024)throw Error('Choose a non-empty file up to 5 MB.');
    const name=d.name.trim(),sig=signature(name,bytes);if(signatures.has(sig))continue;signatures.add(sig);total+=bytes.length;if(total>50*1024*1024)throw Error('Document storage limit is 50 MB per account.');
    toAdd.push({name,bytes,createdAt:Number.isSafeInteger(d.createdAt)&&d.createdAt>0&&d.createdAt<=Date.now()?d.createdAt:Date.now()});
   }
   if(existingDocs.length+toAdd.length>500)throw Error('Maximum 500 documents per account.');
   // Merge data only: never import authentication, email verification or paid entitlements.
   db.exec('BEGIN');try{
    writeAccount(user.id,{...current,subscriptions,archived},current.version+1);
    for(const d of toAdd)db.prepare('INSERT INTO documents(id,user_id,name,content,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),user.id,d.name,d.bytes,d.createdAt);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   json(res,200,{addedSubscriptions:added.length,addedDocuments:toAdd.length,skippedSubscriptions:incoming.length-added.length});return true;
  }
  if(url.pathname==='/api/account/email'){
   requirePassword(user.id,body.password);
   if(!MAIL_READY){json(res,503,{error:'Email delivery is not configured.'});return true;}
   const email=normalizeEmail(body.email);if(!validEmail(email))throw Error('Enter a valid email address.');
   if(email===user.email)throw Error('Enter a different email address.');
   if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email))throw Error('This email address is already in use.');
   const token=crypto.randomBytes(32).toString('base64url'),tokenHash=hashToken(token);
   db.prepare('INSERT INTO pending_email_changes(token_hash,user_id,email,expires_at) VALUES(?,?,?,?)').run(tokenHash,user.id,email,Date.now()+1800000);
   try{await sendMail(email,'Confirm your new Duedar email',`Sign in to your existing account and confirm your new address: ${APP_ORIGIN}/dashboard/settings?emailToken=${token}. The link expires in 30 minutes.`);}catch{db.prepare('DELETE FROM pending_email_changes WHERE token_hash=?').run(tokenHash);const e=Error('Email delivery is temporarily unavailable. Try again later.');e.status=503;throw e;}
   json(res,200,{ok:true});return true;
  }
  if(url.pathname==='/api/account/email/confirm'){
   const pending=db.prepare('SELECT email FROM pending_email_changes WHERE token_hash=? AND user_id=? AND expires_at>?').get(hashToken(String(body.token||'')),user.id,Date.now());
   if(!pending)throw Error('This verification link is invalid or has expired.');
   if(db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(pending.email,user.id))throw Error('This email address is already in use.');
   await billing.updateEmail(user.id,pending.email,user.name);
   db.exec('BEGIN');try{
    db.prepare('UPDATE users SET email=? WHERE id=?').run(pending.email,user.id);
    for(const table of ['sessions','password_resets','email_confirmations','pending_email_changes'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user.id);
    const current=accountData(user.id);writeAccount(user.id,{...current,settings:{...current.settings,emailVerified:true,emailReminders:false}},current.version+1);
    const token=createSession(user.id);db.exec('COMMIT');json(res,200,{user:{...user,email:pending.email}},{'Set-Cookie':sessionCookie(token)});
   }catch(e){db.exec('ROLLBACK');throw e;}return true;
  }
 }catch(e){json(res,e.status||400,{error:e.message});return true;}
 json(res,404,{error:'Not found.'});return true;
}

function expireTemporaryRecords(){
 const now=Date.now();
 db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
 db.prepare('DELETE FROM password_resets WHERE expires_at<=? OR used_at IS NOT NULL').run(now);
 for(const table of ['email_confirmations','pending_email_changes'])db.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).run(now);
 for(const [key,value] of loginAttempts)if(now-value.started>3600000)loginAttempts.delete(key);
}
if (!process.env.VERCEL) setInterval(expireTemporaryRecords,3600000).unref();
export { expireTemporaryRecords };

async function handleUsage(req,res,url){
 if(!['/api/usage','/api/admin/usage'].includes(url.pathname))return false;
 if(process.env.ANALYTICS_ENABLED!=='true'){json(res,404,{error:'Not found.'});return true;}
 db.exec('CREATE TABLE IF NOT EXISTS usage_events(id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,event TEXT NOT NULL,day TEXT NOT NULL,duration_ms INTEGER)');
 if(url.pathname==='/api/admin/usage'){
  const expected=process.env.ANALYTICS_ADMIN_TOKEN||'',provided=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(expected.length<32||!String(req.headers.authorization||'').startsWith('Bearer ')||!crypto.timingSafeEqual(crypto.createHash('sha256').update(provided).digest(),crypto.createHash('sha256').update(expected).digest())){json(res,401,{error:'Unauthorized.'});return true;}
  if(req.method!=='GET'){json(res,405,{error:'Method not allowed.'});return true;}
  json(res,200,{events:db.prepare('SELECT day,event,COUNT(*) AS attempts,COUNT(DISTINCT user_id) AS users,AVG(duration_ms) AS averageDurationMs FROM usage_events GROUP BY day,event ORDER BY day DESC').all(),activation:db.prepare("SELECT (SELECT COUNT(*) FROM users) AS accounts, SUM(CASE WHEN json_array_length(payload,'$.subscriptions')>0 THEN 1 ELSE 0 END) AS withSubscriptions,SUM(CASE WHEN json_array_length(payload,'$.subscriptions')>0 AND json_extract(payload,'$.settings.emailReminders')=1 THEN 1 ELSE 0 END) AS withReminders FROM account_data").get()});return true;
 }
 const user=getCurrentUser(req);if(!user){json(res,401,{error:'Sign in required.'});return true;}
 if(req.method!=='POST'){json(res,405,{error:'Method not allowed.'});return true;}
 try{
  if(rateLimited('usage:'+user.id,120)){json(res,429,{error:'Too many events.'});return true;}
  const body=await readAuthenticatedBody(req,user.id,4096),allowed=['add_started','add_completed','edit_started','edit_completed','reminder_opened','review_completed'];
  if(!allowed.includes(body.event)||typeof body.id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.id))throw Error('Invalid event.');
  const duration=body.durationMs==null?null:Number(body.durationMs);if(duration!==null&&(!Number.isInteger(duration)||duration<0||duration>86400000))throw Error('Invalid duration.');
  db.prepare('DELETE FROM usage_events WHERE day<?').run(dateKey(new Date(Date.now()-90*86400000),'UTC'));
  db.prepare('INSERT OR IGNORE INTO usage_events VALUES(?,?,?,?,?)').run(body.id,user.id,body.event,dateKey(new Date(),'UTC'),duration);
  json(res,200,{ok:true});
 }catch(e){json(res,e.status||400,{error:e.message});}return true;
}
