// The booking and ad-slot checkouts, end to end, against the worker that ships.
// The database, clock and fake network are in harness.mjs.

import {
  MIN, HOUR, START, clock, advance, setClock, TREASURY, USDC, chain, pay, freshEnv, call, runScheduled,
  payments, wallet, signIn, ok, eq, section, finish
} from './harness.mjs';

const row = (env, ref) => env._db.prepare('SELECT * FROM bookings WHERE ref = ?').get(ref);

async function slots(env, type = 'space') {
  const r = await call(env, 'GET', '/api/booking/slots?type=' + type);
  return r.body.slots || [];
}
const firstCalm = (list) => list.find((s) => !s.rush);
const firstRush = (list) => list.find((s) => s.rush);
const guest = { name: 'Test Guest', contact: '@guest' };

// The discount the shipping code applies, read from it rather than copied.
const HOLDER_DISCOUNT_PCT = Number(
  /const HOLDER_DISCOUNT_PCT = (\d+)/.exec(
    (await import('node:fs')).readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
  )[1]
);

// ═════════════════════════════════════════════════════════════════════════════

section('the calendar');
{
  const env = freshEnv();
  const list = await slots(env);
  ok('slots are offered', list.length > 0, 'none returned');
  ok('no slot is less than 24 hours out', list.every((s) => s.starts - clock >= 24 * HOUR));
  ok('no slot is more than 30 days out', list.every((s) => s.starts - clock <= 30 * 24 * HOUR));
  ok('a slot is flagged rush exactly when it is inside 48 hours',
    list.every((s) => s.rush === (s.starts - clock < 48 * HOUR)));
  ok('both rush and non-rush slots exist to book', !!firstRush(list) && !!firstCalm(list));
  eq('an unknown type is refused', (await call(env, 'GET', '/api/booking/slots?type=nope')).status, 400);
  eq('custom content has no calendar', (await slots(env, 'custom')).length, 0);
  eq('MC has no calendar', (await slots(env, 'mc')).length, 0);
}

section('holding a slot — what gets refused');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const hold = (body) => call(env, 'POST', '/api/booking/hold', { body });

  eq('no name', (await hold({ type: 'space', startsAt: s.starts, contact: '@x' })).status, 400);
  eq('no contact', (await hold({ type: 'space', startsAt: s.starts, name: 'x' })).status, 400);
  eq('no time for a booked-time service', (await hold({ type: 'space', ...guest })).status, 400);
  eq('a time under 24 hours away', (await hold({ type: 'space', startsAt: clock + 3 * HOUR, ...guest })).status, 400);
  eq('a time that is not on the calendar grid', (await hold({ type: 'space', startsAt: s.starts + MIN, ...guest })).status, 409);
  eq('a time outside working hours', (await hold({ type: 'space', startsAt: s.starts - (s.starts % (24 * HOUR)) + 30 * HOUR + 4 * HOUR, ...guest })).status, 409);
  eq('an unknown service', (await hold({ type: 'nope', startsAt: s.starts, ...guest })).status, 400);
  eq('nothing was written for any refusal', env._db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0);
}

section('holding a slot — what a good hold looks like');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const r = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  eq('accepted', r.status, 200);
  ok('reference looks like FOX-XXXXXX', /^FOX-[A-HJ-NP-Z2-9]{6}$/.test(r.body.ref), r.body.ref);
  eq('quoted at list price', r.body.quote.total, 200);
  eq('asks for exactly $200 in micro-USDC', r.body.usdc, 200000000);
  eq('pays the treasury', r.body.payTo, TREASURY);
  eq('in USDC', r.body.usdcMint, USDC);
  eq('held for 20 minutes', r.body.holdUntil - clock, 20 * MIN);
  ok('carries a Solana Pay reference', typeof r.body.reference === 'string' && r.body.reference.length >= 32);
  const b = row(env, r.body.ref);
  eq('stored as held', b.status, 'held');
  eq('stored total matches the quote', b.total_usd, 200);

  const after = await slots(env);
  ok('the held slot is gone from the calendar', !after.some((x) => x.starts === s.starts));
  ok('a slot that would overlap it is gone too', !after.some((x) => x.starts === s.starts + 30 * MIN));
  ok('the next free hour is still offered', after.some((x) => x.starts === s.starts + 60 * MIN));
}

section('the same hour cannot be sold twice');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const a = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  const b = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  eq('first hold accepted', a.status, 200);
  eq('second hold on the same slot refused', b.status, 409);
  // one person, one calendar: a Space and a podcast cannot share an hour
  const c = await call(env, 'POST', '/api/booking/hold', { body: { type: 'podcast', startsAt: s.starts, ...guest } });
  eq('a different service at the same hour is refused', c.status, 409);
  const d = await call(env, 'POST', '/api/booking/hold', { body: { type: 'stream', startsAt: s.starts + 30 * MIN, ...guest } });
  eq('a different service overlapping by half an hour is refused', d.status, 409);
}

section('the price is decided by the server');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const lie = await call(env, 'POST', '/api/booking/hold', {
    body: { type: 'space', startsAt: s.starts + 2 * HOUR, ...guest, holder: true, total: 1, usdc: 1, quote: { total: 1 } }
  });
  eq('a client claiming to be a holder, and a $1 total, is ignored', lie.body.quote.total, 200);

  const holderTok = signIn(env, wallet(1), { holder: true });
  const h = await call(env, 'POST', '/api/booking/hold', { token: holderTok, body: { type: 'space', startsAt: s.starts + 4 * HOUR, ...guest } });
  // Derived from the discount the code actually applies, so a change of rate
  // updates the expectation instead of failing a number typed in months ago.
  const holderPrice = Math.round(200 * (1 - HOLDER_DISCOUNT_PCT / 100) * 100) / 100;
  eq('a signed-in holder pays the discounted price', h.body.quote.total, holderPrice);
  eq('and is asked for that in USDC', h.body.usdc, Math.round(holderPrice * 1e6));

  const plainTok = signIn(env, wallet(2));
  const p = await call(env, 'POST', '/api/booking/hold', { token: plainTok, body: { type: 'space', startsAt: s.starts + 6 * HOUR, ...guest } });
  eq('a signed-in non-holder pays list price', p.body.quote.total, 200);

  const staleTok = signIn(env, wallet(3), { holder: true, expired: true });
  const st = await call(env, 'POST', '/api/booking/hold', { token: staleTok, body: { type: 'space', startsAt: s.starts + 8 * HOUR, ...guest } });
  eq('a holder with an expired session pays list price', st.body.quote.total, 200);

  const rushSlot = firstRush(await slots(env));
  const rr = await call(env, 'POST', '/api/booking/hold', { body: { type: 'podcast', startsAt: rushSlot.starts, ...guest } });
  eq('a podcast inside 48 hours carries the rush: $525', rr.body.quote.total, 525);
}

