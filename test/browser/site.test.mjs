// The site in a real browser: Chromium loads index.html from a local server and
// is clicked through the way a visitor would. The worker, the RPC proxy and
// Helius Sender are stood in for at the network layer, and a Wallet Standard
// wallet is registered that signs nothing real. web3.js still loads from the
// CDN with its integrity hash, and the page's own Content-Security-Policy is in
// force, so a blocked connection fails here the way it would for a visitor.
//
// Run: cd test/browser && npm ci && npx playwright install chromium && npm test

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);
const WORKER = 'https://solquicks-points.solquicks-45c.workers.dev';
const RPC = 'https://solquicks-rpc-proxy.solquicks-45c.workers.dev';
const SENDER = 'https://sender.helius-rpc.com/';
const WALLET = '6N1NhZc8CAk3eZYyRWMkKXAqZrV8LSycURz2aMhmUhAd';
const SOL = 'So11111111111111111111111111111111111111112';
const SENDER_TIP = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE', 'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta', '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD', '2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ',
  'wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF', '3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT',
  '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey', '4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or'
];
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const TREASURY = 'uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc';

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
const section = (s) => console.log('\n── ' + s + ' ──');

// ── the site, served as files ────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:' + server.address().port + '/';

// ── stand-ins ────────────────────────────────────────────────────────────────
const net = { worker: [], rpc: [], sender: [], built: null, lamports: 2e9, lastQuote: null };

