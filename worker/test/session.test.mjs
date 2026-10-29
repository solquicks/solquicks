// Signing in, end to end with a real Ed25519 key (security fix 2026-10-29:
// L6 dated sign-in message, shorter sessions, server-side logout; I10 a 400
// for malformed sign-in input). Harness in harness.mjs.
import { webcrypto } from 'node:crypto';
import { freshEnv, call, worker, advance, MIN, HOUR, ok, eq, section, finish } from './harness.mjs';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}
const keys = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const me = b58(new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey)));
const sign = async (text) => Buffer.from(new Uint8Array(
  await webcrypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(text)))).toString('base64');

async function raw(env, path, text) {
  globalThis.caches = { default: env._cache };
  const res = await worker.fetch(new Request('https://api.test' + path, {
    method: 'POST', body: text,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.9.' + Math.floor(Math.random() * 250), Origin: 'https://solquicks.com' }
  }), env, { waitUntil() {}, passThroughOnException() {} });
  return res.status;
}

section('malformed sign-in input is a 400, not a server error');
{
  const env = freshEnv();
  eq('nonce with broken JSON', await raw(env, '/api/nonce', '{not json'), 400);
  eq('nonce with a JSON null', await raw(env, '/api/nonce', 'null'), 400);
  eq('nonce with no body', await raw(env, '/api/nonce', ''), 400);
  eq('session with broken JSON', await raw(env, '/api/session', '{"wallet":'), 400);
  eq('session with a JSON null', await raw(env, '/api/session', 'null'), 400);
  eq('session with an object for a nonce', (await call(env, 'POST', '/api/session',
    { body: { wallet: me, nonce: { a: 1 }, signature: 'x' } })).status, 400);
}

section('the signed message is dated, and the signature still works');
{
  const env = freshEnv();
  const n = await call(env, 'POST', '/api/nonce', { body: { wallet: me } });
  ok('it names the site', /^solquicks\.com wants you to sign in\./.test(n.body.message), n.body.message);
  ok('and when it was issued', /\nIssued at: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(n.body.message), n.body.message);
  const s = await call(env, 'POST', '/api/session', { body: { wallet: me, nonce: n.body.nonce, signature: await sign(n.body.message) } });
  eq('a real signature of it signs in', s.status, 200);
  ok('for a week, not a month', s.body.expires - Date.now() <= 7 * 24 * HOUR && s.body.expires - Date.now() > 6 * 24 * HOUR,
    String(s.body.expires - Date.now()));
  eq('the session works', (await call(env, 'GET', '/api/me', { token: s.body.token })).status, 200);

  const n2 = await call(env, 'POST', '/api/nonce', { body: { wallet: me } });
  const tampered = n2.body.message.replace(/Issued at: .*/, 'Issued at: 2020-01-01T00:00:00.000Z');
  eq('a signature over a differently dated message is refused',
    (await call(env, 'POST', '/api/session', { body: { wallet: me, nonce: n2.body.nonce, signature: await sign(tampered) } })).status, 401);

  const n3 = await call(env, 'POST', '/api/nonce', { body: { wallet: me } });
  advance(6 * MIN);
  eq('and a nonce older than five minutes is refused',
    (await call(env, 'POST', '/api/session', { body: { wallet: me, nonce: n3.body.nonce, signature: await sign(n3.body.message) } })).status, 401);

  section('signing out ends the session on the server');
  const out = await call(env, 'POST', '/api/logout', { token: s.body.token });
  eq('logout answers', out.status, 200);
  eq('and the token no longer works', (await call(env, 'GET', '/api/me', { token: s.body.token })).status, 401);
  eq('logout with no session is refused', (await call(env, 'POST', '/api/logout', {})).status, 401);
}

finish();