section('services without a calendar');
{
  const env = freshEnv();
  const c = await call(env, 'POST', '/api/booking/hold', { body: { type: 'custom', ...guest } });
  eq('custom content needs no time', c.status, 200);
  eq('and is held for payment', row(env, c.body.ref).status, 'held');
  eq('at $250', c.body.usdc, 250000000);

  const m = await call(env, 'POST', '/api/booking/hold', { body: { type: 'mc', ...guest } });
  eq('an MC enquiry is accepted', m.status, 200);
  eq('asks for no money', m.body.usdc, null);
  eq('holds nothing', m.body.holdUntil, null);
  eq('is stored as an enquiry', row(env, m.body.ref).status, 'enquiry');
  const pay1 = pay({ from: wallet(9), usdc: 1000e6 });
  const mc = await call(env, 'POST', '/api/booking/confirm', { token: signIn(env, wallet(9)), body: { ref: m.body.ref, signature: pay1 } });
  eq('and cannot be "paid" through checkout', mc.status, 409);
}

section('paying by connected wallet');
{
  const env = freshEnv();
  const buyer = wallet(10);
  const tok = signIn(env, buyer);
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: s.starts, ...guest } });
  const ref = h.body.ref;
  const confirm = (signature, t = tok, r = ref) => call(env, 'POST', '/api/booking/confirm', { token: t, body: { ref: r, signature } });

  eq('no signature', (await call(env, 'POST', '/api/booking/confirm', { body: { ref } })).status, 400);
  eq('unknown booking', (await confirm('whatever', tok, 'FOX-NOPE22')).status, 404);

  eq('a transaction that is not on chain', (await confirm('sig-not-landed')).status, 402);
  eq('a failed transaction', (await confirm(pay({ from: buyer, usdc: 200e6, failed: true }))).status, 402);
  eq('one cent short', (await confirm(pay({ from: buyer, usdc: 199.99e6 }))).status, 402);
  const solPay = await confirm(pay({ from: buyer, sol: 2e9 }));
  eq('paid in SOL instead of USDC', solPay.status, 402);
  ok('and is told bookings are USDC only', /USDC only/.test(solPay.body.error || ''), solPay.body.error);
  eq('the right amount from somebody else\'s wallet', (await confirm(pay({ from: wallet(11), usdc: 200e6 }))).status, 402);
  eq('none of that marked it paid', row(env, ref).status, 'held');
  eq('none of that consumed a payment', payments(env), 0);

  const good = pay({ from: buyer, usdc: 200e6 });
  const c = await confirm(good);
  eq('the exact amount from the booker is accepted', c.status, 200);
  eq('booking is paid', row(env, ref).status, 'paid');
  eq('signature is recorded on the booking', row(env, ref).signature, good);
  eq('payment is recorded once', payments(env), 1);

  const again = await confirm(good);
  eq('confirming twice is harmless', again.body.alreadyPaid, true);
  eq('and records nothing new', payments(env), 1);

  const lookup = await call(env, 'GET', '/api/booking/lookup?ref=' + ref);
  eq('lookup shows it paid', lookup.body.booking.status, 'paid');
  ok('lookup does not leak the contact details', !('contact' in lookup.body.booking) && !('brief' in lookup.body.booking));

  // the same payment cannot pay for a second booking
  const s2 = (await slots(env)).filter((x) => !x.rush)[5];
  const h2 = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: s2.starts, ...guest } });
  const reuse = await confirm(good, tok, h2.body.ref);
  eq('reusing a payment for another booking is refused', reuse.status, 402);
  eq('that booking is still unpaid', row(env, h2.body.ref).status, 'held');

  const over = await confirm(pay({ from: buyer, usdc: 250e6 }), tok, h2.body.ref);
  eq('overpaying is accepted', over.status, 200);
}

section('paying by QR from a phone that never visited the site');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'stream', startsAt: s.starts, ...guest } });
  const watch = () => call(env, 'GET', '/api/booking/watch?ref=' + h.body.ref);

  eq('before paying it is waiting', (await watch()).body.status, 'waiting');

  pay({ from: wallet(20), usdc: 299e6, reference: h.body.reference });
  const short = await watch();
  eq('a short payment leaves it waiting', short.body.status, 'waiting');
  ok('with a reason', !!short.body.note, JSON.stringify(short.body));

  const phone = wallet(21);
  pay({ from: phone, usdc: 300e6, reference: h.body.reference });
  const paid = await watch();
  eq('the full payment is found by its reference', paid.body.status, 'paid');
  eq('booking is paid', row(env, h.body.ref).status, 'paid');
  eq('the paying wallet is recorded', row(env, h.body.ref).wallet, phone);

  eq('watching again stays paid', (await watch()).body.status, 'paid');
  eq('and does not record the payment twice', payments(env), 1);
  eq('an unknown reference', (await call(env, 'GET', '/api/booking/watch?ref=FOX-NOPE22')).status, 404);
}