const HOLDINGS = [
  { mint: SOL, symbol: 'SOL', name: 'Solana', decimals: 9, verified: true, amount: 2, price: 100, usd: 200 },
  { mint: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, verified: true, amount: 50, price: 1, usd: 50 },
  // unverified, but it trades: must stay visible
  { mint: 'HYPEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'HYPE', name: 'Unverified with a price', decimals: 6, verified: false, amount: 3, price: 4, usd: 12 },
  // airdropped junk: no price at all, and a price worth a fraction of a cent
  { mint: 'SPAMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'CLAIMNOW', name: 'Visit claim-site', decimals: 6, verified: false, amount: 1000, price: null, usd: null },
  { mint: 'DUSTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'DUST', name: 'Worth almost nothing', decimals: 6, verified: false, amount: 5, price: 0.0001, usd: 0.0005 }
];

function workerAnswer(p, url) {
  if (p === '/api/swap/tokens') return { tokens: [
    { mint: SOL, symbol: 'SOL', name: 'Solana', decimals: 9 },
    { mint: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 }
  ] };
  if (p === '/api/swap/holdings') return { wallet: WALLET, tokens: HOLDINGS, totalUsd: 262, more: 0 };
  // a pair with no fee account on either side: the fee is a SOL payment
  if (p === '/api/swap/quote' && url.searchParams.get('in') === BONK) return {
    quote: {
      inputMint: BONK, outputMint: WIF, inAmount: '100000000000', outAmount: '74850000', otherAmountThreshold: '74000000',
      priceImpactPct: '0.0001', swapUsdValue: '150', platformFee: null,
      routePlan: [{ percent: 100, swapInfo: { label: 'Raydium' } }]
    },
    feeBps: 20, fullFeeBps: 20, feeLamports: 2000000, holder: false, feeMint: SOL, slippageBps: 50, autoSlippage: true
  };
  if (p === '/api/swap/build' && net.lastQuote === BONK) {
    return { swapTransaction: net.built, lastValidBlockHeight: 1e12, feeTransfer: { to: TREASURY, lamports: 2000000 } };
  }
  if (p === '/api/swap/quote') return {
    quote: {
      inputMint: SOL, outputMint: USDC, inAmount: '1000000000', outAmount: '99800000', otherAmountThreshold: '99300000',
      priceImpactPct: '0.0001', swapUsdValue: '100',
      platformFee: { amount: '200000', feeBps: 20 },
      routePlan: [{ percent: 100, swapInfo: { label: 'Meteora DLMM' } }]
    },
    feeBps: 20, fullFeeBps: 20, holder: false, feeMint: SOL, slippageBps: 50, autoSlippage: true
  };
  if (p === '/api/swap/build') return { swapTransaction: net.built, lastValidBlockHeight: 1e12 };
  if (p === '/api/swap/history') return { swaps: [], savedUsd: 0, discountedSwaps: 0 };
  if (p === '/api/analytics') return {
    holders: { total: 133, supply: 219, whales: 1, mid: 19, small: 113, top10Pct: 27.4, avg: 1.65, updatedAt: Date.now() - 60000,
      collectingSince: Date.now() - 9 * 86400000,
      history: Array.from({ length: 9 }, (_, i) => ({ t: Date.now() - (9 - i) * 86400000, n: 125 + i })) },
    floor: { lamports: 724870000, sol: 0.725, listed: 24, volume7d: 500000000, change24h: 0, change7d: 45,
      source: 'magiceden', updatedAt: Date.now() - 60000, collectingSince: Date.now() - 9 * 86400000,
      history: Array.from({ length: 9 }, (_, i) => ({ t: Date.now() - (9 - i) * 86400000, sol: i < 3 ? 0.5 : 0.725 })) },
    participation: { stakingWallets: 1, rangersStaked: 5, shareOfHolders: 0.8, top: [{ wallet: WALLET, rangers: 5, since: Date.now() }] },
    collection: { minted: 256, burned: 37, alive: 219, named: 217 }
  };
  if (p === '/api/collection') return {
    total: 4,
    // "Rarity Rank" is one value per Ranger: it must not become a filter
    traits: { Background: { Turtle: 2, Nebula: 2 }, Fur: { Green: 3, Gold: 1 },
      'Rarity Rank': Object.fromEntries(Array.from({ length: 41 }, (_, i) => ['#' + i, 1])) },
    rangers: [
      { mint: 'm1', name: 'Ranger #1', image: 'https://cdn.test/1', rank: 1, traits: { Background: 'Turtle', Fur: 'Gold' } },
      { mint: 'm2', name: 'Ranger #2', image: 'https://cdn.test/2', rank: 2, traits: { Background: 'Turtle', Fur: 'Green' } },
      { mint: 'm3', name: 'Ranger #3', image: 'https://cdn.test/3', rank: 3, traits: { Background: 'Nebula', Fur: 'Green' } },
      // the one whose artwork was lost: every source 404s
      { mint: 'm4', name: 'Ranger #4', image: 'https://gone.test/4', imageAlt: null, rank: 4, traits: { Background: 'Nebula', Fur: 'Green' } }
    ]
  };
  if (p === '/api/collection/sales') return { sales: [
    { mint: 'm1', name: 'Ranger #1', sol: 0.5, ts: Date.now() - 3600000, buyer: WALLET, seller: 'x' },
    { mint: 'm3', name: 'Ranger #3', sol: 0.41, ts: Date.now() - 86400000, buyer: WALLET, seller: 'y' }
  ] };
  return {};
}

function rpcAnswer(method) {
  const ctx = { slot: 1 };
  switch (method) {
    case 'getBalance': return { context: ctx, value: net.lamports };
    case 'getParsedTokenAccountsByOwner':
    case 'getTokenAccountsByOwner': return { context: ctx, value: [] };
    case 'getLatestBlockhash': return { context: ctx, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1e12 } };
    case 'getSignatureStatuses': return { context: ctx, value: [{ slot: 1, confirmations: null, err: null, confirmationStatus: 'confirmed' }] };
    case 'getBlockHeight': return 1;
    case 'searchAssets': return { total: 0, items: [] };
    default: return null;
  }
}

const json = (route, body) => route.fulfill({
  status: 200, contentType: 'application/json',
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
  body: JSON.stringify(body)
});

async function standIns(context) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(SITE) || url.startsWith('https://cdn.jsdelivr.net/')) return route.continue();
    if (req.method() === 'OPTIONS') return json(route, {});
    if (url.startsWith(WORKER)) {
      const u = new URL(url);
      net.worker.push(u.pathname);
      if (u.pathname === '/api/swap/quote') net.lastQuote = u.searchParams.get('in');
      return json(route, workerAnswer(u.pathname, u));
    }
    if (url.startsWith(RPC)) {
      const body = JSON.parse(req.postData() || '{}');
      const calls = Array.isArray(body) ? body : [body];
      const out = calls.map((c) => { net.rpc.push(c.method); return { jsonrpc: '2.0', id: c.id, result: rpcAnswer(c.method) }; });
      return json(route, Array.isArray(body) ? out : out[0]);
    }
    if (url.startsWith(SENDER)) {
      net.sender.push({ url, body: JSON.parse(req.postData()) });
      return json(route, { jsonrpc: '2.0', id: '1', result: 'accepted' });
    }
    return route.abort();   // fonts, images, embeds: not what this test is about
  });
}

