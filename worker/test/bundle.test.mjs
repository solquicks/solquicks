// Bundles: buying several of the same session at once, cheaper per session.
//
// The bug this suite exists to prevent: the first cut of this rate card had a
// four-pack of podcasts at $1,500 ($375 each) and a ten-pack at $4,000 ($400
// each) — the larger commitment carrying the smaller discount. Nothing was
// broken in the code; the two numbers had simply been typed independently. So
// the first section asserts the invariant rather than the prices, and the
// prices themselves are derived from one ladder in src/index.js.

import fs from 'node:fs';
import {
  MIN, HOUR, clock, advance, TREASURY, chain, pay, freshEnv, call, runScheduled,
  wallet, signIn, ok, eq, section, finish
} from './harness.mjs';

const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

// Same lift as booking-quote.test.mjs: the real declarations, not a copy.
function lift(name, kind) {
  const decl = (kind === 'fn' ? 'function ' : 'const ') + name;
  const start = src.indexOf(decl);
  if (start < 0) throw new Error('could not find ' + decl + ' in src/index.js');
  if (kind === 'line') return src.slice(start, src.indexOf('\n', start));
  const [open, close] = kind === 'fn' ? ['{', '}'] : ['[', ']'];
  let depth = 0;
  for (let j = src.indexOf(open, start); j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close && !--depth) return src.slice(start, j + 1) + ';';
  }
  throw new Error('unbalanced ' + decl);
}

const { bundleList, bundleQuote, BUNDLE_TIERS, BOOKING_TYPES, HOLDER_DISCOUNT_PCT, MC_MAX_DAYS } =
  new Function(`
    ${lift('MC_MAX_DAYS', 'line')}
    ${lift('HOLDER_DISCOUNT_PCT', 'line')}
    ${lift('BUNDLE_TIERS', 'array')}
    ${lift('BUNDLE_VALID_DAYS', 'line')}
    ${lift('BOOKING_TYPES', 'array')}
    ${lift('discountPctFor', 'fn')}
    ${lift('bundleableTypes', 'fn')}
    ${lift('bundleList', 'fn')}
    ${lift('bundleQuote', 'fn')}
    return { bundleList, bundleQuote, BUNDLE_TIERS, BOOKING_TYPES, HOLDER_DISCOUNT_PCT, MC_MAX_DAYS };
  `)();

const guest = { name: 'Bundle Buyer', contact: '@buyer' };
const bundles = bundleList();
const bRow = (env, ref) => env._db.prepare('SELECT * FROM bundles WHERE ref = ?').get(ref);
const sessionsOf = (env, ref) =>
  env._db.prepare('SELECT * FROM bookings WHERE bundle_ref = ? ORDER BY starts_at').all(ref);

// Confirm needs the paying wallet connected, exactly as a single booking does.
let payerSeq = 20;
async function payAndConfirm(env, held) {
  const who = wallet(++payerSeq);
  pay({ from: who, usdc: held.body.usdc, reference: held.body.reference });
  const sig = chain.byRef.get(held.body.reference)[0].signature;
  return call(env, 'POST', '/api/bundle/confirm', {
    token: signIn(env, who), body: { ref: held.body.ref, signature: sig }
  });
}

async function slots(env, type) {
  const r = await call(env, 'GET', '/api/booking/slots?type=' + type);
  return (r.body.slots || []).filter((s) => !s.rush);
}

