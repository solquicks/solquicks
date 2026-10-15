// Moon Rangers FPS — game API routes
// All game tables use the game_ prefix so they live safely alongside the
// existing Fox Points tables in the same D1 database.
//
// Server-to-worker calls (match/start, match/end) are authenticated with
// SERVER_TO_WORKER_SECRET via constant-time comparison to prevent timing attacks.
// Player calls use the existing session token system (env.DB sessions table).

const KILL_FP  = 10;   // Fox Points per kill
const WIN_FP   = 50;   // Bonus for winning team
const MAX_KILLS_PER_MATCH = 100; // sanity cap to prevent runaway awards

// ── Schema ─────────────────────────────────────────────────────────────────

async function ensureTables(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_sessions (
      id          TEXT PRIMARY KEY,
      wallet      TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_players (
      wallet      TEXT PRIMARY KEY,
      total_kills INTEGER NOT NULL DEFAULT 0,
      total_deaths INTEGER NOT NULL DEFAULT 0,
      matches_played INTEGER NOT NULL DEFAULT 0,
      matches_won INTEGER NOT NULL DEFAULT 0,
      fp_earned   INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT 0
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_matches (
      id          TEXT PRIMARY KEY,
      map         TEXT,
      mode        TEXT NOT NULL DEFAULT 'tdm',
      winning_team TEXT,
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_match_players (
      match_id    TEXT NOT NULL,
      wallet      TEXT NOT NULL,
      team        TEXT NOT NULL,
      hero        TEXT,
      kills       INTEGER NOT NULL DEFAULT 0,
      deaths      INTEGER NOT NULL DEFAULT 0,
      fp_awarded  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (match_id, wallet)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_purchases (
      id          TEXT PRIMARY KEY,
      wallet      TEXT NOT NULL,
      item_type   TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      amount_fp   INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_approved_skins (
      wallet      TEXT NOT NULL,
      skin_id     TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      PRIMARY KEY (wallet, skin_id)
    )`)
  ]);
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

function tokenMatches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  const enc = new TextEncoder();
  const ab  = enc.encode(a);
  const bb  = enc.encode(b);
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function getBearer(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

async function getSessionWallet(request, env) {
  const token = getBearer(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT wallet, expires FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (!row || row.expires < Date.now()) return null;
  return row.wallet;
}

function requireServerSecret(request, env) {
  const token  = getBearer(request);
  const secret = env.SERVER_TO_WORKER_SECRET || '';
  if (!secret) return false;
  return tokenMatches(token || '', secret);
}

// ── Response helper ──────────────────────────────────────────────────────────

function gameJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function handleGameRequest(path, request, env) {
  await ensureTables(env);

  // GET /api/game/points — player's current FP balance
  if (path === '/api/game/points' && request.method === 'GET') {
    const wallet = await getSessionWallet(request, env);
    if (!wallet) return gameJson({ error: 'unauthorized' }, 401);

    const row = await env.DB.prepare(
      'SELECT points FROM players WHERE wallet = ?'
    ).bind(wallet).first();

    const gp = await env.DB.prepare(
      'SELECT fp_earned, total_kills, total_deaths, matches_played, matches_won FROM game_players WHERE wallet = ?'
    ).bind(wallet).first();

    return gameJson({
      wallet,
      points:         row?.points ?? 0,
      game_fp_earned: gp?.fp_earned ?? 0,
      kills:          gp?.total_kills ?? 0,
      deaths:         gp?.total_deaths ?? 0,
      matches_played: gp?.matches_played ?? 0,
      matches_won:    gp?.matches_won ?? 0,
    });
  }

  // GET /api/game/leaderboard — top 25 by kills
  if (path === '/api/game/leaderboard' && request.method === 'GET') {
    const rows = await env.DB.prepare(`
      SELECT wallet, total_kills, total_deaths, matches_played, matches_won, fp_earned
      FROM game_players
      ORDER BY total_kills DESC
      LIMIT 25
    `).all();

    return gameJson({ leaderboard: rows.results ?? [] });
  }

  // POST /api/game/match/start — called by game server when a match begins
  if (path === '/api/game/match/start' && request.method === 'POST') {
    if (!requireServerSecret(request, env)) return gameJson({ error: 'forbidden' }, 403);

    const body     = await request.json().catch(() => ({}));
    const matchId  = body.match_id  || crypto.randomUUID();
    const map      = String(body.map || 'space_station').slice(0, 64);
    const mode     = String(body.mode || 'tdm').slice(0, 32);

    await env.DB.prepare(
      'INSERT OR IGNORE INTO game_matches (id, map, mode, started_at) VALUES (?, ?, ?, ?)'
    ).bind(matchId, map, mode, Date.now()).run();

    return gameJson({ match_id: matchId, started: true });
  }

  // POST /api/game/match/end — called by game server to report results + award FP
  if (path === '/api/game/match/end' && request.method === 'POST') {
    if (!requireServerSecret(request, env)) return gameJson({ error: 'forbidden' }, 403);

    const body        = await request.json().catch(() => ({}));
    const matchId     = String(body.match_id || '').trim();
    const winningTeam = String(body.winning_team || '').trim();
    const players     = Array.isArray(body.players) ? body.players : [];

    if (!matchId) return gameJson({ error: 'match_id required' }, 400);

    const now = Date.now();
    await env.DB.prepare(
      'UPDATE game_matches SET winning_team = ?, ended_at = ? WHERE id = ?'
    ).bind(winningTeam || null, now, matchId).run();

    const awards = [];
    for (const p of players) {
      const wallet = String(p.wallet || '').trim();
      if (!wallet || wallet.length < 32 || wallet.length > 44) continue;

      const kills  = Math.min(Math.max(parseInt(p.kills,  10) || 0, 0), MAX_KILLS_PER_MATCH);
      const deaths = Math.min(Math.max(parseInt(p.deaths, 10) || 0, 0), MAX_KILLS_PER_MATCH);
      const team   = String(p.team || '').trim();
      const hero   = String(p.hero || '').slice(0, 32);
      const won    = winningTeam && team === winningTeam;
      const fp     = kills * KILL_FP + (won ? WIN_FP : 0);

      // Insert or update game_players aggregates
      await env.DB.prepare(`
        INSERT INTO game_players (wallet, total_kills, total_deaths, matches_played, matches_won, fp_earned, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(wallet) DO UPDATE SET
          total_kills    = total_kills + excluded.total_kills,
          total_deaths   = total_deaths + excluded.total_deaths,
          matches_played = matches_played + 1,
          matches_won    = matches_won + excluded.matches_won,
          fp_earned      = fp_earned + excluded.fp_earned,
          updated_at     = excluded.updated_at
      `).bind(wallet, kills, deaths, won ? 1 : 0, fp, now).run();

      // Record per-match player row
      await env.DB.prepare(`
        INSERT OR IGNORE INTO game_match_players (match_id, wallet, team, hero, kills, deaths, fp_awarded)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(matchId, wallet, team, hero, kills, deaths, fp).run();

      // Award Fox Points via existing players table if they have an account
      if (fp > 0) {
        await env.DB.prepare(
          'UPDATE players SET points = points + ?, updated_at = ? WHERE wallet = ?'
        ).bind(fp, now, wallet).run();
        await env.DB.prepare(
          'INSERT INTO events (wallet, type, points, ts) VALUES (?, ?, ?, ?)'
        ).bind(wallet, 'game_match', fp, now).run();
      }

      awards.push({ wallet, kills, deaths, team, won, fp_awarded: fp });
    }

    return gameJson({ match_id: matchId, awards });
  }

  // GET /api/game/leaderboard?period=all|weekly|daily&limit=200 — leaderboard by Fox Points
  if (path.startsWith('/api/game/leaderboard') && request.method === 'GET') {
    const url    = new URL(request.url);
    const period = url.searchParams.get('period') ?? 'all';
    const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10), 500);
    const creator = url.searchParams.get('creator') ?? 'solquicks';

    let since = 0;
    if (period === 'weekly') since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (period === 'daily')  since = Date.now() -     24 * 60 * 60 * 1000;

    let rows;
    if (since > 0) {
      rows = await env.DB.prepare(`
        SELECT gmp.wallet,
               SUM(gmp.fp_awarded)  AS points,
               SUM(CASE WHEN gm.winning_team = gmp.team THEN 1 ELSE 0 END) AS wins,
               SUM(gmp.kills)       AS kills
        FROM game_match_players gmp
        LEFT JOIN game_matches gm ON gm.id = gmp.match_id
        WHERE gmp.wallet IS NOT NULL AND gm.ended_at > ?
        GROUP BY gmp.wallet
        ORDER BY points DESC
        LIMIT ?
      `).bind(since, limit).all();
    } else {
      rows = await env.DB.prepare(`
        SELECT wallet, fp_earned AS points, matches_won AS wins, total_kills AS kills
        FROM game_players
        ORDER BY fp_earned DESC
        LIMIT ?
      `).bind(limit).all();
    }

    return gameJson({ rows: rows.results ?? [] });
  }

  // GET /api/creator/config?id=xxx — per-creator game configuration
  if (path.startsWith('/api/creator/config') && request.method === 'GET') {
    const url       = new URL(request.url);
    const creatorId = url.searchParams.get('id') ?? 'solquicks';

    // Basic validation
    if (!/^[a-z0-9_-]{1,40}$/.test(creatorId)) return gameJson({ error: 'invalid creator_id' }, 400);

    const row = await env.DB.prepare(
      'SELECT creator_id, display_name, accent_color, logo_url, leaderboard_url, points_label FROM game_creators WHERE creator_id = ? AND active = 1'
    ).bind(creatorId).first();

    if (!row) return gameJson({ error: 'creator not found' }, 404);
    return gameJson(row);
  }

  // POST /api/game/share-reward — daily tweet bonus (25 FP, once per 22 h)
  if (path === '/api/game/share-reward' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const wallet = String(body.wallet ?? '').trim();
    if (!wallet || wallet.length < 32 || wallet.length > 44) return gameJson({ error: 'invalid wallet' }, 400);

    const claimType = 'daily_tweet';
    const creator   = String(body.creator_id ?? 'solquicks').slice(0, 40);
    const pts       = 25;
    const now       = Date.now();
    const window    = 22 * 60 * 60 * 1000;

    const last = await env.DB.prepare(
      'SELECT claimed_at FROM game_share_claims WHERE wallet = ? AND claim_type = ? ORDER BY claimed_at DESC LIMIT 1'
    ).bind(wallet, claimType).first();

    if (last && now - last.claimed_at < window) {
      return gameJson({ error: 'already_claimed', next_claim_in: Math.ceil((window - (now - last.claimed_at)) / 60000) + 'm' }, 429);
    }

    await env.DB.prepare(
      'INSERT INTO game_share_claims (wallet, claim_type, points, creator_id, claimed_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(wallet, claimType, pts, creator, now).run();

    await env.DB.prepare(
      'INSERT INTO players (wallet, points, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(wallet) DO UPDATE SET points = points + ?, updated_at = ?'
    ).bind(wallet, pts, now, now, pts, now).run();

    await env.DB.prepare(
      'INSERT INTO events (wallet, type, points, ts) VALUES (?, ?, ?, ?)'
    ).bind(wallet, 'share_reward', pts, now).run();

    const total = (await env.DB.prepare('SELECT points FROM players WHERE wallet = ?').bind(wallet).first())?.points ?? pts;
    return gameJson({ ok: true, points_awarded: pts, total });
  }

  return null; // not a game route — caller falls through to 404
}