// A Wallet Standard wallet that answers like a real one and signs nothing real.
function testWallet(address) {
  window.__wallet = { signAndSend: 0, signOnly: 0 };
  const account = {
    address, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], label: 'Test',
    features: ['solana:signAndSendTransaction', 'solana:signTransaction', 'solana:signMessage']
  };
  const wallet = {
    version: '1.0.0', name: 'Test Wallet', chains: ['solana:mainnet'], accounts: [account],
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signAndSendTransaction': {
        version: '1.0.0', supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs) => {
          window.__wallet.signAndSend++;
          window.__wallet.lastSent = Array.from(inputs[0].transaction);
          return inputs.map(() => ({ signature: new Uint8Array(64).fill(1) }));
        }
      },
      'solana:signTransaction': {
        version: '1.0.0', supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs) => {
          window.__wallet.signOnly++;
          return inputs.map((i) => {
            const signed = new Uint8Array(i.transaction);
            signed.set(new Uint8Array(64).fill(2), 1);   // one signature, right after its count byte
            return { signedTransaction: signed };
          });
        }
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs) => inputs.map((i) => ({ signedMessage: i.message, signature: new Uint8Array(64).fill(3) }))
      }
    }
  };
  window.addEventListener('wallet-standard:app-ready', (e) => e.detail.register(wallet));
}

// every SOL transfer in a transaction: [from, to, lamports]
const transfersIn = (page, bytesOrB64) => page.evaluate((input) => {
  const bytes = typeof input === 'string' ? Uint8Array.from(atob(input), (c) => c.charCodeAt(0)) : Uint8Array.from(input);
  const tx = solanaWeb3.VersionedTransaction.deserialize(bytes);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  return tx.message.compiledInstructions
    .filter((ix) => keys[ix.programIdIndex] === '11111111111111111111111111111111')
    .map((ix) => [keys[ix.accountKeyIndexes[0]], keys[ix.accountKeyIndexes[1]],
      Number(new DataView(ix.data.buffer, ix.data.byteOffset).getBigUint64(4, true))]);
}, bytesOrB64);

// ── run ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
await standIns(context);
await context.addInitScript(testWallet, WALLET);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const cspBlocks = [];
const warnings = [];
page.on('console', (m) => {
  if (/Content Security Policy/i.test(m.text())) cspBlocks.push(m.text());
  if (m.type() === 'warning') warnings.push(m.text());
});

