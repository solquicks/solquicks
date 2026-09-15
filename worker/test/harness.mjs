// Shared test harness: the real worker, a real SQLite database behind a
// D1-shaped adapter, a controllable clock, and a fake network standing in for
// the Solana RPC, Jupiter and Telegram.
//
// Every D1 call yields to the event loop before it executes, the way a network
// round-trip does. Without that, two requests could never interleave and the
// concurrency tests would pass by construction. A test can also hold one
// statement at the door (pauseBefore) to force an exact interleaving.
//
// Needs Node 22.13+ for node:sqlite. No dependencies, no network.

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// ── a controllable clock ─────────────────────────────────────────────────────
const realNow = Date.now;
export const START = Date.UTC(2026, 8, 14, 15, 0, 0); // a Monday, 11:00 in New York
export let clock = START;
Date.now = () => clock;
export const MIN = 60000, HOUR = 60 * MIN;
export const advance = (ms) => { clock += ms; };
export const setClock = (t) => { clock = t; };

// ── D1 over node:sqlite ──────────────────────────────────────────────────────
function d1(db) {
  const pauses = [];
  const tick = async (sql) => {
    await new Promise((r) => setImmediate(r));
    const p = pauses.find((x) => !x.hit && x.re.test(sql));
    if (p) { p.hit = true; p.arrived(); await p.gate; }
  };
  const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a.map(norm)),
    async first() { await tick(sql); return db.prepare(sql).get(...args) ?? null; },
    async all() { await tick(sql); return { results: db.prepare(sql).all(...args), success: true }; },
    async run() { await tick(sql); const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    _exec() { return db.prepare(sql).run(...args); }
  });
  return {
    pauseBefore(re) {
      const p = { re, hit: false };
      p.reached = new Promise((r) => { p.arrived = r; });
      p.gate = new Promise((r) => { p.release = r; });
      pauses.push(p);
      return p;
    },
    prepare: (sql) => statement(sql),
    async batch(list) {
      await tick('');
      db.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}

// ── a fake network ───────────────────────────────────────────────────────────
export const TREASURY = 'uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const chain = {
  txs: new Map(), byRef: new Map(), n: 0, unexpected: [], lookups: 0, alerts: [], inScheduled: false,
  rpc: {},        // extra RPC methods a test answers: { method: (params) => result }
  jup: null,      // a test's Jupiter stand-in: (url, init) => body object, or a Response
  rpcCalls: [], jupCalls: []
};

// usdc and sol are in base units: micro-USDC and lamports
export function pay({ from, usdc = 0, sol = 0, reference = null, failed = false }) {
  const sig = 'sig' + String(++chain.n).padStart(84, '0');
  const keys = [from, TREASURY].concat(reference ? [reference] : []);
  chain.txs.set(sig, {
    transaction: { message: { accountKeys: keys.map((k) => ({ pubkey: k })) } },
    meta: {
      err: failed ? { InstructionError: [0, 'Custom'] } : null,
      preBalances: [5e9, 1e9],
      postBalances: [5e9 - sol, 1e9 + sol],
      preTokenBalances: [{ accountIndex: 1, mint: USDC, owner: TREASURY, uiTokenAmount: { amount: '1000000000' } }],
      postTokenBalances: [{ accountIndex: 1, mint: USDC, owner: TREASURY, uiTokenAmount: { amount: String(1e9 + usdc) } }]
    }
  });
  if (reference) chain.byRef.set(reference, [{ signature: sig, err: failed ? {} : null }].concat(chain.byRef.get(reference) || []));
  return sig;
}

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://mainnet.helius-rpc.com/')) {
    const { method, params } = JSON.parse(init.body);
    chain.rpcCalls.push(method);
    let result = null;
    if (method === 'getTransaction') result = chain.txs.get(params[0]) || null;
    else if (method === 'getSignaturesForAddress') { chain.lookups++; result = chain.byRef.get(params[0]) || []; }
    else if (chain.rpc[method]) result = chain.rpc[method](params);
    // the scheduled handler also refreshes analytics and checks health; those
    // calls get an empty answer rather than counting as a stray request
    else if (!chain.inScheduled) chain.unexpected.push('rpc ' + method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  }
  if (u.startsWith('https://lite-api.jup.ag/') || u.startsWith('https://api.jup.ag/')) {
    const headers = (init && init.headers) || {};
    chain.jupCalls.push({ url: u, key: headers['x-api-key'] || null, body: init && init.body ? JSON.parse(init.body) : null });
    if (chain.jup) {
      const out = await chain.jup(new URL(u), init);
      if (out instanceof Response) return out;
      if (out !== undefined) return new Response(JSON.stringify(out), { status: 200 });
    }
    if (chain.inScheduled) return new Response('', { status: 503 });
    chain.unexpected.push(u);
    return new Response('{}', { status: 404 });
  }
  if (u.startsWith('https://api.telegram.org/')) {
    chain.alerts.push(JSON.parse(init.body).text);
    return new Response('{"ok":true}', { status: 200 });
  }
  if (chain.inScheduled) return new Response('', { status: 503 });
  chain.unexpected.push(u);
  throw new Error('unexpected network call in a test: ' + u);
};

