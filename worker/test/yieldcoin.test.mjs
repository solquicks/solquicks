// The branded dollar, drafted and switched off.
//
// What matters about a draft of a money feature is that it cannot go off by
// accident. Launching creates a mint that cannot be unmade, so these assert
// the locks far more than they assert the happy path — and the happy path is
// only reachable here because the test turns the flag on itself.

import {
  freshEnv, call, chain, ok, eq, section, finish
} from './harness.mjs';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const SHARE_BPS = Number(/ourShareBps: (\d+)/.exec(src)[1]);
const SYMBOL = /symbol: '([A-Z]+)'/.exec(src)[1];

const admin = { token: 'admin-secret' };
const withAdmin = (env) => ({ token: 'admin-secret' });

// ═════════════════════════════════════════════════════════════════════════════

section('off is the default, and off means off');
{
  const env = freshEnv({ ADMIN_TOKEN: 'admin-secret' });   // no YIELDCOIN set at all
  const s = await call(env, 'GET', '/api/yieldcoin');
  eq('the status reads', s.status, 200);
  eq('and says it is off', s.body.enabled, false);
  ok('and says why, rather than leaving it a mystery', /has not shown any yield/i.test(s.body.note), s.body.note);

  const launch = await call(env, 'POST', '/api/yieldcoin/launch', {
    token: 'admin-secret', body: { imageUrl: 'x', metadataUrl: 'y', confirm: SYMBOL } });
  eq('launching is refused while off, even by an admin', launch.status, 409);
  ok('and says how to turn it on deliberately', /wrangler\.toml/.test(launch.body.error), launch.body.error);

  const up = await call(env, 'POST', '/api/yieldcoin/upload', { token: 'admin-secret', body: {} });
  eq('uploading is refused too', up.status, 409);
  eq('and nothing reached Reflect', chain.reflectCalls.length, 0);
}

section('a stranger cannot launch it, flag or no flag');
{
  for (const flag of ['off', 'on']) {
    const env = freshEnv({ ADMIN_TOKEN: 'admin-secret', YIELDCOIN: flag, REFLECT_API_KEY: 'k' });
    const before = chain.reflectCalls.length;
    const anon = await call(env, 'POST', '/api/yieldcoin/launch', {
      body: { imageUrl: 'x', metadataUrl: 'y', confirm: SYMBOL } });
    eq('flag ' + flag + ': no token is refused', anon.status, 403);
    const wrong = await call(env, 'POST', '/api/yieldcoin/launch', {
      token: 'not-the-token', body: { imageUrl: 'x', metadataUrl: 'y', confirm: SYMBOL } });
    eq('flag ' + flag + ': the wrong token is refused', wrong.status, 403);
    eq('flag ' + flag + ': and nothing reached Reflect', chain.reflectCalls.length, before);
  }
}

section('even switched on, launching takes more than asking');
{
  const env = freshEnv({ ADMIN_TOKEN: 'admin-secret', YIELDCOIN: 'on', REFLECT_API_KEY: 'k' });
  const before = chain.reflectCalls.length;

  const bare = await call(env, 'POST', '/api/yieldcoin/launch', { token: 'admin-secret', body: {} });
  eq('no image or metadata is refused', bare.status, 400);
  ok('and says where they come from', /upload/i.test(bare.body.error), bare.body.error);

  const noConfirm = await call(env, 'POST', '/api/yieldcoin/launch', {
    token: 'admin-secret', body: { imageUrl: 'x', metadataUrl: 'y' } });
  eq('no confirmation is refused', noConfirm.status, 400);
  ok('and says a mint cannot be unmade', /cannot be unmade/i.test(noConfirm.body.error), noConfirm.body.error);

  const wrongConfirm = await call(env, 'POST', '/api/yieldcoin/launch', {
    token: 'admin-secret', body: { imageUrl: 'x', metadataUrl: 'y', confirm: 'something else' } });
  eq('the wrong confirmation is refused', wrongConfirm.status, 400);

  eq('none of those reached Reflect', chain.reflectCalls.length, before);
}

section('with everything in order it goes through');
{
  const env = freshEnv({ ADMIN_TOKEN: 'admin-secret', YIELDCOIN: 'on', REFLECT_API_KEY: 'k' });
  chain.reflect = () => ({ success: true, data: { mint: 'FoXd1111111111111111111111111111111111111111' } });
  const before = chain.reflectCalls.length;

  const r = await call(env, 'POST', '/api/yieldcoin/launch', {
    token: 'admin-secret', body: { imageUrl: 'https://x/i.png', metadataUrl: 'https://x/m.json', confirm: SYMBOL } });
  eq('it launches', r.status, 200);
  eq('one call to Reflect, not several', chain.reflectCalls.length - before, 1);

  const sent = chain.reflectCalls[chain.reflectCalls.length - 1];
  ok('to the initialize flow', /\/integration\/initialize\/flow/.test(sent.url), sent.url);
  eq('with our share, from the one place it is written', sent.body.feeBps, SHARE_BPS);
  eq('and the symbol', sent.body.symbol, SYMBOL);
  ok('and the fox is told', chain.alerts.some((a) => a.includes(SYMBOL)));
  chain.reflect = null;
}

section('what a holder is told');
{
  const env = freshEnv({ ADMIN_TOKEN: 'admin-secret' });
  const d = (await call(env, 'GET', '/api/yieldcoin')).body;
  const all = d.disclosure.join(' ');

  ok('there is a disclosure at all', d.disclosure.length >= 4, String(d.disclosure.length));
  ok('it says it is not a deposit', /not a deposit/i.test(all), all.slice(0, 80));
  ok('it says it is not insured', /not insured/i.test(all), all.slice(0, 80));
  ok('it says the yield is not promised', /not promised|not fixed/i.test(all));
  ok('it says the money is never held by us', /never held by us/i.test(all));
  ok('it says it can lose value', /loses value/i.test(all));

  // The split is stated once and derived everywhere, so the page and the
  // contract cannot disagree the way the first bundle rate card did.
  eq('our share is reported', d.ourSharePct, SHARE_BPS / 100);
  eq('and the holder share is the remainder', d.ourSharePct + d.holderSharePct, 100);
  ok('and the disclosure quotes the same numbers',
    all.includes(String(SHARE_BPS / 100) + '%') && all.includes(String(100 - SHARE_BPS / 100) + '%'), all);
}

finish();