try {
  section('the landing page');
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });
  eq('the tab title', await page.title(), '@solquicks | The Most Famous Fox');
  eq('Calendly links to the booking page',
    await page.locator('a.link-card', { hasText: 'Calendly' }).getAttribute('href'), 'https://calendly.com/solquicks/30min');
  ok('WhatsApp is gone', !/whatsapp/i.test(await page.content()));

  section('every tab opens');
  const tabs = await page.$$eval('.nav-item[data-tab]', (els) => els.map((e) => e.dataset.tab));
  ok('the menu lists the tabs', tabs.length >= 6, tabs.join(','));
  for (const tab of tabs) {
    await page.click('#nav-trigger');
    await page.click('.nav-item[data-tab="' + tab + '"]');
    ok('the ' + tab + ' tab shows its panel', await page.locator('#panel-' + tab).evaluate((p) => p.classList.contains('active')));
  }

  section('the Moon Rangers page');
  await page.click('#nav-trigger');
  await page.click('.nav-item[data-tab="moon"]');
  await page.waitForSelector('#an-wrap:not([hidden])', { timeout: 10000 });
  const moon = await page.evaluate(() => ({
    perks: [...document.querySelectorAll('.moon-perk')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()),
    market: document.getElementById('an-market').innerText.replace(/\s+/g, ' ').trim(),
    buy: document.querySelector('.an-buy a') && document.querySelector('.an-buy a').href,
    sparkTitle: document.getElementById('an-spark-title').textContent,
    part: document.getElementById('an-part-sub').textContent,
    stakers: document.getElementById('an-stakers').textContent.trim(),
    teaser: !document.getElementById('moon-teaser').hidden
  }));
  eq('the page says what a Ranger gets you', moon.perks.length, 4);
  ok('including the half-price swaps', /Half price swaps/.test(moon.perks.join(' ')), moon.perks.join(' | '));
  ok('and the booking discount', /15% off Book The Fox/.test(moon.perks.join(' ')));
  ok('how many are listed, out of the collection', moon.market.includes('24 listed for sale — 11% of the collection'), moon.market);
  ok('and what has traded this week', /0\.50 ◎ traded in the last 7 days/.test(moon.market), moon.market);
  ok('with somewhere to buy one', (moon.buy || '').includes('magiceden.io/marketplace/moonrangers'), moon.buy);
  eq('the chart is honest about how much history it has', moon.sparkTitle, 'Floor since tracking began');
  eq('staking is shown against the whole collection', moon.part, 'Taking part — 5 of 219 Rangers staked, by 0.8% of holders');
  ok('a leaderboard of one is a count instead of a list', /1 wallet staking so far/.test(moon.stakers), moon.stakers);
  ok('missions are explained before one is running', moon.teaser);

  const extras = await page.evaluate(() => ({
    story: document.getElementById('an-story').textContent.replace(/\s+/g, ' ').trim(),
    storyShown: !document.getElementById('an-story').hidden,
    salesShown: !document.getElementById('an-sales-panel').hidden,
    sales: [...document.querySelectorAll('.an-sale')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
    holdersShown: !document.getElementById('an-hold-panel').hidden,
    holdersTitle: document.getElementById('an-hold-title').textContent,
    holdersNote: document.getElementById('an-hold-note').textContent
  }));
  ok('the collection\'s story is told in numbers', extras.storyShown && /256 minted · 37 burned · 219 still here · 217 named/.test(extras.story), extras.story);
  ok('recent sales are listed', extras.salesShown && extras.sales.length === 2, JSON.stringify(extras.sales));
  ok('with price and how long ago', extras.sales[0].includes('0.5 ◎') && extras.sales[0].includes('ago'), extras.sales[0]);
  ok('holders over time is drawn', extras.holdersShown && extras.holdersTitle === 'Holders since tracking began', extras.holdersTitle);
  ok('and says how many holders were gained', /9 days recorded · low 125 · high 133 · \+8 holders/.test(extras.holdersNote), extras.holdersNote);

  section('the Moon Rangers page: explore the collection');
  await page.waitForSelector('#an-explore-panel:not([hidden])', { timeout: 10000 });
  const count = () => page.textContent('#an-explore-count');
  eq('every Ranger is listed, rarest first', (await count()).trim(), 'All 4 Rangers, rarest first');
  eq('a trait with a value per Ranger is not offered as a filter',
    await page.$$eval('#an-filters select', (els) => els.map((e) => e.dataset.trait).join(',')), 'Background,Fur');
  eq('the rarest is first in the grid', (await page.textContent('.an-rgr .an-rgr-name')).trim(), 'Ranger #1');
  await page.selectOption('select[data-trait="Fur"]', 'Green');
  eq('filtering by a trait narrows it down', (await count()).trim(), '3 of 4 match');
  await page.selectOption('select[data-trait="Background"]', 'Turtle');
  eq('two filters together narrow it further', (await count()).trim(), '1 of 4 match');
  eq('and the right one is left', (await page.textContent('.an-rgr .an-rgr-name')).trim(), 'Ranger #2');
  await page.click('.an-rgr');
  const detail = await page.evaluate(() => document.getElementById('an-detail').innerText.replace(/\s+/g, ' '));
  ok('a Ranger opens with its rank', /rarity rank 2 of 4/.test(detail), detail);
  ok('and how rare each trait is', /Green 3 of 4 · 75%/.test(detail), detail);
  ok('with a link to buy it', /View on Magic Eden/.test(detail));
  const missing = await page.evaluate(() => document.querySelectorAll('.an-rgr-missing').length);
  eq('a Ranger with no artwork anywhere says so instead of showing an empty square', missing, 1);
  await page.click('#an-explore-reset');
  eq('clearing the filters brings everyone back', (await count()).trim(), 'All 4 Rangers, rarest first');

  section('the Moon Rangers page: your own Rangers');
  const mine = await page.evaluate(() => {
    rangerList = [
      { mint: 'a1', name: 'Ranger #7', image: 'https://cdn.test/7' },
      { mint: 'a2', name: 'Ranger #8', image: 'https://cdn.test/8' }
    ];
    stakedMints = ['a1'];
    stakedAt = { a1: Date.now() - 3 * 86400000 };
    renderPicker();
    return [...document.querySelectorAll('.rg-card')].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  });
  ok('a staked Ranger shows its days and points', /3 days · 300 pts/.test(mine[0]), JSON.stringify(mine));
  ok('an unstaked one shows no earnings', !/pts/.test(mine[1]), JSON.stringify(mine));

  section('swap: quote');
  await page.click('#nav-trigger');
  await page.click('.nav-item[data-tab="swap"]');
  await page.waitForFunction(() => document.getElementById('sw-in-token').textContent.trim() === 'SOL');
  await page.click('#wallet-chip');
  await page.click('.wm-option:has-text("Test Wallet")');
  await page.waitForFunction((w) => typeof Wallet !== "undefined" && Wallet.pubkey === w, WALLET);
  ok('the test wallet connects', true);
  await page.waitForFunction(() => /Balance 2 SOL/.test(document.getElementById('sw-bal').textContent), null, { timeout: 10000 });
  ok('the SOL balance is read from the chain', true);

  await page.fill('#sw-in-amount', '1');
  await page.waitForSelector('#sw-detail:not([hidden])', { timeout: 10000 });
  ok('the fee line shows 0.2%', /0\.2%/.test(await page.textContent('#sw-fee')));
  eq('the route is shown', (await page.textContent('#sw-route')).trim(), 'Meteora DLMM');
  ok('Auto slippage shows the value the server picked', /Auto · 0\.5%/.test(await page.textContent('#sw-slip-auto')));
  ok('the swap button is ready', /Swap SOL for USDC/.test(await page.textContent('#sw-go')));

  section('swap: token picker hides worthless spam');
  await page.click('#sw-in-token');
  await page.waitForSelector('.sw-result-sym');
  const listed = async () => page.$$eval('#sw-results .sw-result-sym', (els) => els.map((e) => e.textContent.replace('✓', '').trim()));
  let syms = await listed();
  ok('verified holdings are listed', syms.includes('SOL') && syms.includes('USDC'), syms.join(','));
  ok('an unverified token with a real price stays visible', syms.includes('HYPE'));
  ok('an unverified token with no price is hidden', !syms.includes('CLAIMNOW'));
  ok('an unverified token worth under a cent is hidden', !syms.includes('DUST'));
  const toggle = page.locator('.sw-hidden-toggle');
  eq('the hidden count is offered', (await toggle.textContent()).trim(), 'Show 2 unverified tokens with no value');
  await toggle.click();
  syms = await listed();
  ok('showing them brings both back', syms.includes('CLAIMNOW') && syms.includes('DUST'));
  eq('and the button now hides them', (await page.locator('.sw-hidden-toggle').textContent()).trim(), 'Hide 2 unverified tokens with no value');
  await page.fill('#sw-search', '');
  await page.evaluate(() => closeTokenPicker());

  // what Jupiter hands back, in shape: a versioned transaction paid by this wallet
  net.built = await page.evaluate((w) => {
    const { PublicKey, TransactionMessage, VersionedTransaction } = solanaWeb3;
    const msg = new TransactionMessage({
      payerKey: new PublicKey(w), recentBlockhash: '11111111111111111111111111111111',
      instructions: [systemTransferIx(w, 'AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp', 1000)]
    }).compileToV0Message();
    let bin = ''; for (const b of new VersionedTransaction(msg).serialize()) bin += String.fromCharCode(b);
    return btoa(bin);
  }, WALLET);

  section('swap: normal send');
  eq('bot protection is on unless it was turned off', await page.evaluate(() => swapProtect), true);
  eq('and loading the page does not write that choice down',
    await page.evaluate(() => localStorage.getItem('sq.swap.protect')), null);
  await page.click('.sw-protect button[data-protect="off"]');
  eq('turning it off is remembered', await page.evaluate(() => localStorage.getItem('sq.swap.protect')), 'off');
  await page.click('#sw-go');
  await page.waitForSelector('#sw-msg.good', { timeout: 15000 });
  ok('the success message appears', /Swapped\./.test(await page.textContent('#sw-msg')));
  eq('the wallet was asked to sign and send once', await page.evaluate(() => __wallet.signAndSend), 1);
  eq('nothing went to Sender', net.sender.length, 0);
  await page.waitForFunction(() => true);
  ok('the swap was reported for history', net.worker.includes('/api/swap/record'));

  section('swap: bot protection');
  await page.fill('#sw-in-amount', '1');
  await page.waitForSelector('#sw-detail:not([hidden])', { timeout: 10000 });
  await page.click('.sw-protect button[data-protect="on"]');
  eq('the toggle turns on', await page.evaluate(() => localStorage.getItem('sq.swap.protect')), 'on');
  await page.waitForFunction(() => !document.getElementById('sw-go').disabled);
  await page.click('#sw-go');
  await page.waitForSelector('#sw-msg.good', { timeout: 15000 });
  ok('the protected swap succeeds', /Swapped\./.test(await page.textContent('#sw-msg')));
  eq('the wallet was asked only to sign', await page.evaluate(() => [__wallet.signOnly, __wallet.signAndSend].join('/')), '1/1');
  ok('it went to Sender with mev-protect', net.sender.length >= 1 && /mev-protect=true/.test(net.sender[0].url),
    'Sender requests: ' + net.sender.length + (cspBlocks.length ? '; CSP: ' + cspBlocks[0] : ''));
  if (net.sender.length) {
    const sent = net.sender[0].body;
    eq('sent without preflight or Sender retries', JSON.stringify(sent.params[1]), JSON.stringify({ encoding: 'base64', skipPreflight: true, maxRetries: 0 }));
    const tip = await page.evaluate((b64) => {
      const tx = solanaWeb3.VersionedTransaction.deserialize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const last = tx.message.compiledInstructions.at(-1);
      const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
      const lamports = Number(new DataView(last.data.buffer, last.data.byteOffset).getBigUint64(4, true));
      return { to: keys[last.accountKeyIndexes[1]], from: keys[last.accountKeyIndexes[0]], lamports, onList: SENDER_TIP_ACCOUNTS.includes(keys[last.accountKeyIndexes[1]]), signed: tx.signatures[0][0] === 2 };
    }, sent.params[0]);
    ok('the transaction carries a tip to a Helius tip account', tip.onList, JSON.stringify(tip));
    eq('the tip is 5000 lamports', tip.lamports, 5000);
    eq('paid by the connected wallet', tip.from, WALLET);
    ok('what was sent is what the wallet signed', tip.signed);
  }

  section('swap: a pair with no fee account pays in SOL');
  const bonkForWif = async () => {
    await page.evaluate(([bonk, wif]) => {
      swapPair.in = { mint: bonk, symbol: 'BONK', name: 'Bonk', decimals: 5 };
      swapPair.out = { mint: wif, symbol: 'WIF', name: 'dogwifhat', decimals: 6 };
      paintPair();
      document.getElementById('sw-in-amount').value = '';
    }, [BONK, WIF]);
    await page.fill('#sw-in-amount', '1000000');
    await page.waitForFunction(() => /BONK for WIF/.test(document.getElementById('sw-go').textContent) && !document.getElementById('sw-go').disabled, null, { timeout: 10000 });
  };
  await bonkForWif();
  eq('the fee is shown in SOL', (await page.textContent('#sw-fee')).trim(), '0.002 SOL (0.2%)');
  let sentBefore = net.sender.length;
  await page.click('#sw-go');
  await page.waitForSelector('#sw-msg.good', { timeout: 15000 });
  const protectedSend = net.sender.slice(sentBefore)[0];
  const withTip = protectedSend ? await transfersIn(page, protectedSend.body.params[0]) : [];
  ok('with bot protection: the SOL fee goes to the treasury', withTip.some((t) => t[1] === TREASURY && t[2] === 2000000 && t[0] === WALLET), JSON.stringify(withTip));
  ok('and the tip is still there, last', withTip.length && SENDER_TIP.includes(withTip.at(-1)[1]) && withTip.at(-1)[2] === 5000, JSON.stringify(withTip));

  await bonkForWif();
  await page.click('.sw-protect button[data-protect="off"]');
  await page.click('#sw-go');
  await page.waitForSelector('#sw-msg.good', { timeout: 15000 });
  const plain = await transfersIn(page, await page.evaluate(() => __wallet.lastSent));
  ok('without bot protection: the SOL fee is in the transaction the wallet sends', plain.some((t) => t[1] === TREASURY && t[2] === 2000000), JSON.stringify(plain));
  eq('and nothing else was added', plain.length, 2);

  net.lamports = 4e6;   // 0.004 SOL: not enough for the fee and the network costs
  await bonkForWif();
  await page.click('#sw-go');
  await page.waitForSelector('#sw-msg.good', { timeout: 15000 });
  const short = await transfersIn(page, await page.evaluate(() => __wallet.lastSent));
  ok('a wallet short of SOL still swaps, without the fee', !short.some((t) => t[1] === TREASURY), JSON.stringify(short));
  net.lamports = 2e9;
  await bonkForWif();
  await page.click('.sw-protect button[data-protect="on"]');

  section('a direct link to the Moon Rangers tab');
  // #moon restores the tab before the page has finished setting itself up, which
  // once left the explorer empty for anyone following a link straight to it
  warnings.length = 0;
  // a fresh load, not just a hash change: the query makes it a different URL
  await page.goto(SITE + '?arrive=moon#moon', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#an-explore-panel:not([hidden])', { timeout: 20000 });
  // the tab is restored before the script finishes setting up, and reading an
  // address that does not exist yet threw here once, silently
  ok('nothing failed on the way', !warnings.some((w) => /collection did not load/.test(w)), warnings.join(' | '));
  eq('the explorer loads for someone arriving straight there',
    (await page.textContent('#an-explore-count')).trim(), 'All 4 Rangers, rarest first');
  ok('and the collection numbers come with it', /219 still here/.test(await page.textContent('#an-story')));

  section('settings survive a reload');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });
  await page.click('#nav-trigger');
  await page.click('.nav-item[data-tab="swap"]');
  await page.waitForSelector('.sw-protect button.on', { state: 'attached' });
  eq('bot protection is still on', (await page.textContent('.sw-protect button.on')).trim(), 'On');
} catch (e) {
  ok('the run finished without an exception', false, e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(ROOT, 'test/browser/failure.png') }).catch(() => {});
}

ok('no uncaught errors in the page', pageErrors.length === 0, pageErrors.join(' | '));
ok('the Content-Security-Policy blocked nothing the site needs', cspBlocks.length === 0, cspBlocks.join(' | '));
await browser.close();
server.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
