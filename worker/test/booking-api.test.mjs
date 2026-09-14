// The booking API, end to end, against the worker that actually ships.
//
// Nothing here is re-implemented. The real worker module is imported and its
// real fetch handler is called with real Requests. Behind it:
//
//   - a real SQLite database, built from the committed schema.sql, wearing a
//     thin D1-shaped adapter. D1 is SQLite, so the SQL that decides whether a
//     slot is free runs exactly as it does in production.
//   - a fake Solana chain answering the two RPC calls payment verification
//     makes. Any other network call fails the run.
//   - a clock the test controls, so a 20-minute hold can expire in no time.
//
// Every D1 call yields to the event loop before it executes, the way a network
// round-trip does. Without that, two requests could never interleave and the
// concurrency tests below would pass by construction.
//
// Needs Node 22.13+ for node:sqlite. No dependencies, no network.

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// ── a controllable clock ─────────────────────────────────────────────────────
const realNow = Date.now;
let clock = Date.UTC(2026, 8, 14, 15, 0, 0); // a Monday, 11:00 in New York
Date.now = () => clock;
const MIN = 60000, HOUR = 60 * MIN;
const advance = (ms) => { clock += ms; };

// ── D1 over node:sqlite ──────────────────────────────────────────────────────
function d1(db) {
  const tick = () => new Promise((r) => setImmediate(r));
  const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a.map(norm)),
    async first() { await tick(); return db.prepare(sql).get(...args) ?? null; },
    async all() { await tick(); return { results: db.prepare(sql).all(...args), success: true }; },
    async run() { await tick(); const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } }; },
    _exec() { return db.prepare(sql).run(...args); }
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(list) {
      await tick();
      db.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}

// ── a fake chain ─────────────────────────────────────────────────────────────
const TREASURY = 'uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const chain = { txs: new Map(), byRef: new Map(), n: 0, unexpected: [] };

// usdc and sol are in base units: micro-USDC and lamports
function pay({ from, usdc = 0, sol = 0, reference = null, failed = false }) {
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
    let result = null;
    if (method === 'getTransaction') result = chain.txs.get(params[0]) || null;
    else if (method === 'getSignaturesForAddress') result = chain.byRef.get(params[0]) || [];
    else chain.unexpected.push('rpc ' + method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  }
  chain.unexpected.push(u);
  throw new Error('unexpected network call in a test: ' + u);
};

// ── the worker ───────────────────────────────────────────────────────────────
const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const { default: worker } = await import('../src/index.js');

function freshEnv(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return Object.assign({
    DB: d1(db),
    TREASURY_WALLET: TREASURY,
    HELIUS_API_KEY: 'test',
    ALLOWED_ORIGINS: 'https://solquicks.com',
    _db: db
  }, overrides);
}

let ipSeq = 0;
const newIp = () => '10.0.' + Math.floor(++ipSeq / 250) + '.' + (ipSeq % 250);

