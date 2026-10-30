// Moon Rangers FPS — game API routes
//
// Each route decides its own auth, because the three kinds of caller differ:
//   - the leaderboard is public, limited by IP like every other public read;
//   - match/start and match/end come from the game server, which proves itself
//     with SERVER_TO_WORKER_SECRET, not a player session;
//   - everything that credits or reads a player's points needs a session, and
//     the wallet is the session's, never one named in the request.
// So index.js dispatches /api/game/* ahead of its session gate.
//
// Tables live in schema.sql (migrations/004-game-tables.sql for production).
// Nothing here creates schema at request time.
//
// Points always go through addPoints, so every credit has its row in `events`.
//
// Security fix 2026-10-29 (H3): nothing the game reports is credited straight
// away any more. Matches, challenges and the share bonus land in
// game_pending_points as 'earned'; the player claims them on the Fox Points
// dashboard, and the admin approves or rejects each one. A Moon Rangers holder
// gets HOLDER_BOOST at approval, after a fresh on-chain ownership check.

const KILL_FP = 10;   // Fox Points per kill
const WIN_FP = 50;    // bonus for the winning team
const MAX_KILLS_PER_MATCH = 100; // sanity cap to prevent runaway awards
const MAX_PLAYERS_PER_MATCH = 64;

const DAY_MS = 86400000;

// The challenges the game offers, and what each is worth — decided here, not by
// whoever sends the request. Order matters: the game shows DAILIES_PER_DAY of
// these each UTC day, rotating through this list exactly as the client does
// (index-*.js: `sE[(day + n) % sE.length]`), and only those can be claimed.
export const DAILY_CHALLENGES = [
  { id: 'kills_5', fp: 10 },
  { id: 'wins_2', fp: 15 },
  { id: 'headshots_3', fp: 10 },
  { id: 'matches_3', fp: 10 },
  { id: 'ults_5', fp: 10 },
  { id: 'double_3', fp: 20 }
];
export const DAILIES_PER_DAY = 3;
export const WEEKLY_CHALLENGES = [{ id: 'play_10', fp: 50 }];

// The share bonus is kept in the same claims table as the challenges, under an
// id no challenge can have, so "once per wallet per day" is the same primary key.
const SHARE_CLAIM_ID = 'share:daily_tweet';
const SHARE_REWARD_FP = 25;

export const HOLDER_BOOST = 1.25;
const PENDING_SOURCES = ['match', 'challenge', 'share'];

const LEADERBOARD_PERIODS = { all: 0, weekly: 7 * DAY_MS, daily: DAY_MS };
const LEADERBOARD_DEFAULT_LIMIT = 100;
const LEADERBOARD_MAX_LIMIT = 100;

// ── Period keys ─────────────────────────────────────────────────────────────

export function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/// ISO 8601 week, e.g. 2026-W43. Weeks start on Monday, the same as the game's
/// own weekly reset, and the year is the one the week's Thursday falls in — so
/// 2027-01-01 is 2026-W53, not week 1 of 2027.
export function isoWeekKey(ts) {
  const d = new Date(ts);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const thursday = midnight + (3 - ((d.getUTCDay() + 6) % 7)) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY_MS));
  return year + '-W' + String(week).padStart(2, '0');
}

function activeDailies(ts) {
  const day = Math.floor(ts / DAY_MS);
  const out = [];
  for (let n = 0; n < DAILIES_PER_DAY; n++) out.push(DAILY_CHALLENGES[(day + n) % DAILY_CHALLENGES.length]);
  return out;
}

// ── Auth ────────────────────────────────────────────────────────────────────

