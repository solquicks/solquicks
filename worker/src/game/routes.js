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

  return null; // not a game route — caller falls through to 404
}
