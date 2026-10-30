// Off-chain Ranger staking (security fix 2026-10-29, H1): one active stake per
// Ranger, and ownership re-checked when points are claimed. Harness in harness.mjs.

import { chain, freshEnv, call, signIn, wallet, ok, eq, section, finish, advance, HOUR } from './harness.mjs';

const COLLECTION = wallet(200);
const R1 = wallet(301), R2 = wallet(302);
const A = wallet(1), B = wallet(2);

// who holds which Ranger right now, as the chain would say
const owner = {};
let dasDown = false;
chain.rpc.searchAssets = (params) => {
  if (dasDown) throw new Error('das down');
  const items = Object.keys(owner).filter((m) => owner[m] === params.ownerAddress)
    .map((id) => ({ id, content: { metadata: { name: 'Ranger' }, files: [], links: {} } }));
  return { total: items.length, items };
};
// a thrown stand-in must come back as an RPC failure, not crash the harness
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (dasDown && String(url).startsWith('https://mainnet.helius-rpc.com/') && JSON.parse(init.body).method === 'searchAssets') {
    return new Response('down', { status: 503 });
  }
  return realFetch(url, init);
};

const env = freshEnv({ MOON_RANGERS_COLLECTION: COLLECTION });
let ta = signIn(env, A), tb = signIn(env, B);
const rows = (mint) => env._db.prepare('SELECT wallet FROM staked_nfts WHERE mint = ?').all(mint).map((r) => r.wallet);

section('one active stake per Ranger');
{
  owner[R1] = A; owner[R2] = A;
  const s1 = await call(env, 'POST', '/api/stake', { token: ta, body: { mints: [R1, R2] } });
  eq('A stakes both Rangers', s1.status, 200);
  eq('both are staked', (s1.body.staked || []).length, 2);

  // A moves R1 to B. Before the fix B could stake it too, and both earned.
  owner[R1] = B;
  advance(24 * HOUR);
  ta = signIn(env, A); tb = signIn(env, B);
  const s2 = await call(env, 'POST', '/api/stake', { token: tb, body: { mints: [R1] } });
  eq('B, who now holds R1, can stake it', s2.status, 200);
  eq('and R1 has exactly one stake, B\'s', JSON.stringify(rows(R1)), JSON.stringify([B]));
  const a = await call(env, 'GET', '/api/me', { token: ta });
  eq('A is left staking only the Ranger it still holds', a.body.player.stakedMints.join(','), R2);
  eq('A\'s stake count follows', a.body.player.stake.count, 1);
  ok('A keeps what R1 earned while it was verifiably A\'s, and no more',
    a.body.player.pending >= 100 && a.body.player.pending <= 200, String(a.body.player.pending));

  // the database itself refuses a second row for the same Ranger
  let threw = false;
  try { env._db.prepare('INSERT INTO staked_nfts (wallet, mint, since) VALUES (?, ?, ?)').run(A, R1, 1); } catch (e) { threw = true; }
  ok('a second stake of the same Ranger cannot be written at all', threw);

  const again = await call(env, 'POST', '/api/stake', { token: ta, body: { mints: [R1] } });
  eq('A cannot stake R1 back while B holds it', again.status, 403);
}

section('claiming re-checks ownership');
{
  advance(24 * HOUR);
  ta = signIn(env, A); tb = signIn(env, B);
  // B sells R1 on. B's stake row is still there until something checks.
  owner[R1] = wallet(3);
  const before = await call(env, 'GET', '/api/me', { token: tb });
  ok('B shows something pending', before.body.player && before.body.player.pending > 0, JSON.stringify(before));
  const c = await call(env, 'POST', '/api/claim', { token: tb });
  eq('claiming works', c.status, 200);
  eq('but R1 is no longer staked by B once it has left', JSON.stringify(rows(R1)), '[]');
  ok('and B is paid only up to when R1 was last seen in B\'s wallet (one day), not for the time since',
    c.body.awarded <= 100, String(c.body.awarded));

  dasDown = true;
  advance(HOUR);
  const d = await call(env, 'POST', '/api/claim', { token: ta });
  eq('with the ownership check down, a staker\'s claim is refused rather than paid blind', d.status, 503);
  const u = await call(env, 'POST', '/api/unstake', { token: ta, body: { mints: [R2] } });
  eq('but unstaking still works with the check down', u.status, 200);
  dasDown = false;
}

section('holder perks count only a recently verified stake');
{
  const env2 = freshEnv({ MOON_RANGERS_COLLECTION: COLLECTION });
  const C = wallet(4);
  const tc = signIn(env2, C);
  // a stake row from before migration 005, never verified
  env2._db.prepare('INSERT INTO staked_nfts (wallet, mint, since) VALUES (?, ?, ?)').run(C, wallet(305), 1);
  env2._db.prepare('INSERT INTO stakes (wallet, staked, since, count, banked) VALUES (?, 1, 1, 1, 0)').run(C);
  const q1 = await call(env2, 'GET', '/api/booking/types', { token: tc });
  owner[wallet(305)] = C;
  await call(env2, 'GET', '/api/rangers', { token: tc });
  const q2 = await call(env2, 'GET', '/api/booking/types', { token: tc });
  eq('an unverified stake from before the fix is not a holder', q1.body.tier, null);
  eq('once the chain has confirmed it, it is', q2.body.tier, 'ranger');
  advance(25 * HOUR);
  const tc2 = signIn(env2, C);
  const q3 = await call(env2, 'GET', '/api/booking/types', { token: tc2 });
  eq('and a day later without a fresh check it is not again', q3.body.tier, null);
  const v = env2._db.prepare('SELECT verified_at FROM staked_nfts WHERE wallet = ?').get(C);
  ok('visiting the Rangers page stamps the stake as verified', v && v.verified_at > 0);
}

finish();