// Runs one request through the real handler. waitUntil work is collected and
// finished after the response, which is what the Workers runtime does.
async function call(env, method, path, { body, ip, token } = {}) {
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

const row = (env, ref) => env._db.prepare('SELECT * FROM bookings WHERE ref = ?').get(ref);
const payments = (env) => env._db.prepare('SELECT COUNT(*) AS n FROM payments').get().n;

function signIn(env, wallet, { holder = false, expired = false } = {}) {
  const token = 'tok-' + wallet;
  env._db.prepare('INSERT OR REPLACE INTO sessions (token, wallet, expires) VALUES (?, ?, ?)')
    .run(token, wallet, expired ? clock - MIN : clock + 24 * HOUR);
  if (holder) {
    env._db.prepare('INSERT OR REPLACE INTO holder_positions (wallet, count, first_seen, updated_at) VALUES (?, 1, ?, ?)')
      .run(wallet, clock, clock);
  }
  return token;
}

const wallet = (n) => ('W' + n).padEnd(44, '1');

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// A bug that is proven, recorded in TODO.md, and not yet fixed. It prints on
// every run so it stays visible, and does not fail CI while it is still true.
// The moment the behaviour changes it DOES fail — so a fix cannot land without
// someone turning this back into an ordinary assertion.
let known = 0;
const knownBug = (name, stillBroken, detail) => {
  if (stillBroken) { known++; console.log('KNOWN ' + name + '  — ' + detail); }
  else { fail++; console.log('FAIL ' + name + '  — behaviour changed; if this is the fix, make it an ordinary assertion'); }
};
const section = (s) => console.log('\n── ' + s + ' ──');

async function slots(env, type = 'space') {
  const r = await call(env, 'GET', '/api/booking/slots?type=' + type);
  return r.body.slots || [];
}
const firstCalm = (list) => list.find((s) => !s.rush);
const firstRush = (list) => list.find((s) => s.rush);
const guest = { name: 'Test Guest', contact: '@guest' };

// ═════════════════════════════════════════════════════════════════════════════

section('the calendar');
{
  const env = freshEnv();
  const list = await slots(env);
  ok('slots are offered', list.length > 0, 'none returned');
  ok('no slot is less than 24 hours out', list.every((s) => s.starts - clock >= 24 * HOUR));
  ok('no slot is more than 30 days out', list.every((s) => s.starts - clock <= 30 * 24 * HOUR));
  ok('a slot is flagged rush exactly when it is inside 48 hours',
    list.every((s) => s.rush === (s.starts - clock < 48 * HOUR)));
  ok('both rush and non-rush slots exist to book', !!firstRush(list) && !!firstCalm(list));
  eq('an unknown type is refused', (await call(env, 'GET', '/api/booking/slots?type=nope')).status, 400);
  eq('custom content has no calendar', (await slots(env, 'custom')).length, 0);
  eq('MC has no calendar', (await slots(env, 'mc')).length, 0);
}

section('holding a slot — what gets refused');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const hold = (body) => call(env, 'POST', '/api/booking/hold', { body });

  eq('no name', (await hold({ type: 'space', startsAt: s.starts, contact: '@x' })).status, 400);
  eq('no contact', (await hold({ type: 'space', startsAt: s.starts, name: 'x' })).status, 400);
  eq('no time for a booked-time service', (await hold({ type: 'space', ...guest })).status, 400);
  eq('a time under 24 hours away', (await hold({ type: 'space', startsAt: clock + 3 * HOUR, ...guest })).status, 400);
  eq('a time that is not on the calendar grid', (await hold({ type: 'space', startsAt: s.starts + MIN, ...guest })).status, 409);
  eq('a time outside working hours', (await hold({ type: 'space', startsAt: s.starts - (s.starts % (24 * HOUR)) + 30 * HOUR + 4 * HOUR, ...guest })).status, 409);
  eq('an unknown service', (await hold({ type: 'nope', startsAt: s.starts, ...guest })).status, 400);
  eq('nothing was written for any refusal', env._db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0);
}

section('holding a slot — what a good hold looks like');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const r = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  eq('accepted', r.status, 200);
  ok('reference looks like FOX-XXXXXX', /^FOX-[A-HJ-NP-Z2-9]{6}$/.test(r.body.ref), r.body.ref);
  eq('quoted at list price', r.body.quote.total, 200);
  eq('asks for exactly $200 in micro-USDC', r.body.usdc, 200000000);
  eq('pays the treasury', r.body.payTo, TREASURY);
  eq('in USDC', r.body.usdcMint, USDC);
  eq('held for 20 minutes', r.body.holdUntil - clock, 20 * MIN);
  ok('carries a Solana Pay reference', typeof r.body.reference === 'string' && r.body.reference.length >= 32);
  const b = row(env, r.body.ref);
  eq('stored as held', b.status, 'held');
  eq('stored total matches the quote', b.total_usd, 200);

  const after = await slots(env);
  ok('the held slot is gone from the calendar', !after.some((x) => x.starts === s.starts));
  ok('a slot that would overlap it is gone too', !after.some((x) => x.starts === s.starts + 30 * MIN));
  ok('the next free hour is still offered', after.some((x) => x.starts === s.starts + 60 * MIN));
}

