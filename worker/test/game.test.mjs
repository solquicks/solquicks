// Moon Rangers: the /api/game routes.
//
// Two of these routes credit Fox Points, the same balance the site-wide
// leaderboard ranks and the shop spends. They used to take the wallet, the
// challenge and the amount from the request body, so anyone signed in could
// mint points into any wallet by inventing challenge ids. What matters here is
// that a credit only ever lands on the session's own wallet, only for a
// challenge the server knows, at the server's value, and once per period no
// matter how the requests are timed.
//
// The rest is reachability: the public leaderboard and the game server's
// match reports used to sit behind the session gate and never answered.

import {
  MIN, HOUR, clock, advance, setClock, START, freshEnv, call, wallet, signIn,
  ok, eq, section, finish
} from './harness.mjs';
import fs from 'node:fs';
import {
  DAILY_CHALLENGES, WEEKLY_CHALLENGES, DAILIES_PER_DAY, isoWeekKey, dayKey
} from '../src/game/routes.js';

const DAY = 24 * HOUR;
const SECRET = 'game-server-test-secret-0123456789';

const points = (env, w) => (env._db.prepare('SELECT points FROM players WHERE wallet = ?').get(w) || {}).points || 0;
const events = (env, w) => env._db.prepare('SELECT type, points FROM events WHERE wallet = ? ORDER BY id').all(w);
const claims = (env) => env._db.prepare('SELECT * FROM game_challenge_claims ORDER BY claimed_at').all();
const awards = (env, m) => env._db.prepare('SELECT * FROM game_match_awards WHERE match_id = ? ORDER BY wallet').all(m);

// What the game shows today, by the game's own rule.
const activeToday = () => {
  const day = Math.floor(clock / DAY);
  return Array.from({ length: DAILIES_PER_DAY }, (_, n) => DAILY_CHALLENGES[(day + n) % DAILY_CHALLENGES.length]);
};
const inactiveToday = () => DAILY_CHALLENGES.find((c) => activeToday().indexOf(c) < 0);
const WEEKLY = WEEKLY_CHALLENGES[0];

const complete = (env, token, body) => call(env, 'POST', '/api/game/challenge-complete', { token, body });
const share = (env, token, body = {}) => call(env, 'POST', '/api/game/share-reward', { token, body });
const server = (env, p, body, token = SECRET) => call(env, 'POST', '/api/game/match/' + p, { token, body });

// ═════════════════════════════════════════════════════════════════════════════