section('an abandoned hold frees the slot');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });

  advance(19 * MIN);
  await slots(env);
  eq('at 19 minutes it is still held', row(env, h.body.ref).status, 'held');

  advance(2 * MIN);
  await slots(env); // any request sweeps expired holds
  eq('at 21 minutes it has expired', row(env, h.body.ref).status, 'expired');
  ok('the slot is back on the calendar', (await slots(env)).some((x) => x.starts === s.starts));

  const again = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  eq('someone else can now hold it', again.status, 200);

  // the original customer's wallet now pays, but the hour has gone to someone else
  const late = await call(env, 'POST', '/api/booking/confirm', {
    token: signIn(env, wallet(30)), body: { ref: h.body.ref, signature: pay({ from: wallet(30), usdc: 200e6 }) }
  });
  eq('paying for the expired hold after the hour was taken is refused', late.status, 409);
  eq('and says a refund is coming', late.body.refund, true);
  eq('the money is recorded, not lost', payments(env), 1);
  eq('the booking is marked for refund', row(env, h.body.ref).status, 'refund');
  eq('the new holder keeps the hour', row(env, again.body.ref).status, 'held');
  ok('you are told to refund it', chain.alerts.some((a) => a.includes('Refund needed') && a.includes(h.body.ref)));
}

section('money that arrives when nobody is watching');
{
  // The payment screen says: "If you pay and this page closes, the payment is
  // still found." The scheduled sweep is what makes that true.
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });

  advance(1 * MIN);
  pay({ from: wallet(40), usdc: 200e6, reference: h.body.reference }); // paid in full, on time
  advance(20 * MIN); // ...and the tab was closed
  await slots(env);
  eq('with nobody watching, the hold expires on schedule', row(env, h.body.ref).status, 'expired');

  const before = chain.alerts.length;
  await runScheduled(env);
  eq('the scheduled sweep finds the payment', row(env, h.body.ref).status, 'paid');
  eq('records it once', payments(env), 1);
  eq('against the wallet that paid', row(env, h.body.ref).wallet, wallet(40));
  ok('the hour is off the calendar again', !(await slots(env)).some((x) => x.starts === s.starts));
  ok('you are told it was booked late but honoured',
    chain.alerts.slice(before).some((a) => a.includes(h.body.ref) && a.includes('still free')));
  eq('coming back with the reference shows it paid', (await call(env, 'GET', '/api/booking/watch?ref=' + h.body.ref)).body.status, 'paid');

  await runScheduled(env);
  eq('a second sweep changes nothing', payments(env), 1);
}

section('late payment — each way it can go');
{
  // hour still free, customer's page notices on its own
  const env = freshEnv();
  const list = (await slots(env)).filter((x) => !x.rush);
  const a = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: list[0].starts, ...guest } });
  advance(25 * MIN);
  await slots(env);
  pay({ from: wallet(41), usdc: 200e6, reference: a.body.reference });
  eq('hour still free: the page picks up a late payment as paid',
    (await call(env, 'GET', '/api/booking/watch?ref=' + a.body.ref)).body.status, 'paid');

  // hour taken by someone else in the meantime
  const b = await call(env, 'POST', '/api/booking/hold', { body: { type: 'podcast', startsAt: list[8].starts, ...guest } });
  advance(21 * MIN);
  await slots(env);
  const taker = await call(env, 'POST', '/api/booking/hold', { body: { type: 'stream', startsAt: list[8].starts + 30 * MIN, ...guest } });
  eq('once expired, an overlapping hold is allowed', taker.status, 200);
  pay({ from: wallet(42), usdc: 350e6, reference: b.body.reference });
  eq('hour taken: the late payment is marked for refund',
    (await call(env, 'GET', '/api/booking/watch?ref=' + b.body.ref)).body.status, 'refund');
  eq('and the person who took the hour keeps it', row(env, taker.body.ref).status, 'held');

  // the connected-wallet path, late, hour still free
  const buyer = wallet(43);
  const tok = signIn(env, buyer);
  const c = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: list[16].starts, ...guest } });
  advance(21 * MIN);
  await slots(env);
  const cc = await call(env, 'POST', '/api/booking/confirm', { token: tok, body: { ref: c.body.ref, signature: pay({ from: buyer, usdc: 200e6 }) } });
  eq('a wallet payment landing after the hold, hour free, is accepted', cc.status, 200);
  eq('and booked', row(env, c.body.ref).status, 'paid');

  // no hour at all: custom content is always honoured
  const d = await call(env, 'POST', '/api/booking/hold', { body: { type: 'custom', ...guest } });
  advance(30 * MIN);
  await slots(env);
  pay({ from: wallet(44), usdc: 250e6, reference: d.body.reference });
  eq('custom content paid late is honoured',
    (await call(env, 'GET', '/api/booking/watch?ref=' + d.body.ref)).body.status, 'paid');

  // a short payment after expiry is neither honoured nor refunded
  const e = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: list[24].starts, ...guest } });
  advance(21 * MIN);
  await slots(env);
  pay({ from: wallet(45), usdc: 100e6, reference: e.body.reference });
  const ew = await call(env, 'GET', '/api/booking/watch?ref=' + e.body.ref);
  eq('a short late payment leaves the hold expired', ew.body.status, 'expired');
  ok('with a reason', !!ew.body.note);
  eq('and is not recorded as a payment', row(env, e.body.ref).status, 'expired');

  const admin = env._db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'refund'").get().n;
  eq('exactly one booking in this run needs a refund', admin, 1);
}

section('late payment for a time that has already passed');
{
  const env = freshEnv();
  const s = firstRush(await slots(env)); // 24–48 hours out
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  setClock(s.starts + 5 * MIN); // the Space has started
  await slots(env);
  pay({ from: wallet(46), usdc: 300e6, reference: h.body.reference });
  eq('it is refunded rather than booked into the past',
    (await call(env, 'GET', '/api/booking/watch?ref=' + h.body.ref)).body.status, 'refund');
  setClock(START);
}