section('the same hour cannot be sold twice');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const a = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  const b = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  eq('first hold accepted', a.status, 200);
  eq('second hold on the same slot refused', b.status, 409);
  // one person, one calendar: a Space and a podcast cannot share an hour
  const c = await call(env, 'POST', '/api/booking/hold', { body: { type: 'podcast', startsAt: s.starts, ...guest } });
  eq('a different service at the same hour is refused', c.status, 409);
  const d = await call(env, 'POST', '/api/booking/hold', { body: { type: 'stream', startsAt: s.starts + 30 * MIN, ...guest } });
  eq('a different service overlapping by half an hour is refused', d.status, 409);
}

section('the price is decided by the server');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const lie = await call(env, 'POST', '/api/booking/hold', {
    body: { type: 'space', startsAt: s.starts + 2 * HOUR, ...guest, holder: true, total: 1, usdc: 1, quote: { total: 1 } }
  });
  eq('a client claiming to be a holder, and a $1 total, is ignored', lie.body.quote.total, 200);

  const holderTok = signIn(env, wallet(1), { holder: true });
  const h = await call(env, 'POST', '/api/booking/hold', { token: holderTok, body: { type: 'space', startsAt: s.starts + 4 * HOUR, ...guest } });
  eq('a signed-in holder pays $170', h.body.quote.total, 170);
  eq('and is asked for 170 USDC', h.body.usdc, 170000000);

  const plainTok = signIn(env, wallet(2));
  const p = await call(env, 'POST', '/api/booking/hold', { token: plainTok, body: { type: 'space', startsAt: s.starts + 6 * HOUR, ...guest } });
  eq('a signed-in non-holder pays list price', p.body.quote.total, 200);

  const staleTok = signIn(env, wallet(3), { holder: true, expired: true });
  const st = await call(env, 'POST', '/api/booking/hold', { token: staleTok, body: { type: 'space', startsAt: s.starts + 8 * HOUR, ...guest } });
  eq('a holder with an expired session pays list price', st.body.quote.total, 200);

  const rushSlot = firstRush(await slots(env));
  const rr = await call(env, 'POST', '/api/booking/hold', { body: { type: 'podcast', startsAt: rushSlot.starts, ...guest } });
  eq('a podcast inside 48 hours carries the rush: $525', rr.body.quote.total, 525);
}

section('services without a calendar');
{
  const env = freshEnv();
  const c = await call(env, 'POST', '/api/booking/hold', { body: { type: 'custom', ...guest } });
  eq('custom content needs no time', c.status, 200);
  eq('and is held for payment', row(env, c.body.ref).status, 'held');
  eq('at $250', c.body.usdc, 250000000);

  const m = await call(env, 'POST', '/api/booking/hold', { body: { type: 'mc', ...guest } });
  eq('an MC enquiry is accepted', m.status, 200);
  eq('asks for no money', m.body.usdc, null);
  eq('holds nothing', m.body.holdUntil, null);
  eq('is stored as an enquiry', row(env, m.body.ref).status, 'enquiry');
  const pay1 = pay({ from: wallet(9), usdc: 1000e6 });
  const mc = await call(env, 'POST', '/api/booking/confirm', { token: signIn(env, wallet(9)), body: { ref: m.body.ref, signature: pay1 } });
  eq('and cannot be "paid" through checkout', mc.status, 409);
}

