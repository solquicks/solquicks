// solquicks Fox Points API
// Points live here, not in the visitor's browser. Every award is decided
// server-side; the client can only ask, never assert a balance.

const DAY_MS = 86400000;
const STAKE_RATE_PER_DAY = 100;
const SESSION_TTL_MS = 30 * DAY_MS;
const NONCE_TTL_MS = 5 * 60 * 1000;
const FLIP_MIN = 10;
const FLIP_MAX = 1000;   // caps how fast a balance can swing in one go

// Only what can really be earned. The mini-game and gacha are listed on the site
// as coming soon, and used to be claimable through a generic /api/award that
// checked nothing — 50 points a request, 30 a minute, for features that did not
// exist. Each gets its own verified route when it is actually built.
const AWARDS = { visit: 10, plushie: 500 };

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  let bytes = [0];
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error('bad base58');
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch === '1') bytes.push(0); else break; }
  return new Uint8Array(bytes.reverse());
}

function b58encode(bytes) {
  let digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const b of bytes) { if (b === 0) out += '1'; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/// A Solana Pay reference: 32 random bytes used as a throwaway account key on
/// the transfer. It is never signed, so it does not need to be on the curve —
/// it exists purely so a payment can be found again later.
function newReference() {
  return b58encode(crypto.getRandomValues(new Uint8Array(32)));
}

function isWallet(w) {
  if (typeof w !== 'string' || w.length < 32 || w.length > 44) return false;
  try { return b58decode(w).length === 32; } catch (e) { return false; }
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  const origin = request.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request, env) });
}

function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function signInMessage(wallet, nonce) {
  return 'solquicks.com wants you to sign in.\n\n' +
    'This proves you own this wallet. It is free and does not move any funds.\n\n' +
    'Wallet: ' + wallet + '\n' +
    'Nonce: ' + nonce;
}

async function verifySignature(wallet, message, signatureB64) {
  const pub = b58decode(wallet);
  if (pub.length !== 32) return false;
  const sig = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
  if (sig.length !== 64) return false;
  const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, sig, new TextEncoder().encode(message));
}

async function getSession(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const row = await env.DB.prepare('SELECT wallet, expires FROM sessions WHERE token = ?').bind(token).first();
  if (!row || row.expires < Date.now()) return null;
  return row.wallet;
}

async function ensurePlayer(env, wallet) {
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO players (wallet, points, created_at, updated_at) VALUES (?, 0, ?, ?) ON CONFLICT(wallet) DO NOTHING'
  ).bind(wallet, now, now).run();
}

async function addPoints(env, wallet, type, points) {
  if (points <= 0) return;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE players SET points = points + ?, updated_at = ? WHERE wallet = ?').bind(points, now, wallet),
    env.DB.prepare('INSERT INTO events (wallet, type, points, ts) VALUES (?, ?, ?, ?)').bind(wallet, type, points, now)
  ]);
}


const IPFS_GATEWAYS = [
  'https://nftstorage.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/'
];

/// Race the metadata's own URL against the same CID on other gateways and take
/// whichever answers first. Racing rather than trying in turn matters: a stalled
/// gateway would otherwise add its whole timeout to the wait, and a genuinely
/// missing file would cost the sum of them all before falling back.
// Arweave has the same problem IPFS does: one gateway can be slow or busy, and
// arweave.net in particular lags on freshly uploaded data. Race several.
const ARWEAVE_GATEWAYS = [
  'https://arweave.net/',
  'https://vilenarios.com/',
  'https://frostor.xyz/',
  'https://permagate.io/'
];

async function fetchFirstAvailable(src) {
  const candidates = [src];
  const m = src.match(/\/ipfs\/(.+)$/);
  if (m) {
    for (const gw of IPFS_GATEWAYS) {
      const alt = gw + m[1];
      if (!candidates.includes(alt)) candidates.push(alt);
    }
  }
  // arweave.net and www.arweave.net both appear in this collection
  const ar = src.match(/^https?:\/\/(?:www\.)?arweave\.net\/(.+)$/);
  if (ar) {
    for (const gw of ARWEAVE_GATEWAYS) {
      const alt = gw + ar[1];
      if (!candidates.includes(alt)) candidates.push(alt);
    }
  }
  const attempts = candidates.map(function (url) {
    return fetch(url, {
      headers: { Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(11000)
    }).then(function (res) {
      const type = res.headers.get('Content-Type') || '';
      // Gateways mislabel image bytes as octet-stream often enough that
      // requiring image/* loses real artwork. Reject only what is obviously an
      // error page.
      if (res.ok && !type.startsWith('text/')) return res;
      throw new Error('not an image');
    });
  });
  // AbortSignal is not reliably honoured for subrequests here, so cap the whole
  // race with an explicit deadline: a missing file must not stall the page.
  const deadline = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 12000); });
  return Promise.race([
    Promise.any(attempts).catch(function () { return null; }),
    deadline
  ]);
}

async function listRangers(env, wallet) {
  if (!env.HELIUS_API_KEY) return null;
  const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'r', method: 'searchAssets',
      params: {
        ownerAddress: wallet,
        grouping: ['collection', env.MOON_RANGERS_COLLECTION],
        // Without this DAS still reports burned NFTs as owned — a wallet that
        // burned its Rangers was being offered them to stake.
        burnt: false,
        page: 1, limit: 1000
      }
    })
  });
  if (!res.ok) throw new Error('rpc ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'rpc error');
  const items = (data.result && data.result.items) || [];
  return items.map(function (it) {
    const c = it.content || {};
    const files = c.files || [];
    const meta = c.metadata || {};
    return {
      mint: it.id,
      name: meta.name || ('Ranger ' + String(it.id).slice(0, 4)),
      // CDN copy is resized but rate-limited; keep the original as a fallback
      image: (files[0] && files[0].cdn_uri) || (files[0] && files[0].uri) || (c.links && c.links.image) || null,
      imageAlt: (files[0] && files[0].uri) || (c.links && c.links.image) || null
    };
  });
}

async function countRangers(env, wallet) {
  const list = await listRangers(env, wallet);
  return list === null ? -2 : list.length;
}

async function stakedMints(env, wallet) {
  const r = await env.DB.prepare('SELECT mint FROM staked_nfts WHERE wallet = ?').bind(wallet).all();
  return (r.results || []).map(function (x) { return x.mint; });
}

// Verify a SOL payment on-chain before it unlocks anything.
async function verifyPayment(env, wallet, signature, minLamports, purpose) {
  if (!env.TREASURY_WALLET || !minLamports) return { ok: true, skipped: true };
  if (!signature) return { ok: false, error: 'payment required' };

  const seen = await env.DB.prepare('SELECT signature FROM payments WHERE signature = ?').bind(signature).first();
  if (seen) return { ok: false, error: 'this payment was already used' };

  const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'tx', method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]
    })
  });
  const data = await res.json();
  const tx = data && data.result;
  if (!tx) return { ok: false, error: 'payment not found yet — try again in a moment' };
  if (tx.meta && tx.meta.err) return { ok: false, error: 'that payment failed on-chain' };

  const keys = tx.transaction.message.accountKeys.map(function (k) { return k.pubkey || k; });
  const treasuryIdx = keys.indexOf(env.TREASURY_WALLET);
  if (treasuryIdx < 0) return { ok: false, error: 'payment did not go to the right wallet' };
  // `wallet` null means the caller already proved which booking this is (via an
  // unguessable Solana Pay reference), so any payer is fine — that is what lets
  // someone pay by QR from a phone that never connected to the site.
  if (wallet !== null) {
    if (keys.indexOf(wallet) !== 0) return { ok: false, error: 'payment was not sent by your wallet' };
  }
  const payer = keys[0];

  const delta = (tx.meta.postBalances[treasuryIdx] || 0) - (tx.meta.preBalances[treasuryIdx] || 0);
  if (delta < minLamports) return { ok: false, error: 'payment was too small' };

  await env.DB.prepare('INSERT INTO payments (signature, wallet, lamports, purpose, ts) VALUES (?, ?, ?, ?, ?)')
    .bind(signature, wallet || payer, delta, purpose, Date.now()).run();
  return { ok: true, lamports: delta, payer: payer };
}

async function loadStake(env, wallet) {
  const row = await env.DB.prepare('SELECT staked, since, count, banked FROM stakes WHERE wallet = ?').bind(wallet).first();
  return row || { staked: 0, since: 0, count: 0, banked: 0 };
}

function stakeAccrued(s) {
  const banked = s.banked || 0;
  if (!s.staked || !s.since) return banked;
  const elapsed = Date.now() - s.since;
  return banked + Math.max(0, Math.floor((elapsed / DAY_MS) * STAKE_RATE_PER_DAY * (s.count || 0)));
}

async function saveStake(env, wallet, s) {
  await env.DB.prepare(
    'INSERT INTO stakes (wallet, staked, since, count, banked) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(wallet) DO UPDATE SET staked=excluded.staked, since=excluded.since, count=excluded.count, banked=excluded.banked'
  ).bind(wallet, s.staked ? 1 : 0, s.since, s.count, s.banked).run();
}

async function playerState(env, wallet) {
  const p = await env.DB.prepare('SELECT points, last_visit FROM players WHERE wallet = ?').bind(wallet).first();
  const log = await env.DB.prepare('SELECT type, points, ts FROM events WHERE wallet = ? ORDER BY ts DESC LIMIT 50').bind(wallet).all();
  const s = await loadStake(env, wallet);
  const staked = await env.DB.prepare('SELECT mint FROM staked_nfts WHERE wallet = ?').bind(wallet).all();
  const claimed = p ? p.points : 0;
  const pending = stakeAccrued(s);
  const today = new Date().toISOString().slice(0, 10);
  return {
    wallet,
    stakedMints: (staked.results || []).map(function (x) { return x.mint; }),
    points: claimed,
    pending: pending,
    total: claimed + pending,
    lastVisit: p ? p.last_visit : null,
    dailyAvailable: !p || p.last_visit !== today,
    dailyAmount: AWARDS.visit,
    log: (log.results || []).map(r => ({ e: r.type, p: r.points, t: r.ts })),
    stake: { staked: !!s.staked, since: s.since, count: s.count, accrued: stakeAccrued(s) }
  };
}


// ── RATE LIMITING ──
// Counted in D1 rather than the Workers rate-limit binding: that binding
// accepted 16 calls against a limit of 10 in testing, so it is not enforcing
// here. Keyed by wallet when the caller is signed in (so one wallet cannot
// spread abuse across IPs) and by IP otherwise. The window is folded into the
// key, which makes each window self-contained and cheap to expire.
//
// The scarce resource is Helius credits — the free tier allows only 2 DAS
// requests per second — so chain-reading routes are held well below that.
const RATE_RULES = [
  { match: ['/api/nonce', '/api/session'], name: 'auth', by: 'ip', limit: 10, windowMs: 60000 },
  { match: ['/api/rangers', '/api/stake', '/api/img'], name: 'chain', by: 'wallet', limit: 20, windowMs: 60000 },
  { match: ['/api/visit', '/api/claim', '/api/unstake'], name: 'write', by: 'wallet', limit: 30, windowMs: 60000 },
  { match: ['/api/flip'], name: 'flip', by: 'wallet', limit: 30, windowMs: 60000 },
  { match: ['/api/mission', '/api/mission/claim'], name: 'mission', by: 'wallet', limit: 40, windowMs: 60000 },
  { match: ['/api/mission/draw'], name: 'draw', by: 'ip', limit: 30, windowMs: 60000 },
  { match: ['/api/analytics'], name: 'analytics', by: 'ip', limit: 60, windowMs: 60000 },
  { match: ['/api/collection', '/api/collection/sales'], name: 'collection', by: 'ip', limit: 30, windowMs: 60000 },
  { match: ['/api/store'], name: 'store', by: 'ip', limit: 60, windowMs: 60000 },
  { match: ['/api/analytics/wallet'], name: 'lookup', by: 'ip', limit: 30, windowMs: 60000 },
  { match: ['/api/booking/types', '/api/booking/slots', '/api/booking/lookup'], name: 'bookread', by: 'ip', limit: 60, windowMs: 60000 },
  { match: ['/api/booking/hold', '/api/booking/confirm'], name: 'bookwrite', by: 'ip', limit: 12, windowMs: 60000 },
  { match: ['/api/banner/rates', '/api/banner/live'], name: 'adread', by: 'ip', limit: 60, windowMs: 60000 },
  { match: ['/api/booking/watch', '/api/banner/watch'], name: 'paywatch', by: 'ip', limit: 90, windowMs: 60000 },
  { match: ['/api/swap/quote'], name: 'swapquote', by: 'ip', limit: 90, windowMs: 60000 },
  { match: ['/api/swap/build'], name: 'swapbuild', by: 'ip', limit: 20, windowMs: 60000 },
  { match: ['/api/swap/tokens', '/api/swap/earned', '/api/swap/top'], name: 'swapread', by: 'ip', limit: 60, windowMs: 60000 },
  { match: ['/api/swap/search', '/api/swap/prices', '/api/swap/token'], name: 'swaplookup', by: 'ip', limit: 90, windowMs: 60000 },
  { match: ['/api/swap/failed'], name: 'swapfail', by: 'ip', limit: 20, windowMs: 60000 },
  { match: ['/api/swap/holdings'], name: 'swapholdings', by: 'ip', limit: 30, windowMs: 60000 },
  { match: ['/api/swap/record'], name: 'swaprecord', by: 'ip', limit: 20, windowMs: 60000 },
  { match: ['/api/swap/history'], name: 'swaphistory', by: 'ip', limit: 30, windowMs: 60000 },
  { match: ['/api/swap/leaderboard'], name: 'swapboard', by: 'ip', limit: 30, windowMs: 60000 },
  { match: ['/api/cleanup/scan'], name: 'cleanscan', by: 'ip', limit: 20, windowMs: 60000 },
  { match: ['/api/cleanup/award'], name: 'cleanaward', by: 'wallet', limit: 20, windowMs: 60000 },
  { match: ['/api/swap/award'], name: 'swapaward', by: 'wallet', limit: 30, windowMs: 60000 },
  { match: ['/api/banner/hold', '/api/banner/confirm', '/api/banner/creative'], name: 'adwrite', by: 'ip', limit: 12, windowMs: 60000 },
  { match: ['/api/leaderboard', '/api/banner/stats'], name: 'read', by: 'ip', limit: 60, windowMs: 60000 },
  { match: ['/api/banner/event'], name: 'event', by: 'ip', limit: 40, windowMs: 60000 },
  // Guessing a code is infeasible (32^10), so this is not the thing standing
  // between an attacker and the points — it just stops anyone hammering it.
  { match: ['/api/plushie/redeem'], name: 'plushie', by: 'ip', limit: 10, windowMs: 60000 },
  // The admin surface can settle missions, approve creative and export the whole
  // database. It had no limit at all, so a token could be guessed at unlimited
  // speed. Matched by the synthetic path 'admin:*' below, not by exact route.
  { match: ['admin:*'], name: 'admin', by: 'ip', limit: 5, windowMs: 60000 },
  // A global ceiling on wallet scans. Per-IP limits do nothing against a proxy
  // pool, and each scan costs real Helius credits — if those run out, holder
  // analytics and the Ranger grid stop working for everyone.
  { match: ['scan:global'], name: 'scanbudget', by: 'global', limit: 600, windowMs: 3600000 },
  { match: ['holdings:global'], name: 'holdingsbudget', by: 'global', limit: 1200, windowMs: 3600000 }
];

/// Compares without leaking where two strings first differ. A plain !== returns
/// as soon as it finds a mismatch, which in principle times differently for a
/// token that shares a prefix with the real one.
function tokenMatches(header, secret) {
  if (!secret) return false;
  const given = String(header || '');
  const want = 'Bearer ' + secret;
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function rateLimited(request, env, path, wallet) {
  const rule = RATE_RULES.find(function (r) { return r.match.indexOf(path) >= 0; });
  if (!rule) return false;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const who = rule.by === 'global'
    ? 'all'
    : (rule.by === 'wallet' && wallet) ? 'w:' + wallet : 'i:' + ip;
  const now = Date.now();
  const window = Math.floor(now / rule.windowMs);
  const key = rule.name + ':' + who + ':' + window;
  const expires = (window + 1) * rule.windowMs;

  try {
    // RETURNING gives the post-increment count from the write itself; a
    // separate SELECT reads a replica and can lag behind, which silently
    // defeated the limit.
    const row = await env.DB.prepare(
      'INSERT INTO rate_limits (k, n, expires) VALUES (?, 1, ?) ' +
      'ON CONFLICT(k) DO UPDATE SET n = n + 1 ' +
      'RETURNING n'
    ).bind(key, expires).first();
    return !!row && row.n > rule.limit;
  } catch (e) {
    return false; // fail open rather than lock everyone out of a working site
  }
}

function tooMany(request, env) {
  return new Response(
    JSON.stringify({ error: 'Slow down a moment and try again.' }),
    { status: 429, headers: Object.assign({ 'Retry-After': '60' }, corsHeaders(request, env)) }
  );
}

// Expired nonces, sessions and rate-limit windows would otherwise accumulate
// forever. Swept opportunistically to keep this to a single worker.
async function sweepExpired(env) {
  if (Math.random() > 0.02) return;
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM nonces WHERE expires < ?').bind(now),
      env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires < ?').bind(now)
    ]);
  } catch (e) { /* housekeeping only */ }
}


// ── OPERATIONS ──
// Errors were previously swallowed into a 500 with no record, so a fault only
// surfaced if someone happened to mention it. They are now recorded, and a
// scheduled check reports failures rather than waiting to be noticed.
async function logError(env, route, message) {
  try {
    await env.DB.prepare('INSERT INTO error_log (ts, route, message) VALUES (?, ?, ?)')
      .bind(Date.now(), String(route).slice(0, 120), String(message).slice(0, 500)).run();
  } catch (e) { /* logging must never itself break a request */ }
}

/// Optional: set TELEGRAM_ALERT_TOKEN and TELEGRAM_ALERT_CHAT and failures get
/// pushed to Telegram. Without them everything still records, just silently.
async function alert(env, text) {
  if (!env.TELEGRAM_ALERT_TOKEN || !env.TELEGRAM_ALERT_CHAT) return;
  try {
    await fetch('https://api.telegram.org/bot' + env.TELEGRAM_ALERT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_ALERT_CHAT, text: text.slice(0, 3500) })
    });
  } catch (e) { /* an alert failing must not cascade */ }
}

async function healthCheck(env) {
  const detail = {};
  let ok = true;

  try {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM players').first();
    detail.players = r ? r.n : 0;
  } catch (e) { ok = false; detail.db = 'FAIL: ' + e.message; }

  if (env.HELIUS_API_KEY) {
    try {
      const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'h', method: 'getHealth' })
      });
      detail.helius = res.status;
      if (!res.ok) ok = false;
    } catch (e) { ok = false; detail.helius = 'FAIL: ' + e.message; }
  }

  try {
    const since = Date.now() - 3600000;
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log WHERE ts > ?').bind(since).first();
    detail.errorsLastHour = r ? r.n : 0;
    if (detail.errorsLastHour > 25) ok = false;
  } catch (e) { /* already covered by the db check */ }

  return { ok, detail };
}


// ── MISSIONS ──
// A mission runs for a fiscal quarter. Holders join whenever they like; weight
// is earned per Ranger per day locked inside the quarter, so joining late costs
// you tickets rather than locking you out. Longer and more Rangers both raise
// weight, which is what decides both the guaranteed reward and the draw odds.
// Bumped on every deploy so /api/health says which build is actually live.
const BUILD = 'quote-speed-1';

const TICKETS_PER_RANGER_DAY = 1;
// Missions launch with Q1 2027. Until then the card shows the rules and a
// countdown rather than a quarter nobody could have entered from the start.
const FIRST_MISSION_ID = '2027-Q1';
const STREAK_MULTIPLIERS = [1, 1.5, 2];   // 1st, 2nd, 3rd+ consecutive quarter

/// Calendar quarters. If the fiscal year ever differs from the calendar year,
/// this is the single place to change it.
function quarterFor(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  return {
    id: y + '-Q' + (q + 1),
    label: 'Q' + (q + 1) + ' ' + y,
    starts: Date.UTC(y, q * 3, 1),
    ends: Date.UTC(y, q * 3 + 3, 1) - 1
  };
}

function quarterById(id) {
  const [y, q] = id.split('-Q').map(Number);
  return {
    id: id,
    label: 'Q' + q + ' ' + y,
    starts: Date.UTC(y, (q - 1) * 3, 1),
    ends: Date.UTC(y, q * 3, 1) - 1
  };
}

function previousQuarterId(id) {
  const [y, q] = id.split('-Q').map(Number);
  return q === 1 ? (y - 1) + '-Q4' : y + '-Q' + (q - 1);
}

async function currentMission(env) {
  const first = quarterById(FIRST_MISSION_ID);
  const q = Date.now() < first.starts ? first : quarterFor(Date.now());
  let row = await env.DB.prepare('SELECT * FROM missions WHERE id = ?').bind(q.id).first();
  if (!row) {
    await env.DB.prepare(
      'INSERT INTO missions (id, label, starts, ends, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'
    ).bind(q.id, q.label, q.starts, q.ends, Date.now() < q.starts ? 'upcoming' : 'open').run();
    row = await env.DB.prepare('SELECT * FROM missions WHERE id = ?').bind(q.id).first();
  }
  // a mission that has not started yet reports as upcoming whatever the row says
  if (Date.now() < row.starts) row.status = 'upcoming';
  return row;
}

/// How many consecutive quarters this wallet has completed, ending with the one
/// before the mission given. Used to pick the streak multiplier.
async function streakFor(env, wallet, missionId) {
  let streak = 0;
  let id = previousQuarterId(missionId);
  for (let i = 0; i < 12; i++) { // three years is plenty of lookback
    const row = await env.DB.prepare(
      'SELECT tickets FROM mission_results WHERE mission_id = ? AND wallet = ?'
    ).bind(id, wallet).first();
    if (!row || row.tickets <= 0) break;
    streak++;
    id = previousQuarterId(id);
  }
  return streak;
}