section('the whitelist is the game\'s own list');
{
  // The ids and values the shipped game offers. If the game changes them and
  // this list does not follow, players finish challenges the server refuses.
  const html = fs.readFileSync(new URL('../../games/moon-rangers/index.html', import.meta.url), 'utf8');
  const bundle = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)[1];
  const js = fs.readFileSync(new URL('../../games/moon-rangers/assets/' + bundle, import.meta.url), 'utf8');
  const listed = [...js.slice(js.indexOf('moonrangers_challenges_progress')).slice(0, 2000)
    .matchAll(/\{id:`([a-z0-9_]+)`,event:`[a-z_]+`,goal:\d+,label:`[^`]*`,xp:\d+,fp:(\d+)\}/g)]
    .map((m) => m[1] + '=' + m[2]);
  const ours = DAILY_CHALLENGES.concat(WEEKLY_CHALLENGES).map((c) => c.id + '=' + c.fp);
  eq('the dailies and the weekly match the game, in order', ours.join(','), listed.join(','));
}

section('ISO week keys');
{
  eq('a Sunday belongs to the week that began the Monday before', isoWeekKey(Date.UTC(2026, 9, 25, 23, 59)), '2026-W43');
  eq('and Monday starts the next', isoWeekKey(Date.UTC(2026, 9, 26, 0, 0)), '2026-W44');
  eq('New Year\'s Day 2027 is still 2026\'s last week', isoWeekKey(Date.UTC(2027, 0, 1)), '2026-W53');
  eq('30 Dec 2024 is already 2025\'s first week', isoWeekKey(Date.UTC(2024, 11, 30)), '2025-W01');
  eq('4 January is always week 1', isoWeekKey(Date.UTC(2021, 0, 4)), '2021-W01');
  // The old key was built from the day of the MONTH, so the 3rd of every month
  // shared a key and a weekly could be claimed once a month instead of weekly,
  // or not at all after a collision.
  ok('the 3rd of two months are different weeks',
    isoWeekKey(Date.UTC(2026, 8, 3)) !== isoWeekKey(Date.UTC(2026, 9, 3)));
}

section('a challenge needs a session');
{
  const env = freshEnv();
  const a = wallet(1);
  const id = activeToday()[0].id;

  const none = await complete(env, null, { wallet: a, challenge_id: id, fp: 100 });
  eq('no session is refused', none.status, 401);
  const expired = await complete(env, signIn(env, a, { expired: true }), { wallet: a, challenge_id: id });
  eq('an expired one too', expired.status, 401);
  const forged = await complete(env, 'not-a-real-token', { wallet: a, challenge_id: id });
  eq('and a made-up one', forged.status, 401);
  eq('nothing was credited', points(env, a), 0);
  eq('nothing was claimed', claims(env).length, 0);

  const sh = await share(env, null, { wallet: a });
  eq('the share bonus needs one as well', sh.status, 401);
  eq('and credited nothing', points(env, a), 0);
}

section('the wallet is the session\'s, whatever the body says');
{
  const env = freshEnv();
  const me = wallet(1), victim = wallet(2);
  const token = signIn(env, me);
  const c = activeToday()[0];

  const r = await complete(env, token, { wallet: victim, challenge_id: c.id, fp: 100 });
  eq('answers', r.status, 200);
  eq('pays', r.body.ok, true);
  eq('the session\'s wallet is credited', points(env, me), c.fp);
  eq('the wallet named in the body gets nothing', points(env, victim), 0);
  eq('and has no ledger rows', events(env, victim).length, 0);

  const s = await share(env, token, { wallet: victim });
  eq('the share bonus likewise goes to the session', points(env, me), c.fp + 25);
  eq('and not to the wallet in the body', points(env, victim), 0);
}

section('the amount is the server\'s');
{
  const env = freshEnv();
  const me = wallet(3);
  const token = signIn(env, me);
  const [c1, c2] = activeToday();

  const big = await complete(env, token, { challenge_id: c1.id, fp: 100 });
  eq('asking for 100 pays the listed value', big.body.points_awarded, c1.fp);
  const small = await complete(env, token, { challenge_id: c2.id, fp: 1 });
  eq('asking for 1 also pays the listed value', small.body.points_awarded, c2.fp);
  eq('the balance is exactly the two listed values', points(env, me), c1.fp + c2.fp);
  eq('each credit has its ledger row, typed by challenge',
    JSON.stringify(events(env, me)),
    JSON.stringify([{ type: 'challenge_' + c1.id, points: c1.fp }, { type: 'challenge_' + c2.id, points: c2.fp }]));
}

section('only known, current challenges');
{
  const env = freshEnv();
  const me = wallet(4);
  const token = signIn(env, me);

  for (const bad of ['made_up_1', 'kills_5x', '', 'share:daily_tweet', 'challenge_kills_5']) {
    const r = await complete(env, token, { challenge_id: bad, fp: 100 });
    eq('"' + bad + '" is refused', r.status, 400);
  }
  for (const bad of [null, 5, ['kills_5'], { id: 'kills_5' }]) {
    const r = await complete(env, token, { challenge_id: bad });
    eq(JSON.stringify(bad) + ' is refused', r.status, 400);
  }
  const notToday = inactiveToday();
  const r = await complete(env, token, { challenge_id: notToday.id });
  eq('a real daily that is not on today\'s list is refused', r.status, 400);
  eq('with a reason', r.body.error, 'challenge not active today');
  const junk = await call(env, 'POST', '/api/game/challenge-complete', { token });
  eq('no body at all is refused', junk.status, 400);

  eq('none of that credited anything', points(env, me), 0);
  eq('or claimed anything', claims(env).length, 0);
  eq('or wrote to the ledger', events(env, me).length, 0);
}

section('once per period, one after another');
{
  setClock(START);
  const env = freshEnv();
  const me = wallet(5);
  const token = signIn(env, me);
  const c = activeToday()[0];

  const first = await complete(env, token, { challenge_id: c.id });
  eq('the first claim pays', first.body.ok, true);
  eq('keyed to today', first.body.period, dayKey(clock));
  const again = await complete(env, token, { challenge_id: c.id });
  eq('the second does not', again.body.ok, false);
  eq('and says why', again.body.reason, 'already_claimed');
  advance(8 * HOUR);   // 23:00 UTC, still the same day
  const later = await complete(env, token, { challenge_id: c.id });
  eq('nor later the same day', later.body.ok, false);
  eq('one credit in all', points(env, me), c.fp);
  eq('one ledger row', events(env, me).length, 1);

  // START is a Monday, so six more days stay inside the ISO week.
  setClock(START);
  const w1 = await complete(env, token, { challenge_id: WEEKLY.id });
  eq('the weekly pays', w1.body.ok, true);
  eq('keyed to the ISO week', w1.body.period, isoWeekKey(START));
  advance(6 * DAY);
  // A test session lasts a day, so sign in again after each jump.
  const w2 = await complete(env, signIn(env, me), { challenge_id: WEEKLY.id });
  eq('and not again on the Sunday', w2.body.ok, false);
  advance(DAY);
  const w3 = await complete(env, signIn(env, me), { challenge_id: WEEKLY.id });
  eq('but again the next Monday', w3.body.ok, true);
  ok('under the next week\'s key', w3.body.period !== w1.body.period, w3.body.period);
  eq('two weeklies, one daily', points(env, me), c.fp + 2 * WEEKLY.fp);
  setClock(START);
}

section('once per period, all at once');
{
  const env = freshEnv();
  const me = wallet(6);
  const token = signIn(env, me);
  const c = activeToday()[1];

  // Every D1 call yields to the event loop, so these interleave; and nothing
  // reads before it writes, so there is no gap to race through.
  const all = await Promise.all(Array.from({ length: 12 }, () => complete(env, token, { challenge_id: c.id })));
  eq('every request answered', all.filter((r) => r.status === 200).length, 12);
  eq('exactly one was paid', all.filter((r) => r.body.ok === true).length, 1);
  eq('the balance is one credit', points(env, me), c.fp);
  eq('one ledger row', events(env, me).length, 1);
  eq('one claim row', claims(env).length, 1);

  // Forced: one request held right at its INSERT while another runs to the
  // end. A read-then-write would pay both here.
  const c2 = activeToday()[2];
  const gate = env.DB.pauseBefore(/INSERT OR IGNORE INTO game_challenge_claims/);
  const held = complete(env, token, { challenge_id: c2.id });
  await gate.reached;
  const quick = await complete(env, token, { challenge_id: c2.id });
  gate.release();
  const slow = await held;
  eq('the request that got in first is paid', quick.body.ok, true);
  eq('the one held at the door is not', slow.body.ok, false);
  eq('so the balance moved once more', points(env, me), c.fp + c2.fp);
}

section('the share bonus, once per UTC day');
{
  setClock(START);
  const env = freshEnv();
  const me = wallet(7);
  const token = signIn(env, me);

  const first = await share(env, token);
  eq('pays', first.body.ok, true);
  eq('25 points', first.body.points_awarded, 25);
  eq('reports the new total', first.body.total, 25);
  const again = await share(env, token);
  eq('a second the same day is refused', again.status, 429);
  eq('as already claimed', again.body.error, 'already_claimed');
  ok('saying when the next one opens', /^\d+m$/.test(again.body.next_claim_in), again.body.next_claim_in);

  const burst = await Promise.all(Array.from({ length: 8 }, () => share(env, token)));
  eq('a burst pays nothing more', burst.filter((r) => r.body.ok).length, 0);

  // The next UTC day, not 22 hours later.
  const midnight = (Math.floor(clock / DAY) + 1) * DAY;
  setClock(midnight - MIN);
  eq('not a minute before midnight', (await share(env, token)).status, 429);
  setClock(midnight);
  eq('but at midnight UTC', (await share(env, token)).body.ok, true);
  eq('two bonuses in all', points(env, me), 50);
  eq('each on the ledger as share_reward', events(env, me).map((e) => e.type).join(','), 'share_reward,share_reward');

  const fresh = wallet(8);
  const t2 = signIn(env, fresh);
  const race = await Promise.all(Array.from({ length: 8 }, () => share(env, t2)));
  eq('a fresh wallet racing itself is paid once', race.filter((r) => r.body.ok).length, 1);
  eq('25 points', points(env, fresh), 25);
  setClock(START);
}

section('match/start and match/end are the game server\'s');
{
  const env = freshEnv({ SERVER_TO_WORKER_SECRET: SECRET });
  const p = wallet(10);
  const body = { match_id: 'm-auth', winning_team: 'red', players: [{ wallet: p, team: 'red', kills: 3 }] };

  for (const [name, token] of [['no secret', null], ['a wrong secret', 'nope'],
    ['the right length but wrong', SECRET.replace(/.$/, 'X')], ['a player session', signIn(env, p)]]) {
    eq('start with ' + name + ' is 401', (await server(env, 'start', { match_id: 'm-auth' }, token)).status, 401);
    eq('end with ' + name + ' is 401', (await server(env, 'end', body, token)).status, 401);
  }
  eq('none of that recorded a match', env._db.prepare('SELECT COUNT(*) AS n FROM game_match_records').get().n, 0);
  eq('or paid anyone', points(env, p), 0);

  // Reaching the handler at all is the fix: these used to die at the session
  // gate with "not signed in" whatever secret they carried.
  const s = await server(env, 'start', { match_id: 'm-auth', map: 'moon_base' });
  eq('with the secret, start is accepted', s.status, 200);
  eq('and names the match', s.body.match_id, 'm-auth');
  const e = await server(env, 'end', body);
  eq('and so is end', e.status, 200);
  eq('paying kills and the win', points(env, p), 3 * 10 + 50);

  const gen = await server(env, 'start', {});
  ok('a start without an id is given one', typeof gen.body.match_id === 'string' && gen.body.match_id.length > 8);
  eq('an id with odd characters is refused', (await server(env, 'start', { match_id: 'a b/../c' })).status, 400);
  eq('end without an id is refused', (await server(env, 'end', { players: [] })).status, 400);

  // An unset secret must not turn into "anything goes", or into matching an
  // empty or literal-undefined bearer.
  const open = freshEnv();
  for (const token of [null, '', 'undefined', SECRET]) {
    eq('unset secret: start with ' + JSON.stringify(token) + ' is 401', (await server(open, 'start', { match_id: 'x' }, token)).status, 401);
    eq('unset secret: end with ' + JSON.stringify(token) + ' is 401', (await server(open, 'end', body, token)).status, 401);
  }
  const blank = freshEnv({ SERVER_TO_WORKER_SECRET: '' });
  eq('an empty secret is the same as none', (await server(blank, 'end', body, '')).status, 401);
}

section('a match is recorded and paid once');
{
  const env = freshEnv({ SERVER_TO_WORKER_SECRET: SECRET });
  const red = wallet(11), blue = wallet(12), greedy = wallet(13);
  await server(env, 'start', { match_id: 'm-1' });
  const body = {
    match_id: 'm-1', winning_team: 'red',
    players: [
      { wallet: red, team: 'red', kills: 4, deaths: 1, hero: 'rifleman' },
      { wallet: blue, team: 'blue', kills: 2, deaths: 4 },
      { wallet: greedy, team: 'blue', kills: 99999, deaths: -5 },
      { wallet: 'not-a-wallet', team: 'red', kills: 10 },
      { wallet: red, team: 'blue', kills: 50 }          // the same wallet twice
    ]
  };
  const first = await server(env, 'end', body);
  eq('answers', first.status, 200);
  eq('three real wallets recorded', awards(env, 'm-1').length, 3);
  eq('the winner is paid kills plus the win', points(env, red), 4 * 10 + 50);
  eq('the loser is paid kills only', points(env, blue), 2 * 10);
  eq('kills are capped', points(env, greedy), 100 * 10);
  eq('a wallet listed twice is paid once, as first listed', first.body.awards.filter((a) => a.wallet === red).length, 1);
  eq('negative deaths become zero', awards(env, 'm-1').find((a) => a.wallet === greedy).deaths, 0);
  eq('the credit is on the ledger', JSON.stringify(events(env, red)), JSON.stringify([{ type: 'game_match', points: 90 }]));

  const replay = await server(env, 'end', Object.assign({}, body, { winning_team: 'blue' }));
  eq('a replay answers', replay.status, 200);
  eq('and pays nobody', replay.body.awards.length, 0);
  eq('reporting the duplicates', replay.body.duplicates, 4);
  eq('the winner stays the one first reported', replay.body.winning_team, 'red');
  eq('red\'s balance did not move', points(env, red), 90);
  eq('blue\'s did not either', points(env, blue), 20);
  eq('still three rows', awards(env, 'm-1').length, 3);
  eq('still one ledger row each', events(env, red).length, 1);

  // The same report arriving twice at once, as a retrying server would.
  const late = wallet(14);
  const twice = { match_id: 'm-2', winning_team: 'red', players: [{ wallet: late, team: 'red', kills: 1 }] };
  const both = await Promise.all([server(env, 'end', twice), server(env, 'end', twice), server(env, 'end', twice)]);
  eq('three at once all answer', both.filter((r) => r.status === 200).length, 3);
  eq('and only one pays', both.reduce((n, r) => n + r.body.awards.length, 0), 1);
  eq('so the balance is one match', points(env, late), 60);

  // A report that dies part-way is finished by a retry, without paying the
  // players it already got to.
  const env2 = freshEnv({ SERVER_TO_WORKER_SECRET: SECRET });
  const a = wallet(15), b = wallet(16);
  env2._db.prepare(
    "INSERT INTO game_match_records (id, started_at, ended_at, winning_team) VALUES ('m-3', ?, ?, 'red')"
  ).run(clock, clock);
  env2._db.prepare(
    "INSERT INTO game_match_awards (match_id, wallet, team, kills, deaths, won, fp_awarded, ended_at) VALUES ('m-3', ?, 'red', 1, 0, 1, 60, ?)"
  ).run(a, clock);
  const retry = await server(env2, 'end', { match_id: 'm-3', winning_team: 'red', players: [
    { wallet: a, team: 'red', kills: 1 }, { wallet: b, team: 'red', kills: 2 }] });
  eq('a retry pays only who was missing', retry.body.awards.map((x) => x.wallet).join(','), b);
  eq('who gets kills and the win', points(env2, b), 70);
}

section('the leaderboard is public');
{
  const env = freshEnv({ SERVER_TO_WORKER_SECRET: SECRET });
  const top = wallet(20), mid = wallet(21), holder = wallet(22);
  signIn(env, holder, { holder: true });
  await server(env, 'end', { match_id: 'lb-1', winning_team: 'red', players: [
    { wallet: top, team: 'red', kills: 8 }, { wallet: mid, team: 'blue', kills: 3 }, { wallet: holder, team: 'red', kills: 0 }] });

  const r = await call(env, 'GET', '/api/game/leaderboard?period=all&limit=200');
  eq('answers without a session', r.status, 200);
  eq('to the site\'s origin', r.cors, 'https://solquicks.com');
  eq('saying the answer depends on the origin', r.headers.get('Vary'), 'Origin');
  ok('as rows, which is what the page reads', Array.isArray(r.body.rows), JSON.stringify(r.body));
  ok('not the old shadowing shape', !('leaderboard' in r.body));
  eq('ranked by Fox Points', r.body.rows.map((x) => x.wallet).join(','), [top, holder, mid].join(','));
  const row = r.body.rows[0];
  eq('with points', row.points, 8 * 10 + 50);
  eq('wins', row.wins, 1);
  eq('kills', row.kills, 8);
  eq('a rank', row.rank, 1);
  ok('a display_name field, null while there are no names', 'display_name' in row && row.display_name === null);
  eq('the holder is marked', r.body.rows[1].is_holder, true);
  eq('others are not', row.is_holder, false);

  const evil = await call(env, 'GET', '/api/game/leaderboard', { origin: 'https://evil-solquicks.com' });
  eq('another origin still gets an answer', evil.status, 200);
  eq('but no permission to read it', evil.cors, undefined);
  const creator = await call(env, 'GET', '/api/game/leaderboard', { origin: 'https://ripple.solquicks.com' });
  eq('a creator subdomain may read it', creator.cors, 'https://ripple.solquicks.com');

  const pre = await call(env, 'OPTIONS', '/api/game/leaderboard');
  eq('a preflight is answered', pre.status, 204);
  eq('for the site', pre.cors, 'https://solquicks.com');
  ok('allowing GET', /GET/.test(pre.headers.get('Access-Control-Allow-Methods')));
  const prePost = await call(env, 'OPTIONS', '/api/game/challenge-complete');
  ok('and the player routes may send Authorization',
    /Authorization/.test(prePost.headers.get('Access-Control-Allow-Headers')));

  const claim = await complete(env, null, { challenge_id: activeToday()[0].id });
  eq('a 401 from a game route still carries CORS, so the page can read it', claim.cors, 'https://solquicks.com');
  eq('an unknown game path is 404, not a sign-in demand', (await call(env, 'GET', '/api/game/nope')).status, 404);
}

section('the leaderboard\'s limit and period');
{
  const env = freshEnv();
  const ins = env._db.prepare(
    "INSERT INTO game_match_awards (match_id, wallet, team, kills, deaths, won, fp_awarded, ended_at) VALUES (?, ?, 'red', 1, 0, 0, ?, ?)"
  );
  for (let i = 0; i < 120; i++) ins.run('bulk', wallet(100 + i), 1000 - i, clock - HOUR);
  ins.run('old', wallet(500), 5000, clock - 3 * DAY);   // last played three days ago
  ins.run('older', wallet(501), 6000, clock - 30 * DAY);

  const lb = (q) => call(env, 'GET', '/api/game/leaderboard' + q);
  eq('the default is 100 rows', (await lb('')).body.rows.length, 100);
  eq('limit=200 is held to 100', (await lb('?limit=200')).body.rows.length, 100);
  eq('limit=100000 too', (await lb('?limit=100000')).body.rows.length, 100);
  eq('limit=5 gives 5', (await lb('?limit=5')).body.rows.length, 5);
  eq('limit=0 gives at least 1', (await lb('?limit=0')).body.rows.length, 1);
  for (const bad of ['-1', 'abc', '1.5', '1e3', '10;DROP']) {
    eq('limit=' + bad + ' is refused', (await lb('?limit=' + encodeURIComponent(bad))).status, 400);
  }
  for (const bad of ['monthly', 'ALL', "all'"]) {
    eq('period=' + bad + ' is refused', (await lb('?period=' + encodeURIComponent(bad))).status, 400);
  }

  const all = (await lb('?period=all&limit=3')).body.rows.map((r) => r.wallet);
  eq('all time includes the old matches, best first', all.join(','), [wallet(501), wallet(500), wallet(100)].join(','));
  const weekly = (await lb('?period=weekly&limit=3')).body.rows.map((r) => r.wallet);
  eq('the week includes three days ago, not thirty', weekly.join(','), [wallet(500), wallet(100), wallet(101)].join(','));
  const daily = (await lb('?period=daily&limit=2')).body.rows.map((r) => r.wallet);
  eq('today has neither', daily.join(','), [wallet(100), wallet(101)].join(','));
  eq('and says which period it answered', (await lb('?period=daily')).body.period, 'daily');
}

section('the player\'s own stats');
{
  const env = freshEnv({ SERVER_TO_WORKER_SECRET: SECRET });
  const me = wallet(30);
  await server(env, 'end', { match_id: 's-1', winning_team: 'red', players: [{ wallet: me, team: 'red', kills: 2, deaths: 1 }] });
  await server(env, 'end', { match_id: 's-2', winning_team: 'red', players: [{ wallet: me, team: 'blue', kills: 1, deaths: 3 }] });
  eq('need a session', (await call(env, 'GET', '/api/game/points?wallet=' + me)).status, 401);
  const r = await call(env, 'GET', '/api/game/points', { token: signIn(env, me) });
  eq('answers', r.status, 200);
  eq('the balance', r.body.points, 70 + 10);
  eq('matches played', r.body.matches_played, 2);
  eq('won', r.body.matches_won, 1);
  eq('kills', r.body.kills, 3);
  eq('deaths', r.body.deaths, 4);
  eq('game points earned', r.body.game_fp_earned, 80);
}

section('no schema at request time');
{
  const src = fs.readFileSync(new URL('../src/game/routes.js', import.meta.url), 'utf8');
  ok('routes.js creates no tables', !/CREATE\s+TABLE/i.test(src));
  const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../migrations/004-game-tables.sql', import.meta.url), 'utf8');
  for (const t of ['game_match_records', 'game_match_awards', 'game_challenge_claims']) {
    ok(t + ' is in schema.sql', new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '\\b').test(schema));
    ok(t + ' is in the migration', new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '\\b').test(migration));
  }
}

finish();