/// Constant-time, and false whenever the secret is unset — an empty secret must
/// never match an empty or missing header.
function serverAuthorized(request, env) {
  const secret = env.SERVER_TO_WORKER_SECRET;
  if (!secret) return false;
  const given = request.headers.get('Authorization') || '';
  const want = 'Bearer ' + secret;
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Records points the game says were earned, for review. Nothing is credited
/// here. UNIQUE(wallet, source, source_id) means one match or one challenge
/// period can only ever be queued once.
async function queuePending(env, wallet, source, sourceId, fp) {
  if (!(fp > 0)) return false;
  const r = await env.DB.prepare(
    "INSERT OR IGNORE INTO game_pending_points (wallet, source, source_id, base_fp, status, created_at) VALUES (?, ?, ?, ?, 'earned', ?)"
  ).bind(wallet, source, sourceId, fp, Date.now()).run();
  return !!(r.meta && r.meta.changes === 1);
}

/// Claims one (wallet, id, period) and queues its points for review. The
/// INSERT OR IGNORE against the primary key is the lock: two racing requests
/// both get here, only one row is written, and only that one is queued.
async function claimOnce(env, h, wallet, id, period, fp, source) {
  await h.ensurePlayer(env, wallet);
  const r = await env.DB.prepare(
    'INSERT OR IGNORE INTO game_challenge_claims (wallet, challenge_id, fp_awarded, claimed_at, period_key) VALUES (?, ?, ?, ?, ?)'
  ).bind(wallet, id, fp, Date.now(), period).run();
  if (!r.meta || r.meta.changes !== 1) return false;
  await queuePending(env, wallet, source, id + ':' + period, fp);
  return true;
}

async function pendingSummary(env, wallet) {
  const rows = ((await env.DB.prepare(
    'SELECT id, source, source_id, base_fp, status, boost, awarded_fp, note, created_at, claimed_at, decided_at ' +
    'FROM game_pending_points WHERE wallet = ? ORDER BY id DESC LIMIT 100'
  ).bind(wallet).all()).results) || [];
  const totals = { earned: 0, claimed: 0, approved: 0, rejected: 0 };
  const t = ((await env.DB.prepare(
    'SELECT status, SUM(base_fp) AS base, SUM(COALESCE(awarded_fp, 0)) AS awarded FROM game_pending_points WHERE wallet = ? GROUP BY status'
  ).bind(wallet).all()).results) || [];
  for (const r of t) totals[r.status] = r.status === 'approved' ? (r.awarded || 0) : (r.base || 0);
  return { items: rows, totals: totals, holderBoost: HOLDER_BOOST };
}

async function pointsOf(env, wallet) {
  const row = await env.DB.prepare('SELECT points FROM players WHERE wallet = ?').bind(wallet).first();
  return row ? row.points : 0;
}

function cleanId(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

// ── Route handler ───────────────────────────────────────────────────────────

/// `h` is the worker's own helpers: json, getSession, ensurePlayer, addPoints,
/// isWallet, badgesFor, rateLimited, tooMany. Returns null for a path that is
/// not a game route.
export async function handleGameRequest(path, request, env, h) {
  const json = (body, status) => h.json(request, env, body, status);

  // GET /api/game/leaderboard?period=all|weekly|daily&limit=1..100 — public
  if (path === '/api/game/leaderboard' && request.method === 'GET') {
    const url = new URL(request.url);
    const period = url.searchParams.get('period') || 'all';
    if (!Object.prototype.hasOwnProperty.call(LEADERBOARD_PERIODS, period)) {
      return json({ error: 'period must be all, weekly or daily' }, 400);
    }
    const rawLimit = url.searchParams.get('limit');
    let limit = LEADERBOARD_DEFAULT_LIMIT;
    if (rawLimit !== null && rawLimit !== '') {
      if (!/^\d+$/.test(rawLimit)) return json({ error: 'limit must be a whole number' }, 400);
      limit = Math.min(Math.max(parseInt(rawLimit, 10), 1), LEADERBOARD_MAX_LIMIT);
    }
    const window = LEADERBOARD_PERIODS[period];
    const since = window ? Date.now() - window : 0;

    const res = await env.DB.prepare(
      'SELECT wallet, SUM(fp_awarded) AS points, SUM(won) AS wins, SUM(kills) AS kills ' +
      'FROM game_match_awards WHERE ended_at >= ? ' +
      'GROUP BY wallet ORDER BY points DESC, wallet ASC LIMIT ?'
    ).bind(since, limit).all();
    const found = res.results || [];
    const badges = await h.badgesFor(env, found.map(function (r) { return r.wallet; }));
    const rows = found.map(function (r, i) {
      return {
        rank: i + 1,
        wallet: r.wallet,
        // There is no profile name anywhere in the database yet; the page
        // falls back to the shortened wallet.
        display_name: null,
        is_holder: badges[r.wallet] === 'ranger',
        points: r.points || 0,
        wins: r.wins || 0,
        kills: r.kills || 0
      };
    });
    return json({ period, limit, rows });
  }

  // POST /api/game/match/start — game server only
  if (path === '/api/game/match/start' && request.method === 'POST') {
    if (!serverAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(function () { return {}; });
    const matchId = body.match_id === undefined ? crypto.randomUUID() : cleanId(body.match_id);
    if (!matchId) return json({ error: 'bad match_id' }, 400);
    const map = String(body.map || 'space_station').slice(0, 64);
    const mode = String(body.mode || 'tdm').slice(0, 32);

    await env.DB.prepare(
      'INSERT OR IGNORE INTO game_match_records (id, map, mode, started_at) VALUES (?, ?, ?, ?)'
    ).bind(matchId, map, mode, Date.now()).run();
    return json({ match_id: matchId, started: true });
  }

  // POST /api/game/match/end — game server only. Idempotent: each (match,
  // wallet) is recorded and paid at most once, and the first report fixes the
  // winner, so a replay — or a retry after a partial failure — never pays twice.
  if (path === '/api/game/match/end' && request.method === 'POST') {
    if (!serverAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
    const body = await request.json().catch(function () { return {}; });
    const matchId = cleanId(body.match_id);
    if (!matchId) return json({ error: 'match_id required' }, 400);
    const reportedWinner = String(body.winning_team || '').trim().slice(0, 32) || null;
    const players = Array.isArray(body.players) ? body.players.slice(0, MAX_PLAYERS_PER_MATCH) : [];
    const now = Date.now();

    // A match the server never started is still recorded; one already ended
    // keeps its first result.
    await env.DB.prepare(
      'INSERT INTO game_match_records (id, started_at, ended_at, winning_team) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at, winning_team = excluded.winning_team ' +
      'WHERE game_match_records.ended_at IS NULL'
    ).bind(matchId, now, now, reportedWinner).run();
    const match = await env.DB.prepare(
      'SELECT winning_team, ended_at FROM game_match_records WHERE id = ?'
    ).bind(matchId).first();
    const winningTeam = match.winning_team;

    const awards = [];
    let duplicates = 0;
    for (const p of players) {
      const wallet = String((p && p.wallet) || '').trim();
      if (!h.isWallet(wallet)) continue;
      const kills = Math.min(Math.max(parseInt(p.kills, 10) || 0, 0), MAX_KILLS_PER_MATCH);
      const deaths = Math.min(Math.max(parseInt(p.deaths, 10) || 0, 0), MAX_KILLS_PER_MATCH);
      const team = String(p.team || '').trim().slice(0, 32);
      const hero = String(p.hero || '').slice(0, 32);
      const won = !!winningTeam && team === winningTeam;
      const fp = kills * KILL_FP + (won ? WIN_FP : 0);

      const r = await env.DB.prepare(
        'INSERT OR IGNORE INTO game_match_awards (match_id, wallet, team, hero, kills, deaths, won, fp_awarded, ended_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(matchId, wallet, team, hero, kills, deaths, won ? 1 : 0, fp, match.ended_at).run();
      if (!r.meta || r.meta.changes !== 1) { duplicates++; continue; }

      // Queued for review, not credited (H3). fp_awarded on the match row is
      // what the match was worth before review; the balance moves only when
      // the admin approves it.
      if (fp > 0) {
        await h.ensurePlayer(env, wallet);
        await queuePending(env, wallet, 'match', matchId, fp);
      }
      awards.push({ wallet, kills, deaths, team, won, fp_awarded: fp, pending: fp > 0 });
    }

    return json({ match_id: matchId, winning_team: winningTeam, awards, duplicates });
  }

  // ── everything below is a player acting on their own account ──
  const PLAYER_ROUTES = ['/api/game/points', '/api/game/challenge-complete', '/api/game/share-reward',
    '/api/game/pending', '/api/game/pending/claim'];
  if (PLAYER_ROUTES.indexOf(path) < 0) return null;

  const wallet = await h.getSession(request, env);
  if (!wallet) return json({ error: 'not signed in' }, 401);
  if (await h.rateLimited(request, env, path, wallet)) return h.tooMany(request, env);

  // GET /api/game/points — the signed-in player's balance and game stats
  if (path === '/api/game/points' && request.method === 'GET') {
    const gp = await env.DB.prepare(
      'SELECT COUNT(*) AS matches_played, COALESCE(SUM(won), 0) AS matches_won, ' +
      'COALESCE(SUM(kills), 0) AS kills, COALESCE(SUM(deaths), 0) AS deaths, ' +
      'COALESCE(SUM(fp_awarded), 0) AS fp_earned FROM game_match_awards WHERE wallet = ?'
    ).bind(wallet).first();
    return json({
      wallet,
      points: await pointsOf(env, wallet),
      game_fp_earned: gp.fp_earned,
      kills: gp.kills,
      deaths: gp.deaths,
      matches_played: gp.matches_played,
      matches_won: gp.matches_won,
      pending: (await pendingSummary(env, wallet)).totals
    });
  }

  // GET /api/game/pending — what the game has earned this wallet, and where
  // each item is in review
  if (path === '/api/game/pending' && request.method === 'GET') {
    return json(await pendingSummary(env, wallet));
  }

  // POST /api/game/pending/claim — ask for review of everything earned so far
  if (path === '/api/game/pending/claim' && request.method === 'POST') {
    const r = await env.DB.prepare(
      "UPDATE game_pending_points SET status = 'claimed', claimed_at = ? WHERE wallet = ? AND status = 'earned'"
    ).bind(Date.now(), wallet).run();
    const n = (r.meta && r.meta.changes) || 0;
    if (n && h.alert) {
      await h.alert(env, '🎮 Game points claimed — ' + wallet + ' · ' + n + ' item' + (n === 1 ? '' : 's') +
        '\nReview with tools/game-points-admin.mjs or GET /api/admin/game/pending');
    }
    return json(Object.assign({ ok: true, claimed: n }, await pendingSummary(env, wallet)));
  }

  // POST /api/game/share-reward — the daily share bonus, once per UTC day
  if (path === '/api/game/share-reward' && request.method === 'POST') {
    const now = Date.now();
    const paid = await claimOnce(env, h, wallet, SHARE_CLAIM_ID, dayKey(now), SHARE_REWARD_FP, 'share');
    if (!paid) {
      const nextDay = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
      return json({ error: 'already_claimed', next_claim_in: Math.ceil((nextDay - now) / 60000) + 'm' }, 429);
    }
    // points_awarded is kept for the game client; the points are pending
    // review, so the balance (total) has not moved.
    return json({ ok: true, pending: true, points_awarded: SHARE_REWARD_FP, total: await pointsOf(env, wallet) });
  }

  // POST /api/game/challenge-complete — a challenge from the list above, at the
  // value set above, once per wallet per period. Any fp in the body is ignored.
  if (path === '/api/game/challenge-complete' && request.method === 'POST') {
    const body = await request.json().catch(function () { return {}; });
    const id = typeof body.challenge_id === 'string' ? body.challenge_id : '';
    const now = Date.now();

    let challenge = WEEKLY_CHALLENGES.find(function (c) { return c.id === id; });
    let period = challenge ? isoWeekKey(now) : null;
    if (!challenge) {
      challenge = DAILY_CHALLENGES.find(function (c) { return c.id === id; });
      if (!challenge) return json({ error: 'unknown challenge' }, 400);
      if (activeDailies(now).indexOf(challenge) < 0) return json({ error: 'challenge not active today' }, 400);
      period = dayKey(now);
    }

    const paid = await claimOnce(env, h, wallet, challenge.id, period, challenge.fp, 'challenge');
    if (!paid) return json({ ok: false, reason: 'already_claimed', challenge_id: challenge.id, period });
    return json({
      ok: true, pending: true, challenge_id: challenge.id, period,
      points_awarded: challenge.fp, total: await pointsOf(env, wallet)
    });
  }

  return null;
}

// ── Admin: the review queue ─────────────────────────────────────────────────
// Called from index.js after it has checked ADMIN_TOKEN, so nothing here
// re-checks it. `h` adds listRangers (fresh DAS ownership) to the helpers.

/// GET /api/admin/game/pending?status=claimed — the queue, with what each item
/// is based on, so it can be judged rather than rubber-stamped.
export async function adminListPending(env, h, status) {
  const want = ['earned', 'claimed', 'approved', 'rejected'].indexOf(status) >= 0 ? status : 'claimed';
  const rows = ((await env.DB.prepare(
    'SELECT * FROM game_pending_points WHERE status = ? ORDER BY COALESCE(claimed_at, created_at) ASC, id ASC LIMIT 200'
  ).bind(want).all()).results) || [];
  const out = [];
  for (const r of rows) {
    let evidence = null;
    if (r.source === 'match') {
      const m = await env.DB.prepare('SELECT * FROM game_match_records WHERE id = ?').bind(r.source_id).first();
      const a = await env.DB.prepare('SELECT team, hero, kills, deaths, won FROM game_match_awards WHERE match_id = ? AND wallet = ?')
        .bind(r.source_id, r.wallet).first();
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM game_match_awards WHERE match_id = ?').bind(r.source_id).first();
      evidence = { match: m || null, player: a || null, playersInMatch: (n && n.n) || 0 };
    } else {
      const parts = String(r.source_id).split(':');
      const period = parts.pop();
      evidence = { challenge: parts.join(':'), period: period };
    }
    const stats = await env.DB.prepare(
      'SELECT COUNT(*) AS matches, COALESCE(SUM(kills), 0) AS kills, COALESCE(SUM(won), 0) AS wins FROM game_match_awards WHERE wallet = ?'
    ).bind(r.wallet).first();
    out.push(Object.assign({}, r, { evidence: evidence, walletStats: stats }));
  }
  return { status: want, items: out, holderBoost: HOLDER_BOOST };
}

/// POST /api/admin/game/pending/decide { ids:[…], approve:true|false, note? }
///
/// Approving re-checks each wallet's Moon Rangers on-chain right then: a holder
/// gets floor(base × HOLDER_BOOST), anyone else the base. If the check cannot
/// be made, that wallet's items are left in the queue rather than paid at the
/// wrong rate. The status change is a conditional write made before the
/// credit, so approving the same item twice pays once.
export async function adminDecidePending(env, h, body) {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(function (n) { return Number.isInteger(n) && n > 0; }).slice(0, 200);
  if (!ids.length) return { status: 400, body: { error: 'ids required' } };
  const approve = body.approve === true;
  if (!approve && body.approve !== false) return { status: 400, body: { error: 'approve must be true or false' } };
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null;
  const marks = ids.map(function () { return '?'; }).join(',');
  const rows = ((await env.DB.prepare(
    'SELECT * FROM game_pending_points WHERE id IN (' + marks + ')'
  ).bind(...ids).all()).results) || [];
  const now = Date.now();
  const done = [], skipped = [];
  const holderOf = {};
  for (const r of rows) {
    if (!approve) {
      const u = await env.DB.prepare(
        "UPDATE game_pending_points SET status = 'rejected', note = ?, decided_at = ? WHERE id = ? AND status IN ('earned', 'claimed')"
      ).bind(note, now, r.id).run();
      if (u.meta && u.meta.changes === 1) done.push({ id: r.id, status: 'rejected' });
      else skipped.push({ id: r.id, reason: 'already ' + r.status });
      continue;
    }
    if (r.status !== 'claimed') { skipped.push({ id: r.id, reason: r.status === 'earned' ? 'not claimed by the player yet' : 'already ' + r.status }); continue; }
    if (!(r.wallet in holderOf)) {
      const owned = await h.listRangers(env, r.wallet).catch(function () { return null; });
      holderOf[r.wallet] = owned === null ? null : owned.length > 0;
    }
    if (holderOf[r.wallet] === null) { skipped.push({ id: r.id, reason: 'holder check unavailable — left in the queue' }); continue; }
    const boost = holderOf[r.wallet] ? HOLDER_BOOST : 1;
    const awarded = Math.floor(r.base_fp * boost);
    const u = await env.DB.prepare(
      "UPDATE game_pending_points SET status = 'approved', boost = ?, awarded_fp = ?, note = ?, decided_at = ? WHERE id = ? AND status = 'claimed'"
    ).bind(boost, awarded, note, now, r.id).run();
    if (!u.meta || u.meta.changes !== 1) { skipped.push({ id: r.id, reason: 'decided by someone else just now' }); continue; }
    await h.ensurePlayer(env, r.wallet);
    await h.addPoints(env, r.wallet, 'game_' + r.source, awarded);
    done.push({ id: r.id, status: 'approved', wallet: r.wallet, base: r.base_fp, boost: boost, awarded: awarded });
  }
  for (const id of ids) if (!rows.some(function (r) { return r.id === id; })) skipped.push({ id: id, reason: 'no such item' });
  return { status: 200, body: { ok: true, decided: done, skipped: skipped } };
}

export { PENDING_SOURCES };
