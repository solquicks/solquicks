// Reflect, the yield the DeFi tab offers: USDC in, a yield-bearing token back.
//
// Their API builds the transaction and the person's own wallet signs it, so
// nothing here ever holds anyone's money. What this file is about is the three
// things between a person and a mistake: that an amount is an amount, that the
// product their money goes into is ours to choose and not a caller's, and that
// the key doing the asking never leaves this Worker.
//
// Run: node test/reflect.test.mjs

import { chain, freshEnv, call, ok, eq, section, finish, wallet, runScheduled } from './harness.mjs';

const WALLET = '6N1NhZc8CAk3eZYyRWMkKXAqZrV8LSycURz2aMhmUhAd';
const TX = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const reset = () => { chain.reflectCalls.length = 0; chain.reflect = null; };

// A stand-in that answers the way their API documents, and records what it was
// asked. Anything unrecognised is a 404 rather than a quiet success.
function serving(overrides = {}) {
  chain.reflect = (url, init) => {
    const p = url.pathname;
    if (p === '/stablecoin/apy') {
      return overrides.apy !== undefined ? overrides.apy
        : { success: true, data: [{ index: 0, apy: 5.25, timestamp: '2026-10-02T10:30:00Z' }] };
    }
    if (p.startsWith('/stablecoin/quote/')) {
      return overrides.quote !== undefined ? overrides.quote : { success: true, data: 999000 };
    }
    if (p === '/stablecoin/mint' || p === '/stablecoin/burn') {
      return overrides.tx !== undefined ? overrides.tx
        : { success: true, data: { transaction: TX } };
    }
    return new Response(JSON.stringify({ success: false, message: 'no such path' }), { status: 404 });
  };
}

// ── the rate ────────────────────────────────────────────────────────────────
section('the rate people are shown');
{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'GET', '/api/reflect/apy');
  eq('the rate is served', r.status, 200);
  eq('as the number it is', r.body.apy, 5.25);
  ok('with when it was published, because a rate with no date is a claim', !!r.body.at, r.body.at);

  // The key is what separates 500 requests a minute from 100, and it belongs
  // here. In the page it would be readable by anyone who opened the source.
  eq('the key went with the request', chain.reflectCalls[0].key, 'k-1');
  ok('and the request went to production', /^https:\/\/prod\.api\.reflect\.money\//.test(chain.reflectCalls[0].url),
    chain.reflectCalls[0].url);

  // Their response carries every product they run. Handing all of them back
  // would have the page quote a rate for something it cannot deposit into.
  ok('only the product this site offers comes back', r.body.index === undefined && !Array.isArray(r.body.apy));
}

{
  reset();
  serving({ apy: { success: true, data: [{ index: 7, apy: 99, timestamp: 'x' }] } });
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'GET', '/api/reflect/apy');
  eq('a rate for a different product is not shown as ours', r.status, 503);
  ok('and says so rather than showing nothing', /no rate/.test(r.body.error), r.body.error);
}

// ── quotes ──────────────────────────────────────────────────────────────────
section('what they would get back');
{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/quote', { body: { side: 'mint', amount: 1000000 } });
  eq('a quote comes back', r.status, 200);
  eq('for what they put in', r.body.inAmount, 1000000);
  eq('and what they would get', r.body.outAmount, 999000);
  eq('asked of the product we chose, not one a caller named',
    chain.reflectCalls[0].body.stablecoinIndex, 0);
}

{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  // The index decides which product somebody's money goes into. Taking it from
  // the request would let a crafted call point a deposit somewhere else
  // entirely, while the page still said USDC.
  const r = await call(env, 'POST', '/api/reflect/quote',
    { body: { side: 'mint', amount: 1000000, stablecoinIndex: 9 } });
  eq('a caller cannot choose the product', chain.reflectCalls[0].body.stablecoinIndex, 0);
  eq('and the quote is still served', r.status, 200);
}

{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/quote', { body: { side: 'nonsense', amount: 1000000 } });
  eq('an unknown side is read as a deposit rather than passed on', r.body.side, 'mint');
  ok('and that is what was asked for', /\/quote\/mint$/.test(chain.reflectCalls[0].url), chain.reflectCalls[0].url);
}