function multiplierFor(streak) {
  return STREAK_MULTIPLIERS[Math.min(streak, STREAK_MULTIPLIERS.length - 1)];
}

/// Live standing, computed from the stake records rather than stored, so it is
/// always current and cannot drift out of sync with what is actually locked.
async function missionStanding(env, wallet, mission) {
  const now = Date.now();
  const windowEnd = Math.min(now, mission.ends);
  const rows = await env.DB.prepare(
    'SELECT mint, since FROM staked_nfts WHERE wallet = ?'
  ).bind(wallet).all();
  const staked = rows.results || [];

  let rangerDays = 0;
  for (const nft of staked) {
    const from = Math.max(nft.since, mission.starts);
    if (windowEnd <= from) continue;
    rangerDays += (windowEnd - from) / DAY_MS;
  }

  const streak = await streakFor(env, wallet, mission.id);
  const multiplier = multiplierFor(streak);
  const tickets = Math.floor(rangerDays * TICKETS_PER_RANGER_DAY * multiplier);

  // what the same lock would be worth if held to the end of the quarter
  let projectedDays = 0;
  for (const nft of staked) {
    const from = Math.max(nft.since, mission.starts);
    if (mission.ends <= from) continue;
    projectedDays += (mission.ends - from) / DAY_MS;
  }

  return {
    missionId: mission.id,
    label: mission.label,
    starts: mission.starts,
    ends: mission.ends,
    status: mission.status,
    sponsor: mission.sponsor || null,
    prize: mission.prize || null,
    rangers: staked.length,
    rangerDays: Math.floor(rangerDays),
    streak: streak,
    multiplier: multiplier,
    tickets: tickets,
    projectedTickets: Math.round(projectedDays * TICKETS_PER_RANGER_DAY * multiplier),
    missionDays: Math.round((mission.ends - mission.starts) / DAY_MS),
    daysLeft: Math.max(0, Math.ceil((mission.ends - now) / DAY_MS)),
    opensIn: now < mission.starts ? Math.ceil((mission.starts - now) / DAY_MS) : 0
  };
}


// ── THE DRAW ────────────────────────────────────────────────────────────────
// Split between chain and server so it stays cheap without becoming a
// "trust me". The entry list is hashed and committed on-chain before any
// randomness exists; the randomness is written on-chain exactly once; the
// selection below is pure arithmetic over those two published values. Anyone
// can re-run it and get the same winners.

const DRAW_PROGRAM_ID = '8BqrCR3hdX6o1P3tnEjX5xuV9FbTJLU2F8aNBNF5XvCp';

function hex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

function unhex(s) {
  const clean = String(s || '').replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/// One line per entrant, `wallet:entries`, ordered by wallet. Deterministic
/// and diffable — the published file and the hashed bytes are the same thing.
function canonicalSnapshot(entries) {
  return entries
    .slice()
    .sort(function (a, b) { return a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0; })
    .map(function (e) { return e.wallet + ':' + e.tickets; })
    .join('\n');
}

/// Winners, without replacement. Draw n hashes randomness with the draw index;
/// the result picks a point in the cumulative entry range. A wallet already
/// drawn is skipped and the next index tried, so more entries means more
/// chances but never two prizes for the same wallet.
function selectWinners(randomnessHex, snapshotText, winnerCount) {
  const entries = snapshotText.split('\n').filter(Boolean).map(function (line) {
    const at = line.lastIndexOf(':');
    return { wallet: line.slice(0, at), tickets: Number(line.slice(at + 1)) };
  });

  let total = 0;
  const cumulative = entries.map(function (e) { return (total += e.tickets); });
  if (total <= 0) return [];

  const rnd = unhex(randomnessHex);
  const winners = [];
  const taken = new Set();
  const maxDraws = Math.min(4096, entries.length * 64 + winnerCount * 64);

  for (let draw = 0; draw < maxDraws && winners.length < winnerCount && taken.size < entries.length; draw++) {
    const seed = new Uint8Array(rnd.length + 4);
    seed.set(rnd, 0);
    new DataView(seed.buffer).setUint32(rnd.length, draw, false);
    // synchronous hash so the whole selection stays a pure function
    const pick = fnvPick(seed, total);

    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pick < cumulative[mid]) hi = mid; else lo = mid + 1;
    }
    const chosen = entries[lo];
    if (taken.has(chosen.wallet)) continue;
    taken.add(chosen.wallet);
    winners.push({ rank: winners.length + 1, wallet: chosen.wallet, tickets: chosen.tickets, draw: draw });
  }
  return winners;
}

/// 128-bit FNV-1a over the seed, reduced into the entry range. Chosen over
/// SHA-256 here only because it is synchronous and trivial to reimplement in
/// any language — the unpredictability comes from the VRF, not from this.
function fnvPick(seed, total) {
  let h = 0x6c62272e07bb0142n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < seed.length; i++) {
    h ^= BigInt(seed[i]);
    h = (h * prime) & mask;
  }
  // fold once more so single-byte changes propagate across the whole word
  h ^= h >> 33n;
  h = (h * prime) & mask;
  return Number(h % BigInt(total));
}

/// Build the entry list for a mission from the settled results.
async function drawSnapshot(env, missionId) {
  const rows = await env.DB.prepare(
    'SELECT wallet, tickets FROM mission_results WHERE mission_id = ? AND tickets > 0'
  ).bind(missionId).all();
  const entries = (rows.results || []).map(function (r) {
    return { wallet: r.wallet, tickets: r.tickets };
  });
  const text = canonicalSnapshot(entries);
  const hash = hex(await sha256(new TextEncoder().encode(text)));
  const total = entries.reduce(function (s, e) { return s + e.tickets; }, 0);
  return { entries: entries, text: text, hash: hash, total: total };
}


// ── HOLDER ANALYTICS ────────────────────────────────────────────────────────
// Snapshotted on a cron rather than computed per request: a hundred visitors
// then cost the same one DAS call as a single visitor, which matters on a
// free tier capped at 2 DAS requests a second.

const ME_SYMBOL = 'moonrangers';
// The plushie's numbers used to be typed into the page by hand, so the first sale
// made them wrong. store.fun renders its shop in the browser; this is the feed it
// reads, and it needs no key.
const STORE_FEED = 'https://api.store.fun/api/v1/public/collections/quicks/full';
const STORE_PRODUCT = 'quicks-plushie';

async function storeProduct() {
  const res = await fetch(STORE_FEED, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('store ' + res.status);
  const body = await res.json();
  const list = (body && body.data && body.data.products) || [];
  const p = list.find(function (x) { return x.slug === STORE_PRODUCT; }) || list[0];
  if (!p) return null;
  const quantity = Number(p.quantity) || 0;
  const sold = Number(p.sales_count) || 0;
  return {
    name: p.name || null,
    priceUsdc: Number(p.price) || null,
    quantity: quantity,
    sold: sold,
    available: Math.max(0, quantity - sold),
    soldOut: !!p.sale_ended || (quantity > 0 && sold >= quantity)
  };
}
// Bucket edges for a 436-piece collection. Whale is deliberately reachable —
// the point is to show the shape of the holder base, not to flatter anyone.
const WHALE_MIN = 10;
const MID_MIN = 3;

async function fetchAllOwners(env) {
  if (!env.HELIUS_API_KEY) return null;
  const owners = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'a', method: 'searchAssets',
        params: {
          grouping: ['collection', env.MOON_RANGERS_COLLECTION],
          burnt: false,
          page: page, limit: 1000
        }
      })
    });
    if (!res.ok) throw new Error('das ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'das error');
    const items = (data.result && data.result.items) || [];
    for (const it of items) {
      const o = it.ownership && it.ownership.owner;
      if (o) owners.push(o);
    }
    if (items.length < 1000) break;
  }
  return owners;
}

/// Every living Ranger with its art, traits and rarity rank. Rarity is the usual
/// sum of 1/frequency across traits: the fewer Rangers share a trait, the more it
/// is worth. Read once and cached, because it is one heavy call for 219 pieces.
async function collectionData(env) {
  const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'c', method: 'searchAssets',
      params: { grouping: ['collection', env.MOON_RANGERS_COLLECTION], burnt: false, page: 1, limit: 1000 }
    })
  });
  if (!res.ok) throw new Error('das ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'das error');
  const items = (data.result && data.result.items) || [];

  const counts = {};       // trait type → value → how many Rangers have it
  const rangers = items.map(function (it) {
    const meta = (it.content && it.content.metadata) || {};
    const traits = {};
    for (const a of meta.attributes || []) {
      if (!a || !a.trait_type || a.value === undefined || a.value === null || a.value === '') continue;
      const type = String(a.trait_type), value = String(a.value);
      traits[type] = value;
      counts[type] = counts[type] || {};
      counts[type][value] = (counts[type][value] || 0) + 1;
    }
    const files = (it.content && it.content.files) || [];
    const links = (it.content && it.content.links) || {};
    return {
      mint: it.id,
      name: meta.name || '',
      image: (files[0] && files[0].cdn_uri) || links.image || (files[0] && files[0].uri) || null,
      // the CDN copy 404s for a few pieces, so the original comes along too
      imageAlt: links.image || (files[0] && files[0].uri) || null,
      traits: traits
    };
  });

  const total = rangers.length;
  for (const r of rangers) {
    let score = 0;
    for (const type of Object.keys(r.traits)) {
      const n = counts[type][r.traits[type]] || 1;
      score += total / n;
    }
    r.score = Math.round(score * 100) / 100;
  }
  const ranked = rangers.slice().sort(function (a, b) { return b.score - a.score; });
  ranked.forEach(function (r, i) { r.rank = i + 1; });

  return { total: total, traits: counts, rangers: rangers };
}

/// How many were ever minted, burned ones included. DAS reports `total` as the
/// size of the page it just returned, not the size of the collection — asking for
/// one asset and reading `total` said the collection had one piece in it, which
/// is exactly what went out on the page.
async function countMinted(env) {
  let n = 0;
  for (let page = 1; page <= 10; page++) {
    const res = await rpcCall(env, 'searchAssets', {
      grouping: ['collection', env.MOON_RANGERS_COLLECTION], page: page, limit: 1000
    });
    const items = (res && res.items) || [];
    n += items.length;
    if (items.length < 1000) break;
  }
  return n;
}

async function fetchFloor() {
  let res = await fetch('https://api-mainnet.magiceden.dev/v2/collections/' + ME_SYMBOL + '/stats', {
    headers: { 'Accept': 'application/json' }
  });
  if (res.status === 429) {
    await new Promise(function (r) { setTimeout(r, 2000); });
    res = await fetch('https://api-mainnet.magiceden.dev/v2/collections/' + ME_SYMBOL + '/stats', {
      headers: { 'Accept': 'application/json' }
    });
  }
  if (!res.ok) throw new Error('me ' + res.status);
  const s = await res.json();
  if (!s || typeof s.floorPrice !== 'number') return null;
  return { floor: s.floorPrice, listed: s.listedCount || 0, volume7d: s.volume7d || 0 };
}

/// The last sales, as the marketplace reports them. Bids and listings are left
/// out: a sale is the only number that says what someone actually paid.
async function recentSales(env, limit) {
  const res = await fetch('https://api-mainnet.magiceden.dev/v2/collections/' + ME_SYMBOL +
    '/activities?offset=0&limit=100', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('me ' + res.status);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  const names = {};
  try {
    const col = await collectionData(env);
    for (const r of col.rangers) names[r.mint] = r.name;
  } catch (e) { /* a sale without a name is still a sale */ }
  return rows
    .filter(function (a) { return a.type === 'buyNow' && a.price > 0; })
    .slice(0, limit)
    .map(function (a) {
      return {
        mint: a.tokenMint,
        name: names[a.tokenMint] || null,
        sol: Math.round(a.price * 1000) / 1000,
        ts: (a.blockTime || 0) * 1000,
        buyer: a.buyer || null,
        seller: a.seller || null
      };
    });
}

/// One pass: who holds what, and what the market says. Either half can fail
/// without taking the other down — a missing floor is better than a blank tab.
async function refreshAnalytics(env) {
  const now = Date.now();
  const out = { holders: null, floor: null };

  try {
    const owners = await fetchAllOwners(env);
    if (owners && owners.length) {
      const counts = new Map();
      for (const o of owners) counts.set(o, (counts.get(o) || 0) + 1);

      let whales = 0, mid = 0, small = 0;
      for (const n of counts.values()) {
        if (n >= WHALE_MIN) whales++;
        else if (n >= MID_MIN) mid++;
        else small++;
      }
      const sorted = Array.from(counts.values()).sort(function (a, b) { return b - a; });
      const top10 = sorted.slice(0, 10).reduce(function (s, n) { return s + n; }, 0);
      const top10Pct = Math.round((top10 / owners.length) * 1000) / 10;

      await env.DB.prepare(
        'INSERT INTO holder_snapshots (taken_at, holders, supply, whales, mid, small, top10_pct) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(now, counts.size, owners.length, whales, mid, small, top10Pct).run();

      // positions are a replace-in-place mirror, kept for wallet lookup and rank
      const entries = Array.from(counts.entries());
      const batch = [];
      for (const [wallet, count] of entries) {
        batch.push(env.DB.prepare(
          'INSERT INTO holder_positions (wallet, count, first_seen, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(wallet) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at'
        ).bind(wallet, count, now, now));
      }
      for (let i = 0; i < batch.length; i += 50) await env.DB.batch(batch.slice(i, i + 50));
      // wallets that sold out entirely since the last run
      await env.DB.prepare('DELETE FROM holder_positions WHERE updated_at < ?').bind(now).run();

      out.holders = { holders: counts.size, supply: owners.length };

      // what the collection has been through: minted once, some burned since
      try {
        const col = await collectionData(env);
        const named = col.rangers.filter(function (r) { return r.name; }).length;
        const minted = await countMinted(env);
        const put = env.DB.prepare(
          'INSERT INTO kv_cache (k, n, ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET n = excluded.n, ts = excluded.ts'
        );
        await env.DB.batch([
          put.bind('minted', minted, now),
          put.bind('named', named, now)
        ]);
      } catch (e) {
        await logError(env, 'analytics.collection', (e && e.message) || e);
      }
    }
  } catch (e) {
    await logError(env, 'analytics.holders', (e && e.message) || e);
  }

  try {
    const f = await fetchFloor();
    if (f) {
      await env.DB.prepare(
        'INSERT INTO floor_snapshots (taken_at, source, floor_lamports, listed, volume_7d) VALUES (?, ?, ?, ?, ?)'
      ).bind(now, 'magiceden', f.floor, f.listed, f.volume7d).run();
      out.floor = f;
    }
  } catch (e) {
    await logError(env, 'analytics.floor', (e && e.message) || e);
  }

  // a year of history is plenty and keeps the table small
  await env.DB.prepare('DELETE FROM holder_snapshots WHERE taken_at < ?').bind(now - 365 * 86400000).run();
  await env.DB.prepare('DELETE FROM floor_snapshots WHERE taken_at < ?').bind(now - 365 * 86400000).run();
  return out;
}

/// Nearest reading at or before a moment, for the change figures.
async function floorAt(env, ts) {
  const row = await env.DB.prepare(
    'SELECT floor_lamports FROM floor_snapshots WHERE taken_at <= ? ORDER BY taken_at DESC LIMIT 1'
  ).bind(ts).first();
  return row ? row.floor_lamports : null;
}

async function analyticsPayload(env) {
  const now = Date.now();

  const hs = await env.DB.prepare(
    'SELECT * FROM holder_snapshots ORDER BY taken_at DESC LIMIT 1'
  ).first();
  const fs = await env.DB.prepare(
    'SELECT * FROM floor_snapshots ORDER BY taken_at DESC LIMIT 1'
  ).first();

  const day = await floorAt(env, now - 86400000);
  const week = await floorAt(env, now - 7 * 86400000);
  const pct = function (from, to) {
    if (!from || !to) return null;
    return Math.round(((to - from) / from) * 1000) / 10;
  };

  // one point a day keeps the chart honest without shipping every snapshot
  const series = await env.DB.prepare(
    'SELECT MIN(taken_at) AS t, floor_lamports AS floor FROM floor_snapshots ' +
    'WHERE taken_at > ? GROUP BY date(taken_at / 1000, \'unixepoch\') ORDER BY t'
  ).bind(now - 90 * 86400000).all();

  const firstFloor = await env.DB.prepare('SELECT MIN(taken_at) AS t FROM floor_snapshots').first();

  // the same one-a-day treatment for the holder count, which was being stored
  // for a year and never shown
  const holderSeries = await env.DB.prepare(
    'SELECT MIN(taken_at) AS t, holders FROM holder_snapshots ' +
    'WHERE taken_at > ? GROUP BY date(taken_at / 1000, \'unixepoch\') ORDER BY t'
  ).bind(now - 90 * 86400000).all();
  const firstHolders = await env.DB.prepare('SELECT MIN(taken_at) AS t FROM holder_snapshots').first();
  const countOf = async function (k) {
    const row = await env.DB.prepare('SELECT n FROM kv_cache WHERE k = ?').bind(k).first();
    return row ? row.n : null;
  };
  const minted = await countOf('minted');
  const named = await countOf('named');

  // who is actually taking part, rather than just holding
  const staking = await env.DB.prepare(
    'SELECT COUNT(DISTINCT wallet) AS wallets, COUNT(*) AS rangers FROM staked_nfts'
  ).first();
  const top = await env.DB.prepare(
    'SELECT wallet, COUNT(*) AS rangers, MIN(since) AS since FROM staked_nfts ' +
    'GROUP BY wallet ORDER BY rangers DESC, since ASC LIMIT 10'
  ).all();

  const holders = hs ? hs.holders : 0;
  const stakingWallets = (staking && staking.wallets) || 0;

  return {
    holders: hs ? {
      total: hs.holders,
      supply: hs.supply,
      whales: hs.whales,
      mid: hs.mid,
      small: hs.small,
      top10Pct: hs.top10_pct,
      avg: hs.holders ? Math.round((hs.supply / hs.holders) * 100) / 100 : 0,
      updatedAt: hs.taken_at,
      collectingSince: firstHolders ? firstHolders.t : null,
      history: (holderSeries.results || []).map(function (r) { return { t: r.t, n: r.holders }; })
    } : null,
    collection: hs ? {
      minted: minted,
      burned: minted ? minted - hs.supply : null,
      alive: hs.supply,
      named: named
    } : null,
    floor: fs ? {
      lamports: fs.floor_lamports,
      sol: Math.round((fs.floor_lamports / 1e9) * 1000) / 1000,
      listed: fs.listed,
      volume7d: fs.volume_7d,
      change24h: pct(day, fs.floor_lamports),
      change7d: pct(week, fs.floor_lamports),
      source: fs.source,
      updatedAt: fs.taken_at,
      collectingSince: firstFloor ? firstFloor.t : null,
      history: (series.results || []).map(function (r) {
        return { t: r.t, sol: Math.round((r.floor / 1e9) * 1000) / 1000 };
      })
    } : null,
    participation: {
      stakingWallets: stakingWallets,
      rangersStaked: (staking && staking.rangers) || 0,
      shareOfHolders: holders ? Math.round((stakingWallets / holders) * 1000) / 10 : null,
      top: (top.results || []).map(function (r) {
        return { wallet: r.wallet, rangers: r.rangers, since: r.since };
      })
    }
  };
}



/// Looks for a payment tagged with this booking's reference. This is what makes
/// the flow survive a closed tab: the money is on chain either way, and the
/// reference is how we find it again.
async function findPaymentByReference(env, reference) {
  if (!env.HELIUS_API_KEY || !reference) return null;
  const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'ref', method: 'getSignaturesForAddress',
      params: [reference, { limit: 10 }]
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const list = (data && data.result) || [];
  for (const s of list) {
    if (s.err) continue;
    return s.signature;
  }
  return null;
}



// ── SWAP ────────────────────────────────────────────────────────────────────
// Routed through Jupiter's keyless endpoint, proxied here so the browser never
// talks to a third party and the CSP stays as tight as it is. Built on the
// Swap API rather than the Plugin because the Plugin runs on Ultra, whose
// integrator fee starts at 50bps — two and a half times what we charge.

/// lite-api.jup.ag is being phased out, its rate limit cut progressively until
/// it is retired. api.jup.ag serves the same paths but allows keyless callers
/// only about one request every two seconds — shared by every visitor, since
/// all calls leave from this worker. So calls move there only once a key is set
/// (`wrangler secret put JUPITER_API_KEY`), and stay on lite-api until then.
///
/// A key Jupiter rejects must never take the swap down with it — that happened
/// on 2026-09-15, when a key pasted into the secret was refused with 401 and
/// every quote failed until it was removed. So a 401 or 403 is logged and the
/// call is retried on lite-api.
async function jupFetch(env, path, init) {
  const key = env && env.JUPITER_API_KEY;
  if (key) {
    const opts = Object.assign({}, init || {});
    opts.headers = Object.assign({}, opts.headers || {}, { 'x-api-key': key });
    const res = await fetch('https://api.jup.ag' + path, opts);
    if (res.status !== 401 && res.status !== 403) return res;
    await logError(env, 'jupiter.key', res.status + ' from api.jup.ag — JUPITER_API_KEY rejected, fell back to lite-api');
  }
  return fetch('https://lite-api.jup.ag' + path, init);
}

const SWAP_FEE_BPS = 20;

// Fees can only be collected in a token that is one side of the swap, so the
// account is chosen per quote. A pair touching neither simply pays no fee.
// Dollar stablecoins, valued at $1 wherever fees are totted up.
const DOLLAR_MINTS = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'  // USDT
];

const SWAP_FEE_ACCOUNTS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': '3w3oJv6xjbUTEJKfLcoijjAtAEUJkZ64po6nBBCjSijn',
  'So11111111111111111111111111111111111111112': 'AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp',
  // created 2026-09-15; fee taken from USDT received and from USDT sold both
  // simulated on mainnet before it was added
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': '7y4zjYuiFw7eHDUYWByqMSmu3SebpzvvBJSQz8BVbmXL',
  // Token-2022, so its referral account lives under that program — which is
  // exactly the mismatch that broke this pair before it existed.
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': '6aypgwsaHJmrVA6gS2EH5d67EmQyoSR2CRtoX33iZ9Yh'
};