// The calendar offers a start every 30 minutes, but a session runs 60 — so two
// neighbouring slots overlap each other and cannot both be booked. Picking n
// times for a bundle means picking n that do not collide.
function spread(list, n, minutes = 60) {
  const out = [];
  for (const s of list) {
    if (out.every((t) => Math.abs(t - s.starts) >= minutes * 60000)) out.push(s.starts);
    if (out.length === n) break;
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════

section('the price ladder — the bug that started this');
{
  ok('there is more than one tier to compare', BUNDLE_TIERS.length > 1);

  // THE invariant. Buying more must never cost more per session. Any future
  // hand-written price that breaks this fails here.
  const byType = {};
  for (const b of bundles) (byType[b.typeId] = byType[b.typeId] || []).push(b);
  for (const typeId in byType) {
    const tiers = byType[typeId].slice().sort((a, b) => a.qty - b.qty);
    for (let i = 1; i < tiers.length; i++) {
      const small = tiers[i - 1], big = tiers[i];
      ok(`${typeId}: ${big.qty} sessions cost less each than ${small.qty}`,
        big.perSession < small.perSession,
        `${big.qty}× is $${big.perSession}/ea, ${small.qty}× is $${small.perSession}/ea`);
      ok(`${typeId}: the ${big.qty}-pack discount is the deeper one`,
        big.bundlePct > small.bundlePct);
    }
  }

  // And the specific case that was wrong, named so the regression is legible.
  const p4 = bundles.find((b) => b.id === 'podcast-4');
  const p10 = bundles.find((b) => b.id === 'podcast-10');
  ok('both podcast bundles exist', !!p4 && !!p10);
  ok('ten podcasts beat four on price per episode', p10.perSession < p4.perSession,
    `10× $${p10.perSession} vs 4× $${p4.perSession}`);
}

section('every bundle is cheaper than buying the sessions one at a time');
{
  for (const b of bundles) {
    const unit = BOOKING_TYPES.find((t) => t.id === b.typeId).price;
    eq(`${b.id}: full price is ${b.qty} × $${unit}`, b.fullPrice, unit * b.qty);
    ok(`${b.id}: costs less than full price`, b.price < b.fullPrice,
      `$${b.price} vs $${b.fullPrice}`);
    eq(`${b.id}: what it saves adds up`, b.saves, b.fullPrice - b.price);
    eq(`${b.id}: per-session price divides out`, Math.round(b.perSession * b.qty * 100) / 100, b.price);
    ok(`${b.id}: per session beats the single price`, b.perSession < unit);
  }
}

section('what can and cannot be bundled');
{
  ok('MC is not sold in bundles', !bundles.some((b) => b.typeId === 'mc'),
    'an appearance is priced per engagement, not by the multiple');
  for (const t of BOOKING_TYPES) {
    const has = bundles.some((b) => b.typeId === t.id);
    eq(`${t.id} bundleable`, has, t.mode !== 'enquiry');
  }
}

section('the MC appearance');
{
  const mc = BOOKING_TYPES.find((t) => t.id === 'mc');
  eq('is a flat fee', mc.price, 1500);
  ok('blocks whole days rather than an hour', mc.allDay === true);
  eq(`is capped at ${MC_MAX_DAYS} days`, mc.days, MC_MAX_DAYS);
  ok('says the cap out loud', /\b' + MC_MAX_DAYS + '\b|two/.test(String(mc.note)) || mc.note.includes(String(MC_MAX_DAYS)),
    mc.note);
  ok('says a longer booking needs its own package', /longer/i.test(mc.note), mc.note);
  ok('no longer claims travel is billed to the client',
    !mc.includes.some((i) => /travel is included in the fee/i.test(i)));
  ok('says the flights and stay are the fox’s own',
    mc.includes.some((i) => /flights and accommodation/i.test(i)));
}

section('a Ranger gets the discount on a bundle too');
{
  for (const b of bundles) {
    const plain = bundleQuote(b, null);
    const ranger = bundleQuote(b, 'ranger');
    eq(`${b.id}: nobody in particular pays the bundle price`, plain.total, b.price);
    eq(`${b.id}: nobody in particular is quoted no discount`, plain.discountPct, 0);
    eq(`${b.id}: a Ranger is quoted ${HOLDER_DISCOUNT_PCT}%`, ranger.discountPct, HOLDER_DISCOUNT_PCT);
    eq(`${b.id}: and pays that off the bundle price`, ranger.total,
      Math.round(b.price * (1 - HOLDER_DISCOUNT_PCT / 100) * 100) / 100);
    ok(`${b.id}: a Ranger still pays something`, ranger.total > 0);
  }
  // The deepest combination on the site, asserted so the number is a decision
  // somebody made rather than a surprise found in production.
  const deepest = bundles.slice().sort((a, b) =>
    bundleQuote(a, 'ranger').total / a.fullPrice - bundleQuote(b, 'ranger').total / b.fullPrice)[0];
  const off = Math.round((1 - bundleQuote(deepest, 'ranger').total / deepest.fullPrice) * 100);
  ok(`the deepest discount on the site is ${deepest.id} at ${off}% off list`, off <= 60,
    `${off}% off — if that is too generous, change BUNDLE_TIERS or carve bundles out of the holder discount`);
}

section('the rate card over HTTP');
{
  const env = freshEnv();
  const r = await call(env, 'GET', '/api/bundle/types');
  eq('answers', r.status, 200);
  eq('offers every bundle', r.body.bundles.length, bundles.length);
  ok('each carries what this caller would pay', r.body.bundles.every((b) => b.yours && b.yours.total > 0));
  eq('a caller with no wallet is quoted no discount', r.body.discountPct, 0);
  ok('says where the money goes', r.body.payTo === TREASURY);
  ok('explains that credits expire', /expire|last/i.test(r.body.policy.expiry));

  const holder = freshEnv();
  const who = wallet(1);
  const token = signIn(holder, who, { holder: true });
  const h = await call(holder, 'GET', '/api/bundle/types', { token });
  eq('a Ranger is quoted the discount', h.body.discountPct, HOLDER_DISCOUNT_PCT);
  ok('and a lower total on every bundle',
    h.body.bundles.every((b, i) => b.yours.total < r.body.bundles[i].yours.total));
}

section('holding a bundle — what gets refused');
{
  const env = freshEnv();
  const hold = (body) => call(env, 'POST', '/api/bundle/hold', { body });
  const open = await slots(env, 'podcast');

  eq('unknown bundle', (await hold({ bundle: 'nope-4', ...guest })).status, 400);
  eq('no name', (await hold({ bundle: 'podcast-4', contact: '@x' })).status, 400);
  eq('no contact', (await hold({ bundle: 'podcast-4', name: 'x' })).status, 400);

  // All or nothing on purpose: a half-scheduled bundle would have to explain
  // which sessions are times and which are credits.
  eq('too few times', (await hold({ bundle: 'podcast-4', ...guest, slots: [open[0].starts] })).status, 400);
  eq('too many times',
    (await hold({ bundle: 'podcast-4', ...guest, slots: open.slice(0, 5).map((s) => s.starts) })).status, 400);
  eq('the same time twice',
    (await hold({ bundle: 'podcast-4', ...guest, slots: [open[0].starts, open[0].starts, open[1].starts, open[2].starts] })).status, 400);
  // Two starts 30 minutes apart are two different times, and still cannot both
  // be booked — an hour-long session swallows the next slot. The API refuses
  // it; the picker on the page has to grey it out.
  {
    const back = open.filter((sl) => sl.starts >= open[0].starts).slice(0, 2).map((sl) => sl.starts);
    const touching = await hold({ bundle: 'podcast-4', ...guest, slots: back.concat(spread(open, 4).slice(2)) });
    eq('two overlapping times', touching.status, 409);
  }
  eq('a time inside the lead window',
    (await hold({ bundle: 'podcast-4', ...guest, slots: [clock + HOUR, open[1].starts, open[2].starts, open[3].starts] })).status, 400);
}

section('buy now, book later');
{
  const env = freshEnv();
  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'space-10', ...guest } });
  eq('held', r.status, 200);
  ok('says the credits are booked later', r.body.bookLater === true);
  eq('nothing is scheduled yet', r.body.scheduled.length, 0);
  eq('quoted the ladder price', r.body.quote.total, bundles.find((b) => b.id === 'space-10').price);
  ok('asks for USDC', r.body.usdc > 0);

  // Unpaid, so no credit can be spent yet.
  const open = await slots(env, 'space');
  const early = await call(env, 'POST', '/api/bundle/redeem', { body: { ref: r.body.ref, startsAt: open[0].starts } });
  eq('a credit cannot be spent before the bundle is paid for', early.status, 409);

  const c = await payAndConfirm(env, r);
  eq('confirms', c.status, 200);
  eq('paid', bRow(env, r.body.ref).status, 'paid');
  eq('ten credits, none used', c.body.bundle.credits.left, 10);
  ok('credits now have an expiry', bRow(env, r.body.ref).expires_at > clock);

  // And now one can be spent.
  const spend = await call(env, 'POST', '/api/bundle/redeem', { body: { ref: r.body.ref, startsAt: open[0].starts } });
  eq('a credit books an hour', spend.status, 200);
  eq('nine left', spend.body.bundle.credits.left, 9);
  eq('the session costs nothing more', spend.body.booking.totalUsd, 0);
  eq('and is confirmed, not awaiting payment', spend.body.booking.status, 'confirmed');
  eq('one session on the bundle', sessionsOf(env, r.body.ref).length, 1);

  // That hour is now taken for everybody.
  const after = await slots(env, 'space');
  ok('the hour it took is off the calendar', !after.some((s) => s.starts === open[0].starts));

  // The money is counted once, in the bundle, not again in the session.
  const total = env._db.prepare("SELECT COALESCE(SUM(total_usd),0) AS n FROM bookings WHERE bundle_ref = ?")
    .get(r.body.ref).n;
  eq('the sessions add nothing to revenue', total, 0);
}