// ── amounts ─────────────────────────────────────────────────────────────────
section('an amount has to be an amount');
{
  // USDC is counted in whole millionths. A float, a negative or a number past
  // the ceiling is refused here rather than sent on for somebody else's API to
  // interpret — the ceiling is a guard against a decimal slip turning $10 into
  // something nobody meant to sign for.
  const cases = [
    ['nothing at all', undefined],
    ['zero', 0],
    ['a negative', -1000000],
    ['a fraction of a millionth', 1000000.5],
    ['text', '1000000abc'],
    ['infinity', Infinity],
    ['past the ceiling', 1000000 * 1000000 + 1]
  ];
  for (const [what, amount] of cases) {
    reset(); serving();
    const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
    const r = await call(env, 'POST', '/api/reflect/deposit', { body: { wallet: WALLET, amount: amount } });
    eq(what + ' is refused', r.status, 400);
    eq('and nothing was asked of them', chain.reflectCalls.length, 0);
  }
}

{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/deposit',
    { body: { wallet: WALLET, amount: 1000000 * 1000000 } });
  eq('the ceiling itself is allowed', r.status, 200);
}

// ── building the transaction ────────────────────────────────────────────────
section('the transaction they are asked to sign');
{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/deposit',
    { body: { wallet: WALLET, amount: 5000000, minReceived: 4950000 } });
  eq('a deposit transaction comes back', r.status, 200);
  eq('and it is the one they built', r.body.transaction, TX);
  eq('for the wallet that asked', chain.reflectCalls[0].body.signer, WALLET);
  // Without a floor the protocol decides what they receive, and the person
  // signing has nothing to hold it to.
  eq('with the least they said they would accept', chain.reflectCalls[0].body.minimumReceived, 4950000);
  ok('built by mint, for a deposit', /\/stablecoin\/mint$/.test(chain.reflectCalls[0].url), chain.reflectCalls[0].url);
}

{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/withdraw', { body: { wallet: WALLET, amount: 5000000 } });
  eq('a withdrawal comes back too', r.status, 200);
  ok('built by burn, for a withdrawal', /\/stablecoin\/burn$/.test(chain.reflectCalls[0].url), chain.reflectCalls[0].url);
  eq('and no floor is invented for them', chain.reflectCalls[0].body.minimumReceived, undefined);
}

{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  for (const bad of ['', 'not-a-wallet', '6N1NhZc8CAk3eZYyRWMkKXAqZrV8LSycURz2aMhmUhAd!']) {
    const r = await call(env, 'POST', '/api/reflect/deposit', { body: { wallet: bad, amount: 1000000 } });
    eq('a transaction is not built for "' + bad + '"', r.status, 400);
  }
  eq('and none of them reached their API', chain.reflectCalls.length, 0);
}

// ── when they are having a bad day ──────────────────────────────────────────
section('when the provider will not play');
{
  reset();
  chain.reflect = () => new Response(JSON.stringify({ success: false, message: 'depositAmount must be positive' }), { status: 400 });
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/deposit', { body: { wallet: WALLET, amount: 1000000 } });
  eq('their refusal is passed on as a refusal', r.status, 400);
  // Their wording tells somebody what to change. "502" does not.
  ok('in their words', /must be positive/.test(r.body.error), r.body.error);
}

{
  reset();
  chain.reflect = () => new Response('', { status: 429 });
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/quote', { body: { side: 'mint', amount: 1000000 } });
  eq('being rate-limited is said as being rate-limited', r.status, 429);
}

{
  reset();
  chain.reflect = () => new Response('<html>down for maintenance</html>', { status: 500 });
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/quote', { body: { side: 'mint', amount: 1000000 } });
  eq('a page of HTML where JSON was expected is not a success', r.status, 502);
  ok('and says something a person can read', !!r.body.error && !/</.test(r.body.error), r.body.error);
}

{
  reset();
  // Success, and nothing to sign. Treating that as fine would hand the page an
  // undefined transaction and fail somewhere further along, where the reason is
  // no longer visible.
  serving({ tx: { success: true, data: {} } });
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const r = await call(env, 'POST', '/api/reflect/deposit', { body: { wallet: WALLET, amount: 1000000 } });
  eq('a success with no transaction in it is not a success', r.status, 502);
  ok('and says exactly that', /no transaction/.test(r.body.error), r.body.error);
}

// ── the key ─────────────────────────────────────────────────────────────────
section('the key');
{
  reset(); serving();
  // Reads work without one, at a lower rate. Worth keeping: it means the tab
  // still shows a rate on a deployment where the key has not been set yet.
  const env = freshEnv();
  const r = await call(env, 'GET', '/api/reflect/apy');
  eq('the rate still shows without a key', r.status, 200);
  eq('and no empty key is sent in place of one', chain.reflectCalls[0].key, null);
}