const SWAP_TOKENS = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6 },
  { mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', symbol: 'JUP', name: 'Jupiter', decimals: 6 },
  { mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', name: 'Bonk', decimals: 5 },
  { mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF', name: 'dogwifhat', decimals: 6 },
  { mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', symbol: 'PYUSD', name: 'PayPal USD', decimals: 6 }
];

// The fee can also be taken from the token being SOLD. Proven by simulating
// swaps on mainnet (2026-09-14): with the SOL or USDC fee account passed for
// the input side, exactly 0.2% of the input reached the fee account and the
// wallet received 99.8% of the no-fee amount — charged once, not twice. Without
// this, SOL into any token other than USDC or PYUSD — the most common trade —
// earned nothing. PYUSD stays output-only: taking a fee from a Token-2022 input
// has not been tested.
const INPUT_FEE_MINTS = [
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'   // USDT
];

// ── FINDING A FEE ACCOUNT BY ITSELF ─────────────────────────────────────────
// Fee accounts used to be a hand-written list: create one on Jupiter's site, then
// edit this file. Instead the worker derives the address Jupiter would use for a
// mint and asks the chain whether it exists. Create an account and swaps in that
// token start earning by themselves.
const REFERRAL_PROGRAM = 'REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3';
const REFERRAL_ACCOUNT = '5Vrx9Gi4E1dqe4hJine1Whds8LLqayJEN2ZSqFYko9uU';
const PDA_MARKER = 'ProgramDerivedAddress';

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58ToBytes(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58_ALPHABET.indexOf(c);
    if (i < 0) throw new Error('not base58');
    n = n * 58n + BigInt(i);
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== '1') break; out.unshift(0); }
  while (out.length < 32) out.unshift(0);
  return Uint8Array.from(out);
}
function bytesToB58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58_ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}

// Whether 32 bytes decompress to a point on ed25519. A program address is
// precisely an address that does not, which is why it has no private key.
const ED_P = (1n << 255n) - 19n;
const ED_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
function powMod(base, exp, mod) {
  let r = 1n, b = base % mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    exp >>= 1n;
  }
  return r;
}
function isOnCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) + BigInt(bytes[i]);
  y &= (1n << 255n) - 1n;                 // drop the sign bit
  if (y >= ED_P) return false;
  const y2 = (y * y) % ED_P;
  const u = (y2 - 1n + ED_P) % ED_P;
  const v = (ED_D * y2 + 1n) % ED_P;
  // x = u v^3 (u v^7)^((p-5)/8), the standard decompression
  const v3 = (v * v % ED_P) * v % ED_P;
  const v7 = (v3 * v3 % ED_P) * v % ED_P;
  let x = (u * v3 % ED_P) * powMod(u * v7 % ED_P, (ED_P - 5n) / 8n, ED_P) % ED_P;
  const vx2 = (v * x % ED_P) * x % ED_P;
  if (vx2 === u % ED_P) return true;
  if (vx2 === (ED_P - u % ED_P) % ED_P) return true;   // the other square root
  return false;
}

async function programAddress(seeds, programId) {
  const marker = new TextEncoder().encode(PDA_MARKER);
  const program = b58ToBytes(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const parts = seeds.concat([Uint8Array.from([bump]), program, marker]);
    let len = 0;
    for (const p of parts) len += p.length;
    const buf = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    if (!isOnCurve(hash)) return bytesToB58(hash);
  }
  throw new Error('no program address for those seeds');
}

/// The fee account Jupiter would use for a mint — the same address its dashboard
/// creates, derived rather than looked up.
async function derivedFeeAccount(mint) {
  return programAddress(
    [new TextEncoder().encode('referral_ata'), b58ToBytes(REFERRAL_ACCOUNT), b58ToBytes(mint)],
    REFERRAL_PROGRAM);
}

/// Does that account exist, and under which token program? Cached: an answer
/// only changes when an account is created, and a miss costs one RPC call.
async function feeAccountFor(env, mint) {
  const cache = caches.default;
  const key = new Request('https://fee-account.cache/' + mint);
  const hit = await cache.match(key);
  if (hit) {
    const cached = await hit.json();
    return cached.account ? cached : null;
  }
  let answer = { account: null, program: null };
  try {
    const account = await derivedFeeAccount(mint);
    const info = await rpcCall(env, 'getAccountInfo', [account, { encoding: 'jsonParsed' }]);
    const value = info && info.value;
    const parsed = value && value.data && value.data.parsed;
    if (parsed && parsed.type === 'account' && parsed.info && parsed.info.mint === mint) {
      answer = { account: account, program: value.owner };
    }
  } catch (e) {
    await logError(env, 'fee.derive', (e && e.message) || e);
    return null;                                    // do not cache a failure
  }
  // a missing account is worth remembering too, but for less time
  await cache.put(key, new Response(JSON.stringify(answer), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + (answer.account ? 86400 : 900) }
  }));
  return answer.account ? answer : null;
}

/// Which fee account a swap pays into, and in which token. The output side is
/// preferred so pairs that already earned keep earning exactly as before; the
/// input side is the fallback. The account must also sit under its mint's own
/// token program — the wrong one fails the whole swap with
/// IncorrectTokenProgramID (6014), which is how a Token-2022 output like PYUSD
/// once broke. No match on either side means no fee; the swap still goes through.
function swapFee(inputMint, outputMint) {
  if (SWAP_FEE_ACCOUNTS[outputMint]) return { account: SWAP_FEE_ACCOUNTS[outputMint], mint: outputMint };
  if (INPUT_FEE_MINTS.indexOf(inputMint) >= 0) return { account: SWAP_FEE_ACCOUNTS[inputMint], mint: inputMint };
  return null;
}

/// The same question, but also asking the chain about accounts created since this
/// file was written. The output side is preferred, as before. The input side is
/// only used for a classic SPL mint: taking a fee from a Token-2022 input has
/// never been proven here, and a wrong guess fails the whole swap.
async function swapFeeFor(env, inputMint, outputMint) {
  const known = swapFee(inputMint, outputMint);
  if (known) return known;
  const out = await feeAccountFor(env, outputMint);
  if (out) return { account: out.account, mint: outputMint };
  const inp = await feeAccountFor(env, inputMint);
  if (inp && inp.program === TOKEN_PROGRAM_ID) return { account: inp.account, mint: inputMint };
  return null;
}

// A pair with no fee account on either side (BONK → WIF, say) would otherwise
// earn nothing. Those pay the same rate as a plain SOL transfer to the treasury,
// which the page adds to the swap transaction before the wallet signs it. The
// amount comes from Jupiter's dollar value for the swap and the SOL price, and
// anything too small to matter is skipped.
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_FEE_MIN_LAMPORTS = 1000;
async function solFeeLamports(env, quote, bps) {
  const usd = Number(quote && quote.swapUsdValue);
  if (!env.TREASURY_WALLET || !bps || !(usd > 0)) return 0;
  const sol = await solUsd(env);
  if (!sol) return 0;
  const lamports = Math.floor(usd * bps / 10000 / sol * 1e9);
  return lamports >= SOL_FEE_MIN_LAMPORTS ? lamports : 0;
}

// Moon Ranger holders pay half. A wallet that holds or has staked a Ranger is
// quoted and charged 10 bps instead of 20.
const HOLDER_SWAP_FEE_BPS = 10;
function swapFeeBpsFor(isHolder) {
  return isHolder ? HOLDER_SWAP_FEE_BPS : SWAP_FEE_BPS;
}

// Speed choices map to Jupiter's priority levels, each with a ceiling so a busy
// network can never make one swap cost more than a sliver of SOL in fees.
const SWAP_SPEEDS = {
  normal: { priorityLevel: 'medium', maxLamports: 200000 },   // at most 0.0002 SOL
  fast: { priorityLevel: 'high', maxLamports: 500000 },       // at most 0.0005 SOL
  turbo: { priorityLevel: 'veryHigh', maxLamports: 1000000 }  // at most 0.001 SOL
};
function swapPriority(speed) {
  return { priorityLevelWithMaxLamports: SWAP_SPEEDS[speed] || SWAP_SPEEDS.normal };
}

// Dollar stablecoins, for choosing a tight slippage when both sides hold their peg.
const STABLE_MINTS = DOLLAR_MINTS.concat([
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', // USDG
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB'  // USD1
]);

/// Jupiter's token metadata for a set of mints, each cached for ten minutes —
/// liquidity and holder counts do not need to be fresher than that to pick a
/// slippage or describe a token.
async function tokenInfo(env, mints) {
  const cache = caches.default;
  const out = {}, missing = [];
  for (const mint of mints) {
    const hit = await cache.match(new Request('https://token-info.cache/' + mint));
    if (hit) out[mint] = await hit.json();
    else missing.push(mint);
  }
  if (missing.length) {
    const res = await jupFetch(env, '/tokens/v2/search?query=' + missing.join(','));
    const found = res.ok ? await res.json().catch(function () { return []; }) : [];
    for (const t of Array.isArray(found) ? found : []) {
      if (missing.indexOf(t.id) < 0) continue;
      out[t.id] = t;
      await cache.put(new Request('https://token-info.cache/' + t.id),
        new Response(JSON.stringify(t), { headers: { 'Cache-Control': 'public, max-age=600' } }));
    }
  }
  return out;
}

/// Plain-English warnings for a token, shared by search and the token panel.
function tokenWarnings(t) {
  const a = t.audit || {};
  const warnings = [];
  if (!t.isVerified) warnings.push('Not on Jupiter’s verified list');
  if (a.mintAuthorityDisabled === false) warnings.push('The team can still mint more');
  if (a.freezeAuthorityDisabled === false) warnings.push('The team can freeze your tokens');
  if (Number(a.topHoldersPercentage) > 50) warnings.push('Top 10 wallets hold ' + Math.round(a.topHoldersPercentage) + '%');
  if (Number(t.liquidity) < 25000) warnings.push('Thin liquidity — expect slippage');
  return warnings;
}

function tokenCard(t) {
  const day = t.stats24h || {};
  return {
    mint: t.id, symbol: t.symbol, name: t.name, decimals: t.decimals, icon: t.icon || null,
    verified: !!t.isVerified, score: t.organicScoreLabel || null,
    price: t.usdPrice || null,
    change24h: day.priceChange === undefined ? null : Number(day.priceChange),
    mcap: t.mcap || null, liquidity: t.liquidity || null, holders: t.holderCount || null,
    createdAt: t.createdAt || null,
    warnings: tokenWarnings(t)
  };
}

/// Slippage chosen from the pair instead of guessed by the person swapping:
/// tight when both sides are dollar stablecoins, looser as liquidity thins.
async function autoSlippageBps(env, inputMint, outputMint) {
  if (STABLE_MINTS.indexOf(inputMint) >= 0 && STABLE_MINTS.indexOf(outputMint) >= 0) return 20;
  const info = await tokenInfo(env, [inputMint, outputMint]).catch(function () { return {}; });
  const sides = [info[inputMint], info[outputMint]];
  if (sides.some(function (t) { return !t || !t.isVerified; })) return 300;
  const thinnest = Math.min(Number(sides[0].liquidity) || 0, Number(sides[1].liquidity) || 0);
  if (thinnest >= 5000000) return 50;
  if (thinnest >= 250000) return 100;
  return 300;
}

const SWAP_POINTS_PER_USD = 1;
const SWAP_POINTS_DAILY_CAP = 500;
const SWAP_POINTS_MIN_USD = 5;

/// USD prices for up to 50 mints per call. Unreliable prices come back missing,
/// which callers treat as "unpriced", never as zero.
async function jupPrices(env, mints) {
  const ids = mints.filter(Boolean).join(',');
  if (!ids) return {};
  const res = await jupFetch(env, '/price/v3?ids=' + ids);
  if (!res.ok) return {};
  return await res.json().catch(function () { return {}; });
}

/// Reads a finished swap off the chain: who signed it, what they gave up and
/// got back, and whether this site's fee was paid. Everything is taken from the
/// transaction itself rather than the client, which could claim any number.
async function inspectSwap(env, signature) {
  const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 's', method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]
    })
  });
  const data = await res.json();
  const tx = data && data.result;
  if (!tx) return { ok: false, error: 'swap not found yet' };
  if (tx.meta && tx.meta.err) return { ok: false, error: 'that swap failed' };

  const keys = tx.transaction.message.accountKeys.map(function (k) { return k.pubkey || k; });
  const wallet = keys[0];

  // Whole base units, not the floating uiAmount: 5.001 - 5 in floating point is
  // 0.001000000000000334, and that is what would be stored as the fee.
  const decimals = {};
  const owned = function (rows, who) {
    const out = {};
    for (const r of rows || []) {
      if (who ? r.owner !== who : false) continue;
      const key = who ? r.mint : r.accountIndex;
      decimals[r.mint] = r.uiTokenAmount.decimals;
      out[key] = (out[key] || 0n) + BigInt(r.uiTokenAmount.amount || '0');
    }
    return out;
  };
  const ui = function (raw, mint) { return Number(raw) / Math.pow(10, decimals[mint] || 0); };
  const pre = owned(tx.meta.preTokenBalances, wallet);
  const post = owned(tx.meta.postTokenBalances, wallet);
  const spent = {}, received = {};
  for (const mint of new Set(Object.keys(pre).concat(Object.keys(post)))) {
    const delta = (post[mint] || 0n) - (pre[mint] || 0n);
    if (delta < 0n) spent[mint] = ui(-delta, mint);
    if (delta > 0n) received[mint] = ui(delta, mint);
  }
  // the fee shows as a balance increase on one of this site's fee accounts
  let feePaid = null;
  const feeAccounts = Object.values(SWAP_FEE_ACCOUNTS);
  const preIdx = owned(tx.meta.preTokenBalances, null), postIdx = owned(tx.meta.postTokenBalances, null);
  for (const r of tx.meta.postTokenBalances || []) {
    if (feeAccounts.indexOf(keys[r.accountIndex]) < 0) continue;
    const delta = postIdx[r.accountIndex] - (preIdx[r.accountIndex] || 0n);
    if (delta > 0n) feePaid = { mint: r.mint, amount: ui(delta, r.mint) };
  }
  // or, on a pair with no fee account, as SOL arriving at the treasury
  let solFee = 0;
  const treasuryIdx = env.TREASURY_WALLET ? keys.indexOf(env.TREASURY_WALLET) : -1;
  if (!feePaid && treasuryIdx > 0) {
    solFee = Math.max(0, (tx.meta.postBalances[treasuryIdx] || 0) - (tx.meta.preBalances[treasuryIdx] || 0));
    if (solFee) feePaid = { mint: SOL_MINT, amount: solFee / 1e9, native: true };
  }

  // native SOL, with the network fee and a SOL-paid swap fee excluded so
  // neither is counted as volume
  const solDelta = ((tx.meta.postBalances[0] || 0) - (tx.meta.preBalances[0] || 0) + (tx.meta.fee || 0) + solFee) / 1e9;
  if (solDelta < 0) spent[SOL_MINT] = (spent[SOL_MINT] || 0) - solDelta;
  if (solDelta > 0) received[SOL_MINT] = (received[SOL_MINT] || 0) + solDelta;

  return { ok: true, wallet: wallet, spent: spent, received: received, feePaid: feePaid, ts: (tx.blockTime || 0) * 1000 };
}

/// What the wallet gave up in a swap, in dollars — the largest priced leg.
async function swapValueUsd(env, signature, wallet) {
  const s = await inspectSwap(env, signature);
  if (!s.ok) return s;
  if (s.wallet !== wallet) return { ok: false, error: 'that swap was not signed by your wallet' };
  const mints = Object.keys(s.spent);
  if (!mints.length) return { ok: false, error: 'no swap found in that transaction' };

  const prices = await jupPrices(env, mints);
  let best = 0;
  for (const mint of mints) {
    const p = prices[mint] && Number(prices[mint].usdPrice);
    if (!p) continue;
    best = Math.max(best, s.spent[mint] * p);
  }
  if (!best) return { ok: false, error: 'could not value that swap' };
  return { ok: true, usd: best };
}


// ── WALLET CLEANUP ──────────────────────────────────────────────────────────
// Two very different jobs behind one screen. Closing an EMPTY token account
// destroys nothing and hands back the rent Solana was holding. Burning a token
// that still has a balance destroys it forever. The scan below exists mainly to
// keep those two apart, and to make sure nothing valuable is ever mistaken for
// junk — an unpriced token is suspicious, not worthless.

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const CLEANUP_FEE_PCT = 10;
// Closing an empty account is the behaviour worth encouraging — it costs the
// holder nothing and tidies the chain. Burning earns more because it is a
// bigger commitment, but not so much more that it tempts anyone to burn.
const CLOSE_POINTS_PER_ACCOUNT = 2;
const BURN_POINTS_PER_ACCOUNT = 5;
const BURN_POINTS_DAILY_CAP = 250;

async function rpcCall(env, method, params) {
  const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'c', method: method, params: params })
  });
  if (!res.ok) throw new Error('rpc ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'rpc error');
  return data.result;
}

/// Every fungible token a wallet holds, with a dollar value, largest first — so
/// the swap can start from what someone owns rather than a search box. Reads
/// both token programs: the balance line used to look only under the classic
/// one, so a Token-2022 token like PYUSD never showed a balance at all.
async function walletHoldings(env, wallet) {
  const SOL = 'So11111111111111111111111111111111111111112';
  const byMint = {};
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await rpcCall(env, 'getTokenAccountsByOwner',
      [wallet, { programId: programId }, { encoding: 'jsonParsed' }]);
    for (const item of (res && res.value) || []) {
      const info = item.account.data.parsed.info;
      const t = info.tokenAmount;
      if (t.amount === '0') continue;
      if (t.amount === '1' && t.decimals === 0) continue; // the shape of an NFT
      // wrapped SOL is left out: swaps spend native SOL, and showing both would
      // count the same money twice
      if (info.mint === SOL) continue;
      const cur = byMint[info.mint] || { mint: info.mint, decimals: t.decimals, raw: 0n, programId: programId };
      cur.raw += BigInt(t.amount);
      byMint[info.mint] = cur;
    }
  }
  const lamports = await rpcCall(env, 'getBalance', [wallet]);
  const native = (lamports && lamports.value) || 0;

  const list = Object.values(byMint);
  if (native > 0) list.unshift({ mint: SOL, decimals: 9, raw: BigInt(native), programId: null });
  for (const t of list) t.amount = Number(t.raw) / Math.pow(10, t.decimals);

  // prices in batches of 50; a wallet full of airdropped spam is capped rather
  // than allowed to cost dozens of calls
  const priced = list.slice(0, 200);
  const prices = {};
  for (let i = 0; i < priced.length; i += 50) {
    Object.assign(prices, await jupPrices(env, priced.slice(i, i + 50).map(function (t) { return t.mint; })));
  }
  for (const t of priced) {
    const p = prices[t.mint] && Number(prices[t.mint].usdPrice);
    t.price = p || null;
    t.usd = p ? t.amount * p : null;
  }
  priced.sort(function (a, b) { return (b.usd || 0) - (a.usd || 0); });

  // names and icons for the first 100, which is the most the lookup takes
  const top = priced.slice(0, 100);
  const meta = {};
  if (top.length) {
    const res = await jupFetch(env, '/tokens/v2/search?query=' + top.map(function (t) { return t.mint; }).join(','));
    const found = res.ok ? await res.json().catch(function () { return []; }) : [];
    for (const m of Array.isArray(found) ? found : []) meta[m.id] = m;
  }

  let totalUsd = 0;
  const tokens = top.map(function (t) {
    const m = meta[t.mint] || {};
    if (t.usd) totalUsd += t.usd;
    return {
      mint: t.mint,
      symbol: m.symbol || (t.mint === SOL ? 'SOL' : t.mint.slice(0, 4) + '…'),
      // this entry is native SOL; Jupiter's metadata names the mint "Wrapped SOL"
      name: t.mint === SOL ? 'Solana' : (m.name || ''),
      icon: m.icon || null,
      decimals: t.decimals,
      verified: !!m.isVerified,
      amount: t.amount,
      price: t.price,
      usd: t.usd === null ? null : Math.round(t.usd * 100) / 100
    };
  });
  return { wallet: wallet, tokens: tokens, totalUsd: Math.round(totalUsd * 100) / 100, more: Math.max(0, list.length - tokens.length) };
}

