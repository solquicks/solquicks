// Content-Security-Policy on every page (security fix 2026-10-29, M8).
// Serves the site with the headers vercel.json gives each path and loads the
// pages the other suites do not: the game and its leaderboard. Anything the
// policy blocks is recorded from the page's own securitypolicyviolation events.
//
// Run: cd test/browser && node csp.test.mjs

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { vercelHeaders } from './vercel-headers.mjs';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const WORKER = 'https://solquicks-points.solquicks-45c.workers.dev';
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const CLEAN = Object.fromEntries((VERCEL.rewrites || [])
  .filter((r) => !/[:(]/.test(r.source)).map((r) => [r.source, r.destination]));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const creator = /^\/c\/[a-z0-9-]{3,32}\/?$/.test(rel);
  let file = path.join(ROOT, rel === '/' || creator ? 'index.html' : (CLEAN[rel] || rel));
  if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { ...vercelHeaders(VERCEL, rel), 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:' + server.address().port;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const section = (t) => console.log('\n── ' + t);

// ── the policy itself ──
section('every page gets a policy that does more than forbid framing');
const csp = (p) => vercelHeaders(VERCEL, p)['Content-Security-Policy'] || '';
for (const p of ['/', '/fees', '/fees.html', '/launch', '/c/some-creator', '/games/moon-rangers/', '/games/moon-rangers/leaderboard/', '/games/moon-rangers/assets/x.js']) {
  const v = csp(p);
  ok(p + ' has default-src, object-src none, base-uri, and frame-ancestors none',
    /default-src 'self'/.test(v) && /object-src 'none'/.test(v) && /base-uri 'self'/.test(v) && /frame-ancestors 'none'/.test(v), v);
  ok(p + ' does not let the page talk to any workers.dev host', !/\*\.workers\.dev/.test(v), v);
}
ok('the game pages may not run inline script beyond the one hashed leaderboard script',
  !/'unsafe-inline'/.test(csp('/games/moon-rangers/').match(/script-src[^;]*/)[0]));
ok('X-Frame-Options is still DENY everywhere', vercelHeaders(VERCEL, '/games/moon-rangers/')['X-Frame-Options'] === 'DENY');
ok('the asset cache rule still applies to the game files',
  /immutable/.test(vercelHeaders(VERCEL, '/games/moon-rangers/assets/a.js')['Cache-Control'] || ''));

// the hash in the policy has to match the leaderboard's inline script, or it stops working
{
  const crypto = await import('node:crypto');
  const lb = fs.readFileSync(path.join(ROOT, 'games/moon-rangers/leaderboard/index.html'), 'utf8');
  const scripts = [...lb.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const s of scripts) {
    const h = "'sha256-" + crypto.createHash('sha256').update(s).digest('base64') + "'";
    ok('the policy carries the hash of the leaderboard script as it is now', csp('/games/').includes(h), h);
  }
}

// ── in a browser ──
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext();
await context.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + (e.lineNumber || ''));
  });
});
const workerHits = [];
await context.route(WORKER + '/**', (route) => {
  workerHits.push(new URL(route.request().url()).pathname);
  route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ leaderboard: [], players: [], rows: [], top: [], total: 0 }) });
});
// fonts are fetched for real on the other suites; here they are not the point
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

async function visit(p, wait) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(SITE + p, { waitUntil: 'load' });
  if (wait) await wait(page);
  await page.waitForTimeout(1500);
  const blocked = await page.evaluate(() => window.__csp.slice());
  const header = (await (await page.request.get(SITE + p)).headers())['content-security-policy'] || '';
  await page.close();
  return { blocked, errors, header };
}

section('the game page loads under its policy');
{
  const r = await visit('/games/moon-rangers/');
  ok('the game is served with the game policy', /wasm-unsafe-eval/.test(r.header), r.header);
  // The compiled build still points its API and match server at localhost (a
  // build-time setting in the game source, which is not in this repo). The
  // policy now stops a visitor's browser from reaching their own machine;
  // anything else being blocked would be the policy breaking the game.
  // The MessagePack library in the match client tries Function('') once to see
  // whether it may generate code, and falls back to its plain decoder when the
  // policy says no — so that one report is expected and harmless.
  const real = r.blocked.filter((b) => !/(localhost|127\.0\.0\.1):(8787|2567)/.test(b))
    .filter((b) => !/^script-src eval /.test(b));
  ok('nothing the game needs is blocked (its scripts, wasm, workers, images, sounds)', real.length === 0, real.join(' | '));
  ok('the game module ran (no "refused to execute" errors)', !r.errors.some((e) => /Content Security Policy|refused/i.test(e)), r.errors.join(' | '));
}

section('the leaderboard runs its inline script and reaches the worker');
{
  const before = workerHits.length;
  const r = await visit('/games/moon-rangers/leaderboard/');
  ok('nothing is blocked', r.blocked.length === 0, r.blocked.join(' | '));
  ok('its hashed inline script ran and asked the worker for the board', workerHits.length > before, workerHits.join(','));
}

section('the site pages are served with the site policy');
for (const p of ['/', '/fees', '/launch', '/c/some-creator']) {
  const r = await visit(p);
  ok(p + ' carries the site policy', /frame-src https:\/\/auth\.privy\.io/.test(r.header) && /object-src 'none'/.test(r.header), r.header);
  const real = r.blocked.filter((b) => !/^connect-src https:\/\/solquicks-(points|rpc-proxy)/.test(b));
  ok(p + ' loads without the policy blocking anything', real.length === 0, real.join(' | '));
}

section('and the policy does block what it should');
{
  const page = await context.newPage();
  await page.goto(SITE + '/fees', { waitUntil: 'load' });
  const tried = await page.evaluate(async () => {
    const out = {};
    try { await fetch('https://evil.example.workers.dev/x'); out.fetch = 'allowed'; } catch (e) { out.fetch = 'blocked'; }
    const s = document.createElement('script'); s.src = 'https://evil.example/x.js';
    out.script = await new Promise((r) => { s.onerror = () => r('blocked'); s.onload = () => r('allowed'); document.head.appendChild(s); });
    return out;
  });
  ok('fetch to another workers.dev host is blocked', tried.fetch === 'blocked');
  ok('a script from another origin is blocked', tried.script === 'blocked');
  await page.close();
}

await browser.close();
server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