section('old abandoned holds cost nothing');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  advance(49 * HOUR);
  await slots(env);
  // counted for this booking's own reference: the scheduled job also reads the
  // fee accounts for the swap leaderboard, which is not what is being tested here
  const ref = h.body.reference;
  const n = chain.lookupsFor[ref] || 0;
  eq('an expired hold older than two days is not looked up again',
    (await call(env, 'GET', '/api/booking/watch?ref=' + h.body.ref)).body.status, 'expired');
  await runScheduled(env);
  eq('by the page or by the sweep', chain.lookupsFor[ref] || 0, n);
  setClock(START);
}

section('two people, the same hour, the same moment');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env));
  const same = await Promise.all([
    call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, name: 'A', contact: '@a' } }),
    call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, name: 'B', contact: '@b' } })
  ]);
  eq('same hour: exactly one hold succeeds', same.map((r) => r.status).sort().join(), '200,409');

  const t = firstCalm((await slots(env)).filter((x) => x.starts > s.starts + 3 * HOUR));
  const overlap = await Promise.all([
    call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: t.starts, name: 'A', contact: '@a' } }),
    call(env, 'POST', '/api/booking/hold', { body: { type: 'podcast', startsAt: t.starts + 30 * MIN, name: 'B', contact: '@b' } })
  ]);
  eq('overlapping hours: exactly one hold succeeds', overlap.map((r) => r.status).sort().join(), '200,409');
  eq('two bookings held in total', env._db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'held'").get().n, 2);

  const five = await Promise.all([0, 1, 2, 3, 4].map((i) =>
    call(env, 'POST', '/api/booking/hold', { body: { type: 'stream', startsAt: t.starts + 6 * HOUR, name: 'P' + i, contact: '@p' } })));
  eq('five at once: one wins', five.filter((r) => r.status === 200).length, 1);
}

section('two bookings, one payment, the same moment');
{
  const env = freshEnv();
  const buyer = wallet(50);
  const tok = signIn(env, buyer);
  const list = (await slots(env)).filter((x) => !x.rush);
  const h1 = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: list[0].starts, ...guest } });
  const h2 = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: list[4].starts, ...guest } });
  const sig = pay({ from: buyer, usdc: 200e6 });
  const both = await Promise.all([
    call(env, 'POST', '/api/booking/confirm', { token: tok, body: { ref: h1.body.ref, signature: sig } }),
    call(env, 'POST', '/api/booking/confirm', { token: tok, body: { ref: h2.body.ref, signature: sig } })
  ]);
  eq('one payment confirms exactly one booking, even when raced',
    env._db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'paid'").get().n, 1);
  eq('and is recorded once', payments(env), 1);
  eq('the other request is refused plainly, not with a server error', both.map((r) => r.status).sort().join(), '200,402');
}

section('the page and the wallet noticing the same payment at once');
{
  // The page polls every two seconds while the wallet is confirming, so both
  // can try to settle one payment together. Each is paused at the worst moment
  // — payment recorded, booking not yet updated — while the other runs.
  const env = freshEnv();
  const buyer = wallet(51);
  const tok = signIn(env, buyer);
  const list = (await slots(env)).filter((x) => !x.rush);

  const h = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: list[0].starts, ...guest } });
  const sig = pay({ from: buyer, usdc: 200e6, reference: h.body.reference });
  const door = env.DB.pauseBefore(/^UPDATE bookings SET status = 'paid'/);
  const confirming = call(env, 'POST', '/api/booking/confirm', { token: tok, body: { ref: h.body.ref, signature: sig } });
  await door.reached;
  const w = await call(env, 'GET', '/api/booking/watch?ref=' + h.body.ref);
  eq('wallet mid-confirm: the page polling in that instant keeps waiting', w.body.status, 'waiting');
  ok('with no error shown', !w.body.note, w.body.note);
  eq('and nothing is marked for refund', row(env, h.body.ref).status, 'held');
  door.release();
  eq('the wallet confirm then completes', (await confirming).status, 200);
  eq('booking paid', row(env, h.body.ref).status, 'paid');
  eq('payment recorded once', payments(env), 1);

  const h2 = await call(env, 'POST', '/api/booking/hold', { token: tok, body: { type: 'space', startsAt: list[6].starts, ...guest } });
  const sig2 = pay({ from: buyer, usdc: 200e6, reference: h2.body.reference });
  const door2 = env.DB.pauseBefore(/^UPDATE bookings SET status = 'paid'/);
  const watching = call(env, 'GET', '/api/booking/watch?ref=' + h2.body.ref);
  await door2.reached;
  const c = await call(env, 'POST', '/api/booking/confirm', { token: tok, body: { ref: h2.body.ref, signature: sig2 } });
  eq('page mid-settle: the wallet confirm in that instant is told it is finishing', c.status, 202);
  ok('not shown an error', !c.body.error, c.body.error);
  door2.release();
  eq('the page then shows paid', (await watching).body.status, 'paid');
  eq('and a repeat confirm agrees', (await call(env, 'POST', '/api/booking/confirm', { token: tok, body: { ref: h2.body.ref, signature: sig2 } })).body.alreadyPaid, true);
  eq('two payments recorded in total', payments(env), 2);
}

section('abuse');
{
  const env = freshEnv();
  const list = await slots(env);
  const ip = '203.0.113.7';
  const codes = [];
  for (let i = 0; i < 13; i++) {
    codes.push((await call(env, 'POST', '/api/booking/hold', { ip, body: { type: 'space', startsAt: list[i * 3].starts, ...guest } })).status);
  }
  eq('twelve holds a minute from one address are allowed', codes.slice(0, 12).every((c) => c === 200), true);
  eq('the thirteenth is refused', codes[12], 429);
  advance(61 * MIN / 60);
  eq('and the limit resets after a minute', (await call(env, 'POST', '/api/booking/hold', { ip, body: { type: 'space', startsAt: list[40].starts, ...guest } })).status, 200);
}