/// Stores one swap for the wallet's history, valued and named at the time it
/// happened. Anyone may report a signature, because nothing about it is taken
/// on trust: the wallet, the tokens, the amounts and whether the fee was paid
/// all come from the chain.
async function recordSwap(env, signature) {
  const s = await inspectSwap(env, signature);
  if (!s.ok) return s;
  const spent = Object.keys(s.spent), received = Object.keys(s.received);
  if (!spent.length || !received.length) return { ok: false, error: 'no swap found in that transaction' };

  const prices = await jupPrices(env, spent.concat(received, s.feePaid && s.feePaid.native ? [SOL_MINT] : []));
  const price = function (m) { return (prices[m] && Number(prices[m].usdPrice)) || 0; };
  const biggest = function (legs) {
    return Object.keys(legs).sort(function (a, b) { return legs[b] * price(b) - legs[a] * price(a); })[0];
  };
  const inMint = biggest(s.spent), outMint = biggest(s.received);
  const usd = s.spent[inMint] * price(inMint) || s.received[outMint] * price(outMint) || null;

  // The fee rate actually charged, read back from the chain: taken from what was
  // spent, or out of what would have been received. A Moon Ranger holder pays
  // half, so on a discounted swap the saving equals the fee that was paid.
  let feeBps = null, savedUsd = 0;
  let feePaid = s.feePaid;
  if (feePaid && feePaid.native) {
    // paid in SOL on the side, so the rate is the fee's dollar value over the swap's
    if (usd) feeBps = Math.round(feePaid.amount * price(SOL_MINT) / usd * 10000);
    // Anyone can send the treasury a few lamports alongside a swap made elsewhere.
    // Well short of the holder rate is not this site's fee, and does not count.
    if (feeBps === null || feeBps < HOLDER_SWAP_FEE_BPS * 0.8) {
      feePaid = null;
      feeBps = null;
    } else if (feeBps < (HOLDER_SWAP_FEE_BPS + SWAP_FEE_BPS) / 2) {
      savedUsd = Math.round(feePaid.amount * price(SOL_MINT) * 10000) / 10000;
    }
  } else if (feePaid) {
    const base = s.feePaid.mint === inMint ? s.spent[inMint]
      : s.feePaid.mint === outMint ? s.received[outMint] + s.feePaid.amount : 0;
    if (base > 0) feeBps = Math.round(s.feePaid.amount / base * 10000);
    if (feeBps !== null && feeBps < (HOLDER_SWAP_FEE_BPS + SWAP_FEE_BPS) / 2) {
      savedUsd = Math.round(s.feePaid.amount * price(s.feePaid.mint) * 10000) / 10000;
    }
  }

  const symbols = {};
  try {
    const res = await jupFetch(env, '/tokens/v2/search?query=' + inMint + ',' + outMint);
    for (const m of (res.ok ? await res.json() : []) || []) symbols[m.id] = m.symbol;
  } catch (e) { /* the mint is still stored; a symbol is only a label */ }

  const row = {
    signature: signature, wallet: s.wallet,
    in_mint: inMint, in_symbol: symbols[inMint] || null, in_amount: s.spent[inMint],
    out_mint: outMint, out_symbol: symbols[outMint] || null, out_amount: s.received[outMint],
    usd: usd === null ? null : Math.round(usd * 100) / 100,
    fee_mint: feePaid ? feePaid.mint : null, fee_amount: feePaid ? feePaid.amount : null,
    fee_bps: feeBps, saved_usd: savedUsd,
    ts: s.ts || Date.now()
  };
  await env.DB.prepare(
    'INSERT INTO swaps (signature, wallet, in_mint, in_symbol, in_amount, out_mint, out_symbol, out_amount, usd, fee_mint, fee_amount, fee_bps, saved_usd, ts) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(signature) DO NOTHING'
  ).bind(row.signature, row.wallet, row.in_mint, row.in_symbol, row.in_amount, row.out_mint, row.out_symbol,
    row.out_amount, row.usd, row.fee_mint, row.fee_amount, row.fee_bps, row.saved_usd, row.ts).run();
  return { ok: true, swap: row };
}

// ── WEEKLY SWAP LEADERBOARD ──
// Volume counts only swaps that paid this site's fee, so a wallet cannot pad its
// total with swaps made anywhere else. Weeks run Monday 00:00 UTC to Monday.
const WEEKLY_SWAP_PRIZES = [500, 250, 100];   // Fox Points for 1st, 2nd, 3rd
const WEEKLY_SWAP_MIN_USD = 25;               // the least a wallet must swap in a week to place

function weekStart(ts) {
  const d = new Date(ts);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * 86400000;
  return monday;
}

async function weeklySwapTop(env, start, limit) {
  const rows = await env.DB.prepare(
    'SELECT wallet, ROUND(SUM(usd), 2) AS usd, COUNT(*) AS swaps FROM swaps ' +
    'WHERE fee_mint IS NOT NULL AND usd IS NOT NULL AND ts >= ? AND ts < ? ' +
    'GROUP BY wallet ORDER BY SUM(usd) DESC LIMIT ?'
  ).bind(start, start + WEEK_MS, limit).all();
  return rows.results || [];
}

/// Records every swap that paid a fee in the last stretch, read from the fee
/// accounts themselves. The page records its own swaps as they happen, but a
/// closed tab would otherwise leave a swap off the leaderboard.
async function recordFeeAccountSwaps(env) {
  if (!env.HELIUS_API_KEY) return;
  // the treasury is where SOL-paid fees land, alongside booking and ad payments
  const watched = Object.values(SWAP_FEE_ACCOUNTS).concat(env.TREASURY_WALLET ? [env.TREASURY_WALLET] : []);
  for (const account of watched) {
    const list = await rpcCall(env, 'getSignaturesForAddress', [account, { limit: 25 }]).catch(function () { return []; });
    const sigs = (list || []).filter(function (x) { return !x.err; }).map(function (x) { return x.signature; });
    if (!sigs.length) continue;
    const marks = sigs.map(function () { return '?'; }).join(',');
    const known = await env.DB.prepare(
      'SELECT signature FROM swaps WHERE signature IN (' + marks + ') ' +
      "UNION SELECT substr(k, 9) FROM kv_cache WHERE k IN (" + marks + ')'
    ).bind(...sigs, ...sigs.map(function (s) { return 'notswap:' + s; })).all();
    const seen = new Set((known.results || []).map(function (r) { return r.signature; }));
    for (const sig of sigs) {
      if (seen.has(sig)) continue;
      const r = await recordSwap(env, sig).catch(function () { return null; });
      // a payment that is not a swap is remembered, so it is not fetched again every run
      if (r && !r.ok && r.error !== 'swap not found yet') {
        await env.DB.prepare("INSERT OR IGNORE INTO kv_cache (k, n, ts) VALUES (?, 0, ?)")
          .bind('notswap:' + sig, Date.now()).run().catch(function () {});
      }
    }
  }
}

/// Pays last week's top three once the week has closed. Each place is a row
/// keyed by week and rank, so a second run pays nothing twice. Two hours of grace
/// lets swaps from the final minutes be recorded first.
async function awardWeeklySwapPrizes(env) {
  const start = weekStart(Date.now()) - WEEK_MS;
  if (Date.now() < start + WEEK_MS + 2 * 3600000) return;
  const top = (await weeklySwapTop(env, start, WEEKLY_SWAP_PRIZES.length))
    .filter(function (r) { return r.usd >= WEEKLY_SWAP_MIN_USD; });
  const week = new Date(start).toISOString().slice(0, 10);
  for (let i = 0; i < top.length; i++) {
    const points = WEEKLY_SWAP_PRIZES[i];
    const res = await env.DB.prepare(
      'INSERT INTO swap_weekly_awards (week, rank, wallet, usd, points, ts) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(week, rank) DO NOTHING'
    ).bind(week, i + 1, top[i].wallet, top[i].usd, points, Date.now()).run();
    if (res.meta.changes !== 1) continue;
    await ensurePlayer(env, top[i].wallet);
    await addPoints(env, top[i].wallet, 'swap_weekly', points);
  }
}

async function scanWallet(env, wallet) {
  const rows = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    // "confirmed", not the RPC default "finalized": a close the page has just
    // watched confirm would otherwise still be listed for several seconds
    const res = await rpcCall(env, 'getTokenAccountsByOwner',
      [wallet, { programId: programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    for (const item of (res && res.value) || []) {
      const info = item.account.data.parsed.info;
      const amountRaw = info.tokenAmount.amount;
      const decimals = info.tokenAmount.decimals;
      rows.push({
        account: item.pubkey,
        mint: info.mint,
        programId: programId,
        amountRaw: amountRaw,
        amount: Number(info.tokenAmount.uiAmount || 0),
        decimals: decimals,
        frozen: info.state === 'frozen',
        rent: item.account.lamports,
        // one unit with no decimal places is the shape of an NFT
        nftShaped: amountRaw === '1' && decimals === 0
      });
    }
  }

  // metadata and prices for anything that still holds something — the whole
  // point is to know what you would be destroying
  const held = rows.filter(function (r) { return r.amountRaw !== '0'; });
  const mints = Array.from(new Set(held.map(function (r) { return r.mint; }))).slice(0, 200);

  let assets = {};
  if (mints.length) {
    try {
      const batch = await rpcCall(env, 'getAssetBatch', { ids: mints });
      for (const a of batch || []) {
        if (!a || !a.id) continue;
        const c = a.content || {};
        const file = (c.files || [])[0] || {};
        assets[a.id] = {
          name: (c.metadata && c.metadata.name) || null,
          symbol: (c.metadata && c.metadata.symbol) || null,
          image: file.cdn_uri || file.uri || (c.links && c.links.image) || null,
          collection: ((a.grouping || []).find(function (g) { return g.group_key === 'collection'; }) || {}).group_value || null
        };
      }
    } catch (e) { await logError(env, 'cleanup.assets', (e && e.message) || e); }
  }

  let prices = {};
  if (mints.length) {
    try { prices = await jupPrices(env, mints.slice(0, 50)); } catch (e) { /* unpriced is handled below */ }
  }

  let emptyRent = 0;
  const out = rows.map(function (r) {
    const meta = assets[r.mint] || {};
    const price = prices[r.mint] && Number(prices[r.mint].usdPrice);
    const usd = price ? r.amount * price : null;
    if (r.amountRaw === '0' && !r.frozen) emptyRent += r.rent;
    return {
      account: r.account,
      mint: r.mint,
      programId: r.programId,
      amountRaw: r.amountRaw,
      amount: r.amount,
      decimals: r.decimals,
      frozen: r.frozen,
      rent: r.rent,
      empty: r.amountRaw === '0',
      nft: r.nftShaped,
      name: meta.name || null,
      symbol: meta.symbol || null,
      image: meta.image || null,
      collection: meta.collection || null,
      usd: usd === null ? null : Math.round(usd * 100) / 100,
      priced: price ? true : false
    };
  });

  return {
    accounts: out,
    rentPerAccount: 2039280,
    emptyRentLamports: emptyRent,
    feePct: CLEANUP_FEE_PCT,
    treasury: env.TREASURY_WALLET || null,
    pointsPerBurn: BURN_POINTS_PER_ACCOUNT,
    // so the page can show what the reclaimed rent is actually worth
    solUsd: await solUsd(env)
  };
}

// ── USDC ────────────────────────────────────────────────────────────────────
// Priced in dollars, so USDC is the honest default: what the invoice says is
// what lands, with no exchange-rate risk between quote and payment. SOL stays
// available and is re-quoted at the live rate.
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;

function usdcUnits(usd) {
  return Math.round(usd * Math.pow(10, USDC_DECIMALS));
}

/// Reads a transaction once and reports what actually reached the treasury,
/// in both currencies. Callers decide which one they were expecting.
async function inspectPayment(env, signature) {
  const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'tx', method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]
    })
  });
  const data = await res.json();
  const tx = data && data.result;
  if (!tx) return { found: false, error: 'payment not found yet — try again in a moment' };
  if (tx.meta && tx.meta.err) return { found: true, error: 'that payment failed on-chain' };

  const keys = tx.transaction.message.accountKeys.map(function (k) { return k.pubkey || k; });
  const payer = keys[0];

  let sol = 0;
  const idx = keys.indexOf(env.TREASURY_WALLET);
  if (idx >= 0) sol = (tx.meta.postBalances[idx] || 0) - (tx.meta.preBalances[idx] || 0);

  // token balances are keyed by account index, and the "before" row is absent
  // entirely when the account was created by this very transaction
  const amountOf = function (rows) {
    for (const r of rows || []) {
      if (r.mint === USDC_MINT && r.owner === env.TREASURY_WALLET) {
        return Number((r.uiTokenAmount && r.uiTokenAmount.amount) || 0);
      }
    }
    return 0;
  };
  const usdc = amountOf(tx.meta.postTokenBalances) - amountOf(tx.meta.preTokenBalances);

  return { found: true, payer: payer, sol: sol, usdc: usdc };
}

/// One gate for both currencies. `wallet` null means the caller already proved
/// which invoice this is with a Solana Pay reference.
async function verifyInvoice(env, wallet, signature, minUsdc, purpose) {
  if (!env.TREASURY_WALLET) return { ok: false, error: 'payments are not switched on yet' };
  if (!signature) return { ok: false, error: 'payment required' };

  const seen = await env.DB.prepare('SELECT signature FROM payments WHERE signature = ?').bind(signature).first();
  if (seen) return { ok: false, error: 'this payment was already used' };

  const p = await inspectPayment(env, signature);
  if (!p.found || p.error) return { ok: false, error: p.error || 'payment not found yet' };
  if (wallet !== null && p.payer !== wallet) {
    return { ok: false, error: 'payment was not sent by your wallet' };
  }

  // USDC only. SOL is deliberately not accepted, even if someone sends the
  // right value by hand — bookings are priced and settled in dollars.
  if (!(p.usdc >= minUsdc)) {
    if (p.usdc === 0 && p.sol > 0) {
      return { ok: false, error: 'this was paid in SOL — bookings are USDC only. Get in touch with your reference for a refund' };
    }
    return { ok: false, error: p.usdc > 0 ? 'payment was too small' : 'payment did not go to the right wallet' };
  }

  // The check above and this insert are separate calls, so two requests racing
  // with one signature can both get here. The primary key lets only one win;
  // the loser is told plainly instead of hitting a constraint error.
  const rec = await env.DB.prepare(
    'INSERT INTO payments (signature, wallet, lamports, purpose, ts) VALUES (?, ?, ?, ?, ?) ' +
    'ON CONFLICT(signature) DO NOTHING'
  ).bind(signature, wallet || p.payer, 0, purpose + ':usdc', Date.now()).run();
  if (rec && rec.meta && rec.meta.changes === 0) return { ok: false, error: 'this payment was already used' };
  return { ok: true, currency: 'usdc', amount: p.usdc, payer: p.payer };
}

// ── BOOK THE FOX ────────────────────────────────────────────────────────────
// Three booking modes, because they are genuinely different transactions:
//   slot    — pick a time, pay now (Space, podcast, stream)
//   async   — no calendar, pay now, delivered on a turnaround (custom content)
//   enquiry — in-person work, travel included. Date and venue get agreed first, so
//             nobody pays before there is something to pay for.

const RUSH_HOURS = 48;
const RUSH_PCT = 50;
const HOLDER_DISCOUNT_PCT = 15;
const MIN_LEAD_HOURS = 24;
const HOLD_MINUTES = 20;
const BOOKING_HORIZON_DAYS = 30;

// Working hours in the fox's own timezone. Stored as local hours and resolved
// against the real zone each day, so this keeps working across daylight saving
// instead of drifting by an hour twice a year.
const BOOKING_TZ = 'America/New_York';
const DAY_OPEN_HOUR = 7;
const DAY_CLOSE_HOUR = 23;
const SLOT_STEP_MIN = 30;

/// Minutes east of UTC for `ts` in BOOKING_TZ. One call per day is enough —
/// doing it per slot would mean a thousand Intl lookups per request.
function tzOffsetMinutes(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOOKING_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ts));
  const g = {};
  for (const p of parts) g[p.type] = p.value;
  const hour = g.hour === '24' ? 0 : Number(g.hour);
  const asUtc = Date.UTC(Number(g.year), Number(g.month) - 1, Number(g.day), hour, Number(g.minute), Number(g.second));
  return Math.round((asUtc - ts) / 60000);
}

const BOOKING_TYPES = [
  {
    id: 'space', name: 'Hosted X Space', mode: 'slot', minutes: 60, price: 200,
    blurb: 'I host the Space, schedule the guests, drive the conversation and bring the foxy energy.',
    includes: [
      'Schedule compatible guests',
      'Schedule the agenda for topics of conversation and questions',
      'High foxy energy throughout the Space',
      'Promote your CTAs during the Space',
      'Assist with marketing efforts for the Space',
      'Post-Space stats provided'
    ]
  },
  {
    id: 'podcast', name: 'Hosted Podcast', mode: 'slot', minutes: 60, price: 350,
    // edited afterwards, so it is recorded rather than live
    format: 'recorded',
    blurb: 'I host your podcast, build the agenda, drive the conversation and deliver the finished edit.',
    includes: [
      'Schedule the agenda for topics of conversation and questions',
      'Host the full episode',
      'Post-production edit of the long-form video'
    ]
  },
  {
    id: 'stream', name: 'Hosted Stream', mode: 'slot', minutes: 60, price: 300,
    blurb: 'I host your stream live, build the agenda, drive the conversation and set up the visuals.',
    includes: [
      'Schedule the agenda for topics of conversation and questions',
      'Host the full stream',
      'Visual templates for the stream',
      'Goes out live — no post-production edit'
    ]
  },
  {
    id: 'custom', name: 'Custom content', mode: 'async', minutes: 0, price: 250,
    blurb: 'A content drop made for your project and posted from my account.',
    includes: [
      'Create 1× video for your project',
      'Write and publish 1× post',
      'Repost your content 3× from my account'
    ]
  },
  {
    id: 'mc', name: 'MC or speaking', mode: 'enquiry', minutes: 0, price: 1000,
    blurb: 'I MC your event, speak on stage, or host a fireside chat.',
    includes: [
      'MCing, speaking slots and fireside chats',
      'My travel is included in the fee',
      'Date and venue agreed before anything is paid'
    ]
  }
];

const BOOKING_POLICY = {
  rush: 'Booked less than ' + RUSH_HOURS + ' hours ahead? That adds ' + RUSH_PCT + '%.',
  holder: 'Hold any Moon Ranger and ' + HOLDER_DISCOUNT_PCT + '% comes off.',
  cancellation: 'Cancel more than 48 hours ahead for a full refund. Inside 48 hours ' +
    'the booking is non-refundable, because the slot is gone. If I have to cancel, you ' +
    'get everything back and first pick of a new date.',
  refunds: 'Refunds are sent back to the wallet that paid within 3 business days.',
  currency: 'Prices are in USD and paid in USDC. Your slot is held for ' +
    HOLD_MINUTES + ' minutes while you pay.'
};

function bookingType(id) {
  return BOOKING_TYPES.find(function (t) { return t.id === id; }) || null;
}

/// SOL/USD, cached for five minutes. Bookings are quoted, not streamed, so a
/// slightly stale rate is fine — the quote is locked at hold time anyway.
// Sources are tried in order. CoinGecko answers a browser fine but blocks
// Cloudflare's egress, which is exactly the kind of thing that only shows up
// in production — hence more than one, and a stale value beats none.
const SOL_PRICE_SOURCES = [
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/SOL-USD/spot',
    read: function (d) { return d && d.data && Number(d.data.amount); }
  },
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    read: function (d) { return d && d.solana && Number(d.solana.usd); }
  },
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=SOLUSD',
    read: function (d) {
      const r = d && d.result && Object.values(d.result)[0];
      return r && r.c && Number(r.c[0]);
    }
  }
];

async function solUsd(env) {
  const row = await env.DB.prepare(
    "SELECT n, ts FROM kv_cache WHERE k = 'solusd'"
  ).first().catch(function () { return null; });
  if (row && Date.now() - row.ts < 300000 && row.n > 0) return row.n / 10000;

  let price = null;
  for (const src of SOL_PRICE_SOURCES) {
    try {
      const res = await fetch(src.url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) continue;
      const v = src.read(await res.json());
      // a feed returning something absurd is worse than a feed returning nothing
      if (v && isFinite(v) && v > 1 && v < 100000) { price = v; break; }
    } catch (e) { /* try the next one */ }
  }

  if (price === null) {
    await logError(env, 'solUsd', 'every price source failed');
    return row && row.n > 0 ? row.n / 10000 : null;
  }

  await env.DB.prepare(
    "INSERT INTO kv_cache (k, n, ts) VALUES ('solusd', ?, ?) " +
    'ON CONFLICT(k) DO UPDATE SET n = excluded.n, ts = excluded.ts'
  ).bind(Math.round(price * 10000), Date.now()).run().catch(function () {});
  return price;
}

/// Candidate slots, minus anything already held or paid for. Generated from a
/// rule rather than stored, so changing the working week is a one-line edit.
async function openSlots(env, type) {
  if (!type || type.mode !== 'slot') return [];
  const now = Date.now();
  const from = now + MIN_LEAD_HOURS * 3600000;
  const until = now + BOOKING_HORIZON_DAYS * 86400000;

  const taken = await env.DB.prepare(
    "SELECT starts_at, minutes FROM bookings WHERE status IN ('held','paid','confirmed') AND starts_at > ?"
  ).bind(now).all();
  const busy = (taken.results || []).map(function (b) {
    return [b.starts_at, b.starts_at + (b.minutes || 60) * 60000];
  });

  const slots = [];
  for (let d = 0; d <= BOOKING_HORIZON_DAYS && slots.length < 400; d++) {
    // anchor on local noon so the offset is unambiguous even on a DST boundary
    const noonish = now + d * 86400000;
    const offset = tzOffsetMinutes(noonish);
    const localDayStart = Math.floor((noonish + offset * 60000) / 86400000) * 86400000;
    const open = localDayStart - offset * 60000 + DAY_OPEN_HOUR * 3600000;
    const close = localDayStart - offset * 60000 + DAY_CLOSE_HOUR * 3600000;

    for (let t = open; t + type.minutes * 60000 <= close; t += SLOT_STEP_MIN * 60000) {
      if (t < from || t > until) continue;
      const ends = t + type.minutes * 60000;
      if (busy.some(function (b) { return t < b[1] && ends > b[0]; })) continue;
      slots.push({ starts: t, ends: ends, rush: t - now < RUSH_HOURS * 3600000 });
      if (slots.length >= 400) break;
    }
  }
  slots.sort(function (a, b) { return a.starts - b.starts; });
  return slots;
}

