// The Creator Launchpad wizard, in a real browser: an invite, a brand, a set
// of pages, a wallet and an address, with the preview keeping up all the way.
//
// The preview is the point of the page — it is what the demo video is built
// around — so most of what is checked here is that what a creator types really
// does appear in it, rather than that a form submitted.
//
// Run: cd test/browser && npm ci && npx playwright install chromium && node launch.test.mjs

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const WORKER = 'https://solquicks-points.solquicks-45c.workers.dev';
const WALLET = '6N1NhZc8CAk3eZYyRWMkKXAqZrV8LSycURz2aMhmUhAd';

const TYPES = { '.html': 'text/html', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
  '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:' + server.address().port + '/';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
const section = (s) => console.log('\n── ' + s + ' ──');

// ── the worker, stood in for ──────────────────────────────────────────────
const net = { created: null, slugTaken: ['taken'], registered: ['google.io'], invites: ['FOX-ALPHA'] };

const FEATURES = [
  { id: 'swap', name: 'Swap', earns: true, live: false, blurb: 'Every Solana token, routed by Jupiter.' },
  { id: 'store', name: 'Store', earns: true, live: true, blurb: 'Sell merch, paid in crypto.' },
  { id: 'book', name: 'Bookings', earns: true, live: true, blurb: 'Sell your time.' },
  { id: 'cleanup', name: 'Cleanup', earns: false, live: true, blurb: 'Reclaim rent.' },
  { id: 'gacha', name: 'Gacha', earns: true, live: false, blurb: 'Pulls for something.' },
  { id: 'wishlist', name: 'Wishlist', earns: true, live: false, blurb: 'Your wishlist.' },
  { id: 'defi', name: 'DeFi', earns: true, live: false, blurb: 'Lending and earning.' },
  { id: 'referrals', name: 'Referrals', earns: true, live: false, blurb: 'Platforms you use.' }
];

const SOCIALS = [
  { id: 'x', name: 'X (Twitter)', hint: 'yourhandle', url: 'https://x.com/' },
  { id: 'youtube', name: 'YouTube', hint: '@yourchannel', url: 'https://youtube.com/' },
  { id: 'discord', name: 'Discord', hint: 'invite code', url: 'https://discord.gg/' },
  { id: 'website', name: 'Website', hint: 'https://…', url: '' },
  { id: 'email', name: 'Email', hint: 'you@example.com', url: 'mailto:' }
];

function answer(p, url, body) {
  if (p === '/api/launch/features') {
    return { features: FEATURES, socials: SOCIALS, avatarMaxBytes: 400000,
      root: 'solquicks.com', usdcMaxPct: 50, platformPct: 1 };
  }
  if (p === '/api/launch/invite') {
    const code = String((body && body.code) || '').toUpperCase();
    return net.invites.includes(code) ? { ok: true, code } : { error: 'that code is not valid', _status: 404 };
  }
  if (p === '/api/launch/slug') {
    const s = url.searchParams.get('s') || '';
    if (s.length < 3) return { slug: s, free: false, reason: 'that is too short — three characters or more' };
    if (net.slugTaken.includes(s)) return { slug: s, free: false, reason: 'somebody already has that one' };
    return { slug: s, free: true, reason: null, host: s + '.solquicks.com' };
  }
  if (p === '/api/launch/domain') {
    const n = url.searchParams.get('name') || '';
    if (!/^[a-z0-9-]{2,63}\.[a-z]{2,24}$/.test(n)) return { name: n, status: 'invalid' };
    if (n === 'offline.io') return { name: n, status: 'unknown', reason: 'the registry did not answer — try again in a moment' };
    return { name: n, status: net.registered.includes(n) ? 'taken' : 'free' };
  }
  if (p === '/api/launch/create') {
    net.created = body;
    return { ok: true, slug: body.slug, host: body.slug + '.solquicks.com',
      path: '/c/' + body.slug, split: { usdc: 50, token: 49, platform: 1 } };
  }
  return {};
}

// ── Privy, stood in for ───────────────────────────────────────────────────
// Only the surface launch.html actually touches. Signing in for real would
// mean Privy's servers and a code in somebody's inbox; what is worth testing
// here is our wiring — that the right address ends up as the treasury, that a
// wallet somebody already has is reused rather than replaced, and that a
// message from anywhere but the wallet frame is ignored.
const EMBEDDED = 'HLXnUXrmqjiRDTf4KJd9Bpxxqq87W3cxJBeJBsq4wbnw';
const ALREADY  = '4Zw1hY1BgvAPuXZ5cCVTqv8PzUzgaLJ8dLNnAZNWNT7V';

const PRIVY_STUB = `
window.__privy = { sent: [], created: 0, posted: null, onMessage: [], hasWallet: null, code: '424242' };
(function () {
  function solWallet(address) {
    return { type: 'wallet', chain_type: 'solana', wallet_client_type: 'privy', address: address };
  }
  function user() {
    const accounts = [{ type: 'email', address: 'who@ripple.io' }];
    if (window.__privy.hasWallet) accounts.push(solWallet(window.__privy.hasWallet));
    return { id: 'did:privy:test', linked_accounts: accounts };
  }
  function otp(kind) {
    return {
      sendCode: async (to) => {
        if (!/@|^\\+/.test(to)) throw new Error('Invalid ' + kind);
        window.__privy.sent.push(kind + ':' + to);
      },
      loginWithCode: async (to, code) => {
        if (window.__privy.sent.indexOf(kind + ':' + to) < 0) throw new Error('no code was sent to ' + to);
        if (code !== window.__privy.code) throw new Error('Invalid verification code');
        return { user: user() };
      }
    };
  }
  function Privy(opts) {
    window.__privy.appId = opts.appId;
    // What the dashboard has switched on. The page asks rather than assuming,
    // so a creator is never handed a button that cannot work.
    this.app = { getConfig: async () => window.__privyConfig || {
      email_auth: true, sms_auth: true, google_oauth: true, apple_oauth: true } };
    this.auth = { email: otp('email'), phone: otp('phone') };
    this.user = { get: async () => ({ user: user() }) };
    this.embeddedWallet = {
      // A real URL on Privy's origin, so the page's frame-src is exercised.
      getURL: () => 'https://auth.privy.io/apps/' + opts.appId + '/embedded-wallets',
      onMessage: (d) => window.__privy.onMessage.push(d),
      createSolana: async () => {
        window.__privy.created++;
        window.__privy.hasWallet = '${EMBEDDED}';
        return { user: user() };
      }
    };
    this.initialize = async () => {};
    this.setMessagePoster = (w) => { window.__privy.posted = w ? 'frame' : null; };

    // OAuth leaves this page and comes back, so what the page asked for has
    // to outlive the navigation to be checked afterwards.
    this.auth.oauth = {
      generateURL: async (provider, redirectURI) => {
        try { sessionStorage.setItem('__oauth_asked', provider + ' ' + redirectURI); } catch (e) {}
        // A stand-in provider page that redirects straight back, so the round
        // trip is a real navigation and not a simulated one.
        const back = encodeURIComponent(redirectURI);
        return { url: 'https://provider.test/fake-oauth?back=' + back + '&p=' + provider +
          (window.__oauthWillCancel ? '&cancel=1' : '') };
      },
      loginWithCode: async (code, state, provider) => {
        try { sessionStorage.setItem('__oauth_used', [code, state, provider].join(' ')); } catch (e) {}
        if (code !== 'good-code') throw new Error('Invalid authorization code');
        return { user: user() };
      }
    };
  }
  window.PrivySDK = {
    Privy: Privy,
    LocalStorage: function () { this.get = async () => null; this.put = async () => {}; },
    getUserEmbeddedSolanaWallet: function (u) {
      const w = ((u && u.linked_accounts) || []).find(
        (a) => a.type === 'wallet' && a.chain_type === 'solana' && a.wallet_client_type === 'privy');
      return w ? { address: w.address } : null;
    }
  };
})();
`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });

// A Wallet Standard wallet that signs nothing, registered the way a real
// extension registers itself.
await context.addInitScript(() => {
  const account = { address: '6N1NhZc8CAk3eZYyRWMkKXAqZrV8LSycURz2aMhmUhAd', chains: ['solana:mainnet'] };
  const make = (name, chains) => ({
    name, version: '1.0.0', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: chains || ['solana:mainnet'],
    accounts: [], features: { 'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) } }
  });

  // One that waits to be told the page is ready...
  window.addEventListener('wallet-standard:app-ready', (ev) => { ev.detail.register(make('Test Wallet')); });

  // ...and one that turns up after the page has already looked. An extension
  // that loads slowly announces itself with register-wallet, and the page is
  // expected to hand back an object with register on it. Being handed the
  // wrong shape is silent — the wallet calls into nothing and never appears,
  // which is how several of them went missing.
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
      detail: (api) => api.register(make('Late Wallet'))
    }));
  }, 300);

  // An Ethereum wallet, which cannot hold the Solana address a creator's
  // customers pay into.
  window.addEventListener('wallet-standard:app-ready', (ev) => {
    ev.detail.register(make('Ethereum Only', ['eip155:1']));
  });

  // A wallet that injects a provider instead of registering at all. Several
  // Solana wallets still only do this.
  window.solflare = { connect: async () => ({ publicKey: { toString: () => account.address } }) };
  // ...and it sets window.solana too, as most of them do. That was showing up
  // as a second, nameless "Solana Wallet" row beside the real one.
  window.solana = window.solflare;
});

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const cspBlocks = [];
page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspBlocks.push(m.text()); });

await context.route('**/*', async (route) => {
  const url = route.request().url();
  if (/\/vendor\/privy\.js$/.test(url)) {
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: PRIVY_STUB });
  }
  // Google and Apple, stood in for: a page on somebody else's origin that
  // sends the browser back the way a real provider does. A real navigation
  // away and back, so the draft really has to survive a page load.
  if (/\/fake-oauth/.test(url)) {
    const q = new URL(url).searchParams;
    const back = q.get('back');
    const to = q.get('cancel')
      ? back + '?privy_oauth_error=access_denied'
      : back + '?privy_oauth_code=good-code&privy_oauth_state=st-42';
    return route.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>Provider</title>' +
            '<script>location.replace(' + JSON.stringify(to) + ')</scr' + 'ipt>' });
  }
  if (url.startsWith(SITE)) return route.continue();
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }
  if (url.startsWith(WORKER)) {
    const u = new URL(url);
    let body = null;
    try { body = JSON.parse(route.request().postData() || 'null'); } catch (e) { /* GET */ }
    const out = answer(u.pathname, u, body);
    const status = out._status || 200;
    delete out._status;
    return route.fulfill({ status, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      body: JSON.stringify(out) });
  }
  return route.fulfill({ status: 204, body: '' });
});

const pv = {
  name: () => page.textContent('#pv-name'),
  handle: () => page.textContent('#pv-handle'),
  tagline: () => page.textContent('#pv-tagline'),
  url: () => page.textContent('#pv-url'),
  tabs: () => page.$$eval('#pv-tabs .pv-tab', (els) => els.map((e) => e.textContent.trim()))
};