section('payments switched off');
{
  const env = freshEnv({ TREASURY_WALLET: '' });
  const s = firstCalm(await slots(env));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  const c = await call(env, 'POST', '/api/booking/confirm', { token: signIn(env, wallet(60)), body: { ref: h.body.ref, signature: pay({ from: wallet(60), usdc: 200e6 }) } });
  eq('with no treasury configured, nothing can be confirmed', c.status, 503);
  eq('and the booking is not marked paid', row(env, h.body.ref).status, 'held');
}

// ═════════════════════════════════════════════════════════════════════════════
// The ad slot. One exclusive banner, sold in runs of whole weeks; each new run
// starts when the last held or paid one ends.

const DAY = 24 * HOUR, WEEK = 7 * DAY;
const adRow = (env, ref) => env._db.prepare('SELECT * FROM banner_bookings WHERE ref = ?').get(ref);
const adRates = async (env) => (await call(env, 'GET', '/api/banner/rates')).body;
const adHold = (env, weeks, opts = {}) =>
  call(env, 'POST', '/api/banner/hold', { token: opts.token, body: { weeks, name: opts.name || 'Test Sponsor', contact: '@sponsor' } });
const liveRuns = (env) => env._db.prepare(
  "SELECT ref, starts_at, ends_at FROM banner_bookings WHERE status IN ('held','paid') ORDER BY starts_at").all();
const runsOverlap = (runs) => runs.some((a, i) => runs.some((b, j) => i < j && a.starts_at < b.ends_at && b.starts_at < a.ends_at));

section('ad slot — holding a run');
{
  const env = freshEnv();
  eq('with nothing booked, the next run starts in a day', (await adRates(env)).nextFree - clock, DAY);
  // Derived, not picked: "3" was the example of an unoffered length until
  // three weeks went on sale, at which point the test booked a run and the
  // next assertion failed for a reason that had nothing to do with it.
  const offered = new Set((await adRates(env)).rates.map((r) => r.weeks));
  let unoffered = 1;
  while (offered.has(unoffered)) unoffered++;
  eq('an unoffered length is refused', (await adHold(env, unoffered)).status, 400);
  eq('a hold with no contact is refused', (await call(env, 'POST', '/api/banner/hold', { body: { weeks: 1, name: 'x' } })).status, 400);

  // The long runs are the point of the new pricing, so check the curve holds
  // and that a year can actually be booked rather than merely listed.
  const rates = (await adRates(env)).rates;
  eq('seven lengths are offered', rates.length, 7);
  eq('and they are labelled in weeks, months and a year',
    rates.map((r) => r.label).join(', '),
    '1 week, 2 weeks, 3 weeks, 1 month, 3 months, 6 months, 1 year');
  const perWeek = rates.map((r) => Math.round(r.price / r.weeks));
  ok('the per-week price never rises with length', perWeek.every((p, i) => i === 0 || p <= perWeek[i - 1]), perWeek.join(','));
  eq('and flattens at $180 rather than falling forever', perWeek.slice(-3).join(','), '180,180,180');

  const a = await adHold(env, 1);
  eq('a one-week run is held', a.status, 200);
  ok('reference looks like AD-XXXXXX', /^AD-[A-HJ-NP-Z2-9]{6}$/.test(a.body.ref), a.body.ref);
  eq('it starts in a day', a.body.startsAt - clock, DAY);
  eq('and lasts a week', a.body.endsAt - a.body.startsAt, WEEK);
  eq('for 250 USDC', a.body.usdc, 250e6);
  eq('held for 20 minutes by the server\'s clock', a.body.holdUntil - a.body.serverNow, 20 * MIN);

  eq('the next run now starts when that one ends', (await adRates(env)).nextFree, a.body.endsAt);
  const b = await adHold(env, 2);
  eq('a second advertiser is queued straight after', b.body.startsAt, a.body.endsAt);
  eq('for 450 USDC', b.body.usdc, 450e6);
}

section('ad slot — an abandoned hold gives its run back');
{
  const env = freshEnv();
  const a = await adHold(env, 4);
  eq('a four-week hold pushes the next run out four weeks', (await adRates(env)).nextFree, a.body.endsAt);

  advance(21 * MIN);
  await adRates(env); // any request sweeps
  eq('after 20 minutes unpaid it expires', adRow(env, a.body.ref).status, 'expired');
  eq('and the next run is back to starting in a day', (await adRates(env)).nextFree - clock, DAY);
  const b = await adHold(env, 1);
  eq('so the next advertiser is not pushed back a month', b.body.startsAt - clock, DAY);
}

section('ad slot — new advertisers fill the gap an abandoned hold leaves');
{
  const env = freshEnv();
  const a = await adHold(env, 4, { name: 'Abandons' });
  const b = await adHold(env, 1, { name: 'Queued' });
  eq('an advertiser queues behind a four-week hold', b.body.startsAt, a.body.endsAt);
  pay({ from: wallet(78), usdc: 250e6, reference: b.body.reference });
  eq('and pays, so their run is theirs', (await call(env, 'GET', '/api/banner/watch?ref=' + b.body.ref)).body.status, 'paid');

  advance(21 * MIN);
  await adRates(env);
  eq('the four-week hold is abandoned and expires', adRow(env, a.body.ref).status, 'expired');

  const soon = clock + DAY;
  const rates = await adRates(env);
  const startFor = (w) => rates.rates.find((r) => r.weeks === w).startsAt;
  eq('a one-week run is now offered from tomorrow, inside the gap', startFor(1), soon);
  eq('so is a two-week run', startFor(2), soon);
  // the gap is 21 minutes short of four weeks, because this advertiser is booking 21 minutes later
  eq('a four-week run does not fit the gap, so it goes after the queued one', startFor(4), b.body.endsAt);
  eq('the headline date is the one-week date', rates.nextFree, soon);

  const c = await adHold(env, 1, { name: 'Fills first' });
  eq('the next one-week advertiser starts tomorrow, not after the queue', c.body.startsAt, soon);
  const d = await adHold(env, 2, { name: 'Fills second' });
  eq('a two-week advertiser takes the rest of the gap straight after', d.body.startsAt, c.body.endsAt);
  const e = await adHold(env, 1, { name: 'Too late for the gap' });
  eq('what is left is under a week, so the next one queues at the end', e.body.startsAt, b.body.endsAt);

  eq('the advertiser already queued keeps the dates they were given', adRow(env, b.body.ref).starts_at, b.body.startsAt);
  eq('no two runs overlap', runsOverlap(liveRuns(env)), false);
  const empty = liveRuns(env).reduce((gapMs, r, i, all) => gapMs + (i ? Math.max(0, r.starts_at - all[i - 1].ends_at) : 0), 0);
  ok('the banner is left empty for less than a week in total', empty < WEEK, (empty / DAY).toFixed(2) + ' days');
}

