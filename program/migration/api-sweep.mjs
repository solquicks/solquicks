import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
const API = 'https://solquicks-points.solquicks-45c.workers.dev';
const H = { 'Content-Type': 'application/json', Origin: 'https://solquicks.com' };
const results = [];
let token = null;

async function call(method, path, body, opts = {}) {
  const headers = { ...H };
  if (opts.auth && token) headers.Authorization = 'Bearer ' + token;
  if (opts.admin) headers.Authorization = 'Bearer not-the-real-token';
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await res.json(); } catch { b = await res.text().catch(() => null); }
  return { status: res.status, body: b };
}
function check(name, r, expect) {
  const ok = expect(r);
  results.push({ name, ok, status: r.status, note: ok ? '' : JSON.stringify(r.body).slice(0, 110) });
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(42) + r.status);
  return r;
}
const is200 = r => r.status === 200 && r.body && !r.body.error;

// ── session for a throwaway wallet ──
const kp = Keypair.generate(); const wallet = kp.publicKey.toBase58();
const n = await call('POST', '/api/nonce', { wallet });
check('POST /api/nonce', n, is200);
const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.body.message), kp.secretKey)).toString('base64');
const s = await call('POST', '/api/session', { wallet, nonce: n.body.nonce, signature: sig });
check('POST /api/session (real signature)', s, is200);
token = s.body.token;
check('POST /api/session (bad signature)', await call('POST', '/api/session', { wallet, nonce: n.body.nonce, signature: sig }), r => r.status === 401);

// ── public reads ──
check('GET  /api/health',            await call('GET', '/api/health'), is200);
check('GET  /api/leaderboard',       await call('GET', '/api/leaderboard'), r => is200(r) && Array.isArray(r.body.players));
check('GET  /api/analytics',         await call('GET', '/api/analytics'), r => is200(r) && r.body.holders.supply > 0);
check('GET  /api/analytics/wallet',  await call('GET', '/api/analytics/wallet?wallet=' + wallet), r => r.status === 200);
check('GET  /api/booking/types',     await call('GET', '/api/booking/types'), r => is200(r) && r.body.types.length === 5);
check('GET  /api/booking/slots',     await call('GET', '/api/booking/slots?type=space'), r => is200(r) && r.body.slots.length > 0);
check('GET  /api/booking/slots bad', await call('GET', '/api/booking/slots?type=nope'), r => r.status === 400);
check('GET  /api/booking/lookup',    await call('GET', '/api/booking/lookup?ref=FOX-NOPE'), r => r.status === 404 || r.status === 200);
check('GET  /api/banner/rates',      await call('GET', '/api/banner/rates'), r => is200(r) && r.body.rates.length === 3);
check('GET  /api/banner/live',       await call('GET', '/api/banner/live'), r => r.status === 200);
check('GET  /api/banner/stats',      await call('GET', '/api/banner/stats'), r => r.status === 200);
check('GET  /api/swap/tokens',       await call('GET', '/api/swap/tokens'), r => is200(r) && r.body.feeBps === 20);
check('GET  /api/swap/prices',       await call('GET', '/api/swap/prices?mints=So11111111111111111111111111111111111111112'), r => r.status === 200);
check('GET  /api/swap/search',       await call('GET', '/api/swap/search?q=bonk'), r => r.status === 200);
check('GET  /api/swap/earned',       await call('GET', '/api/swap/earned'), r => is200(r) && r.body.usd < 5);
check('GET  /api/swap/quote',        await call('GET', '/api/swap/quote?in=So11111111111111111111111111111111111111112&out=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000000'), is200);
check('GET  /api/swap/quote same',   await call('GET', '/api/swap/quote?in=So11111111111111111111111111111111111111112&out=So11111111111111111111111111111111111111112&amount=1'), r => r.status === 400);
check('GET  /api/flip/stats',        await call('GET', '/api/flip/stats'), r => r.status === 200);
check('GET  /api/mission',           await call('GET', '/api/mission'), r => r.status === 200);
check('GET  /api/mission/draw',      await call('GET', '/api/mission/draw'), r => r.status === 200);
check('GET  /api/cleanup/scan',      await call('GET', '/api/cleanup/scan?wallet=' + wallet), r => is200(r) && Array.isArray(r.body.accounts));
check('GET  /api/cleanup/scan bad',  await call('GET', '/api/cleanup/scan?wallet=nope'), r => r.status === 400);
check('GET  /api/img bad mint',      await call('GET', '/api/img?mint=nope'), r => r.status === 400);