section('paying by connected wallet');
{
  const env = freshEnv();
  const buyer = wallet(10);
  const tok = signIn(env, buyer);
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: s.starts, ...guest } });
  const ref = h.body.ref;
  const confirm = (signature, t = tok, r = ref) => call(env, 'POST', '/api/booking/confirm', { token: t, body: { ref: r, signature } });

  eq('no signature', (await call(env, 'POST', '/api/booking/confirm', { body: { ref } })).status, 400);
  eq('unknown booking', (await confirm('whatever', tok, 'FOX-NOPE22')).status, 404);

  eq('a transaction that is not on chain', (await confirm('sig-not-landed')).status, 402);
  eq('a failed transaction', (await confirm(pay({ from: buyer, usdc: 200e6, failed: true }))).status, 402);
  eq('one cent short', (await confirm(pay({ from: buyer, usdc: 199.99e6 }))).status, 402);
  const solPay = await confirm(pay({ from: buyer, sol: 2e9 }));
  eq('paid in SOL instead of USDC', solPay.status, 402);
  ok('and is told bookings are USDC only', /USDC only/.test(solPay.body.error || ''), solPay.body.error);
  eq('the right amount from somebody else\'s wallet', (await confirm(pay({ from: wallet(11), usdc: 200e6 }))).status, 402);
  eq('none of that marked it paid', row(env, ref).status, 'held');
  eq('none of that consumed a payment', payments(env), 0);

  const good = pay({ from: buyer, usdc: 200e6 });
  const c = await confirm(good);
  eq('the exact amount from the booker is accepted', c.status, 200);
  eq('booking is paid', row(env, ref).status, 'paid');
  eq('signature is recorded on the booking', row(env, ref).signature, good);
  eq('payment is recorded once', payments(env), 1);

  const again = await confirm(good);
  eq('confirming twice is harmless', again.body.alreadyPaid, true);
  eq('and records nothing new', payments(env), 1);

  const lookup = await call(env, 'GET', '/api/booking/lookup?ref=' + ref);
  eq('lookup shows it paid', lookup.body.booking.status, 'paid');
  ok('lookup does not leak the contact details', !('contact' in lookup.body.booking) && !('brief' in lookup.body.booking));

  // the same payment cannot pay for a second booking
  const s2 = (await slots(env)).filter((x) => !x.rush)[5];
  const h2 = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: s2.starts, ...guest } });
  const reuse = await confirm(good, tok, h2.body.ref);
  eq('reusing a payment for another booking is refused', reuse.status, 402);
  eq('that booking is still unpaid', row(env, h2.body.ref).status, 'held');

  const over = await confirm(pay({ from: buyer, usdc: 250e6 }), tok, h2.body.ref);
  eq('overpaying is accepted', over.status, 200);
}

section('paying by QR from a phone that never visited the site');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'stream', startsAt: s.starts, ...guest } });
  const watch = () => call(env, 'GET', '/api/booking/watch?ref=' + h.body.ref);

  eq('before paying it is waiting', (await watch()).body.status, 'waiting');

  pay({ from: wallet(20), usdc: 299e6, reference: h.body.reference });
  const short = await watch();
  eq('a short payment leaves it waiting', short.body.status, 'waiting');
  ok('with a reason', !!short.body.note, JSON.stringify(short.body));

  const phone = wallet(21);
  pay({ from: phone, usdc: 300e6, reference: h.body.reference });
  const paid = await watch();
  eq('the full payment is found by its reference', paid.body.status, 'paid');
  eq('booking is paid', row(env, h.body.ref).status, 'paid');
  eq('the paying wallet is recorded', row(env, h.body.ref).wallet, phone);

  eq('watching again stays paid', (await watch()).body.status, 'paid');
  eq('and does not record the payment twice', payments(env), 1);
  eq('an unknown reference', (await call(env, 'GET', '/api/booking/watch?ref=FOX-NOPE22')).status, 404);
}

section('an abandoned hold frees the slot');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });

  advance(19 * MIN);
  await slots(env);
  eq('at 19 minutes it is still held', row(env, h.body.ref).status, 'held');

  advance(2 * MIN);
  await slots(env); // any request sweeps expired holds
  eq('at 21 minutes it has expired', row(env, h.body.ref).status, 'expired');
  ok('the slot is back on the calendar', (await slots(env)).some((x) => x.starts === s.starts));

  const again = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  eq('someone else can now hold it', again.status, 200);

  const late = await call(env, 'POST', '/api/booking/confirm', {
    token: signIn(env, wallet(30)), body: { ref: h.body.ref, signature: pay({ from: wallet(30), usdc: 200e6 }) }
  });
  ok('confirming the expired hold is refused', late.status === 409 || late.status === 410, 'status ' + late.status);
}