section('ad slot — paying by connected wallet');
{
  const env = freshEnv();
  const buyer = wallet(70);
  const tok = signIn(env, buyer);
  const a = await adHold(env, 1, { token: tok });
  const confirm = (signature, ref = a.body.ref) => call(env, 'POST', '/api/banner/confirm', { token: tok, body: { ref, signature } });
  const creative = (ref) => call(env, 'POST', '/api/banner/creative', {
    body: { ref, sponsor: 'Sponsor', headline: 'Headline', url: 'https://example.com' } });

  eq('creative cannot be sent before paying', (await creative(a.body.ref)).status, 409);
  eq('one cent short', (await confirm(pay({ from: buyer, usdc: 249.99e6 }))).status, 402);
  eq('paid in SOL', (await confirm(pay({ from: buyer, sol: 3e9 }))).status, 402);
  eq('the right amount from another wallet', (await confirm(pay({ from: wallet(71), usdc: 250e6 }))).status, 402);
  eq('none of that marked it paid', adRow(env, a.body.ref).status, 'held');

  const good = pay({ from: buyer, usdc: 250e6 });
  const c = await confirm(good);
  eq('the exact amount is accepted', c.status, 200);
  eq('and asks for the creative', c.body.needsCreative, true);
  eq('run is paid', adRow(env, a.body.ref).status, 'paid');
  eq('confirming twice is harmless', (await confirm(good)).body.alreadyPaid, true);
  eq('payment recorded once', payments(env), 1);

  const b = await adHold(env, 1, { token: tok });
  eq('the same payment cannot buy a second run', (await confirm(good, b.body.ref)).status, 402);

  const cr = await creative(a.body.ref);
  eq('creative is accepted once paid', cr.status, 200);
  eq('and waits for approval', adRow(env, a.body.ref).approved, 0);
  eq('it does not go live unapproved', (await call(env, 'GET', '/api/banner/live')).body.slot, null);
}

section('ad slot — paying by QR');
{
  const env = freshEnv();
  const a = await adHold(env, 2);
  const watch = () => call(env, 'GET', '/api/banner/watch?ref=' + a.body.ref);
  eq('before paying it is waiting', (await watch()).body.status, 'waiting');
  pay({ from: wallet(72), usdc: 400e6, reference: a.body.reference });
  const short = await watch();
  eq('a short payment leaves it waiting', short.body.status, 'waiting');
  ok('with a reason', !!short.body.note);
  pay({ from: wallet(73), usdc: 450e6, reference: a.body.reference });
  eq('the full payment is found by reference', (await watch()).body.status, 'paid');
  eq('the paying wallet is recorded', adRow(env, a.body.ref).wallet, wallet(73));
  eq('watching again stays paid', (await watch()).body.status, 'paid');
  eq('and records nothing new', payments(env), 1);
}

section('ad slot — money nobody was watching for');
{
  const env = freshEnv();
  const a = await adHold(env, 1);
  advance(1 * MIN);
  pay({ from: wallet(74), usdc: 250e6, reference: a.body.reference });
  advance(20 * MIN); // tab closed
  await adRates(env);
  eq('with nobody watching, the hold expires on schedule', adRow(env, a.body.ref).status, 'expired');

  const before = chain.alerts.length;
  await runScheduled(env);
  eq('the scheduled sweep finds the payment', adRow(env, a.body.ref).status, 'paid');
  ok('you are told the ad slot was booked, late but honoured',
    chain.alerts.slice(before).some((m) => m.includes('Ad slot booked') && m.includes(a.body.ref) && m.includes('still free')));
  eq('its run is reserved again', (await adRates(env)).nextFree, a.body.endsAt);
  eq('a returning page shows it paid', (await call(env, 'GET', '/api/banner/watch?ref=' + a.body.ref)).body.status, 'paid');
}

section('ad slot — late payment after the run was taken');
{
  const env = freshEnv({ ADMIN_TOKEN: 'admin-test' });
  const a = await adHold(env, 1);
  advance(21 * MIN);
  await adRates(env);
  const b = await adHold(env, 1, { name: 'Second Sponsor' });
  ok('once expired, an overlapping run is offered to the next advertiser',
    b.body.startsAt < a.body.endsAt && a.body.startsAt < b.body.endsAt);

  pay({ from: wallet(75), usdc: 250e6, reference: a.body.reference });
  const before = chain.alerts.length;
  eq('the late payment is marked for refund', (await call(env, 'GET', '/api/banner/watch?ref=' + a.body.ref)).body.status, 'refund');
  eq('the advertiser who took the run keeps it', adRow(env, b.body.ref).status, 'held');
  eq('the money is recorded', payments(env), 1);
  ok('you are told to refund it', chain.alerts.slice(before).some((m) => m.includes('Refund needed') && m.includes(a.body.ref)));
  const creative = await call(env, 'POST', '/api/banner/creative', {
    body: { ref: a.body.ref, sponsor: 'S', headline: 'H', url: 'https://example.com' } });
  eq('a refunded run cannot submit creative', creative.status, 409);
  const admin = await call(env, 'GET', '/api/admin/banner', { token: 'admin-test' });
  ok('the refund shows in the admin list', (admin.body.bookings || []).some((x) => x.ref === a.body.ref && x.status === 'refund'));

  // and by wallet, when the run is still free
  const buyer = wallet(76);
  const tok = signIn(env, buyer);
  const c = await adHold(env, 1, { token: tok });
  advance(21 * MIN);
  await adRates(env);
  const cc = await call(env, 'POST', '/api/banner/confirm', { token: tok, body: { ref: c.body.ref, signature: pay({ from: buyer, usdc: 250e6 }) } });
  eq('a late wallet payment for a run still free is accepted', cc.status, 200);
  eq('and asks for the creative', cc.body.needsCreative, true);
}

