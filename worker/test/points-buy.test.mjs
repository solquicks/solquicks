// Buying Fox Points with USDC.
//
// This is money in and a balance out, so the only thing that matters is that a
// point is never credited without a payment that is really on chain, for the
// right amount, tagged with this purchase — and never credited twice for one
// payment.

import {
  MIN, HOUR, clock, advance, TREASURY, chain, pay, freshEnv, call, runScheduled,
  wallet, signIn, ok, eq, section, finish
} from './harness.mjs';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const RATE = Number(/const POINTS_PER_USD = (\d+)/.exec(src)[1]);
const MIN_USD = Number(/const POINTS_BUY_MIN_USD = (\d+)/.exec(src)[1]);
const MAX_USD = Number(/const POINTS_BUY_MAX_USD = (\d+)/.exec(src)[1]);

const points = (env, w) => (env._db.prepare('SELECT points FROM players WHERE wallet = ?').get(w) || {}).points || 0;
const row = (env, ref) => env._db.prepare('SELECT * FROM point_purchases WHERE ref = ?').get(ref);

// ═════════════════════════════════════════════════════════════════════════════

section('the rate card');
{
  const env = freshEnv();
  const r = await call(env, 'GET', '/api/points/packs');
  eq('answers', r.status, 200);
  ok('there are packs', r.body.packs.length > 0);
  eq('the rate is the one in the source', r.body.perDollar, RATE);

  // Buying more must never be worse value, the same invariant the bundles use.
  const packs = r.body.packs;
  for (let i = 1; i < packs.length; i++) {
    ok('$' + packs[i].usd + ' is at least as good per dollar as $' + packs[i - 1].usd,
      packs[i].perDollar >= packs[i - 1].perDollar,
      packs[i].perDollar + ' vs ' + packs[i - 1].perDollar);
  }
  for (const p of packs) {
    eq('$' + p.usd + ' gives what the rate and bonus say', p.points,
      Math.round(p.usd * RATE * (1 + p.bonusPct / 100)));
  }

  // The one thing a buyer most needs to know.
  ok('it says points are not money', /not money/i.test(r.body.note), r.body.note);
  ok('and that they cannot be cashed out', /cashed out/i.test(r.body.note), r.body.note);
  ok('and says where the money goes', r.body.payTo === TREASURY);
}

section('buying needs somewhere to put the points');
{
  const env = freshEnv();
  const anon = await call(env, 'POST', '/api/points/buy', { body: { usd: 20 } });
  eq('no wallet signed in is refused', anon.status, 401);
  eq('and nothing was written', env._db.prepare('SELECT COUNT(*) AS n FROM point_purchases').get().n, 0);
}

section('what the amount has to be');
{
  const env = freshEnv();
  const who = wallet(1);
  const token = signIn(env, who);
  const buy = (usd) => call(env, 'POST', '/api/points/buy', { token, body: { usd } });

  eq('under the minimum', (await buy(MIN_USD - 1)).status, 400);
  eq('over the maximum', (await buy(MAX_USD + 1)).status, 400);
  eq('nonsense', (await buy('lots')).status, 400);
  eq('nothing at all', (await call(env, 'POST', '/api/points/buy', { token, body: {} })).status, 400);
  eq('zero', (await buy(0)).status, 400);
  eq('negative', (await buy(-50)).status, 400);
  eq('nothing was written', env._db.prepare('SELECT COUNT(*) AS n FROM point_purchases').get().n, 0);
  eq('the minimum itself is allowed', (await buy(MIN_USD)).status, 200);
}

