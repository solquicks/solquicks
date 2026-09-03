// solquicks Fox Points API
// Points live here, not in the visitor's browser. Every award is decided
// server-side; the client can only ask, never assert a balance.

const DAY_MS = 86400000;
const STAKE_RATE_PER_DAY = 100;
const SESSION_TTL_MS = 30 * DAY_MS;
const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_MIGRATE = 5000; // ceiling on one-time localStorage import
const FLIP_MIN = 10;
const FLIP_MAX = 1000;   // caps how fast a balance can swing in one go

const AWARDS = { visit: 5, plushie: 500, game: 25, gacha: 50 };

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
async function fetchFirstAvailable(src) {
  const candidates = [src];
  const m = src.match(/\/ipfs\/(.+)$/);
  if (m) {
    for (const gw of IPFS_GATEWAYS) {
      const alt = gw + m[1];
      if (!candidates.includes(alt)) candidates.push(alt);
    }
  }
  const attempts = candidates.map(function (url) {
    return fetch(url, {
      headers: { Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000)
    }).then(function (res) {
      if (res.ok && (res.headers.get('Content-Type') || '').startsWith('image/')) return res;
      throw new Error('no image');
    });
  });
  // AbortSignal is not reliably honoured for subrequests here, so cap the whole
  // race with an explicit deadline: a missing file must not stall the page.
  const deadline = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 6000); });
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
  const payerIdx = keys.indexOf(wallet);
  if (treasuryIdx < 0) return { ok: false, error: 'payment did not go to the right wallet' };
  if (payerIdx !== 0) return { ok: false, error: 'payment was not sent by your wallet' };

  const delta = (tx.meta.postBalances[treasuryIdx] || 0) - (tx.meta.preBalances[treasuryIdx] || 0);
  if (delta < minLamports) return { ok: false, error: 'payment was too small' };

  await env.DB.prepare('INSERT INTO payments (signature, wallet, lamports, purpose, ts) VALUES (?, ?, ?, ?, ?)')
    .bind(signature, wallet, delta, purpose, Date.now()).run();
  return { ok: true, lamports: delta };
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
  const p = await env.DB.prepare('SELECT points, last_visit, migrated FROM players WHERE wallet = ?').bind(wallet).first();
  const log = await env.DB.prepare('SELECT type, points, ts FROM events WHERE wallet = ? ORDER BY ts DESC LIMIT 50').bind(wallet).all();
  const s = await loadStake(env, wallet);
  const staked = await env.DB.prepare('SELECT mint FROM staked_nfts WHERE wallet = ?').bind(wallet).all();
  const claimed = p ? p.points : 0;
  const pending = stakeAccrued(s);
  return {
    wallet,
    stakedMints: (staked.results || []).map(function (x) { return x.mint; }),
    points: claimed,
    pending: pending,
    total: claimed + pending,
    migrated: p ? !!p.migrated : false,
    lastVisit: p ? p.last_visit : null,
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
  { match: ['/api/visit', '/api/award', '/api/claim', '/api/unstake', '/api/migrate'], name: 'write', by: 'wallet', limit: 30, windowMs: 60000 },
  { match: ['/api/flip'], name: 'flip', by: 'wallet', limit: 30, windowMs: 60000 },
  { match: ['/api/leaderboard', '/api/banner/stats'], name: 'read', by: 'ip', limit: 60, windowMs: 60000 },
  { match: ['/api/banner/event'], name: 'event', by: 'ip', limit: 40, windowMs: 60000 }
];

async function rateLimited(request, env, path, wallet) {
  const rule = RATE_RULES.find(function (r) { return r.match.indexOf(path) >= 0; });
  if (!rule) return false;

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const who = (rule.by === 'wallet' && wallet) ? 'w:' + wallet : 'i:' + ip;
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

export default {
  /// Runs on a schedule so an outage is reported rather than stumbled upon.
  /// Alerts only on a change of state, so a long outage does not spam.
  async scheduled(event, env, ctx) {
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



      // public routes are limited by IP before any work is done
      if (path === '/api/img' || path === '/api/leaderboard' ||
          path === '/api/nonce' || path === '/api/session' ||
          path === '/api/banner/event' || path === '/api/banner/stats') {
        if (await rateLimited(request, env, path, null)) return tooMany(request, env);
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
        const cacheKey = new Request(new URL('/api/img?mint=' + mint, url.origin).toString(), request);
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
            headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' }
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

      // ── health ──
      if (path === '/api/health' && request.method === 'GET') {
        const h = await healthCheck(env);
        return json(request, env, h, h.ok ? 200 : 503);
      }

      // ── admin: full export ──
      // Cloudflare keeps 30 days of point-in-time recovery, so this is for
      // holding a copy outside the account entirely.
      if (path === '/api/admin/export' && request.method === 'GET') {
        const auth = request.headers.get('Authorization') || '';
        if (!env.ADMIN_TOKEN || auth !== 'Bearer ' + env.ADMIN_TOKEN) {
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

      // ── public: leaderboard ──
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
        return json(request, env, {
          rangers: owned,
          staked: await stakedMints(env, wallet),
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

      if (path === '/api/award' && request.method === 'POST') {
        const { type } = await request.json();
        if (!['plushie', 'game', 'gacha'].includes(type)) {
          return json(request, env, { error: 'unknown award' }, 400);
        }
        // plushie is still click-triggered pending store.fun order verification;
        // capped at once per day per wallet so it cannot be farmed in bulk
        if (type === 'plushie') {
          const since = Date.now() - DAY_MS;
          const recent = await env.DB.prepare(
            'SELECT COUNT(*) AS n FROM events WHERE wallet = ? AND type = ? AND ts > ?'
          ).bind(wallet, 'plushie', since).first();
          if (recent && recent.n > 0) {
            return json(request, env, { awarded: 0, reason: 'already awarded today', player: await playerState(env, wallet) });
          }
        }
        await addPoints(env, wallet, type, AWARDS[type]);
        return json(request, env, { awarded: AWARDS[type], player: await playerState(env, wallet) });
      }

      if (path === '/api/migrate' && request.method === 'POST') {
        const { points } = await request.json();
        const p = await env.DB.prepare('SELECT migrated FROM players WHERE wallet = ?').bind(wallet).first();
        if (p && p.migrated) return json(request, env, { awarded: 0, player: await playerState(env, wallet) });
        const amount = Math.max(0, Math.min(MAX_MIGRATE, Math.floor(Number(points) || 0)));
        await env.DB.prepare('UPDATE players SET migrated = 1 WHERE wallet = ?').bind(wallet).run();
        if (amount > 0) await addPoints(env, wallet, 'migrated', amount);
        return json(request, env, { awarded: amount, player: await playerState(env, wallet) });
      }

      return json(request, env, { error: 'not found' }, 404);
    } catch (err) {
      const message = String((err && err.message) || err);
      ctx.waitUntil(logError(env, path, message));
      return json(request, env, { error: 'server error', detail: message }, 500);
    }
  }
};
