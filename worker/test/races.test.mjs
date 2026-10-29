// Check-then-write races (security fix 2026-10-29, M1 and L7).
//
// The flip used to read the balance and then deduct with no condition, so a
// burst of parallel flips all passed the check and drove the balance
// negative. The daily visit bonus had the same shape. Both now make the write
// itself the check.

import { freshEnv, call, wallet, signIn, eq, ok, section, finish } from './harness.mjs';

section('parallel flips cannot spend points that are not there');
{
  const env = freshEnv();
  const me = wallet(1);
  const t = signIn(env, me);
  await call(env, 'GET', '/api/me', { token: t });
  env._db.prepare('INSERT OR REPLACE INTO players (wallet, points, created_at, updated_at) VALUES (?, 100, 0, 0)').run(me);
  const flips = await Promise.all(Array.from({ length: 10 }, () =>
    call(env, 'POST', '/api/flip', { token: t, body: { wager: 100, call: 'heads' } })));
  const bal = env._db.prepare('SELECT points FROM players WHERE wallet = ?').get(me).points;
  ok('the balance never goes negative', bal >= 0, 'balance ' + bal);
  const played = env._db.prepare('SELECT COUNT(*) AS n FROM flips WHERE wallet = ?').get(me).n;
  const accepted = flips.filter((f) => f.status === 200).length;
  eq('every accepted flip is recorded', played, accepted);
  ok('the rest are refused for want of points', flips.filter((f) => f.status === 400).length === 10 - accepted);
  // A loss leaves 0, so at most one flip plays before the balance is gone;
  // a win doubles it, so allow for a lucky streak but never beyond what the
  // balance could have covered one flip at a time.
  const rows = env._db.prepare('SELECT won FROM flips WHERE wallet = ? ORDER BY ts, rowid').all(me);
  let b = 100, valid = true;
  for (const r of rows) { if (b < 100) valid = false; b += r.won ? 100 : -100; }
  ok('each flip was covered by the balance at the time', valid && b === bal, JSON.stringify({ rows: rows.length, b, bal }));
}

section('parallel visits are paid once');
{
  const env = freshEnv();
  const me = wallet(2);
  const t = signIn(env, me);
  const r = await Promise.all(Array.from({ length: 8 }, () => call(env, 'POST', '/api/visit', { token: t })));
  eq('exactly one visit was paid', r.filter((x) => x.body.awarded > 0).length, 1);
  eq('one ledger row', env._db.prepare("SELECT COUNT(*) AS n FROM events WHERE wallet = ? AND type = 'visit'").get(me).n, 1);
}

finish();