section('money first, points after');
{
  const env = freshEnv();
  const who = wallet(2);
  const token = signIn(env, who);

  const h = await call(env, 'POST', '/api/points/buy', { token, body: { usd: 50 } });
  eq('held', h.status, 200);
  eq('quoted the points it will give', h.body.points, Math.round(50 * RATE * (1 + h.body.bonusPct / 100)));
  ok('and asks for USDC', h.body.usdc === 50000000, String(h.body.usdc));
  eq('paid to the treasury', h.body.payTo, TREASURY);

  eq('nothing is credited yet', points(env, who), 0);

  // Confirming without a payment must not credit anything.
  const early = await call(env, 'POST', '/api/points/confirm', {
    token, body: { ref: h.body.ref, signature: 'sig-that-never-landed' } });
  eq('an unpaid confirm is refused', early.status, 402);
  eq('still nothing credited', points(env, who), 0);
  eq('and still held', row(env, h.body.ref).status, 'held');

  // Short payment is not payment.
  const shortSig = pay({ from: who, usdc: 40000000, reference: h.body.reference });
  const short = await call(env, 'POST', '/api/points/confirm', { token, body: { ref: h.body.ref, signature: shortSig } });
  eq('paying less than the price is refused', short.status, 402);
  eq('nothing credited for it', points(env, who), 0);

  // The real thing.
  const sig = pay({ from: who, usdc: h.body.usdc, reference: h.body.reference });
  const c = await call(env, 'POST', '/api/points/confirm', { token, body: { ref: h.body.ref, signature: sig } });
  eq('a real payment is accepted', c.status, 200);
  eq('the points are credited', points(env, who), h.body.points);
  eq('and the purchase is marked paid', row(env, h.body.ref).status, 'paid');
  ok('and the fox is told', chain.alerts.some((a) => a.includes(h.body.ref)));
}

section('one payment cannot be spent twice');
{
  const env = freshEnv();
  const who = wallet(3);
  const token = signIn(env, who);
  const h = await call(env, 'POST', '/api/points/buy', { token, body: { usd: 20 } });
  const sig = pay({ from: who, usdc: h.body.usdc, reference: h.body.reference });

  const first = await call(env, 'POST', '/api/points/confirm', { token, body: { ref: h.body.ref, signature: sig } });
  const second = await call(env, 'POST', '/api/points/confirm', { token, body: { ref: h.body.ref, signature: sig } });
  eq('the first credits', first.status, 200);
  eq('the second says so rather than crediting again', second.body.alreadyPaid, true);
  eq('the balance only moved once', points(env, who), h.body.points);

  // And both at once.
  const env2 = freshEnv();
  const w2 = wallet(4);
  const t2 = signIn(env2, w2);
  const h2 = await call(env2, 'POST', '/api/points/buy', { token: t2, body: { usd: 20 } });
  const s2 = pay({ from: w2, usdc: h2.body.usdc, reference: h2.body.reference });
  await Promise.all([
    call(env2, 'POST', '/api/points/confirm', { token: t2, body: { ref: h2.body.ref, signature: s2 } }),
    call(env2, 'POST', '/api/points/confirm', { token: t2, body: { ref: h2.body.ref, signature: s2 } })
  ]);
  eq('two confirms racing still credit once', points(env2, w2), h2.body.points);
}

section('the points go to the buyer, not the payer');
{
  // The wallet signed in is the one credited. Somebody else's payment cannot be
  // pointed at their own balance, because the invoice is checked against the
  // wallet the purchase was opened for.
  const env = freshEnv();
  const buyer = wallet(5);
  const stranger = wallet(6);
  const token = signIn(env, buyer);
  const h = await call(env, 'POST', '/api/points/buy', { token, body: { usd: 20 } });

  const theirSig = pay({ from: stranger, usdc: h.body.usdc, reference: h.body.reference });
  const c = await call(env, 'POST', '/api/points/confirm', {
    token: signIn(env, stranger), body: { ref: h.body.ref, signature: theirSig } });

  // Whoever confirms, the row names the buyer, so only the buyer can gain.
  eq('the stranger gains nothing', points(env, stranger), 0);
  if (c.status === 200) eq('the buyer is the one credited', points(env, buyer), h.body.points);
  eq('the purchase still belongs to the buyer', row(env, h.body.ref).wallet, buyer);
}

section('an abandoned purchase does not stay live');
{
  const env = freshEnv();
  const who = wallet(7);
  const token = signIn(env, who);
  const h = await call(env, 'POST', '/api/points/buy', { token, body: { usd: 20 } });

  advance(21 * MIN);
  await call(env, 'GET', '/api/points/packs');     // any public request runs the sweep
  eq('it expires', row(env, h.body.ref).status, 'expired');
  eq('and credited nothing', points(env, who), 0);

  // Paying late still works if the money really arrived — the customer paid.
  const sig = pay({ from: who, usdc: h.body.usdc, reference: h.body.reference });
  const late = await call(env, 'POST', '/api/points/confirm', { token, body: { ref: h.body.ref, signature: sig } });
  eq('a late payment is honoured rather than kept', late.status, 200);
  eq('and the points arrive', points(env, who), h.body.points);
}

finish();