section('ad slot — advertisers arriving at the same moment');
{
  const env = freshEnv();
  const two = await Promise.all([adHold(env, 1, { name: 'A' }), adHold(env, 1, { name: 'B' })]);
  eq('two at once are both placed', two.map((r) => r.status).join(), '200,200');
  ok('on different runs', two[0].body.startsAt !== two[1].body.startsAt,
    two.map((r) => new Date(r.body.startsAt).toISOString()).join(' and '));
  eq('that do not overlap', runsOverlap(liveRuns(env)), false);

  const five = await Promise.all([1, 2, 4, 1, 2].map((w, i) => adHold(env, w, { name: 'P' + i })));
  const placed = five.filter((r) => r.status === 200);
  ok('several at once: at least one is placed, and the rest are placed or told to retry',
    placed.length >= 1 && five.every((r) => r.status === 200 || r.status === 409), five.map((r) => r.status).join());
  eq('no two runs ever overlap', runsOverlap(liveRuns(env)), false);
  eq('every accepted hold is really held', placed.every((r) => adRow(env, r.body.ref).status === 'held'), true);
}

section('ad slot — the page and the wallet noticing one payment at once');
{
  const env = freshEnv();
  const buyer = wallet(77);
  const tok = signIn(env, buyer);
  const a = await adHold(env, 1, { token: tok });
  const sig = pay({ from: buyer, usdc: 250e6, reference: a.body.reference });
  const door = env.DB.pauseBefore(/^UPDATE banner_bookings SET status = 'paid'/);
  const confirming = call(env, 'POST', '/api/banner/confirm', { token: tok, body: { ref: a.body.ref, signature: sig } });
  await door.reached;
  const w = await call(env, 'GET', '/api/banner/watch?ref=' + a.body.ref);
  eq('mid-confirm, the page keeps waiting', w.body.status, 'waiting');
  ok('with no error shown', !w.body.note, w.body.note);
  door.release();
  eq('the confirm completes', (await confirming).status, 200);
  eq('run paid, payment recorded once', adRow(env, a.body.ref).status + ' ' + payments(env), 'paid 1');
}

// ═════════════════════════════════════════════════════════════════════════════

section('the basket — several things, one payment');
{
  const env = freshEnv();
  const slots1 = await slots(env, 'space');
  const a = await call(env, 'POST', '/api/booking/hold',
    { body: { type: 'space', startsAt: firstCalm(slots1).starts, ...guest } });
  const podSlots = await slots(env, 'podcast');
  const b = await call(env, 'POST', '/api/booking/hold',
    { body: { type: 'podcast', startsAt: firstCalm(podSlots).starts, ...guest } });
  const ad = await adHold(env, 4);
  eq('three things are held on their own', [a.status, b.status, ad.status].join(','), '200,200,200');

  const basket = (items, extra = {}) => call(env, 'POST', '/api/cart/checkout',
    { body: { items, name: 'Test Guest', contact: '@guest', ...extra } });

  eq('an empty basket is refused', (await basket([])).status, 400);
  eq('a basket with no contact is refused',
    (await call(env, 'POST', '/api/cart/checkout', { body: { items: [{ kind: 'booking', ref: a.body.ref }], name: 'x' } })).status, 400);

  const out = await basket([
    { kind: 'booking', ref: a.body.ref },
    { kind: 'booking', ref: b.body.ref },
    { kind: 'banner', ref: ad.body.ref }
  ]);
  eq('the basket is accepted', out.status, 200);
  eq('and asks for the sum of its lines', out.body.total,
    Math.round((a.body.quote.total + b.body.quote.total + ad.body.totalUsd) * 100) / 100);
  eq('in USDC', out.body.usdc, Math.round(out.body.total * 1e6));
  eq('with all three lines', out.body.items.length, 3);

  // every line now belongs to the basket and holds until the basket does
  const held = env._db.prepare("SELECT ref, group_ref, hold_until FROM bookings WHERE group_ref = ?").all(out.body.ref);
  eq('the bookings joined it', held.length, 2);
  ok('and their holds were pushed out to match',
    held.every((r) => r.hold_until === out.body.holdUntil), JSON.stringify(held.map((r) => r.hold_until)));

  eq('a line cannot be put in two baskets',
    (await basket([{ kind: 'booking', ref: a.body.ref }])).status, 409);

  // one payment settles the lot
  const signature = pay({ from: wallet(40), usdc: Math.round(out.body.total * 1e6), reference: out.body.reference });
  const done = await call(env, 'POST', '/api/cart/confirm',
    { token: signIn(env, wallet(40)), body: { ref: out.body.ref, signature } });
  eq('one signature pays for everything', done.status, 200);
  eq('and every line is paid', done.body.items.filter((i) => (i.booking || i).status === 'paid').length, 3);
  eq('the basket itself is paid', env._db.prepare('SELECT status FROM cart_groups WHERE ref = ?').get(out.body.ref).status, 'paid');
  eq('the ad run is paid too',
    env._db.prepare('SELECT status FROM banner_bookings WHERE ref = ?').get(ad.body.ref).status, 'paid');
  eq('paying twice records one payment', payments(env), 1);

  const again = await call(env, 'POST', '/api/cart/confirm',
    { token: signIn(env, wallet(40)), body: { ref: out.body.ref, signature } });
  eq('confirming again is harmless', [again.status, String(again.body.alreadyPaid)].join(','), '200,true');
}