// ── the worker ───────────────────────────────────────────────────────────────
const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
export const { default: worker } = await import('../src/index.js');

// Cloudflare's Cache API, in memory. Each environment gets its own.
function memoryCache() {
  const store = new Map();
  return {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res.clone()); }
  };
}

export function freshEnv(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const env = Object.assign({
    DB: d1(db),
    TREASURY_WALLET: TREASURY,
    HELIUS_API_KEY: 'test',
    ALLOWED_ORIGINS: 'https://solquicks.com',
    TELEGRAM_ALERT_TOKEN: 'test',
    TELEGRAM_ALERT_CHAT: 'test',
    _db: db,
    _cache: memoryCache()
  }, overrides);
  globalThis.caches = { default: env._cache };
  return env;
}

let ipSeq = 0;
const newIp = () => '10.0.' + Math.floor(++ipSeq / 250) + '.' + (ipSeq % 250);

// Runs one request through the real handler. waitUntil work is collected and
// finished after the response, which is what the Workers runtime does.
export async function call(env, method, path, { body, ip, token } = {}) {
  globalThis.caches = { default: env._cache };
  const pending = [];
  const headers = { 'Content-Type': 'application/json', Origin: 'https://solquicks.com', 'CF-Connecting-IP': ip || newIp() };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(
    new Request('https://api.test' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }),
    env,
    { waitUntil: (p) => pending.push(p), passThroughOnException() {} }
  );
  await Promise.allSettled(pending);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { _raw: text }; }
  return { status: res.status, body: json };
}

// The cron entry point, exactly as Cloudflare invokes it.
export async function runScheduled(env) {
  const pending = [];
  chain.inScheduled = true;
  try {
    await worker.scheduled({ cron: '*/30 * * * *', scheduledTime: clock }, env, { waitUntil: (p) => pending.push(p) });
    await Promise.allSettled(pending);
  } finally { chain.inScheduled = false; }
}

export const payments = (env) => env._db.prepare('SELECT COUNT(*) AS n FROM payments').get().n;
// A distinct, valid-format Solana address per number: 32 bytes, base58. The
// swap routes check addresses properly, so a look-alike string will not do.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}
export const wallet = (n) => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (n * 131 + i * 17 + 7) % 251 + 1;
  return b58(bytes);
};

export function signIn(env, who, { holder = false, expired = false } = {}) {
  const token = 'tok-' + who;
  env._db.prepare('INSERT OR REPLACE INTO sessions (token, wallet, expires) VALUES (?, ?, ?)')
    .run(token, who, expired ? clock - MIN : clock + 24 * HOUR);
  if (holder) {
    env._db.prepare('INSERT OR REPLACE INTO holder_positions (wallet, count, first_seen, updated_at) VALUES (?, 1, ?, ?)')
      .run(who, clock, clock);
  }
  return token;
}

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
export const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
export const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
export const section = (s) => console.log('\n── ' + s + ' ──');

export function finish() {
  ok('no request tried to reach anything the test did not stand in for', chain.unexpected.length === 0, chain.unexpected.join(', '));
  Date.now = realNow;
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
}
