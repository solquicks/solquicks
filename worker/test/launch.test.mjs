// The creator launchpad: an invite, a name, a set of pages, and a site at the
// end of it that is really theirs. Harness in harness.mjs.
//
// Two things here are worth more care than the rest: the origin check, because
// every creator site is a subdomain calling this worker and a sloppy match
// there opens the API to anyone who can register a lookalike domain; and the
// invite, because a code that can be spent twice is two creators fighting over
// one site.

import { chain, freshEnv as blankEnv, call, wallet, ok, eq, section, finish } from './harness.mjs';

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
const registries = (u) => new Response('',
  { status: REGISTERED.indexOf(decodeURIComponent(u.split('/').pop())) >= 0 ? 200 : 404 });
chain.rdap = registries;

const slug = (env, s) => call(env, 'GET', '/api/launch/slug?s=' + encodeURIComponent(s));
const domain = (env, n) => call(env, 'GET', '/api/launch/domain?name=' + encodeURIComponent(n));

const good = {
  code: 'FOX-ALPHA', slug: 'ripple', wallet: CREATOR, name: 'Ripple',
  handle: '@ripple', tagline: 'Making waves', avatar: 'https://img.test/r.png',
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
  chain.rdap = () => new Response('', { status: 500 });
  const out = await domain(env, 'ripple.io');
  eq('a registry that will not answer says so', out.body.status, 'unknown');
  ok('rather than claiming it is available', out.body.status !== 'free', out.body.status);
  chain.rdap = registries;

  await create(env, {});
  eq('a domain already claimed here is taken', (await domain(env, 'ripple.io')).body.status, 'taken');
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

finish();
