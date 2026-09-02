// solquicks Fox Points API
// Points live here, not in the visitor's browser. Every award is decided
// server-side; the client can only ask, never assert a balance.

const DAY_MS = 86400000;
const STAKE_RATE_PER_DAY = 100;
const SESSION_TTL_MS = 30 * DAY_MS;
const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_MIGRATE = 5000; // ceiling on one-time localStorage import

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
  return {
    wallet,
    stakedMints: (staked.results || []).map(function (x) { return x.mint; }),
    points: p ? p.points : 0,
    migrated: p ? !!p.migrated : false,
    lastVisit: p ? p.last_visit : null,
    log: (log.results || []).map(r => ({ e: r.type, p: r.points, t: r.ts })),
    stake: { staked: !!s.staked, since: s.since, count: s.count, accrued: stakeAccrued(s) }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
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

      // ── public: leaderboard ──
      if (path === '/api/leaderboard' && request.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT wallet, points FROM players WHERE points > 0 ORDER BY points DESC, wallet ASC LIMIT 100'
        ).all();
        return json(request, env, { players: rows.results || [] });
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
      return json(request, env, { error: 'server error', detail: String(err && err.message || err) }, 500);
    }
  }
};
