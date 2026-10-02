// Reflect, the yield the DeFi tab offers: USDC in, a yield-bearing token back.
//
// Their API builds the transaction and the person's own wallet signs it, so
// nothing here ever holds anyone's money. What this file is about is the three
// things between a person and a mistake: that an amount is an amount, that the
// product their money goes into is ours to choose and not a caller's, and that
// the key doing the asking never leaves this Worker.
//
// Run: node test/reflect.test.mjs

import { chain, freshEnv, call, ok, eq, section, finish } from './harness.mjs';

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

finish();