/// Rush and holder discount are both multipliers, so the order they are applied
/// in does not change the total. What must stay in step is the breakdown the
/// payment screen draws in index.html, which is computed separately — see
/// test/booking-quote.test.mjs.
function quoteFor(type, startsAt, isHolder) {
  const base = type.price;
  const rush = type.mode === 'slot' && startsAt &&
    (startsAt - Date.now()) < RUSH_HOURS * 3600000;
  const afterRush = rush ? base * (1 + RUSH_PCT / 100) : base;
  const discount = isHolder ? HOLDER_DISCOUNT_PCT : 0;
  const total = Math.round(afterRush * (1 - discount / 100) * 100) / 100;
  return { base: base, rush: rush, rushPct: rush ? RUSH_PCT : 0, discountPct: discount, total: total };
}

async function isRangerHolder(env, wallet) {
  if (!wallet) return false;
  const row = await env.DB.prepare(
    'SELECT count FROM holder_positions WHERE wallet = ?'
  ).bind(wallet).first();
  if (row && row.count > 0) return true;
  // a Ranger locked in the vault is still held, even if the snapshot lags
  const staked = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM staked_nfts WHERE wallet = ?'
  ).bind(wallet).first();
  return !!(staked && staked.n > 0);
}

function publicBooking(b) {
  return {
    ref: b.ref,
    type: b.type_id,
    mode: b.mode,
    startsAt: b.starts_at,
    minutes: b.minutes,
    baseUsd: b.base_usd,
    rushPct: b.rush_pct,
    discountPct: b.discount_pct,
    totalUsd: b.total_usd,
    lamports: b.lamports,
    status: b.status,
    signature: b.signature,
    name: b.name,
    createdAt: b.created_at,
    paidAt: b.paid_at
  };
}

// What "taken" means, written once so the calendar, a hold and settlement
// cannot disagree. Each is a subquery bound as (?end, ?start) for the time a
// candidate would occupy. A booking holds its hour, and an ad campaign its run,
// while held or paid.
const OVERLAPS_LIVE_BOOKING =
  "SELECT 1 FROM bookings o WHERE o.status IN ('held','paid','confirmed') " +
  'AND o.starts_at IS NOT NULL AND o.starts_at < ? AND o.starts_at + COALESCE(o.minutes, 60) * 60000 > ?';
const OVERLAPS_LIVE_BANNER =
  "SELECT 1 FROM banner_bookings o WHERE o.status IN ('held','paid') AND o.starts_at < ? AND o.ends_at > ?";

// How far back the scheduled sweep looks for payments nobody was watching for.
const RECONCILE_HOURS = 48;

// Bookings and ad campaigns are paid for and settled identically. They differ
// only in where they are stored, what time they occupy, and what you are told.
const CHECKOUTS = {
  booking: {
    table: 'bookings',
    purpose: 'booking:',
    overlap: OVERLAPS_LIVE_BOOKING,
    endOf: function (b) { return b.starts_at ? b.starts_at + (b.minutes || 60) * 60000 : null; },
    bookedAlert: function (b) {
      return '📅 New booking ' + b.ref + ' — ' + b.type_id + ' — $' + b.total_usd +
        (b.starts_at ? ' on ' + new Date(b.starts_at).toISOString() : '') + '\n' + b.name + ' · ' + b.contact;
    }
  },
  banner: {
    table: 'banner_bookings',
    purpose: 'banner:',
    overlap: OVERLAPS_LIVE_BANNER,
    endOf: function (b) { return b.ends_at; },
    bookedAlert: function (b) {
      return '🪧 Ad slot booked ' + b.ref + ' — ' + b.weeks + ' week(s), $' + b.total_usd +
        ' from ' + new Date(b.starts_at).toISOString().slice(0, 10) +
        '\n' + b.name + ' · ' + b.contact + '\nAwaiting creative, then your approval.';
    }
  }
};

/// Settles money found for a booking or an ad campaign — from the page polling,
/// the wallet confirming, or the scheduled sweep. The payment is recorded first,
/// so it can never go missing whatever happens to the booking.
///
/// A hold that expired before the money was noticed is honoured if its time is
/// still ahead and nobody else has taken it. Otherwise it is marked `refund`
/// and flagged, because the customer paid and did not get what they paid for.
async function settlePayment(env, kind, b, signature, wallet) {
  const purpose = kind.purpose + b.ref;
  const v = await verifyInvoice(env, wallet, signature, usdcUnits(b.total_usd), purpose);
  if (!v.ok) {
    // a concurrent request may have settled this exact payment a moment ago
    const cur = await env.DB.prepare('SELECT status, signature FROM ' + kind.table + ' WHERE ref = ?').bind(b.ref).first();
    if (cur && (cur.status === 'paid' || cur.status === 'refund') && cur.signature === signature) {
      return { status: cur.status };
    }
    // ...or be part-way through doing so: the payment is recorded against this
    // booking but the booking is not updated yet. That is not a failure.
    const rec = await env.DB.prepare('SELECT purpose FROM payments WHERE signature = ?').bind(signature).first();
    if (rec && rec.purpose === purpose + ':usdc') return { status: 'settling' };
    return { status: 'unpaid', error: v.error };
  }

  const now = Date.now();
  const late = b.status !== 'held';
  const honoured = await env.DB.prepare(
    'UPDATE ' + kind.table + " SET status = 'paid', signature = ?, paid_at = ?, wallet = COALESCE(wallet, ?) " +
    "WHERE ref = ? AND (status = 'held' OR (status = 'expired' AND " +
    '(starts_at IS NULL OR (starts_at > ? AND NOT EXISTS (' + kind.overlap + ')))))'
  ).bind(signature, now, v.payer, b.ref, now, kind.endOf(b), b.starts_at).run();

  if (honoured.meta.changes === 1) {
    await alert(env, kind.bookedAlert(b) +
      (late ? '\nPaid after its hold ended — the time was still free, so it is booked.' : ''));
    return { status: 'paid', late: late };
  }

  const refunded = await env.DB.prepare(
    'UPDATE ' + kind.table + " SET status = 'refund', signature = ?, paid_at = ?, wallet = COALESCE(wallet, ?) " +
    "WHERE ref = ? AND status = 'expired'"
  ).bind(signature, now, v.payer, b.ref).run();
  if (refunded.meta.changes !== 1) {
    const cur = await env.DB.prepare('SELECT status FROM ' + kind.table + ' WHERE ref = ?').bind(b.ref).first();
    await alert(env, '⚠️ Payment recorded for ' + b.ref + ' but it was already ' +
      (cur ? cur.status : 'gone') + ' — check whether a refund is owed. signature ' + signature);
    return { status: cur ? cur.status : 'unpaid' };
  }
  await alert(env, '💸 Refund needed — ' + b.ref + ' — $' + b.total_usd + ' USDC from ' + v.payer +
    '\nPaid after the hold ended, and that time had been taken or had passed.\n' +
    b.name + ' · ' + b.contact + '\nsignature ' + signature);
  return { status: 'refund' };
}

/// The payment page only watches while it is open. This finds payments made
/// after it closed — or after it stopped looking — so "the payment is still
/// found" is true. Runs from the scheduled handler.
async function reconcilePayments(env) {
  if (!env.TREASURY_WALLET || !env.HELIUS_API_KEY) return;
  for (const kind of [CHECKOUTS.booking, CHECKOUTS.banner]) {
    const rows = await env.DB.prepare(
      'SELECT * FROM ' + kind.table + " WHERE status IN ('held','expired') AND reference IS NOT NULL " +
      'AND created_at > ? ORDER BY created_at DESC LIMIT 50'
    ).bind(Date.now() - RECONCILE_HOURS * 3600000).all();
    for (const b of rows.results || []) {
      const sig = await findPaymentByReference(env, b.reference);
      if (sig) await settlePayment(env, kind, b, sig, null);
    }
  }
}

/// Answers the payment page's poll. The payer may never have touched this site,
/// so the chain is checked by the booking's reference.
async function watchPayment(request, env, kind, ref) {
  const b = await env.DB.prepare('SELECT * FROM ' + kind.table + ' WHERE ref = ?').bind(ref).first();
  if (!b) return json(request, env, { error: 'no booking with that reference' }, 404);
  if (b.status === 'paid' || b.status === 'refund') {
    return json(request, env, { status: b.status, signature: b.signature });
  }
  // an expired hold is still looked at for a while: the money may have left
  // the customer's wallet just as the hold ran out
  const recent = b.created_at > Date.now() - RECONCILE_HOURS * 3600000;
  if (b.status !== 'held' && !(b.status === 'expired' && recent)) {
    return json(request, env, { status: b.status });
  }
  const unpaid = b.status === 'held' ? 'waiting' : 'expired';

  const sig = await findPaymentByReference(env, b.reference);
  if (!sig) return json(request, env, { status: unpaid });

  const s = await settlePayment(env, kind, b, sig, null);
  if (s.status === 'unpaid') return json(request, env, { status: unpaid, note: s.error });
  if (s.status === 'settling') return json(request, env, { status: unpaid });
  return json(request, env, { status: s.status, signature: sig });
}

function bookingRef() {
  const s = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = 'FOX-';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += s[b % s.length];
  return out;
}


// ── ADVERTISING SLOT ────────────────────────────────────────────────────────
// Paying does not put an ad live. A stranger's creative would publish under
// the fox's name and next to his wallet connect, so every booking waits on
// approval — and is refundable until it runs.

const BANNER_RATES = [
  { weeks: 1, price: 250 },
  { weeks: 2, price: 450 },
  { weeks: 4, price: 800 }
];

function bannerRate(weeks) {
  return BANNER_RATES.find(function (r) { return r.weeks === Number(weeks); }) || null;
}

const BANNER_LEAD_MS = 86400000; // a day, so creative can be reviewed before it runs
const WEEK_MS = 7 * 86400000;

/// The earliest start, at least a day out, where a run of `weeks` fits without
/// overlapping a held or paid run. It used to be "when the last run ends",
/// which left the banner empty wherever an abandoned hold dropped out of the
/// queue. A run can only start at the lead-time boundary or where another run
/// ends, so those are the only starts worth trying.
///
/// A gap left by an expired hold is always a little shorter than the run that
/// left it — anyone booking later also starts later — so it is filled by a
/// shorter run, not a same-length one. Queued runs are never moved earlier:
/// those are dates people have already been given.
function earliestBannerStart(runs, soonest, weeks) {
  const len = weeks * WEEK_MS;
  const starts = [soonest].concat(runs.map(function (r) { return r.ends_at; })
    .filter(function (e) { return e > soonest; })).sort(function (a, b) { return a - b; });
  for (const s of starts) {
    if (!runs.some(function (r) { return s < r.ends_at && s + len > r.starts_at; })) return s;
  }
  return starts[starts.length - 1]; // not reached: nothing overlaps after the last run ends
}

async function bannerRuns(env, soonest) {
  const rows = await env.DB.prepare(
    "SELECT starts_at, ends_at FROM banner_bookings WHERE status IN ('held','paid') AND ends_at > ?"
  ).bind(soonest).all();
  return rows.results || [];
}

async function bannerNextFree(env, weeks) {
  const soonest = Date.now() + BANNER_LEAD_MS;
  return earliestBannerStart(await bannerRuns(env, soonest), soonest, weeks);
}

async function bannerLive(env) {
  const now = Date.now();
  return await env.DB.prepare(
    "SELECT ref, sponsor, headline, url, image_url, starts_at, ends_at FROM banner_bookings " +
    "WHERE status = 'paid' AND approved = 1 AND starts_at <= ? AND ends_at > ? " +
    'ORDER BY starts_at ASC LIMIT 1'
  ).bind(now, now).first();
}

// exposed for the tests: address derivation is maths that must be checked
// against addresses Jupiter itself created
export const _internals = { derivedFeeAccount, programAddress, isOnCurve, b58ToBytes, bytesToB58 };