// ── session routes ──
check('GET  /api/me',                await call('GET', '/api/me', null, { auth: true }), is200);
check('GET  /api/me (no token)',     await call('GET', '/api/me'), r => r.status === 401);
check('GET  /api/rangers',           await call('GET', '/api/rangers', null, { auth: true }), r => is200(r) && Array.isArray(r.body.rangers));
check('POST /api/visit',             await call('POST', '/api/visit', {}, { auth: true }), r => is200(r) && r.body.awarded === 10);
check('POST /api/visit twice',       await call('POST', '/api/visit', {}, { auth: true }), r => r.status === 200 && r.body.awarded === 0);
check('POST /api/claim (nothing)',   await call('POST', '/api/claim', {}, { auth: true }), r => r.status === 200 || r.status === 400);
check('POST /api/stake (no ranger)', await call('POST', '/api/stake', { mints: ['So11111111111111111111111111111111111111112'] }, { auth: true }), r => r.status >= 400);
check('POST /api/unstake (none)',    await call('POST', '/api/unstake', {}, { auth: true }), r => r.status === 200 || r.status >= 400);
check('POST /api/flip (no points)',  await call('POST', '/api/flip', { call: 'heads', wager: 1000000 }, { auth: true }), r => r.status >= 400);
check('POST /api/flip (valid)',      await call('POST', '/api/flip', { call: 'heads', wager: 10 }, { auth: true }), r => is200(r) && ['heads','tails'].includes(r.body.result));
check('POST /api/plushie bad code',  await call('POST', '/api/plushie/redeem', { code: 'FOX-NOPE-NOPE' }, { auth: true }), r => r.status === 400);
check('POST /api/plushie no code',   await call('POST', '/api/plushie/redeem', {}, { auth: true }), r => r.status === 400);
check('GET  /api/swap/points',       await call('GET', '/api/swap/points', null, { auth: true }), r => r.status === 200);
check('POST /api/swap/award nosig',  await call('POST', '/api/swap/award', {}, { auth: true }), r => r.status >= 400);
check('POST /api/cleanup/award nosig', await call('POST', '/api/cleanup/award', {}, { auth: true }), r => r.status >= 400);
check('POST /api/mission/claim',     await call('POST', '/api/mission/claim', {}, { auth: true }), r => r.status === 200 || r.status >= 400);
check('POST /api/award (removed)',   await call('POST', '/api/award', { type: 'gacha' }, { auth: true }), r => r.status === 404);
check('POST /api/migrate (removed)', await call('POST', '/api/migrate', { points: 5000 }, { auth: true }), r => r.status === 404);

// ── admin routes must refuse a wrong token ──
for (const p of ['/api/admin/banner', '/api/admin/bookings', '/api/admin/export', '/api/admin/plushie/codes'])
  check('GET  ' + p + ' (bad token)', await call('GET', p, null, { admin: true }), r => r.status === 401);
for (const p of ['/api/admin/mission/settle', '/api/admin/plushie/codes', '/api/admin/banner/approve'])
  check('POST ' + p + ' (bad token)', await call('POST', p, {}, { admin: true }), r => r.status === 401);

// ── booking + banner holds (rows created, deleted after) ──
const bh = await call('POST', '/api/booking/hold', { type: 'custom', name: 'ZZ SWEEP — delete me', contact: 'test', brief: 'api sweep' });
check('POST /api/booking/hold', bh, r => is200(r) && r.body.usdc === 250000000);
if (bh.body && bh.body.ref) {
  check('GET  /api/booking/watch',  await call('GET', '/api/booking/watch?ref=' + bh.body.ref), r => r.status === 200 && r.body.status === 'waiting');
  check('POST /api/booking/confirm (no payment)', await call('POST', '/api/booking/confirm', { ref: bh.body.ref, signature: '4'.repeat(88) }), r => r.status >= 400);
}
const ah = await call('POST', '/api/banner/hold', { weeks: 1, name: 'ZZ SWEEP — delete me', contact: 'test' });
check('POST /api/banner/hold', ah, r => is200(r) && r.body.usdc === 250000000);
if (ah.body && ah.body.ref) check('GET /api/banner/watch', await call('GET', '/api/banner/watch?ref=' + ah.body.ref), r => r.status === 200);

// ── CORS: the worker should refuse an origin that is not the site ──
const evil = await fetch(API + '/api/leaderboard', { headers: { Origin: 'https://evil.example' } });
check('CORS blocks a foreign origin', { status: evil.status, body: null },
  () => !evil.headers.get('access-control-allow-origin'));

const failed = results.filter(r => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) { console.log('\nFAILURES:'); failed.forEach(f => console.log('  ' + f.name + '  [' + f.status + '] ' + f.note)); }
console.log('\nCLEANUP_WALLET=' + wallet);
console.log('CLEANUP_BOOKING=' + (bh.body && bh.body.ref));
console.log('CLEANUP_BANNER=' + (ah.body && ah.body.ref));