// ── what they did, and when ─────────────────────────────────────────────────
section('a record of what happened');
{
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const SIG = '5' + 'x'.repeat(0) + 'J7rA9kqLm2pQwTvZ8nYcHbGdEfMxKs3RtUvWyZaBcDeFgHiJkLmNoPqRsTuVwXyZ12';

  // The chain is asked whether this transaction is theirs. Without that, the
  // wallet and the signature both arrive from whoever is posting.
  const onChain = (sig, payer, failed = false) => chain.txs.set(sig, {
    meta: { err: failed ? { InstructionError: [0, 'Custom'] } : null },
    transaction: { message: { accountKeys: [{ pubkey: payer }, { pubkey: 'other' }] } }
  });
  onChain(SIG, WALLET);

  const w = await call(env, 'POST', '/api/reflect/record',
    { body: { wallet: WALLET, signature: SIG, side: 'in', amount: 25 } });
  eq('a deposit is written down', w.status, 200);

  const h = await call(env, 'GET', '/api/reflect/history?wallet=' + WALLET);
  eq('and comes back', h.body.rows.length, 1);
  eq('with the amount', h.body.rows[0].amount, 25);
  eq('and which way it went', h.body.rows[0].side, 'in');

  // A page that retries a record must not double it. The signature is the key.
  onChain(SIG, WALLET);
  await call(env, 'POST', '/api/reflect/record',
    { body: { wallet: WALLET, signature: SIG, side: 'in', amount: 25 } });
  const h2 = await call(env, 'GET', '/api/reflect/history?wallet=' + WALLET);
  eq('writing the same one twice leaves one row', h2.body.rows.length, 1);

  // This row is read back to somebody as a link to an explorer, so anything
  // that is not a signature has no business in it.
  for (const bad of ['', 'not-a-signature', '<script>', 'x'.repeat(200)]) {
    const r = await call(env, 'POST', '/api/reflect/record',
      { body: { wallet: WALLET, signature: bad, side: 'in', amount: 25 } });
    eq('"' + bad.slice(0, 16) + '" is not written down', r.status, 400);
  }

  const other = await call(env, 'GET', '/api/reflect/history?wallet=' + wallet(2));
  eq('and one wallet cannot see another\'s', other.body.rows.length, 0);
}

{
  // Nothing here moves money, but it is read back as somebody's own record and
  // decides what they are told they have earned. Both the wallet and the
  // signature arrive from whoever is posting, so without asking the chain,
  // anybody could write anything into anybody's history.
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const SIG = 'J7rA9kqLm2pQwTvZ8nYcHbGdEfMxKs3RtUvWyZaBcDeFgHiJkLmNoPqRsTuVwXyZ12';
  const victim = wallet(3);

  // Somebody else's transaction: the victim appears in it but did not sign it.
  chain.txs.set(SIG, { meta: { err: null },
    transaction: { message: { accountKeys: [{ pubkey: WALLET }, { pubkey: victim }] } } });
  const forged = await call(env, 'POST', '/api/reflect/record',
    { body: { wallet: victim, signature: SIG, side: 'in', amount: 999999 } });
  eq('a row cannot be written into somebody else\'s history', forged.status, 403);

  // A signature that does not exist at all.
  chain.txs.delete(SIG);
  const invented = await call(env, 'POST', '/api/reflect/record',
    { body: { wallet: WALLET, signature: SIG, side: 'in', amount: 25 } });
  eq('nor for a transaction that never happened', invented.status, 403);

  // One that failed on chain is not a deposit either.
  chain.txs.set(SIG, { meta: { err: { InstructionError: [0, 'Custom'] } },
    transaction: { message: { accountKeys: [{ pubkey: WALLET }] } } });
  const failed = await call(env, 'POST', '/api/reflect/record',
    { body: { wallet: WALLET, signature: SIG, side: 'in', amount: 25 } });
  eq('nor for one that failed', failed.status, 403);

  const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM savings').first();
  eq('and none of them were written down', rows.n, 0);
}