section('buy now, schedule everything up front');
{
  const env = freshEnv();
  const open = await slots(env, 'stream');
  const picked = spread(open, 4);
  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'stream-4', ...guest, slots: picked } });
  eq('held', r.status, 200);
  eq('four sessions scheduled', r.body.scheduled.length, 4);
  ok('not a book-later bundle', r.body.bookLater === false);

  // Those hours are held before a penny is paid — that is the point of
  // choosing them up front.
  const during = await slots(env, 'stream');
  ok('all four hours are held while payment is pending',
    picked.every((t) => !during.some((s) => s.starts === t)));
  ok('the sessions are held, not confirmed',
    sessionsOf(env, r.body.ref).every((b) => b.status === 'held'));

  const c = await payAndConfirm(env, r);
  eq('confirms', c.status, 200);
  ok('every session is confirmed once the bundle is paid',
    sessionsOf(env, r.body.ref).every((b) => b.status === 'confirmed'));
  eq('no credits left to book', c.body.bundle.credits.left, 0);

  const spare = spread(await slots(env, 'stream'), 1)[0];
  const more = await call(env, 'POST', '/api/bundle/redeem', { body: { ref: r.body.ref, startsAt: spare } });
  eq('a fifth session is refused', more.status, 409);
}

section('an abandoned bundle gives its hours back');
{
  const env = freshEnv();
  const open = await slots(env, 'podcast');
  const picked = spread(open, 4);
  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'podcast-4', ...guest, slots: picked } });
  eq('held', r.status, 200);

  // Abandoned holds are retired at the start of any public request, which is
  // where the rest of the suite triggers them too — a request is the only time
  // a freed hour can matter to anybody.
  advance(21 * MIN);
  await slots(env, 'podcast');

  eq('the bundle is expired', bRow(env, r.body.ref).status, 'expired');
  ok('so are its sessions', sessionsOf(env, r.body.ref).every((b) => b.status === 'expired'));
  // Against the whole calendar, not the no-rush slice: 21 minutes have passed,
  // so the earliest of these hours have crossed into the rush window and would
  // be filtered out for being pricier rather than for being taken.
  const all = (await call(env, 'GET', '/api/booking/slots?type=podcast')).body.slots || [];
  ok('every hour is bookable again', picked.every((t) => all.some((s) => s.starts === t)),
    picked.filter((t) => !all.some((s) => s.starts === t)).join(', ') + ' still gone');

  // And the credits it never bought cannot be counted.
  const look = await call(env, 'GET', '/api/bundle/lookup?ref=' + r.body.ref);
  eq('lookup finds it', look.status, 200);
  eq('expired', look.body.bundle.status, 'expired');
}

