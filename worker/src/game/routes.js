// Moon Rangers game routes — all use env.GAME_DB (test D1), never env.DB (live).
// Wire into worker/src/index.js:
//
//   import { handleGameRoute } from './game/routes.js';
//
//   // Inside fetch handler, before other routes:
//   const gameResult = await handleGameRoute(path, request, env, ctx);
//   if (gameResult !== null) return gameResult;
//
// Required Worker bindings (wrangler.toml):
//   [[d1_databases]]
//   binding = "GAME_DB"
//   database_name = "moon-rangers-test"
//   database_id   = "<your test DB id>"
//
// Required Worker secrets (npx wrangler secret put <NAME>):
//   SERVER_TO_WORKER_SECRET
//   ADMIN_KEY

// ── Helpers ───────────────────────────────────────────────────────────────────

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MATCH_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isValidWallet(w) { return typeof w === 'string' && WALLET_RE.test(w); }
function isValidMatchId(m) { return typeof m === 'string' && MATCH_ID_RE.test(m); }

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const corsOrigin = allowed.includes(origin) ? origin : (allowed[0] ?? '');
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request, env),
    },
  });
}

function tokenMatches(header, secret) {
  if (!header || !secret) return false;
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

async function getSessionWallet(request, env) {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const row = await env.GAME_DB.prepare(
    'SELECT wallet FROM game_sessions WHERE token = ? AND expires_at > ?'
  ).bind(token, Date.now()).first();
  return row?.wallet ?? null;
}

async function ensureTables(env) {
  await env.GAME_DB.exec(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      token      TEXT PRIMARY KEY,
      wallet     TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_players (
      wallet     TEXT PRIMARY KEY,
      points     INTEGER NOT NULL DEFAULT 0,
      kills      INTEGER NOT NULL DEFAULT 0,
      deaths     INTEGER NOT NULL DEFAULT 0,
      matches    INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS game_matches (
      match_id   TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER,
      winner     TEXT,
      status     TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS game_match_players (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id   TEXT NOT NULL,
      wallet     TEXT NOT NULL,
      role       TEXT,
      kills      INTEGER NOT NULL DEFAULT 0,
      deaths     INTEGER NOT NULL DEFAULT 0,
      assists    INTEGER NOT NULL DEFAULT 0,
      team       INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS game_purchases (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet     TEXT NOT NULL,
      item_id    TEXT NOT NULL,
      hero_key   TEXT NOT NULL,
      price      INTEGER NOT NULL DEFAULT 0,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_approved_skins (
      wallet   TEXT NOT NULL,
      item_id  TEXT NOT NULL,
      PRIMARY KEY (wallet, item_id)
    );
  `);
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function handleGameRoute(path, request, env, ctx) {
  // CORS preflight — use ALLOWED_ORIGINS same as json() helper
  if (request.method === 'OPTIONS' && path.startsWith('/api/game')) {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, env),
    });
  }

  if (!path.startsWith('/api/game')) return null;

  // Lazy table creation (idempotent)
  await ensureTables(env);

  const url = new URL(request.url);

  // ── GET /api/game/points — Fox Points balance ────────────────────────────────
  if (path === '/api/game/points' && request.method === 'GET') {
    const wallet = url.searchParams.get('wallet');
    if (!wallet) return json(request, env, { error: 'wallet required' }, 400);
    if (!isValidWallet(wallet)) return json(request, env, { error: 'invalid wallet' }, 400);
    const row = await env.GAME_DB.prepare(
      'SELECT points FROM game_players WHERE wallet = ?'
    ).bind(wallet).first();
    return json(request, env, { wallet, points: row?.points ?? 0 });
  }

  // ── GET /api/game/leaderboard ────────────────────────────────────────────────
  if (path === '/api/game/leaderboard' && request.method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100);
    const rows = await env.GAME_DB.prepare(
      'SELECT wallet, points, kills, deaths, matches FROM game_players ORDER BY kills DESC LIMIT ?'
    ).bind(limit).all();
    return json(request, env, { players: rows.results ?? [] });
  }

  // ── POST /api/game/match/start — server-only ─────────────────────────────────
  if (path === '/api/game/match/start' && request.method === 'POST') {
    if (!tokenMatches(request.headers.get('Authorization'), env.SERVER_TO_WORKER_SECRET)) {
      return json(request, env, { error: 'unauthorized' }, 401);
    }
    const body = await request.json().catch(() => ({}));
    const matchId = body.match_id ?? crypto.randomUUID();
    await env.GAME_DB.prepare(
      'INSERT OR IGNORE INTO game_matches (match_id, started_at, status) VALUES (?, ?, ?)'
    ).bind(matchId, Date.now(), 'active').run();
    return json(request, env, { match_id: matchId });
  }

  // ── POST /api/game/match/end — server-only, awards points ────────────────────
  if (path === '/api/game/match/end' && request.method === 'POST') {
    if (!tokenMatches(request.headers.get('Authorization'), env.SERVER_TO_WORKER_SECRET)) {
      return json(request, env, { error: 'unauthorized' }, 401);
    }
    const body = await request.json().catch(() => ({}));
    const { match_id, winner, players = [] } = body;
    if (!match_id) return json(request, env, { error: 'match_id required' }, 400);
    if (!isValidMatchId(match_id)) return json(request, env, { error: 'invalid match_id' }, 400);

    await env.GAME_DB.prepare(
      'UPDATE game_matches SET ended_at = ?, winner = ?, status = ? WHERE match_id = ?'
    ).bind(Date.now(), winner ?? null, 'ended', match_id).run();

    // Award points: 10 FP per kill, +50 if on winning team
    const stmts = [];
    for (const p of players) {
      if (!p.wallet || !isValidWallet(p.wallet)) continue;
      const pts = (p.kills ?? 0) * 10 + (p.team === winner ? 50 : 0);
      stmts.push(
        env.GAME_DB.prepare(`
          INSERT INTO game_players (wallet, points, kills, deaths, matches, updated_at)
          VALUES (?, ?, ?, ?, 1, ?)
          ON CONFLICT(wallet) DO UPDATE SET
            points     = points + excluded.points,
            kills      = kills  + excluded.kills,
            deaths     = deaths + excluded.deaths,
            matches    = matches + 1,
            updated_at = excluded.updated_at
        `).bind(p.wallet, pts, p.kills ?? 0, p.deaths ?? 0, Date.now())
      );
      stmts.push(
        env.GAME_DB.prepare(
          'INSERT INTO game_match_players (match_id, wallet, role, kills, deaths, assists, team) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(match_id, p.wallet, p.role ?? null, p.kills ?? 0, p.deaths ?? 0, p.assists ?? 0, p.team ?? 0)
      );
    }
    if (stmts.length) await env.GAME_DB.batch(stmts);
    return json(request, env, { success: true, players_recorded: players.length });
  }

  // ── POST /api/game/shop/purchase ─────────────────────────────────────────────
  if (path === '/api/game/shop/purchase' && request.method === 'POST') {
    const wallet = await getSessionWallet(request, env);
    if (!wallet) return json(request, env, { error: 'session required' }, 401);

    const body = await request.json().catch(() => ({}));
    const { item_id, hero_key } = body;
    if (!item_id || !hero_key) return json(request, env, { error: 'item_id + hero_key required' }, 400);

    // Check if already owned
    const owned = await env.GAME_DB.prepare(
      'SELECT 1 FROM game_approved_skins WHERE wallet = ? AND item_id = ?'
    ).bind(wallet, item_id).first();
    if (owned) return json(request, env, { error: 'Already owned' }, 409);

    // Get price from a hard-coded table (can't trust client)
    const PRICES = {
      rf_carbon: 500, rf_solarflare: 1200, rf_voidwalker: 2500,
      sn_arctic: 500, sn_darkmatter: 1200, sn_sunshot: 2500,
      cqb_inferno: 500, cqb_bloodmoon: 1200, cqb_acid: 2500,
      tk_storm: 500, tk_volcano: 1200, tk_suneater: 2500,
      hl_lifeglow: 500, hl_rosegold: 1200, hl_aurora: 2500,
    };
    const price = PRICES[item_id];
    if (price === undefined) return json(request, env, { error: 'Unknown item' }, 404);
    if (price === 0) {
      // Free item — approve immediately
      await env.GAME_DB.prepare(
        'INSERT OR IGNORE INTO game_approved_skins (wallet, item_id) VALUES (?, ?)'
      ).bind(wallet, item_id).run();
      return json(request, env, { success: true, itemName: item_id, newBalance: null });
    }

    // Check balance
    const playerRow = await env.GAME_DB.prepare(
      'SELECT points FROM game_players WHERE wallet = ?'
    ).bind(wallet).first();
    const balance = playerRow?.points ?? 0;
    if (balance < price) return json(request, env, { error: 'Insufficient Fox Points' }, 402);

    // Deduct and approve in one batch
    await env.GAME_DB.batch([
      env.GAME_DB.prepare('UPDATE game_players SET points = points - ? WHERE wallet = ?').bind(price, wallet),
      env.GAME_DB.prepare('INSERT OR IGNORE INTO game_approved_skins (wallet, item_id) VALUES (?, ?)').bind(wallet, item_id),
      env.GAME_DB.prepare(
        'INSERT INTO game_purchases (wallet, item_id, hero_key, price, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(wallet, item_id, hero_key, price, 'approved', Date.now()),
    ]);

    const newBal = Math.max(0, balance - price);
    return json(request, env, { success: true, itemName: item_id, newBalance: newBal });
  }

  // ── GET /api/game/inventory — what skins does a wallet own ───────────────────
  if (path === '/api/game/inventory' && request.method === 'GET') {
    const wallet = url.searchParams.get('wallet');
    if (!wallet) return json(request, env, { error: 'wallet required' }, 400);
    if (!isValidWallet(wallet)) return json(request, env, { error: 'invalid wallet' }, 400);
    const rows = await env.GAME_DB.prepare(
      'SELECT item_id FROM game_approved_skins WHERE wallet = ?'
    ).bind(wallet).all();
    return json(request, env, { wallet, items: (rows.results ?? []).map(r => r.item_id) });
  }

  // ── GET /api/game/admin/purchases (admin only) ────────────────────────────────
  if (path === '/api/game/admin/purchases' && request.method === 'GET') {
    if (!tokenMatches(request.headers.get('Authorization'), env.ADMIN_KEY)) {
      return json(request, env, { error: 'unauthorized' }, 401);
    }
    const rows = await env.GAME_DB.prepare(
      'SELECT * FROM game_purchases ORDER BY created_at DESC LIMIT 100'
    ).all();
    return json(request, env, { purchases: rows.results ?? [] });
  }

  // ── GET /api/game/admin/players (admin only) ──────────────────────────────────
  if (path === '/api/game/admin/players' && request.method === 'GET') {
    if (!tokenMatches(request.headers.get('Authorization'), env.ADMIN_KEY)) {
      return json(request, env, { error: 'unauthorized' }, 401);
    }
    const rows = await env.GAME_DB.prepare(
      'SELECT * FROM game_players ORDER BY points DESC LIMIT 200'
    ).all();
    return json(request, env, { players: rows.results ?? [] });
  }

  return null; // Not a handled game route
}