{
  // 1e99 went in happily and came back out as somebody's history.
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  chain.txs.set('K7rA9kqLm2pQwTvZ8nYcHbGdEfMxKs3RtUvWyZaBcDeFgHiJkLmNoPqRsTuVwXyZ12',
    { meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: WALLET }] } } });
  const r = await call(env, 'POST', '/api/reflect/record',
    { body: { wallet: WALLET, signature: 'K7rA9kqLm2pQwTvZ8nYcHbGdEfMxKs3RtUvWyZaBcDeFgHiJkLmNoPqRsTuVwXyZ12',
              side: 'in', amount: 1e99 } });
  eq('an amount past the ceiling is refused here too', r.status, 400);
}

// ── a rate of our own ───────────────────────────────────────────────────────
section('the rate, measured rather than borrowed');
{
  // Reflect publishes no APY — their endpoint answers 404 — but what a token
  // redeems for is the yield, so recording that over time is the yield over
  // time. Measured directly beats taken on trust.
  reset();
  chain.reflect = (url) => url.pathname === '/stablecoin/quote/redeem'
    ? { success: true, data: 1008428 }
    : new Response(JSON.stringify({ error: 'No stablecoin yield data found' }), { status: 404 });
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });

  // One reading is not a rate.
  const DAY = 86400000;
  await env.DB.prepare('INSERT INTO savings_rate (ts, rate) VALUES (?, ?)')
    .bind(Date.now() - 30 * DAY, 1.0).run();
  let r = await call(env, 'GET', '/api/reflect/apy');
  eq('one reading gives no rate', r.status, 503);

  // Two, a month apart, with the token up 1% — about 12.7% a year compounded.
  await env.DB.prepare('INSERT INTO savings_rate (ts, rate) VALUES (?, ?)')
    .bind(Date.now(), 1.01).run();
  r = await call(env, 'GET', '/api/reflect/apy');
  eq('two far enough apart give one', r.status, 200);
  ok('that is roughly right', r.body.apy > 12 && r.body.apy < 13, String(r.body.apy));
  eq('and it is said to be measured, not published', r.body.measured, true);
  ok('with how long it is based on', r.body.since > 0 && r.body.readings === 2, JSON.stringify(r.body));
}

{
  // Compounding a few hours out to a year produces something absurd. A number
  // built from noise is worse than no number at all, especially this one.
  reset();
  chain.reflect = () => new Response(JSON.stringify({ error: 'none' }), { status: 404 });
  const env = freshEnv();
  await env.DB.prepare('INSERT INTO savings_rate (ts, rate) VALUES (?, ?)')
    .bind(Date.now() - 600000, 1.0).run();
  await env.DB.prepare('INSERT INTO savings_rate (ts, rate) VALUES (?, ?)')
    .bind(Date.now(), 1.004).run();
  const r = await call(env, 'GET', '/api/reflect/apy');
  eq('ten minutes of movement is not an annual rate', r.status, 503);
}

{
  // A rate below par, or far above it, is a bad read rather than a rate, and
  // one of those in the series would show somebody a number that never
  // happened. Exercised through the half-hourly job, which is the only thing
  // that writes to this table.
  for (const bad of [0.5, 2.5, 0]) {
    reset();
    chain.reflect = () => ({ success: true, data: Math.round(bad * 1000000) });
    const env = freshEnv();
    await runScheduled(env);
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM savings_rate').first()).n;
    eq('a reading of ' + bad + ' is not written down', n, 0);
  }

  // And a sane one is.
  reset();
  chain.reflect = () => ({ success: true, data: 1008428 });
  const env = freshEnv();
  await runScheduled(env);
  const row = await env.DB.prepare('SELECT rate FROM savings_rate').first();
  eq('while a real one is', row && Math.round(row.rate * 1e6), 1008428);
}

// ── limits ──────────────────────────────────────────────────────────────────
section('the limits actually apply');
{
  // The rate-limit table is only consulted for paths named in the public list.
  // An entry that is not in both is an entry that never fires, which looks
  // exactly like a working limit until somebody leans on it.
  reset(); serving();
  const env = freshEnv({ REFLECT_API_KEY: 'k-1' });
  const ip = '203.0.113.9';
  let limited = 0;
  for (let i = 0; i < 25; i++) {
    const r = await call(env, 'POST', '/api/reflect/deposit',
      { body: { wallet: WALLET, amount: 1000000 }, ip: ip });
    if (r.status === 429) limited++;
  }
  ok('building transactions from one address is capped', limited > 0, limited + ' of 25 refused');
  ok('and the cap is not so tight that an ordinary person meets it',
    limited < 10, limited + ' of 25 refused');
}

finish();