export default {
  /// Runs on a schedule so an outage is reported rather than stumbled upon.
  /// Alerts only on a change of state, so a long outage does not spam.
  async scheduled(event, env, ctx) {
    // analytics first: a failure here is logged, never fatal, and must not
    // stop the health check from running
    ctx.waitUntil(refreshAnalytics(env).catch(function () {}));
    // record site swaps first, then pay out a closed week from complete numbers
    ctx.waitUntil(recordFeeAccountSwaps(env).then(function () { return awardWeeklySwapPrizes(env); }).catch(function (e) {
      return logError(env, 'swapWeekly', e && e.message);
    }));
    ctx.waitUntil(reconcilePayments(env).catch(function (e) {
      return logError(env, 'reconcilePayments', e && e.message);
    }));

    const h = await healthCheck(env);
    let previous = null;
    try {
      const row = await env.DB.prepare('SELECT ok FROM health_log ORDER BY ts DESC LIMIT 1').first();
      previous = row ? !!row.ok : null;
    } catch (e) { /* first run */ }

    try {
      await env.DB.prepare('INSERT INTO health_log (ts, ok, detail) VALUES (?, ?, ?)')
        .bind(Date.now(), h.ok ? 1 : 0, JSON.stringify(h.detail)).run();
      // keep a week
      await env.DB.prepare('DELETE FROM health_log WHERE ts < ?').bind(Date.now() - 7 * 86400000).run();
    } catch (e) { /* nothing useful to do here */ }

    if (previous !== null && previous !== h.ok) {
      await alert(env, h.ok
        ? '✅ solquicks points API recovered.\n' + JSON.stringify(h.detail)
        : '🔴 solquicks points API is unhealthy.\n' + JSON.stringify(h.detail));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      ctx.waitUntil(sweepExpired(env));
      // An abandoned checkout must not hold a slot hostage. For the ad slot this
      // matters even more: the next campaign starts when the last held or paid
      // one ends, so one abandoned four-week hold would push every later
      // advertiser back four weeks, for good.
      ctx.waitUntil(env.DB.prepare(
        "UPDATE bookings SET status = 'expired' WHERE status = 'held' AND hold_until < ?"
      ).bind(Date.now()).run().catch(function () {}));
      ctx.waitUntil(env.DB.prepare(
        "UPDATE banner_bookings SET status = 'expired' WHERE status = 'held' AND hold_until < ?"
      ).bind(Date.now()).run().catch(function () {}));



      // public routes are limited by IP before any work is done
      if (path === '/api/img' || path === '/api/leaderboard' ||
          path === '/api/mission/draw' || path === '/api/analytics' ||
          path === '/api/analytics/wallet' || path === '/api/collection' ||
          path === '/api/collection/sales' || path === '/api/store' ||
          path === '/api/booking/types' ||
          path === '/api/booking/slots' || path === '/api/booking/hold' ||
          path === '/api/booking/confirm' || path === '/api/booking/lookup' ||
          path === '/api/banner/rates' || path === '/api/banner/live' ||
          path === '/api/banner/hold' || path === '/api/banner/confirm' ||
          path === '/api/banner/creative' || path === '/api/booking/watch' ||
          path === '/api/banner/watch' || path === '/api/swap/tokens' ||
          path === '/api/swap/quote' || path === '/api/swap/build' ||
          path === '/api/swap/earned' || path === '/api/swap/search' ||
          path === '/api/swap/top' ||
          path === '/api/swap/prices' || path === '/api/swap/failed' ||
          path === '/api/cleanup/scan' ||
          path === '/api/swap/holdings' || path === '/api/swap/record' ||
          path === '/api/swap/history' || path === '/api/swap/token' ||
          path === '/api/swap/leaderboard' ||
          path === '/api/nonce' || path === '/api/session' ||
          path === '/api/banner/event' || path === '/api/banner/stats') {
        if (await rateLimited(request, env, path, null)) return tooMany(request, env);
      }

      // Every admin route, throttled before the token is even looked at, so the
      // secret cannot be guessed at speed.
      if (path.startsWith('/api/admin/')) {
        if (await rateLimited(request, env, 'admin:*', null)) return tooMany(request, env);
      }

      // ── public: Ranger artwork ──
      // IPFS gateways serve a 403 challenge to browser User-Agents, so the
      // image has to be fetched server-side. Deliberately keyed by MINT, not
      // by URL: the source is read from on-chain metadata and must belong to
      // the configured collection, so this can never be used to proxy
      // arbitrary content.
      if (path === '/api/img' && request.method === 'GET') {
        const mint = url.searchParams.get('mint');
        if (!isWallet(mint)) return new Response('bad mint', { status: 400 });
        if (!env.HELIUS_API_KEY) return new Response('unavailable', { status: 503 });

        const cache = caches.default;
        const cacheKey = new Request(new URL('/api/img?v=' + BUILD + '&mint=' + mint, url.origin).toString(), request);
        const hit = await cache.match(cacheKey);
        if (hit) return hit;

        const assetRes = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'getAsset', params: { id: mint } })
        });
        const asset = await assetRes.json();
        const result = asset && asset.result;
        if (!result) return new Response('not found', { status: 404 });

        const inCollection = (result.grouping || []).some(function (g) {
          return g.group_key === 'collection' && g.group_value === env.MOON_RANGERS_COLLECTION;
        });
        if (!inCollection) return new Response('not a Moon Ranger', { status: 403 });

        const files = (result.content && result.content.files) || [];
        const src = (files[0] && files[0].uri) ||
          (result.content && result.content.links && result.content.links.image);
        if (!src || !/^https:\/\//.test(src)) return new Response('no image', { status: 404 });

        // Individual files are not always well pinned, so try several gateways
        // rather than trusting whichever one the metadata happens to name.
        // No browser User-Agent here, so gateways serve the real bytes.
        const imgRes = await fetchFirstAvailable(src);
        if (!imgRes) {
          // cache the miss briefly so a missing file is not re-fetched on every view
          const miss = new Response('artwork unavailable', {
            status: 502,
            headers: { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' }
          });
          ctx.waitUntil(cache.put(cacheKey, miss.clone()));
          return miss;
        }

        const out = new Response(imgRes.body, {
          status: 200,
          headers: {
            'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*'
          }
        });
        ctx.waitUntil(cache.put(cacheKey, out.clone()));
        return out;
      }

      // ── banner delivery stats ──
      // Counts only. No IPs, no cookies, no third party — just enough to tell
      // an advertiser what they got, and to know what the slot is worth.
      if (path === '/api/banner/event' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const slot = String(body.slot || '').slice(0, 64);
        const kind = body.kind === 'click' ? 'clicks' : 'views';
        if (!slot) return json(request, env, { ok: false }, 400);
        const day = new Date().toISOString().slice(0, 10);
        await env.DB.prepare(
          'INSERT INTO banner_stats (slot, day, ' + kind + ') VALUES (?, ?, 1) ' +
          'ON CONFLICT(slot, day) DO UPDATE SET ' + kind + ' = ' + kind + ' + 1'
        ).bind(slot, day).run();
        return json(request, env, { ok: true });
      }

      // what a booking actually delivered, for reporting back to a sponsor
      if (path === '/api/banner/stats' && request.method === 'GET') {
        const slot = url.searchParams.get('slot');
        const rows = slot
          ? await env.DB.prepare(
              'SELECT slot, day, views, clicks FROM banner_stats WHERE slot = ? ORDER BY day DESC LIMIT 60'
            ).bind(slot).all()
          : await env.DB.prepare(
              'SELECT slot, SUM(views) AS views, SUM(clicks) AS clicks, MIN(day) AS first_day, MAX(day) AS last_day ' +
              'FROM banner_stats GROUP BY slot ORDER BY last_day DESC LIMIT 50'
            ).all();
        const out = rows.results || [];
        const totals = out.reduce(function (a, r) {
          a.views += r.views || 0; a.clicks += r.clicks || 0; return a;
        }, { views: 0, clicks: 0 });
        totals.ctr = totals.views ? +(100 * totals.clicks / totals.views).toFixed(2) : 0;
        return json(request, env, { rows: out, totals: totals });
      }

      // ── admin: mission configuration and settlement ──
      if (path.startsWith('/api/admin/mission') && request.method === 'POST') {
        const auth = request.headers.get('Authorization') || '';
        if (!tokenMatches(auth, env.ADMIN_TOKEN)) {
          return json(request, env, { error: 'not authorised' }, 401);
        }
        const body = await request.json().catch(function () { return {}; });
        const mission = await currentMission(env);

        if (path === '/api/admin/mission/configure') {
          await env.DB.prepare('UPDATE missions SET sponsor = ?, prize = ? WHERE id = ?')
            .bind(body.sponsor || null, body.prize || null, body.missionId || mission.id).run();
          return json(request, env, { ok: true });
        }

        // Settlement: snapshot everyone's weight, then issue the guaranteed
        // rewards. The draw for headline prizes is a separate step so the
        // randomness can be published with a proof.
        if (path === '/api/admin/mission/settle') {
          const target = body.missionId || mission.id;
          const m = await env.DB.prepare('SELECT * FROM missions WHERE id = ?').bind(target).first();
          if (!m) return json(request, env, { error: 'no such mission' }, 404);

          const wallets = await env.DB.prepare(
            'SELECT DISTINCT wallet FROM staked_nfts'
          ).all();

          const pointsPool = Math.max(0, Math.floor(Number(body.pointsPool) || 0));
          const rows = [];
          let totalTickets = 0;
          for (const w of (wallets.results || [])) {
            const s = await missionStanding(env, w.wallet, m);
            if (s.tickets <= 0) continue;
            rows.push({ wallet: w.wallet, s: s });
            totalTickets += s.tickets;
          }

          for (const r of rows) {
            await env.DB.prepare(
              'INSERT INTO mission_results (mission_id, wallet, tickets, rangers, ranger_days, streak) ' +
              'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(mission_id, wallet) DO UPDATE SET ' +
              'tickets=excluded.tickets, rangers=excluded.rangers, ranger_days=excluded.ranger_days, streak=excluded.streak'
            ).bind(target, r.wallet, r.s.tickets, r.s.rangers, r.s.rangerDays, r.s.streak).run();

            // guaranteed share of the points pool, proportional to weight
            if (pointsPool > 0 && totalTickets > 0) {
              const share = Math.floor(pointsPool * (r.s.tickets / totalTickets));
              if (share > 0) {
                await env.DB.prepare(
                  'INSERT INTO mission_rewards (mission_id, wallet, kind, amount, detail) VALUES (?, ?, ?, ?, ?)'
                ).bind(target, r.wallet, 'points', share, m.label + ' — guaranteed share').run();
              }
            }
          }

          await env.DB.prepare("UPDATE missions SET status = 'settled' WHERE id = ?").bind(target).run();
          return json(request, env, { mission: target, entrants: rows.length, totalTickets: totalTickets });
        }

        // Freeze the entry list. Runs before any randomness exists; the hash
        // it returns is what gets committed on-chain.
        if (path === '/api/admin/mission/snapshot') {
          const missionId = body.missionId || mission.id;
          const winnerCount = Math.max(1, Math.min(64, Number(body.winnerCount) || 3));
          const existing = await env.DB.prepare(
            'SELECT snapshot_hash FROM mission_draws WHERE mission_id = ?'
          ).bind(missionId).first();
          if (existing) {
            return json(request, env, { error: 'already snapshotted', snapshotHash: existing.snapshot_hash }, 409);
          }
          const snap = await drawSnapshot(env, missionId);
          if (snap.total <= 0) return json(request, env, { error: 'no entries to draw from' }, 400);

          await env.DB.prepare(
            'INSERT INTO mission_draws (mission_id, snapshot, snapshot_hash, total_tickets, winner_count, created_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(missionId, snap.text, snap.hash, snap.total, winnerCount, Date.now()).run();

          return json(request, env, {
            mission: missionId,
            snapshotHash: snap.hash,
            totalTickets: snap.total,
            entrants: snap.entries.length,
            winnerCount: winnerCount,
            commitWith: { programId: DRAW_PROGRAM_ID, mission: missionId }
          });
        }

        // Record the on-chain accounts once the commit lands.
        if (path === '/api/admin/mission/draw-account') {
          await env.DB.prepare(
            'UPDATE mission_draws SET draw_account = ?, commit_signature = ? WHERE mission_id = ?'
          ).bind(body.drawAccount || null, body.signature || null, body.missionId || mission.id).run();
          return json(request, env, { ok: true });
        }

        // Randomness has landed on-chain: reproduce the winners from it and
        // hand each one a claimable reward.
        if (path === '/api/admin/mission/winners') {
          const missionId = body.missionId || mission.id;
          const row = await env.DB.prepare(
            'SELECT * FROM mission_draws WHERE mission_id = ?'
          ).bind(missionId).first();
          if (!row) return json(request, env, { error: 'snapshot the mission first' }, 404);
          if (row.winners) return json(request, env, { error: 'winners already drawn', winners: JSON.parse(row.winners) }, 409);

          const randomness = String(body.randomness || '').replace(/^0x/, '').toLowerCase();
          if (!/^[0-9a-f]{64}$/.test(randomness)) {
            return json(request, env, { error: 'randomness must be 32 bytes of hex from the on-chain draw account' }, 400);
          }
          if (/^0+$/.test(randomness)) {
            return json(request, env, { error: 'randomness is still unset on-chain' }, 400);
          }

          const winners = selectWinners(randomness, row.snapshot, row.winner_count);
          const prizes = Array.isArray(body.prizes) ? body.prizes : [];

          await env.DB.prepare(
            'UPDATE mission_draws SET randomness = ?, winners = ?, fulfill_signature = ?, drawn_at = ? WHERE mission_id = ?'
          ).bind(randomness, JSON.stringify(winners), body.signature || null, Date.now(), missionId).run();

          for (const w of winners) {
            const prize = prizes[w.rank - 1] || {};
            await env.DB.prepare(
              'INSERT INTO mission_rewards (mission_id, wallet, kind, amount, detail) VALUES (?, ?, ?, ?, ?)'
            ).bind(
              missionId,
              w.wallet,
              prize.kind || 'prize',
              Math.max(0, Math.floor(Number(prize.amount) || 0)),
              prize.detail || (missionId + ' \u2014 draw winner #' + w.rank)
            ).run();
          }

          return json(request, env, { mission: missionId, randomness: randomness, winners: winners });
        }

        return json(request, env, { error: 'unknown admin action' }, 404);
      }

      // ── health ──
      if (path === '/api/health' && request.method === 'GET') {
        const h = await healthCheck(env);
        h.build = BUILD;
        return json(request, env, h, h.ok ? 200 : 503);
      }

      if (path === '/api/admin/banner' && request.method === 'GET') {
        const auth = request.headers.get('Authorization') || '';
        if (!tokenMatches(auth, env.ADMIN_TOKEN)) {
          return json(request, env, { error: 'not authorised' }, 401);
        }
        const rows = await env.DB.prepare(
          "SELECT * FROM banner_bookings WHERE status IN ('paid','refund') ORDER BY starts_at ASC"
        ).all();
        return json(request, env, { bookings: rows.results || [] });
      }

      if (path === '/api/admin/banner/approve' && request.method === 'POST') {
        const auth = request.headers.get('Authorization') || '';
        if (!tokenMatches(auth, env.ADMIN_TOKEN)) {
          return json(request, env, { error: 'not authorised' }, 401);
        }
        const body = await request.json().catch(function () { return {}; });
        const ref = String(body.ref || '').trim();
        const ok = body.approved ? 1 : 0;
        const r = await env.DB.prepare(
          'UPDATE banner_bookings SET approved = ? WHERE ref = ?'
        ).bind(ok, ref).run();
        if (!r.meta || r.meta.changes === 0) return json(request, env, { error: 'no such booking' }, 404);
        return json(request, env, { ok: true, ref: ref, approved: !!ok });
      }

      // ── admin: plushie codes ──
      // One code per real order. Generated here rather than derived from the
      // order number so that knowing someone's order number is not enough to
      // claim their points.
      if (path === '/api/admin/plushie/codes' && request.method === 'POST') {
        const auth = request.headers.get('Authorization') || '';
        if (!tokenMatches(auth, env.ADMIN_TOKEN)) {
          return json(request, env, { error: 'not authorised' }, 401);
        }
        const body = await request.json().catch(function () { return {}; });
        const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 50);
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
        const made = [];
        for (let i = 0; i < count; i++) {
          const bytes = crypto.getRandomValues(new Uint8Array(10));
          let code = 'FOX-';
          for (let j = 0; j < 10; j++) {
            if (j === 5) code += '-';
            code += alphabet[bytes[j] % alphabet.length];
          }
          await env.DB.prepare(
            'INSERT INTO plushie_codes (code, note, created_at) VALUES (?, ?, ?)'
          ).bind(code, body.note || null, Date.now()).run();
          made.push(code);
        }
        return json(request, env, { codes: made });
      }

      if (path === '/api/admin/plushie/codes' && request.method === 'GET') {
        const auth = request.headers.get('Authorization') || '';
        if (!tokenMatches(auth, env.ADMIN_TOKEN)) {
          return json(request, env, { error: 'not authorised' }, 401);
        }
        const rows = await env.DB.prepare(
          'SELECT code, note, created_at, redeemed_by, redeemed_at FROM plushie_codes ORDER BY created_at DESC LIMIT 200'
        ).all();
        return json(request, env, { codes: rows.results || [] });
      }

      if (path === '/api/admin/bookings' && request.method === 'GET') {
        const auth = request.headers.get('Authorization') || '';
        if (!tokenMatches(auth, env.ADMIN_TOKEN)) {
          return json(request, env, { error: 'not authorised' }, 401);
        }
        const rows = await env.DB.prepare(
          "SELECT * FROM bookings WHERE status IN ('paid','enquiry','refund') ORDER BY " +
          'COALESCE(starts_at, created_at) ASC LIMIT 200'
        ).all();
        return json(request, env, { bookings: rows.results || [] });
      }

      // ── admin: full export ──
      // Cloudflare keeps 30 days of point-in-time recovery, so this is for
      // holding a copy outside the account entirely.
      if (path === '/api/admin/export' && request.method === 'GET') {
        const auth = request.headers.get('Authorization') || '';
        if (!tokenMatches(auth, env.ADMIN_TOKEN)) {
          return json(request, env, { error: 'not authorised' }, 401);
        }
        const dump = {};
        for (const t of ['players', 'events', 'stakes', 'staked_nfts', 'banner_stats', 'payments', 'flips']) {
          const r = await env.DB.prepare('SELECT * FROM ' + t).all();
          dump[t] = r.results || [];
        }
        dump._exportedAt = new Date().toISOString();
        return new Response(JSON.stringify(dump, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="solquicks-points-' +
              new Date().toISOString().slice(0, 10) + '.json"'
          }
        });
      }

      // ── public: holder analytics ──
      if (path === '/api/analytics' && request.method === 'GET') {
        const cache = caches.default;
        const key = new Request(new URL('/api/analytics', url.origin).toString(), request);
        const hit = await cache.match(key);
        if (hit) return hit;

        const payload = await analyticsPayload(env);
        const res = json(request, env, payload);
        // the snapshot only moves on the cron, so a minute of edge cache is free
        const cached = new Response(res.body, res);
        cached.headers.set('Cache-Control', 'public, max-age=60');
        ctx.waitUntil(cache.put(key, cached.clone()));
        return cached;
      }

      // One wallet's standing. Rank is dense over holdings, so ties share it.
      // The whole collection with traits and rarity, for browsing. One heavy read
      // behind six hours of cache: the traits only change if the metadata does.
      if (path === '/api/collection' && request.method === 'GET') {
        if (!env.HELIUS_API_KEY || !env.MOON_RANGERS_COLLECTION) {
          return json(request, env, { error: 'collection lookups are not switched on' }, 503);
        }
        const cache = caches.default;
        const key = new Request(new URL('/api/collection?v=' + BUILD, url.origin).toString(), request);
        const hit = await cache.match(key);
        if (hit) return hit;

        let col;
        try {
          col = await collectionData(env);
        } catch (e) {
          await logError(env, 'collection', (e && e.message) || e);
          return json(request, env, { error: 'could not read the collection just now' }, 502);
        }
        const res = json(request, env, {
          total: col.total,
          traits: col.traits,
          rangers: col.rangers.map(function (r) {
            return { mint: r.mint, name: r.name, image: r.image, imageAlt: r.imageAlt, rank: r.rank, traits: r.traits };
          })
        });
        const cached = new Response(res.body, res);
        cached.headers.set('Cache-Control', 'public, max-age=21600');
        ctx.waitUntil(cache.put(key, cached.clone()));
        return cached;
      }

      // How many plushies are left, from the shop rather than from memory.
      if (path === '/api/store' && request.method === 'GET') {
        const cache = caches.default;
        const key = new Request(new URL('/api/store', url.origin).toString(), request);
        const hit = await cache.match(key);
        if (hit) return hit;

        let product = null;
        try {
          product = await storeProduct();
        } catch (e) {
          await logError(env, 'store', (e && e.message) || e);
          return json(request, env, { unavailable: true });
        }
        if (!product) return json(request, env, { unavailable: true });
        const res = json(request, env, { product: product });
        const cached = new Response(res.body, res);
        cached.headers.set('Cache-Control', 'public, max-age=600');
        ctx.waitUntil(cache.put(key, cached.clone()));
        return cached;
      }

      // What Rangers have actually sold for lately, from the marketplace.
      if (path === '/api/collection/sales' && request.method === 'GET') {
        const cache = caches.default;
        const key = new Request(new URL('/api/collection/sales', url.origin).toString(), request);
        const hit = await cache.match(key);
        if (hit) return hit;

        let sales = [];
        try {
          sales = await recentSales(env, 8);
        } catch (e) {
          await logError(env, 'collection.sales', (e && e.message) || e);
          return json(request, env, { sales: [], unavailable: true });
        }
        const res = json(request, env, { sales: sales });
        const cached = new Response(res.body, res);
        cached.headers.set('Cache-Control', 'public, max-age=600');
        ctx.waitUntil(cache.put(key, cached.clone()));
        return cached;
      }

      if (path === '/api/analytics/wallet' && request.method === 'GET') {
        const who = url.searchParams.get('address');
        if (!isWallet(who)) return json(request, env, { error: 'not a wallet address' }, 400);

        const pos = await env.DB.prepare(
          'SELECT count, first_seen FROM holder_positions WHERE wallet = ?'
        ).bind(who).first();
        if (!pos) return json(request, env, { wallet: who, holds: 0, rank: null, staked: 0 });

        const ahead = await env.DB.prepare(
          'SELECT COUNT(DISTINCT count) AS n FROM holder_positions WHERE count > ?'
        ).bind(pos.count).first();
        const staked = await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM staked_nfts WHERE wallet = ?'
        ).bind(who).first();
        const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM holder_positions').first();

        return json(request, env, {
          wallet: who,
          holds: pos.count,
          rank: ((ahead && ahead.n) || 0) + 1,
          ofHolders: (total && total.n) || 0,
          staked: (staked && staked.n) || 0,
          firstSeen: pos.first_seen
        });
      }

      // Wallets report failures in their own words, and some of those words are
      // useless ("Internal error"). Recording them is the only way to find out
      // what actually went wrong for someone else.
      if (path === '/api/swap/failed' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        await logError(env, 'swap.client', JSON.stringify({
          message: String(body.message || '').slice(0, 240),
          in: String(body.inMint || '').slice(0, 44),
          out: String(body.outMint || '').slice(0, 44),
          wallet: String(body.wallet || '').slice(0, 44)
        }));
        return json(request, env, { ok: true });
      }

      if (path === '/api/swap/search' && request.method === 'GET') {
        const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
        if (q.length < 2) return json(request, env, { tokens: [] });
        const res = await jupFetch(env, '/tokens/v2/search?query=' + encodeURIComponent(q));
        if (!res.ok) return json(request, env, { tokens: [] });
        const list = await res.json().catch(function () { return []; });

        // Trimmed to what a person needs to judge a token before swapping into
        // it. The warnings are the point of this endpoint, not a footnote.
        return json(request, env, {
          tokens: (Array.isArray(list) ? list : []).slice(0, 20).map(function (t) {
            const warnings = tokenWarnings(t);
            return {
              mint: t.id, symbol: t.symbol, name: t.name, decimals: t.decimals,
              icon: t.icon || null, verified: !!t.isVerified,
              score: t.organicScoreLabel || null,
              usdPrice: t.usdPrice || null,
              liquidity: t.liquidity || 0,
              warnings: warnings
            };
          })
        });
      }

      if (path === '/api/swap/prices' && request.method === 'GET') {
        const ids = String(url.searchParams.get('ids') || '').split(',')
          .filter(isWallet).slice(0, 10);
        if (!ids.length) return json(request, env, { prices: {} });
        const out = await jupPrices(env, ids);
        const prices = {};
        for (const [mint, v] of Object.entries(out || {})) {
          if (v && v.usdPrice) prices[mint] = Number(v.usdPrice);
        }
        return json(request, env, { prices: prices });
      }

      // Each scan costs several Helius calls, and the route is public because
      // the feature is worth trying before connecting anything. Two guards keep
      // that from becoming a way to burn the credit balance: a short cache, so
      // re-scanning the same wallet is free, and a global hourly ceiling, which
      // a rotating proxy pool cannot sidestep the way it sidesteps a per-IP
      // limit. Running out of credits would break holder analytics and the
      // Ranger grid for everyone, so the ceiling fails closed with a clear
      // message rather than quietly draining.
      if (path === '/api/cleanup/scan' && request.method === 'GET') {
        const who = url.searchParams.get('wallet');
        if (!isWallet(who)) return json(request, env, { error: 'not a wallet address' }, 400);
        if (!env.HELIUS_API_KEY) return json(request, env, { error: 'unavailable' }, 503);

        const cache = caches.default;
        const cacheKey = new Request(
          new URL('/api/cleanup/scan?v=' + BUILD + '&wallet=' + who, url.origin).toString(),
          request
        );
        // Rebuild the response from the cached body so the CORS header is always
        // computed for this caller. Replaying a stored response would hand back
        // whichever origin populated the cache - a miss from a foreign origin
        // would then be served, header-less, to the real site.
        // After closing or burning, the page asks for a fresh read. Serving the
        // cached one showed the accounts it had just closed as still there.
        if (url.searchParams.get('fresh') !== '1') {
          const hit = await cache.match(cacheKey);
          if (hit) return json(request, env, await hit.json());
        }

        if (await rateLimited(request, env, 'scan:global', null)) {
          return json(request, env, {
            error: 'wallet scanning is busy right now — try again in a few minutes'
          }, 503);
        }

        try {
          const result = await scanWallet(env, who);
          const res = json(request, env, result);
          const cached = new Response(res.body, res);
          cached.headers.set('Cache-Control', 'public, max-age=60');
          ctx.waitUntil(cache.put(cacheKey, cached.clone()));
          return cached;
        } catch (e) {
          await logError(env, 'cleanup.scan', (e && e.message) || e);
          return json(request, env, { error: 'could not read that wallet just now' }, 502);
        }
      }

      // ── public: swap ──
      // Each call costs a few Helius and Jupiter requests, so the same guards
      // as the cleanup scan: a short per-wallet cache and a global hourly ceiling.
      if (path === '/api/swap/holdings' && request.method === 'GET') {
        const who = url.searchParams.get('wallet');
        if (!isWallet(who)) return json(request, env, { error: 'not a wallet address' }, 400);
        if (!env.HELIUS_API_KEY) return json(request, env, { error: 'unavailable' }, 503);

        const cache = caches.default;
        const cacheKey = new Request(
          new URL('/api/swap/holdings?v=' + BUILD + '&wallet=' + who, url.origin).toString(), request);
        // after a swap the page asks for fresh numbers; the per-IP limit still applies
        if (url.searchParams.get('fresh') !== '1') {
          const hit = await cache.match(cacheKey);
          if (hit) return json(request, env, await hit.json());
        }
        if (await rateLimited(request, env, 'holdings:global', null)) {
          return json(request, env, { error: 'balances are busy right now — try again in a moment' }, 503);
        }
        try {
          const res = json(request, env, await walletHoldings(env, who));
          const cached = new Response(res.body, res);
          cached.headers.set('Cache-Control', 'public, max-age=30');
          ctx.waitUntil(cache.put(cacheKey, cached.clone()));
          return cached;
        } catch (e) {
          await logError(env, 'swap.holdings', (e && e.message) || e);
          return json(request, env, { error: 'could not read that wallet just now' }, 502);
        }
      }

      if (path === '/api/swap/record' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const signature = String(body.signature || '').trim();
        if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return json(request, env, { error: 'which swap?' }, 400);
        const seen = await env.DB.prepare('SELECT signature FROM swaps WHERE signature = ?').bind(signature).first();
        if (seen) return json(request, env, { ok: true, already: true });
        if (!env.HELIUS_API_KEY) return json(request, env, { error: 'unavailable' }, 503);
        const r = await recordSwap(env, signature);
        if (!r.ok) return json(request, env, { error: r.error }, /not found yet/.test(r.error) ? 404 : 400);
        return json(request, env, { ok: true, swap: r.swap });
      }

      if (path === '/api/swap/history' && request.method === 'GET') {
        const who = url.searchParams.get('wallet');
        if (!isWallet(who)) return json(request, env, { error: 'not a wallet address' }, 400);
        // swaps that earned points before history existed are filled in a few
        // at a time, so nobody's first look at it comes back empty
        if (env.HELIUS_API_KEY) {
          const missing = await env.DB.prepare(
            'SELECT a.signature FROM swap_awards a LEFT JOIN swaps s ON s.signature = a.signature ' +
            'WHERE a.wallet = ? AND s.signature IS NULL ORDER BY a.ts DESC LIMIT 5'
          ).bind(who).all();
          for (const m of missing.results || []) {
            await recordSwap(env, m.signature).catch(function () {});
          }
        }
        const rows = await env.DB.prepare(
          'SELECT s.signature, s.in_mint, s.in_symbol, s.in_amount, s.out_mint, s.out_symbol, s.out_amount, ' +
          's.usd, s.fee_bps, s.saved_usd, s.ts, a.points FROM swaps s LEFT JOIN swap_awards a ON a.signature = s.signature ' +
          'WHERE s.wallet = ? ORDER BY s.ts DESC LIMIT 25'
        ).bind(who).all();
        const saved = await env.DB.prepare(
          'SELECT COALESCE(SUM(saved_usd), 0) AS usd, COUNT(*) AS n FROM swaps WHERE wallet = ? AND saved_usd > 0'
        ).bind(who).first();
        return json(request, env, {
          swaps: rows.results || [],
          savedUsd: Math.round(((saved && saved.usd) || 0) * 100) / 100,
          discountedSwaps: (saved && saved.n) || 0
        });
      }

      if (path === '/api/swap/leaderboard' && request.method === 'GET') {
        const now = Date.now();
        const start = weekStart(now);
        const top = await weeklySwapTop(env, start, 10);
        const last = await env.DB.prepare(
          'SELECT rank, wallet, usd, points FROM swap_weekly_awards WHERE week = ? ORDER BY rank'
        ).bind(new Date(start - WEEK_MS).toISOString().slice(0, 10)).all();
        return json(request, env, {
          weekStart: start, weekEnd: start + WEEK_MS,
          prizes: WEEKLY_SWAP_PRIZES, minUsd: WEEKLY_SWAP_MIN_USD,
          top: top.map(function (r, i) { return { rank: i + 1, wallet: r.wallet, usd: r.usd, swaps: r.swaps }; }),
          lastWeek: last.results || []
        });
      }

      // The busiest tokens on Solana right now, so the fee-account page can offer
      // them rather than making anyone hunt for mint addresses.
      if (path === '/api/swap/top' && request.method === 'GET') {
        const cache = caches.default;
        const key = new Request(new URL('/api/swap/top', url.origin).toString(), request);
        const hit = await cache.match(key);
        if (hit) return hit;

        const res = await jupFetch(env, '/tokens/v2/toptraded/24h?limit=50');
        if (!res.ok) return json(request, env, { error: 'could not read the top tokens' }, 502);
        const list = await res.json().catch(function () { return []; });
        const tokens = (Array.isArray(list) ? list : []).map(function (t) {
          const s24 = t.stats24h || {};
          return {
            mint: t.id, symbol: t.symbol || null, name: t.name || null, decimals: t.decimals,
            verified: !!t.isVerified, tokenProgram: t.tokenProgram || null,
            volume24h: Math.round((Number(s24.buyVolume) || 0) + (Number(s24.sellVolume) || 0))
          };
        }).filter(function (t) { return t.mint; });
        const out = json(request, env, { tokens: tokens });
        const cached = new Response(out.body, out);
        cached.headers.set('Cache-Control', 'public, max-age=1800');
        ctx.waitUntil(cache.put(key, cached.clone()));
        return cached;
      }

      if (path === '/api/swap/tokens' && request.method === 'GET') {
        return json(request, env, { tokens: SWAP_TOKENS, feeBps: SWAP_FEE_BPS });
      }

      if (path === '/api/swap/quote' && request.method === 'GET') {
        const inputMint = url.searchParams.get('in');
        const outputMint = url.searchParams.get('out');
        const amount = url.searchParams.get('amount');
        const slippageParam = url.searchParams.get('slippage');
        const who = url.searchParams.get('wallet');
        if (!isWallet(inputMint) || !isWallet(outputMint)) {
          return json(request, env, { error: 'pick two tokens' }, 400);
        }
        if (inputMint === outputMint) return json(request, env, { error: 'those are the same token' }, 400);
        if (!/^[0-9]+$/.test(String(amount)) || Number(amount) <= 0) {
          return json(request, env, { error: 'enter an amount' }, 400);
        }

        // Slippage, the fee account and the holder check ask three different
        // services nothing to do with each other. Waiting for each in turn added
        // a third of a second to every keystroke.
        const auto = slippageParam === 'auto';
        const [slippageBps, fee, holder] = await Promise.all([
          auto ? autoSlippageBps(env, inputMint, outputMint)
               : Promise.resolve(Math.max(1, Math.min(5000, Number(slippageParam) || 50))),
          swapFeeFor(env, inputMint, outputMint),
          isWallet(who) ? isRangerHolder(env, who) : Promise.resolve(false)
        ]);
        const feeBps = fee ? swapFeeBpsFor(holder) : 0;
        const q = new URLSearchParams({
          inputMint: inputMint, outputMint: outputMint,
          amount: String(amount), slippageBps: String(slippageBps)
        });
        if (fee) q.set('platformFeeBps', String(feeBps));

        const res = await jupFetch(env, '/swap/v1/quote?' + q.toString());
        if (!res.ok) {
          const body = await res.text();
          // the pair and size come too: "Invalid input" on its own says nothing
          // about which quote Jupiter refused
          await logError(env, 'swap.quote', res.status + ' ' + body.slice(0, 120) +
            ' [' + inputMint.slice(0, 6) + '→' + outputMint.slice(0, 6) + ' ' + amount + ' slip ' + slippageBps + ']');
          return json(request, env, { error: 'no route for that pair right now' }, 502);
        }
        const quote = await res.json();
        if (quote.error) return json(request, env, { error: quote.error }, 400);
        const feeLamports = fee ? 0 : await solFeeLamports(env, quote, swapFeeBpsFor(holder));
        const charged = fee || feeLamports > 0;
        // feeMint says which token the fee is really taken in: the quote always
        // prices it in the output token, even when it comes out of the input
        return json(request, env, {
          quote: quote,
          feeBps: charged ? swapFeeBpsFor(holder) : 0,
          fullFeeBps: charged ? SWAP_FEE_BPS : 0,
          feeLamports: feeLamports,
          holder: holder,
          feeMint: fee ? fee.mint : feeLamports ? SOL_MINT : null,
          slippageBps: slippageBps,
          autoSlippage: auto
        });
      }

      if (path === '/api/swap/build' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const quote = body.quote;
        const user = body.user;
        if (!quote || !quote.inputMint || !isWallet(user)) {
          return json(request, env, { error: 'missing quote or wallet' }, 400);
        }
        // Rebuild the fee account here rather than trusting the client with it.
        const fee = await swapFeeFor(env, quote.inputMint, quote.outputMint);

        // The quote arrives from the browser, so its fee rate is checked against
        // what this wallet is actually entitled to. The wallet is the one that
        // signs, so quoting as a holder's address and swapping from another
        // wallet does not carry the discount across.
        const entitled = swapFeeBpsFor(await isRangerHolder(env, user));
        if (fee) {
          const quoted = quote.platformFee ? Number(quote.platformFee.feeBps) : 0;
          if (quoted !== entitled) {
            return json(request, env, { error: 'that price is out of date — getting a fresh one', requote: true }, 409);
          }
        }
        const feeLamports = fee ? 0 : await solFeeLamports(env, quote, entitled);

        const payload = {
          quoteResponse: quote,
          userPublicKey: user,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: false,
          prioritizationFeeLamports: swapPriority(body.speed)
        };
        if (fee) payload.feeAccount = fee.account;

        const res = await jupFetch(env, '/swap/v1/swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const out = await res.json().catch(function () { return null; });
        if (!res.ok || !out || !out.swapTransaction) {
          await logError(env, 'swap.build', res.status + ' ' + JSON.stringify(out).slice(0, 200));
          return json(request, env, { error: (out && out.error) || 'could not build that swap' }, 502);
        }
        return json(request, env, {
          swapTransaction: out.swapTransaction,
          lastValidBlockHeight: out.lastValidBlockHeight,
          prioritizationFeeLamports: out.prioritizationFeeLamports,
          feeTransfer: feeLamports ? { to: env.TREASURY_WALLET, lamports: feeLamports } : null
        });
      }

      // What someone is about to buy, in numbers: price, market cap, liquidity,
      // holders and the day's move, alongside the same warnings the search shows.
      if (path === '/api/swap/token' && request.method === 'GET') {
        const mint = url.searchParams.get('mint');
        if (!isWallet(mint)) return json(request, env, { error: 'not a token address' }, 400);
        const info = (await tokenInfo(env, [mint]))[mint];
        if (!info) return json(request, env, { error: 'no details for that token' }, 404);
        return json(request, env, { token: tokenCard(info) });
      }

      // What the slot has actually earned, read straight off the fee accounts.
      if (path === '/api/swap/earned' && request.method === 'GET') {
        const cache = caches.default;
        const key = new Request(new URL('/api/swap/earned', url.origin).toString(), request);
        const hit = await cache.match(key);
        if (hit) return hit;

        let usd = 0;
        const parts = [];
        for (const [mint, account] of Object.entries(SWAP_FEE_ACCOUNTS)) {
          try {
            const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + env.HELIUS_API_KEY, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 'b', method: 'getTokenAccountBalance', params: [account] })
            });
            const d = await res.json();
            const ui = d && d.result && d.result.value && Number(d.result.value.uiAmount);
            if (!ui) continue;
            // PYUSD is a dollar too. It was priced at SOL's rate, which reported
            // $31 of earnings when the real figure was under a dollar.
            const isUsd = DOLLAR_MINTS.indexOf(mint) >= 0;
            const price = isUsd ? 1 : (await solUsd(env)) || 0;
            usd += ui * price;
            parts.push({ mint: mint, amount: ui });
          } catch (e) { /* one missing balance should not blank the figure */ }
        }
        const res = json(request, env, { usd: Math.round(usd * 100) / 100, parts: parts, feeBps: SWAP_FEE_BPS });
        const cached = new Response(res.body, res);
        cached.headers.set('Cache-Control', 'public, max-age=300');
        ctx.waitUntil(cache.put(key, cached.clone()));
        return cached;
      }

      // ── public: the advertising slot ──
      if (path === '/api/banner/rates' && request.method === 'GET') {
        const live = await bannerLive(env);
        const soonest = Date.now() + BANNER_LEAD_MS;
        const runs = await bannerRuns(env, soonest);
        // a shorter run may fit a gap a longer one cannot, so each has its own date
        const rates = BANNER_RATES.map(function (r) {
          return { weeks: r.weeks, price: r.price, startsAt: earliestBannerStart(runs, soonest, r.weeks) };
        });
        return json(request, env, {
          rates: rates,
          nextFree: rates[0].startsAt,
          taken: !!live,
          payTo: env.TREASURY_WALLET || null,
          rules: 'Your creative is reviewed before it runs — no adult content, ' +
            'no unaudited token launches, nothing that impersonates anyone. If I ' +
            'turn it down you get a full refund, no argument.'
        });
      }

      if (path === '/api/banner/live' && request.method === 'GET') {
        const live = await bannerLive(env);
        return json(request, env, { slot: live || null });
      }

      if (path === '/api/banner/hold' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const rate = bannerRate(body.weeks);
        if (!rate) return json(request, env, { error: 'pick one of the offered durations' }, 400);

        const name = String(body.name || '').trim().slice(0, 120);
        const contact = String(body.contact || '').trim().slice(0, 200);
        if (!name || !contact) return json(request, env, { error: 'name and a way to reach you are both needed' }, 400);

        const wallet = await getSession(request, env).catch(function () { return null; });
        const ref = bookingRef().replace('FOX-', 'AD-');
        const reference = newReference();
        const now = Date.now();

        // Two advertisers arriving together would both be handed the same next
        // free date. The insert re-checks for an overlapping run inside one
        // statement, so only one lands on it; the other is moved to the next
        // free run rather than refused.
        let starts = 0, ends = 0, placed = false;
        for (let attempt = 0; attempt < 3 && !placed; attempt++) {
          starts = await bannerNextFree(env, rate.weeks);
          ends = starts + rate.weeks * WEEK_MS;
          const r = await env.DB.prepare(
            'INSERT INTO banner_bookings (ref, wallet, weeks, starts_at, ends_at, total_usd, sol_price, ' +
            'lamports, status, hold_until, name, contact, created_at, reference) ' +
            "SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?, ?, ?, ?, ? WHERE NOT EXISTS (" + OVERLAPS_LIVE_BANNER + ')'
          ).bind(
            ref, wallet, rate.weeks, starts, ends, rate.price, null, null,
            now + HOLD_MINUTES * 60000, name, contact, now, reference, ends, starts
          ).run();
          placed = r.meta.changes === 1;
        }
        if (!placed) return json(request, env, { error: 'the slot is being booked right now — try again in a moment' }, 409);

        return json(request, env, {
          ref: ref, reference: reference, weeks: rate.weeks, startsAt: starts, endsAt: ends,
          totalUsd: rate.price,
          usdc: usdcUnits(rate.price), usdcMint: USDC_MINT,
          payTo: env.TREASURY_WALLET || null,
          holdUntil: now + HOLD_MINUTES * 60000,
          serverNow: now
        });
      }

      if (path === '/api/banner/confirm' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const ref = String(body.ref || '').trim();
        const signature = String(body.signature || '').trim();
        if (!ref || !signature) return json(request, env, { error: 'reference and signature are both needed' }, 400);

        const b = await env.DB.prepare('SELECT * FROM banner_bookings WHERE ref = ?').bind(ref).first();
        if (!b) return json(request, env, { error: 'no booking with that reference' }, 404);
        if (b.status === 'paid') return json(request, env, { ok: true, alreadyPaid: true, ref: ref });
        // called only after the customer signed, so an expired hold is settled
        // rather than refused — see /api/booking/confirm
        if (b.status !== 'held' && b.status !== 'expired') {
          return json(request, env, { error: 'that booking is not awaiting payment' }, 409);
        }
        if (!env.TREASURY_WALLET) {
          await logError(env, 'banner.confirm', 'TREASURY_WALLET unset — refusing to confirm');
          return json(request, env, { error: 'payments are not switched on yet' }, 503);
        }

        const payer = b.wallet || (await getSession(request, env).catch(function () { return null; }));
        if (!payer) return json(request, env, { error: 'connect the wallet that paid' }, 400);

        const s = await settlePayment(env, CHECKOUTS.banner, b, signature, payer);
        if (s.status === 'unpaid') return json(request, env, { error: s.error }, 402);
        if (s.status === 'settling') return json(request, env, { pending: true }, 202);
        if (s.status === 'refund') {
          return json(request, env, {
            error: 'your payment arrived after the hold ended, and that run had been taken. ' +
              'It is recorded against ' + ref + ' and will be refunded.',
            refund: true, ref: ref
          }, 409);
        }
        return json(request, env, { ok: true, ref: ref, needsCreative: true });
      }

      // Creative arrives after payment, and sits unapproved until reviewed.
      if (path === '/api/banner/creative' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const ref = String(body.ref || '').trim();
        const b = await env.DB.prepare('SELECT * FROM banner_bookings WHERE ref = ?').bind(ref).first();
        if (!b) return json(request, env, { error: 'no booking with that reference' }, 404);
        if (b.status !== 'paid') return json(request, env, { error: 'that booking is not paid yet' }, 409);

        const sponsor = String(body.sponsor || '').trim().slice(0, 60);
        const headline = String(body.headline || '').trim().slice(0, 90);
        const link = String(body.url || '').trim().slice(0, 300);
        const image = String(body.image || '').trim().slice(0, 400);
        if (!sponsor || !headline || !link) {
          return json(request, env, { error: 'name, headline and a link are all needed' }, 400);
        }
        if (!/^https:\/\//.test(link)) return json(request, env, { error: 'the link must be https' }, 400);
        if (image && !/^https:\/\//.test(image)) return json(request, env, { error: 'the image must be https' }, 400);

        await env.DB.prepare(
          'UPDATE banner_bookings SET sponsor = ?, headline = ?, url = ?, image_url = ?, approved = 0 WHERE ref = ?'
        ).bind(sponsor, headline, link, image || null, ref).run();
        await alert(env, '🖼 Creative submitted for ' + ref + '\n' + sponsor + ' — ' + headline +
          '\n' + link + '\nApprove it before it runs.');

        return json(request, env, { ok: true, ref: ref, pendingApproval: true });
      }

      // Poll after showing a QR: the payer may never have touched this site.
      if (path === '/api/booking/watch' && request.method === 'GET') {
        return watchPayment(request, env, CHECKOUTS.booking, String(url.searchParams.get('ref') || '').trim());
      }

      if (path === '/api/banner/watch' && request.method === 'GET') {
        return watchPayment(request, env, CHECKOUTS.banner, String(url.searchParams.get('ref') || '').trim());
      }

      // ── public: the rate card ──
      if (path === '/api/booking/types' && request.method === 'GET') {
        const wallet = await getSession(request, env).catch(function () { return null; });
        const holder = wallet ? await isRangerHolder(env, wallet) : false;
        return json(request, env, {
          types: BOOKING_TYPES,
          policy: BOOKING_POLICY,
          rushHours: RUSH_HOURS,
          rushPct: RUSH_PCT,
          holderDiscountPct: HOLDER_DISCOUNT_PCT,
          holder: holder,
          payTo: env.TREASURY_WALLET || null
        });
      }

      if (path === '/api/booking/slots' && request.method === 'GET') {
        const type = bookingType(url.searchParams.get('type'));
        if (!type) return json(request, env, { error: 'unknown booking type' }, 400);
        return json(request, env, { type: type.id, minutes: type.minutes, slots: await openSlots(env, type) });
      }

      // Holds the slot and locks the quote. Nothing is charged here — this
      // exists so the price cannot move between choosing and paying.
      if (path === '/api/booking/hold' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const type = bookingType(body.type);
        if (!type) return json(request, env, { error: 'unknown booking type' }, 400);

        const name = String(body.name || '').trim().slice(0, 120);
        const contact = String(body.contact || '').trim().slice(0, 200);
        const brief = String(body.brief || '').trim().slice(0, 2000);
        if (!name || !contact) return json(request, env, { error: 'name and a way to reach you are both needed' }, 400);

        let startsAt = null;
        if (type.mode === 'slot') {
          startsAt = Number(body.startsAt);
          if (!startsAt) return json(request, env, { error: 'pick a time' }, 400);
          if (startsAt - Date.now() < MIN_LEAD_HOURS * 3600000) {
            return json(request, env, { error: 'that time is too soon — pick one at least a day out' }, 400);
          }
          const open = await openSlots(env, type);
          if (!open.some(function (s) { return s.starts === startsAt; })) {
            return json(request, env, { error: 'that slot just went — pick another' }, 409);
          }
        }

        const wallet = await getSession(request, env).catch(function () { return null; });
        const holder = wallet ? await isRangerHolder(env, wallet) : false;
        const q = quoteFor(type, startsAt, holder);
        // Paid in USDC, so no exchange rate is needed — and a SOL price feed
        // being down can no longer refuse someone paying in dollars.
        const usdc = type.mode === 'enquiry' ? null : usdcUnits(q.total);

        const ref = bookingRef();
        const reference = newReference();
        const now = Date.now();
        // The free-slot check above reads, and this writes; two holds for the
        // same hour arriving together would both pass the read. So the insert
        // re-checks inside a single statement, which the database runs
        // atomically, and only one of them can land.
        const guard = type.mode === 'slot' ? ' WHERE NOT EXISTS (' + OVERLAPS_LIVE_BOOKING + ')' : '';
        const inserted = await env.DB.prepare(
          'INSERT INTO bookings (ref, wallet, type_id, mode, starts_at, minutes, base_usd, rush_pct, ' +
          'discount_pct, total_usd, sol_price, lamports, status, hold_until, name, contact, brief, created_at, reference) ' +
          'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?' + guard
        ).bind(...[
          ref, wallet, type.id, type.mode, startsAt, type.minutes,
          q.base, q.rushPct, q.discountPct, q.total, null, null,
          type.mode === 'enquiry' ? 'enquiry' : 'held',
          type.mode === 'enquiry' ? null : now + HOLD_MINUTES * 60000,
          name, contact, brief, now, reference
        ].concat(type.mode === 'slot' ? [startsAt + type.minutes * 60000, startsAt] : [])).run();
        if (inserted.meta.changes !== 1) {
          return json(request, env, { error: 'that slot just went — pick another' }, 409);
        }

        return json(request, env, {
          ref: ref,
          reference: reference,
          type: type.id,
          mode: type.mode,
          startsAt: startsAt,
          minutes: type.minutes,
          quote: q,
          usdc: usdc,
          usdcMint: USDC_MINT,
          payTo: env.TREASURY_WALLET || null,
          holdUntil: type.mode === 'enquiry' ? null : now + HOLD_MINUTES * 60000,
          // lets the page count down the hold without trusting the visitor's clock
          serverNow: now,
          policy: BOOKING_POLICY
        });
      }

      if (path === '/api/booking/confirm' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const ref = String(body.ref || '').trim();
        const signature = String(body.signature || '').trim();
        if (!ref || !signature) return json(request, env, { error: 'reference and signature are both needed' }, 400);

        const b = await env.DB.prepare('SELECT * FROM bookings WHERE ref = ?').bind(ref).first();
        if (!b) return json(request, env, { error: 'no booking with that reference' }, 404);
        if (b.status === 'paid') return json(request, env, { ok: true, alreadyPaid: true, booking: publicBooking(b) });
        // Confirm is only ever called after the customer has signed, so by now
        // the money has left their wallet. An expired hold is therefore settled
        // like any other rather than refused — refusing it used to tell a paying
        // customer to "book again" while keeping their payment.
        if (b.status !== 'held' && b.status !== 'expired') {
          return json(request, env, { error: 'that booking is not awaiting payment' }, 409);
        }

        if (!env.TREASURY_WALLET) {
          await logError(env, 'booking.confirm', 'TREASURY_WALLET unset — refusing to confirm');
          return json(request, env, { error: 'payments are not switched on yet' }, 503);
        }
        const payer = b.wallet || (await getSession(request, env).catch(function () { return null; }));
        if (!payer) return json(request, env, { error: 'connect the wallet that paid' }, 400);

        // USDC only, expected in full; verifyInvoice refuses SOL outright.
        const s = await settlePayment(env, CHECKOUTS.booking, b, signature, payer);
        if (s.status === 'unpaid') return json(request, env, { error: s.error }, 402);
        if (s.status === 'settling') return json(request, env, { pending: true }, 202);

        const fresh = await env.DB.prepare('SELECT * FROM bookings WHERE ref = ?').bind(ref).first();
        if (s.status === 'refund') {
          return json(request, env, {
            error: 'your payment arrived after the hold ended, and that time had been taken. ' +
              'It is recorded against ' + ref + ' and will be refunded.',
            refund: true, booking: publicBooking(fresh)
          }, 409);
        }
        return json(request, env, { ok: true, booking: publicBooking(fresh) });
      }

      if (path === '/api/booking/lookup' && request.method === 'GET') {
        const ref = String(url.searchParams.get('ref') || '').trim();
        if (!ref) return json(request, env, { error: 'which booking?' }, 400);
        const b = await env.DB.prepare('SELECT * FROM bookings WHERE ref = ?').bind(ref).first();
        if (!b) return json(request, env, { error: 'no booking with that reference' }, 404);
        return json(request, env, { booking: publicBooking(b) });
      }

      // ── public: leaderboard ──
      // ── the draw, published so it can be checked ──
      if (path === '/api/mission/draw' && request.method === 'GET') {
        const missionId = url.searchParams.get('mission');
        if (!missionId) return json(request, env, { error: 'which mission?' }, 400);
        const row = await env.DB.prepare(
          'SELECT * FROM mission_draws WHERE mission_id = ?'
        ).bind(missionId).first();
        if (!row) return json(request, env, { error: 'no draw for that mission' }, 404);
        return json(request, env, {
          mission: row.mission_id,
          snapshotHash: row.snapshot_hash,
          totalTickets: row.total_tickets,
          winnerCount: row.winner_count,
          entries: row.snapshot.split('\n').filter(Boolean).map(function (l) {
            const at = l.lastIndexOf(':');
            return { wallet: l.slice(0, at), tickets: Number(l.slice(at + 1)) };
          }),
          randomness: row.randomness || null,
          winners: row.winners ? JSON.parse(row.winners) : null,
          onChain: {
            programId: DRAW_PROGRAM_ID,
            drawAccount: row.draw_account || null,
            commitSignature: row.commit_signature || null,
            fulfillSignature: row.fulfill_signature || null
          },
          committedAt: row.created_at,
          drawnAt: row.drawn_at || null,
          howToVerify: 'sha256 of the entry lines joined by newline must equal snapshotHash, which is stored on-chain in drawAccount before randomness existed. Re-run the published selection over randomness to reproduce winners.'
        });
      }

      if (path === '/api/leaderboard' && request.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT p.wallet AS wallet, ' +
          '  p.points + COALESCE(s.banked, 0) + ' +
          '  CASE WHEN s.staked = 1 AND s.since > 0 ' +
          '    THEN CAST(((? - s.since) / 86400000.0) * ? * s.count AS INTEGER) ' +
          '    ELSE 0 END AS points ' +
          'FROM players p LEFT JOIN stakes s ON s.wallet = p.wallet ' +
          'WHERE p.points > 0 OR s.staked = 1 ' +
          'ORDER BY points DESC, p.wallet ASC LIMIT 100'
        ).bind(Date.now(), STAKE_RATE_PER_DAY).all();
        return json(request, env, { players: (rows.results || []).filter(function (r) { return r.points > 0; }) });
      }

      // ── step 1: request a nonce ──
      if (path === '/api/nonce' && request.method === 'POST') {
        const { wallet } = await request.json();
        if (!isWallet(wallet)) return json(request, env, { error: 'bad wallet' }, 400);
        const nonce = randomToken();
        await env.DB.prepare('INSERT INTO nonces (nonce, wallet, expires) VALUES (?, ?, ?)')
          .bind(nonce, wallet, Date.now() + NONCE_TTL_MS).run();
        return json(request, env, { nonce, message: signInMessage(wallet, nonce) });
      }

      // ── step 2: exchange a signature for a session ──
      if (path === '/api/session' && request.method === 'POST') {
        const { wallet, nonce, signature } = await request.json();
        if (!isWallet(wallet) || !nonce || !signature) return json(request, env, { error: 'missing fields' }, 400);
        const row = await env.DB.prepare('SELECT wallet, expires FROM nonces WHERE nonce = ?').bind(nonce).first();
        if (!row || row.wallet !== wallet || row.expires < Date.now()) {
          return json(request, env, { error: 'nonce invalid or expired' }, 401);
        }
        // one-shot: burn the nonce whatever happens next
        await env.DB.prepare('DELETE FROM nonces WHERE nonce = ?').bind(nonce).run();

        let ok = false;
        try { ok = await verifySignature(wallet, signInMessage(wallet, nonce), signature); } catch (e) { ok = false; }
        if (!ok) return json(request, env, { error: 'signature did not verify' }, 401);

        const token = randomToken();
        const expires = Date.now() + SESSION_TTL_MS;
        await ensurePlayer(env, wallet);
        await env.DB.prepare('INSERT INTO sessions (token, wallet, expires) VALUES (?, ?, ?)')
          .bind(token, wallet, expires).run();
        return json(request, env, { token, expires, player: await playerState(env, wallet) });
      }

      // ── everything below needs a session ──
      const wallet = await getSession(request, env);
      if (!wallet) return json(request, env, { error: 'not signed in' }, 401);

      if (await rateLimited(request, env, path, wallet)) return tooMany(request, env);

      // ── coin flip (points only) ──
      // No money in or out — points are staked against points. The outcome is
      // decided here, with cryptographic randomness, and the wager is deducted
      // before the coin is flipped so a dropped connection cannot mean a free
      // win. Rejection sampling keeps heads and tails exactly even.
      if (path === '/api/flip' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const wager = Math.floor(Number(body.wager) || 0);
        const call = body.call === 'tails' ? 'tails' : 'heads';

        if (wager < FLIP_MIN) return json(request, env, { error: 'Minimum wager is ' + FLIP_MIN + ' points.' }, 400);
        if (wager > FLIP_MAX) return json(request, env, { error: 'Maximum wager is ' + FLIP_MAX + ' points.' }, 400);

        const p = await env.DB.prepare('SELECT points FROM players WHERE wallet = ?').bind(wallet).first();
        const balance = p ? p.points : 0;
        if (balance < wager) {
          return json(request, env, { error: 'Not enough points. You have ' + balance + '.' }, 400);
        }

        // take the wager first, so a crash mid-flip can never pay out for free
        await env.DB.prepare('UPDATE players SET points = points - ?, updated_at = ? WHERE wallet = ?')
          .bind(wager, Date.now(), wallet).run();

        const buf = new Uint32Array(1);
        let v;
        do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= 0xFFFFFFFE); // keep it exactly even
        const result = (v % 2 === 0) ? 'heads' : 'tails';
        const won = result === call;

        if (won) {
          await addPoints(env, wallet, 'flip_win', wager * 2);
        } else {
          await env.DB.prepare('INSERT INTO events (wallet, type, points, ts) VALUES (?, ?, ?, ?)')
            .bind(wallet, 'flip_loss', -wager, Date.now()).run();
        }
        await env.DB.prepare('INSERT INTO flips (wallet, wager, won, ts) VALUES (?, ?, ?, ?)')
          .bind(wallet, wager, won ? 1 : 0, Date.now()).run();

        return json(request, env, {
          call: call, result: result, won: won,
          delta: won ? wager : -wager,
          player: await playerState(env, wallet)
        });
      }

      // how the coin has actually landed, so the odds are checkable
      if (path === '/api/flip/stats' && request.method === 'GET') {
        const r = await env.DB.prepare(
          'SELECT COUNT(*) AS total, SUM(won) AS wins FROM flips'
        ).first();
        const mine = await env.DB.prepare(
          'SELECT COUNT(*) AS total, SUM(won) AS wins FROM flips WHERE wallet = ?'
        ).bind(wallet).first();
        return json(request, env, {
          all: { total: (r && r.total) || 0, wins: (r && r.wins) || 0 },
          mine: { total: (mine && mine.total) || 0, wins: (mine && mine.wins) || 0 }
        });
      }

      // ── missions ──
      if (path === '/api/mission' && request.method === 'GET') {
        const mission = await currentMission(env);
        const standing = await missionStanding(env, wallet, mission);
        const rewards = await env.DB.prepare(
          'SELECT id, mission_id, kind, amount, detail, claimed FROM mission_rewards ' +
          'WHERE wallet = ? ORDER BY claimed ASC, id DESC LIMIT 50'
        ).bind(wallet).all();
        // how much of the field this wallet represents, for a sense of the odds
        const totals = await env.DB.prepare(
          'SELECT COUNT(DISTINCT wallet) AS holders, COUNT(*) AS rangers FROM staked_nfts'
        ).first();
        return json(request, env, {
          standing: standing,
          rewards: rewards.results || [],
          field: { holders: (totals && totals.holders) || 0, rangers: (totals && totals.rangers) || 0 }
        });
      }

      // Rewards sit against the wallet until claimed — nothing is pushed out,
      // so a quiet wallet never loses anything and claiming brings people back.
      if (path === '/api/mission/claim' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const id = Number(body.id);
        if (!id) return json(request, env, { error: 'which reward?' }, 400);

        const reward = await env.DB.prepare(
          'SELECT * FROM mission_rewards WHERE id = ? AND wallet = ?'
        ).bind(id, wallet).first();
        if (!reward) return json(request, env, { error: 'reward not found' }, 404);
        if (reward.claimed) return json(request, env, { error: 'already claimed' }, 409);

        // mark first, then credit — a double-click cannot pay twice
        const marked = await env.DB.prepare(
          'UPDATE mission_rewards SET claimed = 1, claimed_at = ? WHERE id = ? AND claimed = 0'
        ).bind(Date.now(), id).run();
        if (!marked.meta || marked.meta.changes === 0) {
          return json(request, env, { error: 'already claimed' }, 409);
        }

        if (reward.kind === 'points' && reward.amount > 0) {
          await addPoints(env, wallet, 'mission', reward.amount);
        }

        return json(request, env, {
          claimed: { kind: reward.kind, amount: reward.amount, detail: reward.detail },
          player: await playerState(env, wallet)
        });
      }

      // What a swap of this size would be worth, so the page can say it up front
      // rather than after the fact.
      // Points for burning, paid per account actually closed — verified from
      // the transaction, not from what the page claims.
      if (path === '/api/cleanup/award' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const signature = String(body.signature || '').trim();
        if (!signature) return json(request, env, { error: 'which transaction?' }, 400);

        const seen = await env.DB.prepare('SELECT points FROM swap_awards WHERE signature = ?')
          .bind(signature).first();
        if (seen) return json(request, env, { awarded: 0, already: true, player: await playerState(env, wallet) });

        let burns = 0, closes = 0;
        try {
          const tx = await rpcCall(env, 'getTransaction',
            [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
          if (!tx) return json(request, env, { error: 'not found yet' }, 400);
          if (tx.meta && tx.meta.err) return json(request, env, { error: 'that transaction failed' }, 400);
          const keys = tx.transaction.message.accountKeys.map(function (k) { return k.pubkey || k; });
          if (keys[0] !== wallet) return json(request, env, { error: 'that was not signed by your wallet' }, 400);
          for (const ix of tx.transaction.message.instructions || []) {
            const t = ix.parsed && ix.parsed.type;
            if (t === 'burn' || t === 'burnChecked') burns++;
            else if (t === 'closeAccount') closes++;
          }
        } catch (e) {
          await logError(env, 'cleanup.award', (e && e.message) || e);
          return json(request, env, { error: 'could not read that transaction' }, 502);
        }
        // a burn is always paired with a close, so only the surplus closes are
        // counted at the lower rate — nobody is paid twice for one account
        const bareCloses = Math.max(0, closes - burns);
        const earned = burns * BURN_POINTS_PER_ACCOUNT + bareCloses * CLOSE_POINTS_PER_ACCOUNT;
        if (earned === 0) return json(request, env, { awarded: 0, player: await playerState(env, wallet) });

        const dayStart = Date.now() - (Date.now() % 86400000);
        const today = await env.DB.prepare(
          "SELECT COALESCE(SUM(points), 0) AS n FROM events WHERE wallet = ? AND type IN ('burn','cleanup') AND ts >= ?"
        ).bind(wallet, dayStart).first();
        const room = Math.max(0, BURN_POINTS_DAILY_CAP - ((today && today.n) || 0));
        const points = Math.min(room, earned);

        // A page that retries, or two tabs at once, used to hit the primary key and
        // hand the person a 500 for a cleanup that had already been paid.
        const wrote = await env.DB.prepare(
          'INSERT INTO swap_awards (signature, wallet, usd, points, ts) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(signature) DO NOTHING'
        ).bind(signature, wallet, 0, points, Date.now()).run();
        if (wrote.meta.changes !== 1) {
          return json(request, env, { awarded: 0, already: true, player: await playerState(env, wallet) });
        }
        if (points > 0) await addPoints(env, wallet, 'cleanup', points);

        return json(request, env, {
          awarded: points, burned: burns, closed: bareCloses,
          cappedOut: points === 0 && room === 0,
          dailyCap: BURN_POINTS_DAILY_CAP,
          player: await playerState(env, wallet)
        });
      }

      if (path === '/api/swap/points' && request.method === 'GET') {
        const dayStart = Date.now() - (Date.now() % 86400000);
        const today = await env.DB.prepare(
          'SELECT COALESCE(SUM(points), 0) AS n FROM swap_awards WHERE wallet = ? AND ts >= ?'
        ).bind(wallet, dayStart).first();
        const used = (today && today.n) || 0;
        return json(request, env, {
          perUsd: SWAP_POINTS_PER_USD,
          minUsd: SWAP_POINTS_MIN_USD,
          dailyCap: SWAP_POINTS_DAILY_CAP,
          usedToday: used,
          remaining: Math.max(0, SWAP_POINTS_DAILY_CAP - used)
        });
      }

      if (path === '/api/swap/award' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const signature = String(body.signature || '').trim();
        if (!signature) return json(request, env, { error: 'which swap?' }, 400);

        const seen = await env.DB.prepare('SELECT points FROM swap_awards WHERE signature = ?')
          .bind(signature).first();
        if (seen) return json(request, env, { awarded: 0, already: true, player: await playerState(env, wallet) });

        const v = await swapValueUsd(env, signature, wallet);
        if (!v.ok) return json(request, env, { error: v.error }, 400);
        if (v.usd < SWAP_POINTS_MIN_USD) {
          return json(request, env, {
            awarded: 0,
            note: 'Swaps under $' + SWAP_POINTS_MIN_USD + ' do not earn points.',
            player: await playerState(env, wallet)
          });
        }

        const dayStart = Date.now() - (Date.now() % 86400000);
        const today = await env.DB.prepare(
          'SELECT COALESCE(SUM(points), 0) AS n FROM swap_awards WHERE wallet = ? AND ts >= ?'
        ).bind(wallet, dayStart).first();
        const used = (today && today.n) || 0;
        const room = Math.max(0, SWAP_POINTS_DAILY_CAP - used);
        const points = Math.min(room, Math.round(v.usd * SWAP_POINTS_PER_USD));

        const wrote = await env.DB.prepare(
          'INSERT INTO swap_awards (signature, wallet, usd, points, ts) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(signature) DO NOTHING'
        ).bind(signature, wallet, v.usd, points, Date.now()).run();
        if (wrote.meta.changes !== 1) {
          return json(request, env, { awarded: 0, already: true, player: await playerState(env, wallet) });
        }
        if (points > 0) await addPoints(env, wallet, 'swap', points);

        return json(request, env, {
          awarded: points,
          usd: Math.round(v.usd * 100) / 100,
          cappedOut: points === 0 && room === 0,
          dailyCap: SWAP_POINTS_DAILY_CAP,
          player: await playerState(env, wallet)
        });
      }

      if (path === '/api/me' && request.method === 'GET') {
        return json(request, env, { player: await playerState(env, wallet) });
      }

      if (path === '/api/visit' && request.method === 'POST') {
        const today = new Date().toISOString().slice(0, 10);
        const p = await env.DB.prepare('SELECT last_visit FROM players WHERE wallet = ?').bind(wallet).first();
        if (p && p.last_visit === today) {
          return json(request, env, { awarded: 0, player: await playerState(env, wallet) });
        }
        await env.DB.prepare('UPDATE players SET last_visit = ? WHERE wallet = ?').bind(today, wallet).run();
        await addPoints(env, wallet, 'visit', AWARDS.visit);
        return json(request, env, { awarded: AWARDS.visit, player: await playerState(env, wallet) });
      }

      // Once the escrow program is live on mainnet, off-chain staking must stop
      // accepting new positions or the two records diverge. Existing stakers can
      // still read and unstake; they simply cannot add more.
      if (path === '/api/stake' && request.method === 'POST' && env.STAKING_ONCHAIN === 'true') {
        return json(request, env, {
          error: 'Staking has moved on-chain. Unstake here, then stake again to lock your Ranger in the vault.',
          onchain: true
        }, 409);
      }

      // which Rangers this wallet holds, and which are already staked
      if (path === '/api/rangers' && request.method === 'GET') {
        const owned = await listRangers(env, wallet);
        if (owned === null) return json(request, env, { rangers: [], staked: [], verified: false });
        const staked = await stakedMints(env, wallet);
        const ownedMints = owned.map(function (r) { return r.mint; });
        // drop anything that has since left the wallet
        const stale = staked.filter(function (m) { return ownedMints.indexOf(m) < 0; });
        if (stale.length) {
          const s = await loadStake(env, wallet);
          const remaining = staked.length - stale.length;
          await saveStake(env, wallet, { staked: remaining > 0 ? 1 : 0, since: remaining > 0 ? Date.now() : 0, count: remaining, banked: stakeAccrued(s) });
          await env.DB.batch(stale.map(function (m) {
            return env.DB.prepare('DELETE FROM staked_nfts WHERE wallet = ? AND mint = ?').bind(wallet, m);
          }));
        }
        // when each one was locked, so the page can show days staked and what
        // that Ranger has earned so far
        const sinceRows = await env.DB.prepare(
          'SELECT mint, since FROM staked_nfts WHERE wallet = ?'
        ).bind(wallet).all();
        const stakedAt = {};
        for (const r of sinceRows.results || []) stakedAt[r.mint] = r.since;
        return json(request, env, {
          rangers: owned,
          staked: await stakedMints(env, wallet),
          stakedAt: stakedAt,
          verified: true,
          feeLamports: Number(env.STAKE_FEE_LAMPORTS || 0),
          treasury: env.TREASURY_WALLET || null
        });
      }

      if (path === '/api/stake' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const owned = await listRangers(env, wallet);
        if (owned === null) return json(request, env, { error: 'ownership checks unavailable' }, 503);
        const ownedMints = owned.map(function (r) { return r.mint; });
        if (!ownedMints.length) return json(request, env, { error: 'no Moon Ranger in this wallet' }, 403);

        let want = Array.isArray(body.mints) && body.mints.length ? body.mints : ownedMints;
        want = want.filter(function (m) { return ownedMints.indexOf(m) >= 0; });
        if (!want.length) return json(request, env, { error: 'those Rangers are not in this wallet' }, 403);

        const already = await stakedMints(env, wallet);
        const toAdd = want.filter(function (m) { return already.indexOf(m) < 0; });
        if (!toAdd.length) return json(request, env, { player: await playerState(env, wallet), added: 0 });

        // fee is charged per Ranger newly staked
        const fee = Number(env.STAKE_FEE_LAMPORTS || 0) * toAdd.length;
        const pay = await verifyPayment(env, wallet, body.paymentSignature, fee, 'stake');
        if (!pay.ok) return json(request, env, { error: pay.error, feeLamports: fee }, 402);

        const s = await loadStake(env, wallet);
        const now = Date.now();
        await env.DB.batch(toAdd.map(function (m) {
          return env.DB.prepare('INSERT INTO staked_nfts (wallet, mint, since) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(wallet, m, now);
        }));
        const total = already.length + toAdd.length;
        await saveStake(env, wallet, { staked: 1, since: now, count: total, banked: stakeAccrued(s) });
        return json(request, env, { player: await playerState(env, wallet), added: toAdd.length, staked: await stakedMints(env, wallet) });
      }

      if (path === '/api/unstake' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const already = await stakedMints(env, wallet);
        const drop = Array.isArray(body.mints) && body.mints.length
          ? body.mints.filter(function (m) { return already.indexOf(m) >= 0; })
          : already;
        if (!drop.length) return json(request, env, { player: await playerState(env, wallet), removed: 0 });

        const s = await loadStake(env, wallet);
        await env.DB.batch(drop.map(function (m) {
          return env.DB.prepare('DELETE FROM staked_nfts WHERE wallet = ? AND mint = ?').bind(wallet, m);
        }));
        const remaining = already.length - drop.length;
        await saveStake(env, wallet, {
          staked: remaining > 0 ? 1 : 0,
          since: remaining > 0 ? Date.now() : 0,
          count: remaining,
          banked: stakeAccrued(s)
        });
        return json(request, env, { player: await playerState(env, wallet), removed: drop.length, staked: await stakedMints(env, wallet) });
      }

      if (path === '/api/claim' && request.method === 'POST') {
        const s = await loadStake(env, wallet);
        const pending = stakeAccrued(s);
        if (pending <= 0) return json(request, env, { awarded: 0, player: await playerState(env, wallet) });
        await saveStake(env, wallet, { staked: s.staked, since: s.staked ? Date.now() : 0, count: s.count, banked: 0 });
        await addPoints(env, wallet, 'stake', pending);
        return json(request, env, { awarded: pending, player: await playerState(env, wallet) });
      }

      // Redeeming a plushie code. The code is the proof of purchase: it is
      // issued by hand against a real store.fun order, and burned on first use,
      // so a code cannot be shared around to farm points across wallets.
      if (path === '/api/plushie/redeem' && request.method === 'POST') {
        const body = await request.json().catch(function () { return {}; });
        const code = String(body.code || '').trim().toUpperCase();
        if (!code) return json(request, env, { error: 'Enter the code from your order.' }, 400);

        const row = await env.DB.prepare('SELECT * FROM plushie_codes WHERE code = ?').bind(code).first();
        // Same message whether the code is unknown or already used: telling the
        // difference apart would let someone probe for valid codes.
        if (!row || row.redeemed_at) {
          return json(request, env, { error: 'That code is not valid, or it has already been used.' }, 400);
        }

        // Claim it with a conditional write. Two requests racing the same code
        // both see redeemed_at IS NULL above; only one can win here.
        const claim = await env.DB.prepare(
          'UPDATE plushie_codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ? AND redeemed_at IS NULL'
        ).bind(wallet, Date.now(), code).run();
        if (!claim.meta || claim.meta.changes !== 1) {
          return json(request, env, { error: 'That code is not valid, or it has already been used.' }, 400);
        }

        await addPoints(env, wallet, 'plushie', AWARDS.plushie);
        return json(request, env, { awarded: AWARDS.plushie, player: await playerState(env, wallet) });
      }

      return json(request, env, { error: 'not found' }, 404);
    } catch (err) {
      const message = String((err && err.message) || err);
      ctx.waitUntil(logError(env, path, message));
      // The detail is logged above, not returned. It used to be sent to the
      // caller, which handed an attacker table names, upstream providers and
      // which code path failed — the reconnaissance step before a real attempt.
      return json(request, env, { error: 'server error' }, 500);
    }
  }
};