try {
  section('the pitch, and getting in');
  await page.goto(SITE + 'launch.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#earns .earn').length > 0, null, { timeout: 10000 });

  ok('it says what you get before it asks for anything',
    /Launch your own website/.test(await page.textContent('h1')));
  // Every earner, not the first six. The cap quietly dropped whichever were
  // added last, which is always the newest thing worth showing off.
  const earns = await page.$$eval('#earns .earn b', (e) => e.map((x) => x.textContent.trim()));
  ok('and lists what actually earns', earns.includes('Swap'), earns.join(','));
  eq('all of them, not the first few', earns.length, FEATURES.filter((f) => f.earns).length);

  // The claim on this card is that a creator's domain becomes an asset they
  // own. Who makes that true is the part that turns the claim into a plan.
  {
    const marks = await page.$$eval('.pitch-mark', (els) => els.map((e) => ({
      name: e.textContent.trim(),
      src: (e.querySelector('img') || {}).getAttribute
        ? e.querySelector('img').getAttribute('src') : null,
      alt: e.querySelector('img') ? e.querySelector('img').getAttribute('alt') : null
    })));
    eq('the pitch names who tokenizes the domain', marks.map((m) => m.name).join(','), 'D3,Doma');
    ok('from our own repo, not somebody else\'s host',
      marks.every((m) => /^img\/partners\//.test(m.src || '')), JSON.stringify(marks));
    // The name is right beside each mark, so reading the image out as well
    // would say everything twice.
    ok('and not read out twice to a screen reader', marks.every((m) => m.alt === ''));

    await page.waitForFunction(
      () => [...document.querySelectorAll('.pitch-mark img')].every((i) => i.complete),
      null, { timeout: 15000 }).catch(() => {});
    const loaded = await page.$$eval('.pitch-mark img', (els) => els.map((i) => i.naturalWidth > 0));
    ok('and the files behind them really load', loaded.every(Boolean), JSON.stringify(loaded));
  }

  // The preview is there from the first second, before a single keystroke.
  ok('the preview is on screen from the start', await page.locator('.pv-frame').isVisible());
  eq('showing a placeholder site', await pv.name(), 'Your name');

  await page.fill('#code', 'WRONG-ONE');
  await page.click('#code-go');
  await page.waitForFunction(() => /not valid/.test(document.getElementById('code-msg').textContent), null, { timeout: 10000 });
  ok('a made-up invite is refused', true);
  eq('and nothing has opened', await page.locator('#s-brand').isVisible(), false);

  await page.fill('#code', 'fox-alpha');
  await page.click('#code-go');
  await page.waitForSelector('#s-brand:not([hidden])', { timeout: 10000 });
  ok('a real one, however it is typed, lets you in', true);

  section('the brand, and the preview keeping up');
  await page.fill('#f-name', 'Ripple');
  eq('the name appears in the preview as it is typed', await pv.name(), 'Ripple');
  await page.fill('#f-handle', 'ripple');
  eq('a handle gets its @ put back on', await pv.handle(), '@ripple');
  await page.fill('#f-handle', '@ripple');
  eq('and is not given two', await pv.handle(), '@ripple');
  await page.fill('#f-tagline', 'Making waves');
  eq('the tagline too', await pv.tagline(), 'Making waves');
  eq('and the address follows the name until told otherwise', await pv.url(), 'ripple.solquicks.com');

  // An avatar is a URL somebody types. Only ever an image over http(s).
  await page.fill('#f-avatar', 'javascript:alert(1)');
  eq('a javascript: avatar is never loaded', await page.locator('#pv-avatar').isVisible(), false);
  await page.fill('#f-avatar', 'data:image/svg+xml,<svg/>');
  eq('nor a data: one', await page.locator('#pv-avatar').isVisible(), false);
  eq('the initial stands in instead', (await page.textContent('#pv-avatar-fb')).trim(), 'R');
  // Served by this test's own server, so it is a real image really loading
  // rather than a URL that happens to look right.
  await page.fill('#f-avatar', SITE + 'avatar.png');
  await page.waitForFunction(() => !document.getElementById('pv-avatar').hidden, null, { timeout: 10000 });
  ok('a real image is shown', await page.locator('#pv-avatar').isVisible());

  section('the bio, the picture and the links');
  {
    await page.fill('#f-tagline', 'Making waves since 2019');
    eq('a bio longer than a tagline is allowed',
      await page.evaluate(() => document.getElementById('f-tagline').maxLength), 300);
    eq('and shows in the preview', await pv.tagline(), 'Making waves since 2019');

    // Every platform has its own row, so nothing has to be hunted for.
    eq('every platform gets a row', await page.locator('#socials .soc-row').count(), SOCIALS.length);
    eq('nothing is in the preview until something is typed',
      (await page.$$eval('#pv-links .pv-link', (e) => e.map((x) => x.textContent.trim())))[0], 'your links');

    await page.fill('#soc-x', '@ripple');
    await page.fill('#soc-email', 'hi@ripple.io');
    eq('a link typed in appears in the preview',
      (await page.$$eval('#pv-links .pv-link', (e) => e.map((x) => x.textContent.trim()))).join(','),
      'X (Twitter),Email');
    await page.fill('#soc-email', '');
    eq('and clearing one takes it away again',
      (await page.$$eval('#pv-links .pv-link', (e) => e.map((x) => x.textContent.trim()))).join(','),
      'X (Twitter)');
    await page.fill('#soc-email', 'hi@ripple.io');

    // A picture off a phone is megabytes; the page shows a 256px square. It is
    // shrunk here so that uploading one is not a minute of waiting.
    const big = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 800;
      const x = c.getContext('2d');
      x.fillStyle = '#F0821E'; x.fillRect(0, 0, 1200, 800);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return { size: blob.size, data: await new Promise((r) => {
        const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob);
      }) };
    });
    ok('the picture under test is a real one', big.size > 2000, String(big.size));

    await page.setInputFiles('#f-file', {
      name: 'me.png', mimeType: 'image/png',
      buffer: Buffer.from(big.data.split(',')[1], 'base64')
    });
    await page.waitForFunction(() => /ready/i.test(document.getElementById('avatar-msg').textContent),
      null, { timeout: 15000 });

    const pic = await page.evaluate(() => ({
      stored: draft.avatar.slice(0, 22), bytes: draft.avatar.length,
      shown: document.getElementById('pv-avatar').src.slice(0, 22),
      visible: !document.getElementById('pv-avatar').hidden
    }));
    eq('an uploaded picture is stored as a picture', pic.stored, 'data:image/png;base64,');
    ok('shrunk on the way in rather than sent whole', pic.bytes < big.data.length, pic.bytes + ' vs ' + big.data.length);
    ok('and it shows in the preview', pic.visible && pic.shown === 'data:image/png;base64,');

    // The avatar sits on the page colour, not the card colour, so a picture
    // with a pale or transparent background does not sit on a disc of a
    // different shade.
    const bg = await page.evaluate(() => {
      const pv = getComputedStyle(document.querySelector('.pv-frame')).backgroundColor;
      return { avatar: getComputedStyle(document.getElementById('pv-avatar')).backgroundColor, frame: pv };
    });
    eq('the picture sits on the same colour as the site behind it', bg.avatar, bg.frame);
  }

  section('a name is not optional');
  await page.fill('#f-name', '');
  await page.click('#brand-go');
  ok('going on without one is refused', /needs a name/.test(await page.textContent('#brand-msg')));
  eq('and it does not move on', await page.locator('#s-feats').isVisible(), false);
  await page.fill('#f-name', 'Ripple');
  await page.click('#brand-go');
  await page.waitForSelector('#s-feats:not([hidden])', { timeout: 10000 });

  section('picking pages');
  eq('all of them are offered', await page.locator('.feat').count(), FEATURES.length);
  ok('and the ones that are not built yet say so',
    /Coming soon/i.test(await page.locator('.feat[data-id="gacha"] .feat-foot').textContent()));

  // The name and the blurb are separate lines. They were inline spans, which
  // ran the two together into one paragraph on every card.
  const card = await page.evaluate(() => {
    const c = document.querySelector('.feat[data-id="swap"]');
    const n = c.querySelector('.feat-name').getBoundingClientRect();
    const b = c.querySelector('.feat-blurb').getBoundingClientRect();
    return { stacked: b.top >= n.bottom - 1, nameBlock: getComputedStyle(c.querySelector('.feat-name')).display };
  });
  ok('the name sits above the blurb rather than running into it', card.stacked, JSON.stringify(card));

  // Nothing floats over the text any more — the footer is a row along the
  // bottom, so a long blurb cannot end up underneath a badge.
  const overlap = await page.evaluate(() => {
    const c = document.querySelector('.feat[data-id="swap"]');
    const b = c.querySelector('.feat-blurb').getBoundingClientRect();
    const f = c.querySelector('.feat-foot').getBoundingClientRect();
    return f.top >= b.bottom - 1;
  });
  ok('and the footer sits below it, not on top of it', overlap);

  section('three slots, filled in order');
  eq('there are three slots', await page.locator('.slot').count(), 3);
  eq('all empty to begin with', await page.locator('.slot.filled').count(), 0);
  ok('and it asks for three', /Pick 3 more/.test(await page.textContent('#feats-head')),
    await page.textContent('#feats-head'));
  eq('nothing is in the preview yet', (await pv.tabs())[0], 'your pages');

  await page.locator('.feat[data-id="swap"]').click();
  eq('a pick fills the first slot', (await page.locator('.slot.filled .slot-name').first().textContent()).trim(), 'Swap');
  eq('and the card says where it went',
    (await page.locator('.feat[data-id="swap"] .feat-where').textContent()).trim(), '✓ In the top bar');
  ok('with two slots still asked for', /Pick 2 more/.test(await page.textContent('#feats-head')));

  await page.locator('.feat[data-id="store"]').click();
  eq('two picked is not enough to go on', await page.locator('#feats-go').click().then(
    () => page.locator('#s-wallet').isVisible()), false);
  ok('and it says why', /all three slots/i.test(await page.textContent('#feats-msg')),
    await page.textContent('#feats-msg'));

  await page.locator('.feat[data-id="book"]').click();
  eq('three fills the bar', (await pv.tabs()).join(','), 'Swap,Store,Bookings');
  eq('every slot is taken', await page.locator('.slot.filled').count(), 3);
  ok('and it stops asking for more', /goes in the menu/.test(await page.textContent('#feats-head')),
    await page.textContent('#feats-head'));

  await page.locator('.feat[data-id="cleanup"]').click();
  eq('a fourth goes to the menu, not the bar', (await pv.tabs()).join(','), 'Swap,Store,Bookings');
  eq('and is labelled as such',
    (await page.locator('.feat[data-id="cleanup"] .feat-where').textContent()).trim(), '✓ In the menu');
  ok('the summary says both', /Top bar: Swap, Store, Bookings/.test(await page.textContent('#picked')) &&
    /In the menu: Cleanup/.test(await page.textContent('#picked')), await page.textContent('#picked'));

  // Taking one out of a slot: the menu page that was chosen first moves up.
  await page.locator('.slot.filled .slot-drop').nth(1).click();
  eq('dropping one out of a slot lets the next take its place',
    (await pv.tabs()).join(','), 'Swap,Bookings,Cleanup');
  eq('and the one dropped is off the site entirely',
    (await page.locator('.feat[data-id="store"] .feat-where').textContent()).trim(), '');
  // Four picks minus one is still three, so the bar refills itself from the
  // menu rather than leaving a hole for somebody to notice and fix.
  eq('the bar stays full, filled from the menu', await page.locator('.slot.filled').count(), 3);
  ok('so nothing is asked for', /goes in the menu/.test(await page.textContent('#feats-head')),
    await page.textContent('#feats-head'));

  await page.locator('.feat[data-id="store"]').click();
  eq('picking it again leaves the bar alone', (await pv.tabs()).join(','), 'Swap,Bookings,Cleanup');
  ok('and puts it in the menu, where there is room',
    /In the menu: Store/.test(await page.textContent('#picked')), await page.textContent('#picked'));

  // Back to what the rest of this expects, which also checks un-picking.
  for (const id of ['swap', 'store', 'book', 'cleanup']) {
    const el = page.locator('.feat[data-id="' + id + '"]');
    if ((await el.getAttribute('class')).includes('on')) await el.click();
  }
  eq('clicking a picked one again takes it off', await page.locator('.feat.on').count(), 0);
  eq('and the preview empties with it', (await pv.tabs())[0], 'your pages');
  for (const id of ['swap', 'store', 'book', 'cleanup']) await page.locator('.feat[data-id="' + id + '"]').click();

  await page.click('#feats-go');
  await page.waitForSelector('#s-wallet:not([hidden])', { timeout: 10000 });

  section('the wallet, and what it is for');
  {
    // The late one arrives on its own schedule, as a real extension does.
    await page.waitForFunction(
      () => [...document.querySelectorAll('.wallet-pick')].some((e) => /Late Wallet/.test(e.textContent)),
      null, { timeout: 15000 }).catch(() => {});
    const offered = await page.$$eval('.wallet-pick', (els) => els.map((e) => e.textContent.trim()));

    // Three ways a wallet makes itself known, and all three have to be found.
    // Only one of them worked before: a wallet that announces itself first was
    // handed a callback of the wrong shape and simply never appeared.
    ok('a wallet that waits for the page is offered', offered.includes('Test Wallet'), offered.join(','));
    ok('one that turns up after the page has looked is too', offered.includes('Late Wallet'), offered.join(','));
    ok('and one that only injects a provider', offered.includes('Solflare'), offered.join(','));

    // This wallet becomes the address a creator's customers pay into.
    ok('an Ethereum wallet is not offered for a Solana payout',
      !offered.includes('Ethereum Only'), offered.join(','));

    // Most wallets set window.solana as well as their own name, so the generic
    // fallback was listing the same wallet twice — once properly, once as a
    // nameless "Solana Wallet" with no icon.
    ok('a wallet that also sets window.solana is listed once, not twice',
      offered.filter((n) => /Solflare/.test(n)).length === 1, offered.join(','));
    ok('and no nameless row is offered beside the real ones',
      !offered.some((n) => /Solana Wallet/.test(n)), offered.join(','));
  }
  ok('the split is shown before they commit to anything',
    /50%/.test(await page.textContent('#split')) && /Into your domain token/.test(await page.textContent('#split')));
  ok('and says the cash share is a ceiling',
    /is the most you can take/.test(await page.textContent('#split')), await page.textContent('#split'));

  eq('you cannot go on without one', await page.locator('#wallet-go').isDisabled(), true);
  await page.locator('.wallet-pick', { hasText: 'Test Wallet' }).click();
  await page.waitForFunction(() => !document.getElementById('wallet-have').hidden, null, { timeout: 10000 });
  eq('connecting shows the address the money goes to', (await page.textContent('#wallet-addr')).trim(), WALLET);
  eq('and lets you go on', await page.locator('#wallet-go').isDisabled(), false);

  // Several wallets in a browser, and the first to register is not necessarily
  // the one somebody meant.
  await page.click('text=Use another wallet');
  ok('there is always a way back to the chooser, with every wallet still on it',
    await page.locator('.wallet-pick').count() === 3);

  section('a wallet for somebody who has never had one');
  {
    // Most creators this is for have never held crypto. "Go install a wallet
    // first" is where they would leave, so there is a way to make one here.
    ok('the way out is offered beside the wallets', !(await page.locator('#signin').isHidden()));
    ok('and does not talk down to anyone who already has one',
      /don't have a wallet/.test(await page.textContent('#signin-open')),
      await page.textContent('#signin-open'));

    await page.click('#signin-open');
    await page.waitForSelector('#signin-flow:not([hidden])', { timeout: 10000 });

    // Nothing is asked for until they have chosen how to be reached.
    await page.click('#signin-send');
    ok('sending with nothing filled in says so', /Put your email in first/.test(await page.textContent('#signin-msg')),
      await page.textContent('#signin-msg'));

    await page.click('#way-phone');
    eq('switching to a phone asks for a phone', (await page.textContent('#signin-id-label')).trim(), 'Your phone number');
    eq('and the keyboard matches', await page.locator('#signin-id').getAttribute('type'), 'tel');
    await page.click('#way-email');
    eq('and back again', (await page.textContent('#signin-id-label')).trim(), 'Your email');

    await page.fill('#signin-id', 'who@ripple.io');
    await page.click('#signin-send');
    await page.waitForSelector('#signin-code-box:not([hidden])', { timeout: 10000 });
    eq('a code is sent to the address they gave',
      await page.evaluate(() => window.__privy.sent.join(',')), 'email:who@ripple.io');
    eq('and they are told where to look', (await page.textContent('#signin-sent-to')).trim(), 'who@ripple.io');

    // The App ID is a public identifier; the app secret is a different value
    // and must never be in a page that anybody can read.
    eq('the client is started with our app', await page.evaluate(() => window.__privy.appId),
      'cmumeogp100bs0djspgu988bc');
    ok('and the key never leaves Privy — signing happens in their frame, not ours',
      await page.evaluate(() => window.__privy.posted) === 'frame');
    eq('the frame is on Privy’s origin',
      await page.$eval('iframe', (f) => new URL(f.src).origin), 'https://auth.privy.io');

    // Anything on the internet can postMessage to this window. If that were
    // fed to the wallet it would be the whole point of the frame undone.
    await page.evaluate(() => window.postMessage({ privy: 'not from the frame' }, '*'));
    await page.waitForTimeout(100);
    eq('a message from anywhere but that frame is ignored',
      await page.evaluate(() => window.__privy.onMessage.length), 0);

    await page.fill('#signin-code', '000000');
    await page.click('#signin-verify');
    await page.waitForFunction(() => /not right/.test(document.getElementById('signin-msg').textContent),
      null, { timeout: 10000 });
    ok('a wrong code is said plainly, not as a stack trace',
      /That code is not right/.test(await page.textContent('#signin-msg')), await page.textContent('#signin-msg'));
    eq('and no wallet is made for it', await page.evaluate(() => window.__privy.created), 0);
    eq('nor is one adopted', await page.locator('#wallet-go').isDisabled(), true);

    // The code belongs to the address it was sent to. The box is out of reach
    // while a code is outstanding, and the address is read from what was sent
    // rather than from the field — so neither route can swap it.
    ok('the address cannot be edited while a code is outstanding',
      await page.locator('#signin-id-box').isHidden());
    await page.evaluate(() => { document.getElementById('signin-id').value = 'someone@else.io'; });

    await page.fill('#signin-code', '424242');
    await page.click('#signin-verify');
    await page.waitForFunction(() => !document.getElementById('wallet-have').hidden, null, { timeout: 15000 });

    eq('the right code makes them a wallet', await page.evaluate(() => window.__privy.created), 1);
    eq('checked against the address it was sent to, not whatever the field says now',
      await page.evaluate(() => window.__privy.sent.join(',')), 'email:who@ripple.io');
    eq('and it is the address their money will go to', (await page.textContent('#wallet-addr')).trim(), EMBEDDED);
    eq('which lets them go on', await page.locator('#wallet-go').isDisabled(), false);
    ok('the split is shown for them too', /50%/.test(await page.textContent('#split')));
    ok('and the chooser is out of the way once they have one', await page.locator('#signin').isHidden());
  }

  section('signing in twice does not move the money');
  {
    // A creator who signs in again already has a wallet. Making a second one
    // would point this site at an address they are not watching.
    await page.click('text=Use another wallet');

    // Somebody who started signing in, changed their mind and came back was
    // left looking at a half-filled form still naming an address their code
    // had already been spent on.
    ok('coming back puts the sign-in offer back as it was',
      !(await page.locator('#signin-open').isHidden()) && await page.locator('#signin-flow').isHidden());

    await page.evaluate((a) => { window.__privy.hasWallet = a; window.__privy.sent = []; window.__privy.created = 0; }, ALREADY);
    await page.click('#signin-open');
    eq('with nothing left in the box', await page.inputValue('#signin-id'), '');
    await page.fill('#signin-id', 'who@ripple.io');
    await page.click('#signin-send');
    await page.waitForSelector('#signin-code-box:not([hidden])', { timeout: 10000 });
    await page.fill('#signin-code', '424242');
    await page.click('#signin-verify');
    await page.waitForFunction(() => !document.getElementById('wallet-have').hidden, null, { timeout: 15000 });

    eq('the wallet they already have is used', (await page.textContent('#wallet-addr')).trim(), ALREADY);
    eq('and no second one is made', await page.evaluate(() => window.__privy.created), 0);
  }

  section('what they typed survives losing the page');
  {
    // The invite code is already spent by this point and there is only one
    // each, so a creator who loses the tab here cannot simply start over.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#resume:not([hidden])', { timeout: 10000 });
    ok('coming back is offered, and says what is waiting',
      /Ripple/.test(await page.textContent('#resume-what')), await page.textContent('#resume-what'));

    await page.click('text=Pick up where I left off');
    await page.waitForSelector('#s-wallet:not([hidden])', { timeout: 10000 });

    eq('the name is back', await page.inputValue('#f-name'), 'Ripple');
    eq('the bio with it', await page.inputValue('#f-tagline'), 'Making waves since 2019');
    eq('and the links', await page.inputValue('#soc-x'), '@ripple');
    eq('the pages they picked', await pv.tabs().then((t) => t.join(',')), 'Swap,Store,Bookings');
    ok('the picture too', /^data:image\/png;base64,/.test(
      await page.$eval('#pv-avatar', (e) => e.getAttribute('src') || '')));
    eq('and the wallet their money was going to', (await page.textContent('#wallet-addr')).trim(), ALREADY);

    // An address free an hour ago may be taken now, and the step must ask
    // again rather than trust what it checked before it was reloaded.
    await page.click('#wallet-go');
    await page.waitForSelector('#s-domain:not([hidden])', { timeout: 10000 });
    eq('a name checked before the reload is not still taken on trust',
      await page.locator('#domain-go').isDisabled(), true);
    await page.click('#s-domain .actions .ghost');
    await page.waitForSelector('#s-wallet:not([hidden])', { timeout: 10000 });
  }

  section('only what is actually switched on');
  {
    // Which ways of signing in work is a setting in Privy's dashboard, not in
    // this page. Today only email is on, so offering Google, Apple and SMS
    // would be three buttons that cannot work.
    await page.click('text=Use another wallet');
    await page.evaluate(() => {
      window.__privyConfig = { email_auth: true, sms_auth: false, google_oauth: false, apple_oauth: false };
    });
    await page.click('#signin-open');
    await page.waitForFunction(() => document.getElementById('oauth-ways').hidden, null, { timeout: 15000 });

    ok('a provider that is off is not offered', await page.locator('#oauth-google').isHidden());
    ok('nor is the other one', await page.locator('#oauth-apple').isHidden());
    ok('and the rule above them goes with them',
      await page.locator('#signin-flow .or').isHidden());
    ok('a phone that is off is not offered either', await page.locator('#way-phone').isHidden());
    ok('and one way left is not presented as a choice',
      await page.locator('#signin-flow .ways').isHidden());
    ok('while the one that works still is', !(await page.locator('#signin-id-box').isHidden()));
    eq('and it is the one selected', (await page.textContent('#signin-id-label')).trim(), 'Your email');

    // Turning one on in the dashboard takes effect without us deploying, so
    // the page is asked again rather than reloaded.
    await page.evaluate(() => { window.__privyConfig = null; return trimToWhatWorks(); });
    await page.waitForFunction(() => !document.getElementById('oauth-ways').hidden, null, { timeout: 15000 });
    ok('and switching one on needs no deploy of ours',
      !(await page.locator('#oauth-google').isHidden()));
  }

  section('Google and Apple');
  {
    const ways = await page.$$eval('.oauth span', (e) => e.map((x) => x.textContent.trim()));
    eq('both are offered', ways.join(','), 'Continue with Google,Continue with Apple');
    ok('and a code is still offered beside them',
      /or use a code/.test(await page.textContent('#signin-flow')));

    // A real navigation away to the provider and back, which is the only way
    // to know the draft really survives the round trip.
    await page.click('#oauth-google');
    await page.waitForFunction(() => !document.getElementById('wallet-have').hidden, null, { timeout: 25000 });

    eq('the provider was asked for, and told where to send them back',
      await page.evaluate(() => sessionStorage.getItem('__oauth_asked')),
      'google ' + SITE + 'launch.html');
    eq('and the code it returned was handed straight back to Privy',
      await page.evaluate(() => sessionStorage.getItem('__oauth_used')), 'good-code st-42 google');

    // The code is one use. Left in the URL, a reload would spend it again and
    // a shared link would carry somebody else's sign-in.
    ok('nothing of the sign-in is left in the address bar',
      !/privy_oauth/.test(page.url()), page.url());

    eq('they come back to the step they left', await page.locator('#s-wallet').isHidden(), false);
    eq('with everything they had typed', await page.inputValue('#f-name'), 'Ripple');
    eq('and the wallet it made them is where the money goes',
      (await page.textContent('#wallet-addr')).trim(), EMBEDDED);
    eq('which lets them go on', await page.locator('#wallet-go').isDisabled(), false);
  }

  section('a sign-in they backed out of');
  {
    await page.click('text=Use another wallet');
    await page.click('#signin-open');
    await page.evaluate(() => { window.__oauthWillCancel = true; });
    await page.click('#oauth-apple');
    await page.waitForFunction(
      () => /did not finish/.test(document.getElementById('signin-msg').textContent),
      null, { timeout: 25000 });

    ok('they are told, rather than dropped somewhere blank',
      /Try again, or use a code/.test(await page.textContent('#signin-msg')),
      await page.textContent('#signin-msg'));
    eq('nothing they typed is lost', await page.inputValue('#f-name'), 'Ripple');
    ok('and the wallets are still there to pick from', await page.locator('.wallet-pick').count() >= 1);
  }

  await page.locator('.wallet-pick', { hasText: 'Test Wallet' }).click();
  await page.waitForFunction(() => !document.getElementById('wallet-have').hidden, null, { timeout: 10000 });
  eq('and a real wallet still wins when they have one', (await page.textContent('#wallet-addr')).trim(), WALLET);
  await page.click('#wallet-go');
  await page.waitForSelector('#s-domain:not([hidden])', { timeout: 10000 });

  section('the address, checked for real');
  eq('you cannot launch before picking one', await page.locator('#domain-go').isDisabled(), true);

  await page.fill('#f-slug', 'ab');
  await page.waitForFunction(() => /too short/.test(document.getElementById('slug-msg').textContent), null, { timeout: 10000 });
  ok('a name that is too short says so', true);

  await page.fill('#f-slug', 'taken');
  await page.waitForFunction(() => /already has/.test(document.getElementById('slug-msg').textContent), null, { timeout: 10000 });
  ok('one somebody has is refused', true);
  eq('and still will not let you on', await page.locator('#domain-go').isDisabled(), true);

  await page.fill('#f-slug', 'ripple');
  await page.waitForFunction(() => /is yours/.test(document.getElementById('slug-msg').textContent), null, { timeout: 10000 });
  ok('a free one is yours', true);
  eq('the preview takes the address', await pv.url(), 'ripple.solquicks.com');
  eq('and now you can go on — a domain is optional', await page.locator('#domain-go').isDisabled(), false);

  await page.fill('#f-domain', 'google.io');
  await page.waitForFunction(() => /already owns/.test(document.getElementById('domain-msg').textContent), null, { timeout: 10000 });
  ok('a domain somebody owns is refused', true);
  eq('which blocks the way on', await page.locator('#domain-go').isDisabled(), true);

  // The honest case: a registry that will not answer must never read as free.
  await page.fill('#f-domain', 'offline.io');
  await page.waitForFunction(() => /did not answer/.test(document.getElementById('domain-msg').textContent), null, { timeout: 10000 });
  ok('a registry that will not answer says so rather than guessing', true);
  eq('and is not treated as available', await page.locator('#domain-go').isDisabled(), true);

  await page.fill('#f-domain', 'ripple.io');
  await page.waitForFunction(() => /is free/.test(document.getElementById('domain-msg').textContent), null, { timeout: 10000 });
  ok('a free one is free, and says what happens to it',
    /tokenize with D3/.test(await page.textContent('#domain-msg')), await page.textContent('#domain-msg'));
  await page.click('#domain-go');
  await page.waitForSelector('#s-launch:not([hidden])', { timeout: 10000 });

  section('review and launch');
  const review = await page.textContent('#review');
  ok('the review names the site', /Ripple/.test(review));
  ok('its address', /ripple\.solquicks\.com/.test(review));
  ok('the domain being reserved', /ripple\.io/.test(review));
  ok('what goes in the bar', /Swap, Store, Bookings/.test(review), review);
  ok('and the split, one more time', /50% cash/.test(review), review);

  // Nothing touches Solana when this is pressed — the site is made and the
  // domain reserved, and tokenization happens with D3 afterwards. A button
  // promising a signature that never comes is the one claim this site would
  // be making that it does not keep.
  eq('the button says what it actually does', (await page.textContent('#launch-go')).trim(), 'Launch my site');
  const sub = (await page.textContent('#s-launch .step-sub')).replace(/\s+/g, ' ');
  ok('and says no signature is needed', /no wallet signature needed/.test(sub), sub);
  ok('while naming what does go on Solana, and when', /tokenized on Solana with D3 after/.test(sub), sub);

  await page.click('#launch-go');
  await page.waitForSelector('#s-done:not([hidden])', { timeout: 10000 });

  eq('the site is made with the name they chose', net.created.name, 'Ripple');
  eq('with the bio they wrote', net.created.tagline, 'Making waves since 2019');
  eq('the links they gave', net.created.socials.map((s) => s.id + '=' + s.value).join(','),
    'x=@ripple,email=hi@ripple.io');
  eq('and the picture they uploaded', net.created.avatar.slice(0, 22), 'data:image/png;base64,');
  eq('at the address they chose', net.created.slug, 'ripple');
  eq('paying into the wallet they connected', net.created.wallet, WALLET);
  eq('with three in the bar', net.created.topTabs.join(','), 'swap,store,book');
  eq('and the rest in the menu', net.created.moreTabs.join(','), 'cleanup');
  eq('and the domain reserved to them', net.created.domain, 'ripple.io');

  eq('they are given the address it is live at', (await page.textContent('#done-url')).trim(), 'ripple.solquicks.com');
  eq('as a link they can open', await page.locator('#done-url').getAttribute('href'), 'https://ripple.solquicks.com');
  ok('told what works right now', /pay straight to your wallet/.test(await page.textContent('#done-note')));
  ok('and what is still to come', /goes live with D3/.test(await page.textContent('#done-note')),
    await page.textContent('#done-note'));

  section('the draft is spent with the invite code');
  {
    // Their code is used and their site exists. Being offered a resume of it
    // would walk them into launching a name that is now taken — by them.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#earns .earn').length > 0, null, { timeout: 10000 });
    ok('launching clears it, so no half-site is offered back',
      await page.locator('#resume').isHidden());

    // And a draft nobody came back to for a day is not worth dropping
    // somebody into either — the names in it will have moved on.
    await page.evaluate(() => {
      localStorage.setItem('launch_draft', JSON.stringify({
        at: 'wallet', saved: Date.now() - 25 * 60 * 60 * 1000,
        draft: { code: 'FOX-ALPHA', name: 'Stale', picked: [], socials: {} }
      }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#earns .earn').length > 0, null, { timeout: 10000 });
    ok('nor is a day-old one', await page.locator('#resume').isHidden());
    eq('and it is thrown away rather than left to rot',
      await page.evaluate(() => localStorage.getItem('launch_draft')), null);

    // Somebody who would rather start over should be able to say so.
    await page.evaluate(() => {
      localStorage.setItem('launch_draft', JSON.stringify({
        at: 'brand', saved: Date.now(),
        draft: { code: 'FOX-ALPHA', name: 'Second Thoughts', picked: [], socials: {} }
      }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#resume:not([hidden])', { timeout: 10000 });
    eq('a fresh one is offered by name', (await page.textContent('#resume-what')).trim(), 'Second Thoughts');
    await page.click('text=Start again');
    ok('and turning it down puts the offer away', await page.locator('#resume').isHidden());
    eq('for good', await page.evaluate(() => localStorage.getItem('launch_draft')), null);
  }
} catch (e) {
  ok('the run finished without an exception', false, e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(ROOT, 'test/browser/launch-failure.png') }).catch(() => {});
}

ok('no uncaught errors in the page', pageErrors.length === 0, pageErrors.join(' | '));
ok('the Content-Security-Policy blocked nothing the page needs', cspBlocks.length === 0, cspBlocks.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