section('money that arrives when nobody is watching');
{
  // The payment screen says: "If you pay and this page closes, the payment is
  // still found." Only the open tab ever looks for a QR payment, and it stops
  // looking after about five minutes. Nothing on the server looks at all.
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });

  advance(1 * MIN);
  pay({ from: wallet(40), usdc: 200e6, reference: h.body.reference }); // paid in full, on time
  // ...and the tab is closed. Time passes; other visitors use the site.
  advance(20 * MIN);
  await slots(env);

  const b = row(env, h.body.ref);
  knownBug('a booking paid in full within its hold is lost if the page closed',
    b.status === 'expired' && payments(env) === 0,
    `booking ${b.status}, payments recorded ${payments(env)}; the slot is back on sale and no alert fires`);

  const w = await call(env, 'GET', '/api/booking/watch?ref=' + h.body.ref);
  knownBug('coming back with the reference does not recover it',
    w.body.status === 'expired' && payments(env) === 0,
    `watch answers "${w.body.status}" and still records nothing`);
}

section('two people, the same slot, the same moment');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const both = await Promise.all([
    call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, name: 'A', contact: '@a' } }),
    call(env, 'POST', '/api/booking/hold', { body: { type: 'podcast', startsAt: s.starts + 30 * MIN, name: 'B', contact: '@b' } })
  ]);
  const held = env._db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'held'").get().n;
  knownBug('two overlapping holds made at the same moment both succeed',
    held === 2,
    `responses ${both.map((r) => r.status).join(' and ')}, ${held} overlapping bookings held — both can pay`);
}

section('two bookings, one payment, the same moment');
{
  const env = freshEnv();
  const buyer = wallet(50);
  const tok = signIn(env, buyer);
  const list = (await slots(env)).filter((x) => !x.rush);
  const h1 = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: list[0].starts, ...guest } });
  const h2 = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: list[4].starts, ...guest } });
  const sig = pay({ from: buyer, usdc: 200e6 });
  const both = await Promise.all([
    call(env, 'POST', '/api/booking/confirm', { token: tok, body: { ref: h1.body.ref, signature: sig } }),
    call(env, 'POST', '/api/booking/confirm', { token: tok, body: { ref: h2.body.ref, signature: sig } })
  ]);
  const paid = env._db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'paid'").get().n;
  // The payments table's primary key is what actually stops this.
  eq('one payment confirms exactly one booking, even when raced', paid, 1);
  eq('and is recorded once', payments(env), 1);
  const codes = both.map((r) => r.status).sort();
  knownBug('the losing request gets a 500 rather than a clear refusal',
    codes[0] === 200 && codes[1] === 500,
    `responses ${codes.join(' and ')} — safe, but an error page for a customer`);
}

section('abuse');
{
  const env = freshEnv();
  const list = await slots(env);
  const ip = '203.0.113.7';
  const codes = [];
  for (let i = 0; i < 13; i++) {
    codes.push((await call(env, 'POST', '/api/booking/hold', { ip, body: { type: 'space', startsAt: list[i * 3].starts, ...guest } })).status);
  }
  eq('twelve holds a minute from one address are allowed', codes.slice(0, 12).every((c) => c === 200), true);
  eq('the thirteenth is refused', codes[12], 429);
  advance(61 * MIN / 60);
  eq('and the limit resets after a minute', (await call(env, 'POST', '/api/booking/hold', { ip, body: { type: 'space', startsAt: list[40].starts, ...guest } })).status, 200);
}

section('payments switched off');
{
  const env = freshEnv({ TREASURY_WALLET: '' });
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  const c = await call(env, 'POST', '/api/booking/confirm', { token: signIn(env, wallet(60)), body: { ref: h.body.ref, signature: pay({ from: wallet(60), usdc: 200e6 }) } });
  eq('with no treasury configured, nothing can be confirmed', c.status, 503);
  eq('and the booking is not marked paid', row(env, h.body.ref).status, 'held');
}

ok('no request tried to reach anything but the Solana RPC', chain.unexpected.length === 0, chain.unexpected.join(', '));

Date.now = realNow;
console.log(`\n${pass}/${pass + fail} passed` + (known ? `, ${known} known bug(s) still open — see TODO.md` : ''));
process.exit(fail ? 1 : 0);
