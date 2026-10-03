// The creator launchpad: an invite, a name, a set of pages, and a site at the
// end of it that is really theirs. Harness in harness.mjs.
//
// Two things here are worth more care than the rest: the origin check, because
// every creator site is a subdomain calling this worker and a sloppy match
// there opens the API to anyone who can register a lookalike domain; and the
// invite, because a code that can be spent twice is two creators fighting over
// one site.

import { chain, freshEnv as blankEnv, call, wallet, ok, eq, section, finish, TREASURY, pay } from './harness.mjs';

const ROOT = 'solquicks.com';
const CREATOR = wallet(500);

const freshEnv = (o) => {
  const env = blankEnv(Object.assign({ ALLOWED_ORIGINS: 'https://' + ROOT, LAUNCH_ROOT: ROOT }, o || {}));
  env._db.prepare('INSERT INTO launch_invites (code, note, created_at) VALUES (?, ?, ?)')
    .run('FOX-ALPHA', 'demo', 1);
  return env;
};

// RDAP, as the registries answer it: 200 for a name somebody owns, 404 for one
// nobody does.
const REGISTERED = ['google.io', 'taken.com'];
// IANA's bootstrap decides which registry answers for a TLD; the registry then
// answers 200 for a name somebody owns and 404 for one nobody does.
const BOOTSTRAP = { services: [[['com', 'net'], ['https://rdap.verisign.com/com/v1/']]] };
const registries = (u) => {
  if (u.indexOf('data.iana.org') >= 0) {
    return new Response(JSON.stringify(BOOTSTRAP), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('', { status: REGISTERED.indexOf(decodeURIComponent(u.split('/').pop())) >= 0 ? 200 : 404 });
};
chain.rdap = registries;

const slug = (env, s) => call(env, 'GET', '/api/launch/slug?s=' + encodeURIComponent(s));
const domain = (env, n) => call(env, 'GET', '/api/launch/domain?name=' + encodeURIComponent(n));

const good = {
  code: 'FOX-ALPHA', slug: 'ripple', wallet: CREATOR, name: 'Ripple',
  handle: '@ripple', tagline: 'Making waves', avatar: 'https://img.test/r.png',
  socials: [{ id: 'x', value: '@ripple' }, { id: 'email', value: 'hi@ripple.io' }],
  topTabs: ['swap', 'store', 'book'], moreTabs: ['cleanup', 'gacha'], domain: 'ripple.io'
};
const create = (env, body) => call(env, 'POST', '/api/launch/create', { body: Object.assign({}, good, body) });

// ═════════════════════════════════════════════════════════════════════════════

section('the origin check, which every creator site depends on');
{
  const env = freshEnv();
  const from = async (origin) => {
    const res = await call(env, 'GET', '/api/launch/features', { origin });
    return res.cors;
  };

  eq('the main site is allowed', await from('https://solquicks.com'), 'https://solquicks.com');
  eq('and so is a creator on a subdomain', await from('https://ripple.solquicks.com'), 'https://ripple.solquicks.com');
  eq('dashes and digits in a name are fine', await from('https://fox-2.solquicks.com'), 'https://fox-2.solquicks.com');

  // The ways this is normally got wrong. Each of these passes a careless
  // endsWith or a substring test.
  eq('a lookalike domain is refused', await from('https://evil-solquicks.com'), undefined);
  eq('and one that only starts with ours', await from('https://solquicks.com.attacker.dev'), undefined);
  eq('a sub-subdomain is not one of ours', await from('https://a.b.solquicks.com'), undefined);
  eq('plain http is refused even on the right host', await from('http://ripple.solquicks.com'), undefined);
  eq('so is an odd port', await from('https://ripple.solquicks.com:8443'), undefined);
  eq('and an empty label', await from('https://.solquicks.com'), undefined);
  eq('a stranger gets nothing', await from('https://example.com'), undefined);

  // A cache in front of this must not hand one origin's answer to another.
  const res = await call(env, 'GET', '/api/launch/features', { origin: 'https://ripple.solquicks.com' });
  eq('the answer says it varies by who asked', res.headers.get('Vary'), 'Origin');
}

section('the invite');
{
  const env = freshEnv();
  const tryCode = (c) => call(env, 'POST', '/api/launch/invite', { body: { code: c } });

  eq('a real code opens the door', (await tryCode('FOX-ALPHA')).status, 200);
  eq('however it is typed', (await tryCode('fox-alpha')).status, 200);
  eq('a made-up one does not', (await tryCode('FOX-NOPE')).status, 404);
  eq('and nor does nothing', (await tryCode('')).status, 400);

  // A code that exists but is spent must answer exactly like one that never
  // existed, or this becomes a way to find real codes.
  await create(env, {});
  const spent = await tryCode('FOX-ALPHA');
  const never = await tryCode('FOX-NOPE');
  eq('a spent code is refused', spent.status, 404);
  eq('and says the same thing as an imaginary one', spent.body.error, never.body.error);
}

section('choosing a name');
{
  const env = freshEnv();
  eq('a good name is free', (await slug(env, 'ripple')).body.free, true);
  eq('and comes with the address it would have', (await slug(env, 'ripple')).body.host, 'ripple.' + ROOT);

  for (const [bad, why] of [
    ['ab', 'too short'], ['-fox', 'start or end'], ['fox-', 'start or end'],
    ['fo--x', 'double'], ['Fox Fox', 'letters, numbers'], ['a'.repeat(33), 'too long']
  ]) {
    const r = await slug(env, bad);
    ok('"' + bad + '" is refused', r.body.free === false, JSON.stringify(r.body));
    ok('  and says why (' + why + ')', new RegExp(why, 'i').test(r.body.reason || ''), r.body.reason);
  }

  // Names that would be used to impersonate the thing hosting them.
  for (const taken of ['www', 'api', 'admin', 'solquicks', 'swap', 'login', 'support']) {
    eq('"' + taken + '" is not available to anyone', (await slug(env, taken)).body.free, false);
  }

  await create(env, {});
  eq('a name in use is gone', (await slug(env, 'ripple')).body.free, false);
  ok('and says so plainly', /already has/.test((await slug(env, 'ripple')).body.reason));
}

section('the domain, asked of the registry rather than guessed');
{
  const env = freshEnv();
  eq('one nobody owns is free', (await domain(env, 'ripple.io')).body.status, 'free');
  eq('one somebody owns is taken', (await domain(env, 'google.io')).body.status, 'taken');
  eq('and .com is answered too', (await domain(env, 'taken.com')).body.status, 'taken');
  eq('nonsense is not a domain', (await domain(env, 'not a domain')).body.status, 'invalid');

  // A registry that will not answer is unknown. Showing that as "free" would
  // have somebody reserve a name that is already somebody else's.
  chain.rdap = (u) => u.indexOf('data.iana.org') >= 0
    ? new Response(JSON.stringify(BOOTSTRAP), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : new Response('', { status: 500 });
  const out = await domain(env, 'ripple.io');
  eq('a registry that will not answer says so', out.body.status, 'unknown');
  ok('rather than claiming it is available', out.body.status !== 'free', out.body.status);

  // Some registries answer from a laptop and not from a Worker — .xyz's does
  // exactly that, which left every .xyz unknown however long anybody waited.
  // rdap.org forwards to whichever registry owns the name, from a host this
  // can reach.
  const asked = [];
  chain.rdap = (u) => {
    asked.push(u);
    if (u.indexOf('data.iana.org') >= 0) {
      return new Response(JSON.stringify(BOOTSTRAP), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (u.indexOf('rdap.org') >= 0) {
      return new Response('', { status: REGISTERED.indexOf(decodeURIComponent(u.split('/').pop())) >= 0 ? 200 : 404 });
    }
    return new Response('', { status: 500 });   // the registry itself, unreachable
  };
  const viaProxy = await domain(env, 'nobodyhasthisone.com');
  eq('a registry we cannot reach falls back and still answers', viaProxy.body.status, 'free');
  ok('having asked the forwarder', asked.some((u) => u.indexOf('rdap.org') >= 0), asked.join(' '));

  // And the fallback must be the fallback. A registry that answers is not
  // replaced by a slower route through somebody else.
  asked.length = 0;
  chain.rdap = registries;
  await domain(env, 'nobodyhasthisone.com');
  ok('while a registry that does answer is not routed around',
    !asked.some((u) => u.indexOf('rdap.org') >= 0), asked.join(' '));

  chain.rdap = registries;

  await create(env, {});
  eq('a domain already claimed here is taken', (await domain(env, 'ripple.io')).body.status, 'taken');

  // .com is most of what anyone would type, and it used to come back unknown:
  // the old lookup went through a service that only ever answered with a
  // redirect to the real registry, which read as the registry not answering.
  const env5 = freshEnv();
  eq('a .com nobody owns is free', (await domain(env5, 'zzq-fox-9183.com')).body.status, 'free');
  eq('and one somebody owns is taken', (await domain(env5, 'taken.com')).body.status, 'taken');

  // A TLD with no RDAP service at all cannot be checked, which is not the
  // same as being free.
  eq('a TLD nobody publishes a registry for is unknown',
    (await domain(env5, 'ripple.nowhere')).body.status, 'unknown');
}

section('launching');
{
  const env = freshEnv();
  const made = await create(env, {});
  eq('the site is made', made.status, 200);
  eq('at its own address', made.body.host, 'ripple.' + ROOT);
  eq('with a path that works too', made.body.path, '/c/ripple');

  // The cash share is a ceiling, not a setting.
  eq('the creator keeps half in cash', made.body.split.usdc, 50);
  eq('the rest goes to the token', made.body.split.token, 49);
  eq('and the platform takes one', made.body.split.platform, 1);
  eq('which is all of it', made.body.split.usdc + made.body.split.token + made.body.split.platform, 100);

  const env2 = freshEnv();
  const greedy = await create(env2, { usdcPct: 90 });
  eq('asking for more cash than the ceiling gets the ceiling', greedy.body.split.usdc, 50);
  const env3 = freshEnv();
  const modest = await create(env3, { usdcPct: 20 });
  eq('asking for less is honoured', modest.body.split.usdc, 20);
  eq('and the difference goes to the token', modest.body.split.token, 79);
}

section('what a launch refuses');
{
  const env = freshEnv();
  eq('no wallet, no site', (await create(env, { wallet: 'nope' })).status, 400);
  eq('no name, no site', (await create(env, { name: '' })).status, 400);
  eq('a bad slug is refused here too, not only in the check',
    (await create(env, { slug: 'admin' })).status, 400);
  eq('two for the top bar is not three', (await create(env, { topTabs: ['swap', 'store'] })).status, 400);
  eq('nor is four', (await create(env, { topTabs: ['swap', 'store', 'book', 'cleanup'] })).status, 400);
  eq('a page that does not exist cannot be put on a site',
    (await create(env, { topTabs: ['swap', 'store', 'mainframe'] })).status, 400);
  eq('and the same page cannot be in both places',
    (await create(env, { topTabs: ['swap', 'store', 'book'], moreTabs: ['swap'] })).status, 400);

  // None of those may have spent the code.
  eq('a refused launch leaves the invite unspent', (await call(env, 'POST', '/api/launch/invite', { body: { code: 'FOX-ALPHA' } })).status, 200);
  eq('so the creator can fix it and go again', (await create(env, {})).status, 200);
}

section('two people, one code');
{
  const env = freshEnv();
  const both = await Promise.all([
    create(env, { slug: 'first', wallet: wallet(501) }),
    create(env, { slug: 'second', wallet: wallet(502) })
  ]);
  eq('only one of them gets through', both.filter((r) => r.status === 200).length, 1);
  eq('and only one site exists', env._db.prepare('SELECT COUNT(*) AS n FROM sites').get().n, 1);
}

section('the site a creator ends up with');
{
  const env = freshEnv();
  await create(env, {});
  const s = (await call(env, 'GET', '/api/site?slug=ripple')).body.site;

  eq('it knows its name', s.name, 'Ripple');
  eq('and the handle', s.handle, '@ripple');
  eq('and the tagline', s.tagline, 'Making waves');
  eq('the pages they chose are in the bar', s.topTabs.join(','), 'swap,store,book');
  eq('and the rest in the dropdown', s.moreTabs.join(','), 'cleanup,gacha');

  // The address the creator's own customers will be asked to pay.
  eq('money goes to the creator, not to us', s.treasury, CREATOR);
  ok('and the wallet is not hidden from the page that has to ask for it', !!s.treasury);

  eq('a site nobody has made is nothing', (await call(env, 'GET', '/api/site?slug=ghost')).body.site, null);
}

section('a creator site takes its own money');
{
  // The point of the whole thing: a booking made on somebody's site is asked
  // for at their wallet and checked against their wallet. Getting this wrong
  // sends a customer's money to me and leaves the creator unpaid.
  const env = freshEnv();
  await create(env, {});

  const mine = await call(env, 'GET', '/api/booking/types');
  const theirs = await call(env, 'GET', '/api/booking/types?site=ripple');
  eq('my rate card quotes my wallet', mine.body.payTo, TREASURY);
  eq('their rate card quotes theirs', theirs.body.payTo, CREATOR);
  ok('which is not mine', theirs.body.payTo !== mine.body.payTo);

  const guest = { name: 'A Customer', contact: '@customer' };
  const held = await call(env, 'POST', '/api/booking/hold',
    { body: Object.assign({ type: 'custom', site: 'ripple' }, guest) });
  eq('a booking on their site is held', held.status, 200);
  eq('and asks for the money at their wallet', held.body.payTo, CREATOR);
  eq('the booking remembers whose site it is',
    env._db.prepare('SELECT site_slug FROM bookings WHERE ref = ?').get(held.body.ref).site_slug, 'ripple');

  const ad = await call(env, 'POST', '/api/banner/hold',
    { body: Object.assign({ weeks: 1, site: 'ripple' }, guest) });
  eq('so does an ad on their site', ad.body.payTo, CREATOR);

  // A site nobody has launched cannot take money at all, rather than
  // defaulting to mine.
  const ghost = await call(env, 'POST', '/api/booking/hold',
    { body: Object.assign({ type: 'custom', site: 'nobody' }, guest) });
  eq('a site that does not exist cannot take payments', ghost.status, 503);
  eq('and certainly does not send them to me', ghost.body.payTo, undefined);
}

section('money is checked against the wallet it was asked for');
{
  // The half that matters more: a payment to me must not settle a booking made
  // on somebody else's site, and the other way round.
  const env = freshEnv();
  await create(env, {});
  const guest = { name: 'A Customer', contact: '@customer' };

  const theirs = await call(env, 'POST', '/api/booking/hold',
    { body: Object.assign({ type: 'custom', site: 'ripple' }, guest) });

  // Paid to me, for a booking on their site.
  pay({ from: wallet(600), usdc: 250e6, reference: theirs.body.reference });
  const wrong = await call(env, 'GET', '/api/booking/watch?ref=' + theirs.body.ref);
  ok('a payment to my wallet does not settle their booking',
    wrong.body.status !== 'paid', JSON.stringify(wrong.body));

  // Paid to them, as it should have been.
  pay({ from: wallet(600), usdc: 250e6, reference: theirs.body.reference, to: CREATOR });
  const right = await call(env, 'GET', '/api/booking/watch?ref=' + theirs.body.ref);
  eq('a payment to theirs does', right.body.status, 'paid');

  // And the reverse: a booking on my site is not settled by paying them.
  const mine = await call(env, 'POST', '/api/booking/hold',
    { body: Object.assign({ type: 'custom' }, guest) });
  pay({ from: wallet(601), usdc: 250e6, reference: mine.body.reference, to: CREATOR });
  const back = await call(env, 'GET', '/api/booking/watch?ref=' + mine.body.ref);
  ok('and paying a creator does not settle a booking on mine',
    back.body.status !== 'paid', JSON.stringify(back.body));
}

section('a basket cannot mix two sites');
{
  // One payment settling lines owed to two different wallets cannot be right
  // at any price, so it is refused rather than half-paid.
  const env = freshEnv();
  await create(env, {});
  const guest = { name: 'A Customer', contact: '@customer' };

  const a = await call(env, 'POST', '/api/booking/hold', { body: Object.assign({ type: 'custom', site: 'ripple' }, guest) });
  const b = await call(env, 'POST', '/api/booking/hold', { body: Object.assign({ type: 'custom' }, guest) });
  const mixed = await call(env, 'POST', '/api/cart/checkout', {
    body: { items: [{ kind: 'booking', ref: a.body.ref }, { kind: 'booking', ref: b.body.ref }], ...guest }
  });
  eq('a basket from two sites is refused', mixed.status, 409);
  ok('and says why', /different sites/.test(mixed.body.error), mixed.body.error);

  const c = await call(env, 'POST', '/api/booking/hold', { body: Object.assign({ type: 'custom', site: 'ripple' }, guest) });
  const same = await call(env, 'POST', '/api/cart/checkout', {
    body: { items: [{ kind: 'booking', ref: a.body.ref }, { kind: 'booking', ref: c.body.ref }], ...guest }
  });
  eq('two from the same site is fine', same.status, 200);
  eq('and the whole basket is owed to that site', same.body.payTo, CREATOR);
}

section('the links on a creator\'s contact page');
{
  const env = freshEnv();
  await create(env, {});
  const socials = (await call(env, 'GET', '/api/site?slug=ripple')).body.site.socials;

  eq('the ones they gave are there', socials.length, 2);
  eq('a handle becomes a link to the platform',
    socials.find((s) => s.id === 'x').href, 'https://x.com/ripple');
  eq('shown as they typed it', socials.find((s) => s.id === 'x').label, '@ripple');
  eq('and an email becomes a mailto', socials.find((s) => s.id === 'email').href, 'mailto:hi@ripple.io');

  // What a creator types goes into a URL, so anything that is not a handle is
  // dropped rather than pasted into one.
  const env2 = freshEnv();
  await create(env2, { slug: 'probe', socials: [
    { id: 'x', value: '../../evil' },
    { id: 'youtube', value: 'a b c' },                   // a space is not a handle
    { id: 'website', value: 'javascript:alert(1)' },     // not https
    { id: 'website', value: 'http://insecure.test' },    // not https either
    { id: 'email', value: 'not-an-email' },
    { id: 'mainframe', value: 'whatever' },              // not a platform at all
    { id: 'telegram', value: '' }                        // nothing typed
  ] });
  const probed = (await call(env2, 'GET', '/api/site?slug=probe')).body.site.socials;
  eq('every bad one is dropped', probed.length, 0, JSON.stringify(probed));

  // One entry per platform: a second is ignored rather than shown twice.
  const env4 = freshEnv();
  await create(env4, { slug: 'twice', socials: [{ id: 'x', value: 'first' }, { id: 'x', value: 'second' }] });
  const twice = (await call(env4, 'GET', '/api/site?slug=twice')).body.site.socials;
  eq('a platform given twice appears once', twice.length, 1);
  eq('and it is the first one', twice[0].href, 'https://x.com/first');

  const env3 = freshEnv();
  await create(env3, { slug: 'fine', socials: [
    { id: 'x', value: 'ripple' }, { id: 'discord', value: 'aBc123' },
    { id: 'website', value: 'https://ripple.io' }
  ] });
  const fine = (await call(env3, 'GET', '/api/site?slug=fine')).body.site.socials;
  eq('good ones survive', fine.length, 3);
  eq('a bare handle works as well as an @ one', fine[0].href, 'https://x.com/ripple');
  eq('an https site is taken as typed', fine[2].href, 'https://ripple.io');
  ok('and every link is http(s) or mailto, never anything else',
    fine.every((f) => /^(https:\/\/|mailto:)/.test(f.href)), JSON.stringify(fine));
}

section('the picture');
{
  const png = 'data:image/png;base64,' + 'A'.repeat(200);
  let n = 0;
  const status = async (avatar) =>
    (await create(freshEnv(), { slug: 'pic' + (++n), avatar: avatar })).status;

  eq('an https link is fine', await status('https://img.test/a.png'), 200);
  eq('a picture the browser made is fine', await status(png), 200);
  eq('and none at all is fine', await status(''), 200);

  eq('http is refused', await status('http://img.test/a.png'), 400);
  eq('so is javascript:', await status('javascript:alert(1)'), 400);
  // An SVG is a document that can carry script, not just an image.
  eq('and an SVG, which is a document rather than a picture',
    await status('data:image/svg+xml;base64,PHN2Zy8+'), 400);
  eq('anything dressed as a picture is refused',
    await status('data:text/html;base64,PHNjcmlwdD4='), 400);
  eq('and one too big to be a resized square',
    await status('data:image/png;base64,' + 'A'.repeat(500000)), 400);
}

finish();