section('one of the chosen hours goes while the buyer is choosing');
{
  const env = freshEnv();
  const open = await slots(env, 'space');
  const picked = spread(open, 4);

  // Somebody books the third hour as a single session first.
  const single = await call(env, 'POST', '/api/booking/hold', {
    body: { type: 'space', startsAt: picked[2], name: 'Someone Else', contact: '@else' }
  });
  eq('they get it', single.status, 200);

  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'space-4', ...guest, slots: picked } });
  eq('the bundle is refused rather than sold short', r.status, 409);

  // Nothing half-written left behind: a bundle that could not have all four
  // hours must not leave two of them held by a bundle nobody owns.
  eq('no bundle row survives', env._db.prepare('SELECT COUNT(*) AS n FROM bundles').get().n, 0);
  eq('no orphan sessions survive',
    env._db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE bundle_ref IS NOT NULL').get().n, 0);
  const after = await slots(env, 'space');
  ok('the other hours are free again',
    [picked[0], picked[1], picked[3]].every((t) => after.some((s) => s.starts === t)));
}

section('a bundle that is short-paid buys nothing');
{
  const env = freshEnv();
  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'custom-4', ...guest } });
  eq('held', r.status, 200);

  // A dollar less than the quote. Written as its own payment rather than
  // through payAndConfirm, because the whole point is that it is NOT the
  // quoted amount — a helper that always pays in full would hide the bug.
  const short = wallet(4);
  pay({ from: short, usdc: r.body.usdc - 1000000, reference: r.body.reference });
  const sig = chain.byRef.get(r.body.reference)[0].signature;
  const c = await call(env, 'POST', '/api/bundle/confirm', {
    token: signIn(env, short), body: { ref: r.body.ref, signature: sig }
  });
  ok('refused', c.status === 402, 'status ' + c.status);
  eq('still held, not paid', bRow(env, r.body.ref).status, 'held');

  const open = await slots(env, 'consult');
  const spend = await call(env, 'POST', '/api/bundle/redeem', { body: { ref: r.body.ref, startsAt: open[0] && open[0].starts } });
  eq('and no credit can be spent', spend.status, 409);
}