section('the basket — a line that goes while you are checking out');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env, 'space'));
  const mine = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });

  // it expires, and somebody else takes the hour before checkout happens
  env._db.prepare("UPDATE bookings SET status = 'expired' WHERE ref = ?").run(mine.body.ref);
  const out = await call(env, 'POST', '/api/cart/checkout',
    { body: { items: [{ kind: 'booking', ref: mine.body.ref }], name: 'Test Guest', contact: '@guest' } });
  eq('checkout refuses a line that is no longer held', out.status, 409);
  eq('and names the one that went', out.body.ref, mine.body.ref);
  eq('no half-made basket is left behind', env._db.prepare('SELECT COUNT(*) AS n FROM cart_groups').get().n, 0);
}

section('the basket — abandoned');
{
  const env = freshEnv();
  const s = firstCalm(await slots(env, 'space'));
  const one = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s.starts, ...guest } });
  const out = await call(env, 'POST', '/api/cart/checkout',
    { body: { items: [{ kind: 'booking', ref: one.body.ref }], name: 'Test Guest', contact: '@guest' } });
  eq('a basket is waiting', out.status, 200);

  // nobody pays; the hold runs out
  advance(HOUR);
  await call(env, 'GET', '/api/booking/types');     // any request runs the sweep
  await new Promise((r) => setTimeout(r, 30));
  eq('the hour is released', env._db.prepare('SELECT status FROM bookings WHERE ref = ?').get(one.body.ref).status, 'expired');
  eq('and the basket is retired with it',
    env._db.prepare('SELECT status FROM cart_groups WHERE ref = ?').get(out.body.ref).status, 'expired');
}

section('after paying — the details I actually need');
{
  const env = freshEnv();
  const s0 = firstCalm(await slots(env, 'space'));
  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'space', startsAt: s0.starts, ...guest } });

  const brief = (ref, details) => call(env, 'POST', '/api/booking/brief', { body: { ref, details } });
  eq('details before paying are refused', (await brief(h.body.ref, 'guests: @a')).status, 409);

  const sig = pay({ from: wallet(50), usdc: 200e6, reference: h.body.reference });
  await call(env, 'POST', '/api/booking/confirm', { token: signIn(env, wallet(50)), body: { ref: h.body.ref, signature: sig } });
  eq('once paid they are taken', (await brief(h.body.ref, 'guests: @a, @b · topic: launch')).status, 200);
  eq('and stored against the booking',
    env._db.prepare('SELECT details FROM bookings WHERE ref = ?').get(h.body.ref).details, 'guests: @a, @b · topic: launch');
  eq('an empty note is refused', (await brief(h.body.ref, '   ')).status, 400);
  eq('a reference nobody holds is refused', (await brief('NOPE', 'x')).status, 404);

  const look = await call(env, 'GET', '/api/booking/lookup?ref=' + h.body.ref);
  eq('lookup finds the booking', look.body.kind, 'booking');
  eq('and returns what was told to me', look.body.details, 'guests: @a, @b · topic: launch');

  const ad = await adHold(env, 1);
  const adLook = await call(env, 'GET', '/api/booking/lookup?ref=' + ad.body.ref);
  eq('lookup finds an ad run too', adLook.body.kind, 'banner');
  eq('and says whether the artwork has arrived', adLook.body.banner.hasCreative, false);
}

section('the consulting hour');
{
  const env = freshEnv({ CONSULT_CALENDLY: 'https://calendly.com/solquicks/secret-hour' });
  const types = (await call(env, 'GET', '/api/booking/types')).body.types;
  const consult = types.find((t) => t.id === 'consult');
  ok('it is on the rate card', !!consult, types.map((t) => t.id).join(','));
  eq('at $100 for an hour', consult.price + '/' + consult.minutes, '100/60');

  // The seven lines solquicks wrote, served as written. This is what a
  // customer reads before paying $100, so a silent edit should fail here.
  eq('and lists what the hour covers, in full', consult.includes.join(' · '),
    'Consulting and advisory for your project · An idea session focused on growth and revenue · ' +
    'Go-to-market strategy · Marketing advisory · Community building strategy · ' +
    'Solana networking · Events planning');
  eq('with no calendar of its own', consult.mode, 'async');
  eq('and the scheduling link comes from config', consult.calendly, 'https://calendly.com/solquicks/secret-hour');

  const h = await call(env, 'POST', '/api/booking/hold', { body: { type: 'consult', ...guest } });
  eq('it can be booked', h.status, 200);
  eq('the link comes back with the booking', h.body.calendly, 'https://calendly.com/solquicks/secret-hour');
  eq('and it is paid for like anything else', h.body.usdc, 100000000);

  // Calendly's free plan allows one event type and the 30-minute link is
  // using it, so the hour is arranged by hand: sold with no link at all, and
  // the page asks for availability once it is paid for.
  const bare = freshEnv();
  const card = (await call(bare, 'GET', '/api/booking/types')).body.types;
  const noLink = card.find((t) => t.id === 'consult');
  ok('with no link configured the hour is still on sale', !!noLink, card.map((t) => t.id).join(','));
  eq('and carries no link to offer', noLink.calendly, undefined);
  eq('every service is on the card either way', card.length, types.length);

  const held = await call(bare, 'POST', '/api/booking/hold', { body: { type: 'consult', ...guest } });
  eq('it can be booked without one', held.status, 200);
  eq('and the booking says there is no link', held.body.calendly, null);

  // Its own wording: the defaults for an async booking describe something
  // made and delivered, which is not an hour spent on a call.
  ok('the card does not call it a thing with no calendar',
    !/no calendar needed/i.test(noLink.meta || ''), noLink.meta);
  ok('it says a time is agreed after booking', /after you book/.test(noLink.meta), noLink.meta);
  eq('and the button asks for an hour', noLink.cta, 'Book an hour');
}

finish();