section('credits expire');
{
  const env = freshEnv();
  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'space-4', ...guest } });
  eq('paid', (await payAndConfirm(env, r)).status, 200);

  const expiresAt = bRow(env, r.body.ref).expires_at;
  advance(expiresAt - clock + MIN);

  const open = await slots(env, 'space');
  const late = await call(env, 'POST', '/api/bundle/redeem', { body: { ref: r.body.ref, startsAt: open[0].starts } });
  eq('a credit cannot be spent after it expires', late.status, 409);
  ok('and says when they ran out', /expired/i.test(late.body.error), late.body.error);
}

section('the reference is the only thing a buyer has to keep');
{
  const env = freshEnv();
  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'podcast-10', ...guest } });
  eq('paid', (await payAndConfirm(env, r)).status, 200);

  // The page has one "find it" box, so a bundle reference must work in it.
  const viaBooking = await call(env, 'GET', '/api/booking/lookup?ref=' + r.body.ref);
  eq('the booking lookup finds a bundle', viaBooking.status, 200);
  eq('and says what it is', viaBooking.body.kind, 'bundle');
  eq('with the credits on it', viaBooking.body.bundle.credits.left, 10);

  eq('an unknown reference is a 404', (await call(env, 'GET', '/api/bundle/lookup?ref=PACK-NOPE1')).status, 404);
  eq('no reference at all is a 400', (await call(env, 'GET', '/api/bundle/lookup')).status, 400);

  // Credits belong to the reference, not to a wallet — so a bundle can be
  // bought for somebody else, and read back with nothing signed in.
  const anon = await call(env, 'GET', '/api/bundle/lookup?ref=' + r.body.ref);
  eq('readable with no wallet connected', anon.status, 200);
  eq('and the credits are all there', anon.body.bundle.credits.left, 10);

  // Spending one needs no wallet either, only the reference.
  const open = await slots(env, 'podcast');
  const spend = await call(env, 'POST', '/api/bundle/redeem', { body: { ref: r.body.ref, startsAt: open[0].starts } });
  eq('and whoever holds the reference can book', spend.status, 200);
  eq('nine left', spend.body.bundle.credits.left, 9);
}

section('paying twice does not buy twice');
{
  const env = freshEnv();
  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'space-4', ...guest } });
  const who = wallet(7);
  const tok = signIn(env, who);
  pay({ from: who, usdc: r.body.usdc, reference: r.body.reference });
  const sig = chain.byRef.get(r.body.reference)[0].signature;
  const twice = (body) => call(env, 'POST', '/api/bundle/confirm', { token: tok, body });

  const a = await twice({ ref: r.body.ref, signature: sig });
  const b = await twice({ ref: r.body.ref, signature: sig });
  eq('first confirm pays it', a.status, 200);
  eq('second confirm says so rather than paying again', b.status, 200);
  ok('and says it was already paid', b.body.alreadyPaid === true);
  eq('one payment recorded', env._db.prepare("SELECT COUNT(*) AS n FROM payments").get().n, 1);
  eq('four credits, not eight', b.body.bundle.credits.left, 4);
}

section('the sweep finds a bundle paid after the page closed');
{
  const env = freshEnv();
  const open = await slots(env, 'stream');
  const picked = spread(open, 4);
  const r = await call(env, 'POST', '/api/bundle/hold', { body: { bundle: 'stream-4', ...guest, slots: picked } });
  pay({ from: wallet(8), usdc: r.body.usdc, reference: r.body.reference });

  // Nobody ever called confirm.
  await runScheduled(env);
  eq('the sweep pays it', bRow(env, r.body.ref).status, 'paid');
  ok('and confirms its sessions',
    sessionsOf(env, r.body.ref).every((b) => b.status === 'confirmed'));
  ok('and tells the fox', chain.alerts.some((a) => a.includes(r.body.ref)));
}

finish();
