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
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const RAY = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
const MINT_FIXTURE = JSON.parse(fs.readFileSync(new URL('./mint-ix.fixture.json', import.meta.url), 'utf8'));

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
const section = (s) => console.log('\n── ' + s + ' ──');

// ── the site, served as files ────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // /c/<slug> is a creator's site, which is index.html deciding it is theirs.
  // Vercel is configured to rewrite the same way.
  const creator = /^\/c\/[a-z0-9-]{3,32}\/?$/.test(rel);
  const file = path.join(ROOT, rel === '/' || creator ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const SITE = 'http://127.0.0.1:' + server.address().port + '/';

// ── stand-ins ────────────────────────────────────────────────────────────────
const net = { worker: [], rpc: [], sender: [], built: null, lamports: 2e9, lastQuote: null, emptyAccounts: 3, accounts: {}, simFail: false,
  quoteFail: 0, siteDelay: 0, boardThin: true, players: 2,
  invite: { ranger: false, invited: 6, traded: 2, earned: 2.4, available: 2.4, claimed: 0, claimable: false, invitedBy: null } };

// a wallet with some dead token accounts holding rent, and one holding a token
const cleanupScan = () => ({
  accounts: Array.from({ length: net.emptyAccounts }, (_, i) => ({
    // real addresses: the page builds instructions from these, so they must decode
    account: ['3w3oJv6xjbUTEJKfLcoijjAtAEUJkZ64po6nBBCjSijn', 'AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp',
      '7y4zjYuiFw7eHDUYWByqMSmu3SebpzvvBJSQz8BVbmXL'][i], mint: USDC, programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    amountRaw: '0', amount: 0, decimals: 6, frozen: false, rent: 2039280, empty: true, nft: false,
    name: 'USD Coin', symbol: 'USDC', image: null, collection: null, usd: null, priced: false
  })).concat([{
    account: '6aypgwsaHJmrVA6gS2EH5d67EmQyoSR2CRtoX33iZ9Yh', mint: BONK, programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    amountRaw: '1000', amount: 1000, decimals: 5, frozen: false, rent: 2039280, empty: false, nft: false,
    name: 'Bonk', symbol: 'BONK', image: null, collection: null, usd: 0.02, priced: true
  }]),
  rentPerAccount: 2039280, emptyRentLamports: 2039280 * net.emptyAccounts, feePct: 10,
  treasury: TREASURY, pointsPerBurn: 5, solUsd: 100
});

const HOLDINGS = [
  { mint: SOL, symbol: 'SOL', name: 'Solana', decimals: 9, verified: true, amount: 2, price: 100, usd: 200 },
  { mint: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, verified: true, amount: 50, price: 1, usd: 50 },
  // unverified, but it trades: must stay visible
  { mint: 'HYPEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'HYPE', name: 'Unverified with a price', decimals: 6, verified: false, amount: 3, price: 4, usd: 12 },
  // airdropped junk: no price at all, and a price worth a fraction of a cent
  { mint: 'SPAMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'CLAIMNOW', name: 'Visit claim-site', decimals: 6, verified: false, amount: 1000, price: null, usd: null },
  { mint: 'DUSTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'DUST', name: 'Worth almost nothing', decimals: 6, verified: false, amount: 5, price: 0.0001, usd: 0.0005 }
];

// What the invite endpoint would say, given what the test has done to it so far.
function inviteState() {
  return {
    code: 'FOX-MINE', sharePct: net.invite.ranger ? 50 : 20, rangerPct: 50, basePct: 20,
    pointsPct: 10, refereePoints: 250, refereeMinUsd: 50, claimMinUsd: 10,
    invited: net.invite.invited, traded: net.invite.traded,
    earnedUsd: net.invite.earned, availableUsd: net.invite.available, claimedUsd: net.invite.claimed,
    pointsEarned: 120, paidSwaps: 4, claimable: net.invite.claimable,
    queuedClaims: net.invite.claimed ? [{ id: 1, usd: net.invite.claimed, requested_at: Date.now() }] : [],
    invitedBy: net.invite.invitedBy
  };
}

function workerAnswer(p, url) {
  if (p === '/api/swap/tokens') return { tokens: [
    { mint: SOL, symbol: 'SOL', name: 'Solana', decimals: 9 },
    { mint: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 }
  ] };
  if (p === '/api/leaderboard') return {
    players: Array.from({ length: net.players }, (_, i) => ({
      wallet: ['6N1NhZc8CAk3eZYyRWMkKXAqZrV8LSycURz2aMhmUhAd',
        'AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp',
        '7y4zjYuiFw7eHDUYWByqMSmu3SebpzvvBJSQz8BVbmXL',
        '3w3oJv6xjbUTEJKfLcoijjAtAEUJkZ64po6nBBCjSijn'][i],
      points: 1000 - i * 100
    }))
  };
  if (p === '/api/swap/holdings') return { wallet: WALLET, tokens: HOLDINGS, totalUsd: 262, more: 0 };
  if (p === '/api/swap/leaderboard') {
    const many = [
      { rank: 1, wallet: WALLET, usd: 328.53, swaps: 2, tier: 'ranger' },
      { rank: 2, wallet: 'AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp', usd: 210, swaps: 4, tier: null },
      { rank: 3, wallet: '7y4zjYuiFw7eHDUYWByqMSmu3SebpzvvBJSQz8BVbmXL', usd: 90, swaps: 1, tier: 'collectible' }
    ];
    return {
      weekStart: Date.now() - 3 * 86400000, weekEnd: Date.now() + 4 * 86400000,
      prizes: [500, 250, 100], minUsd: 25,
      top: net.boardThin ? many.slice(0, 1) : many,
      lastWeek: net.boardThin ? [{ rank: 1, wallet: WALLET }]
        : many.map((r) => ({ rank: r.rank, wallet: r.wallet }))
    };
  }
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
  if (p === '/api/swap/history') return {
    swaps: Array.from({ length: 9 }, (_, i) => ({
      signature: 'h'.repeat(80) + i, in_symbol: 'SOL', in_mint: SOL, in_amount: 1, out_symbol: 'USDC', out_mint: USDC,
      out_amount: 100 + i, usd: 100 + i, points: 100, ts: Date.now() - i * 3600000
    })),
    savedUsd: 0, discountedSwaps: 0
  };
  // prices drive the instant estimate: 1 SOL is 100 USDC here
  if (p === '/api/swap/prices') return { prices: { [SOL]: 100, [USDC]: 1, [BONK]: 0.00002, [WIF]: 2 } };
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
  if (p === '/api/site') {
    const slug = url.searchParams.get('slug');
    return slug === 'ripple' ? { site: {
      slug: 'ripple', name: 'Ripple', handle: '@ripple', tagline: 'Making waves',
      avatar: 'https://img.test/ripple.png', domain: 'ripple.io',
      socials: [
        { id: 'x', name: 'X (Twitter)', label: '@ripple', href: 'https://x.com/ripple' },
        { id: 'email', name: 'Email', label: 'hi@ripple.io', href: 'mailto:hi@ripple.io' }
      ],
      treasury: '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey',
      topTabs: ['swap', 'store', 'book'], moreTabs: ['cleanup']
    } } : { site: null };
  }
  if (p === '/api/invite') return inviteState();
  if (p === '/api/invite/bind') {
    const code = (net.lastBody && net.lastBody.code) || '';
    if (code === 'FOX-MINE') return { error: 'that is your own code' };
    if (code !== 'FOX-GOOD') return { error: 'no such code' };
    net.invite.invitedBy = code;
    return { ok: true, code: code, note: 'Swap $50 or more and you earn 250 Fox Points.' };
  }
  if (p === '/api/invite/claim') {
    if (!net.invite.claimable) return { error: 'there is $2.40 to claim, and the minimum is $10' };
    net.invite.claimed = net.invite.available;
    net.invite.available = 0;
    net.invite.claimable = false;
    return { ok: true, claimed: net.invite.claimed };
  }
  if (p === '/api/cleanup/scan') return cleanupScan();
  if (p === '/api/cleanup/award') return { awarded: 6, burned: 0, closed: 3, player: { points: 6 } };
  if (p === '/api/store') return { product: { name: 'quicks Plushie', priceUsdc: 40, quantity: 100, sold: 12, available: 88, soldOut: false } };
  // ── the booking tab, enough of it to walk the basket through ──
  if (p === '/api/booking/types') return {
    types: [
      { id: 'space', name: 'Hosted X Space', mode: 'slot', minutes: 60, price: 200,
        blurb: 'I host the Space.', includes: ['Guests', 'Agenda'], format: 'live' },
      { id: 'custom', name: 'Custom content', mode: 'async', minutes: null, price: 250,
        blurb: 'Made for you.', includes: ['A video'] },
      { id: 'consult', name: 'Project consulting', mode: 'async', minutes: 60, price: 100,
        blurb: 'An hour on your project.',
        // As many lines as the real one has: the page has to render every one
        // it is given, not the first few.
        includes: ['Consulting and advisory for your project', 'An idea session focused on growth and revenue',
          'Go-to-market strategy', 'Marketing advisory', 'Community building strategy',
          'Solana networking', 'Events planning'],
        meta: '60 minutes · one to one · we agree a time after you book',
        cta: 'Book an hour' }
    ],
    policy: { cancellation: 'Cancel any time.', refunds: 'Full refund.', currency: 'Paid in USDC.',
      rush: 'Booked inside 48 hours costs more.', holder: 'Hold any Moon Ranger and 30% comes off.' },
    rushHours: 48, rushPct: 50, holderDiscountPct: 30, collectibleDiscountPct: 5,
    holder: false, tier: null, discountPct: 0,
    // A creator's site is quoted their wallet, the same way the worker does it.
    payTo: url.searchParams.get('site') === 'ripple'
      ? '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey' : TREASURY
  };
  if (p === '/api/booking/slots') return { slots: [
    { starts: Date.now() + 5 * 86400000, rush: false },
    { starts: Date.now() + 6 * 86400000, rush: false }
  ] };
  if (p === '/api/booking/hold') {
    net.holds = (net.holds || 0) + 1;
    return { ref: 'BK-' + net.holds, reference: 'REF' + net.holds, type: 'space', mode: 'slot',
      startsAt: Date.now() + 5 * 86400000, minutes: 60,
      quote: { base: 200, rush: false, rushPct: 0, discountPct: 0, total: 200 },
      usdc: 200000000, usdcMint: USDC, payTo: TREASURY,
      holdUntil: Date.now() + 20 * 60000, serverNow: Date.now(), policy: {} };
  }
  if (p === '/api/banner/rates') return {
    rates: [
      { weeks: 1, price: 250, label: '1 week', startsAt: Date.now() + 86400000 },
      { weeks: 52, price: 9360, label: '1 year', startsAt: Date.now() + 86400000 }
    ],
    nextFree: Date.now() + 86400000, taken: false, payTo: TREASURY, rules: 'Reviewed before it runs.'
  };
  if (p === '/api/banner/hold') return {
    ref: 'AD-1', reference: 'REFAD', weeks: 1, startsAt: Date.now() + 86400000,
    endsAt: Date.now() + 8 * 86400000, totalUsd: 250, usdc: 250000000, usdcMint: USDC,
    payTo: TREASURY, holdUntil: Date.now() + 20 * 60000, serverNow: Date.now()
  };
  if (p === '/api/cart/checkout') {
    net.cartPosts = (net.cartPosts || 0) + 1;
    return { ref: 'CART-1', reference: 'REFCART', total: 450, usdc: 450000000, usdcMint: USDC,
      payTo: TREASURY, holdUntil: Date.now() + 20 * 60000, serverNow: Date.now(),
      items: [{ kind: 'booking', ref: 'BK-1', total: 200 }, { kind: 'banner', ref: 'AD-1', total: 250 }],
      policy: {} };
  }
  if (p === '/api/cart/watch') return { status: 'held' };
  if (p === '/api/booking/brief') { net.briefs = (net.briefs || 0) + 1; return { ok: true }; }
  if (p === '/api/booking/lookup') {
    const ref = url.searchParams.get('ref');
    if (ref === 'FOX-AD0001') return { kind: 'banner', banner: { ref, weeks: 1,
      startsAt: Date.now() + 86400000, endsAt: Date.now() + 8 * 86400000,
      total: 250, status: 'paid', approved: false, hasCreative: false } };
    if (ref === 'FOX-BK0001') return { kind: 'booking', details: 'guests: @a',
      booking: { ref, type: 'space', status: 'paid', totalUsd: 200, startsAt: Date.now() + 5 * 86400000 } };
    return { error: 'no booking with that reference' };
  }

  if (p === '/api/swap/top') {
    // Deliberately disagreeing metrics, so a test can tell which one the page
    // is actually ranking by: USDC is the busiest, BONK the biggest.
    const pool = [
      { mint: USDC, symbol: 'USDC', decimals: 6, verified: true, tokenProgram: TOKEN_PROGRAM, volume24h: 900000000, mcap: 1000, liquidity: 5000, holders: 10, organicScore: 1 },
      { mint: WIF, symbol: 'WIF', decimals: 6, verified: true, tokenProgram: TOKEN_PROGRAM, volume24h: 20000000, mcap: 50000, liquidity: 90000, holders: 500, organicScore: 50 },
      { mint: BONK, symbol: 'BONK', decimals: 5, verified: true, tokenProgram: TOKEN_PROGRAM, volume24h: 5000000, mcap: 9000000, liquidity: 1000, holders: 90, organicScore: 99 },
      // Neither of these is swapped on the site, and their metrics are
      // inverted, so the order they come out in says which ranking is live.
      { mint: RAY, symbol: 'RAY', decimals: 6, verified: true, tokenProgram: TOKEN_PROGRAM, volume24h: 1, mcap: 5000000, liquidity: 700000, holders: 3000, organicScore: 80 }
    ];
    const rank = url.searchParams.get('rank') || 'volume';
    const of = { volume: 'volume24h', mcap: 'mcap', liquidity: 'liquidity', organic: 'organicScore', holders: 'holders' }[rank] || 'volume24h';
    return {
      rank,
      ranks: [
        { id: 'volume', label: 'Busiest — 24h volume', unit: 'usd' },
        { id: 'mcap', label: 'Biggest — market cap', unit: 'usd' },
        { id: 'liquidity', label: 'Deepest liquidity', unit: 'usd' },
        { id: 'organic', label: 'Most organic — real trading', unit: 'score' },
        { id: 'holders', label: 'Most holders', unit: 'count' }
      ],
      tokens: pool.slice().sort((a, b) => b[of] - a[of])
    };
  }
  if (p === '/api/swap/traded') return { days: 90, tokens: [
    { mint: BONK, symbol: 'BONK', swaps: 9 },
    { mint: WIF, symbol: 'WIF', swaps: 2 }
  ] };
  if (p === '/api/collectible') return { open: true, minted: 37, cap: 100000, priceSol: 0.1, points: 250, swapFeeBps: 15, discountPct: 7, holder: false };
  if (p === '/api/collectible/claim') return { points: 250, player: { points: 250 } };
  if (p === '/api/collection/sales') return { sales: [
    { mint: 'm1', name: 'Ranger #1', sol: 0.5, ts: Date.now() - 3600000, buyer: WALLET, seller: 'x' },
    { mint: 'm3', name: 'Ranger #3', sol: 0.41, ts: Date.now() - 86400000, buyer: WALLET, seller: 'y' }
  ] };
  return {};
}

function rpcAnswer(method, params) {
  const ctx = { slot: 1 };
  switch (method) {
    // The fee-account page reads a list of mints, then the list of fee
    // accounts derived from them. net.accounts says which addresses exist.
    case 'getMultipleAccounts': return {
      context: ctx,
      value: (params && params[0] ? params[0] : []).map((k) => net.accounts[k] || null)
    };
    case 'getBalance': return { context: ctx, value: net.lamports };
    case 'getParsedTokenAccountsByOwner':
    case 'getTokenAccountsByOwner': return { context: ctx, value: [] };
    case 'getLatestBlockhash': return { context: ctx, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1e12 } };
    case 'getSignatureStatuses': return { context: ctx, value: [{ slot: 1, confirmations: null, err: null, confirmationStatus: 'confirmed' }] };
    case 'getBlockHeight': return 1;
    // the real rent-exempt minimum for a token account, which the page reads
    // rather than assuming — it assumed 0.00204 and was a third over
    case 'getMinimumBalanceForRentExemption': return (params && params[0] >= 178) ? 1554480 : 1488440;
    // net.simFail makes the referral program refuse, the way it does for a
    // mint carrying Token-2022 extensions it is too old to read.
    case 'simulateTransaction': return {
      context: ctx,
      value: { err: net.simFail ? { InstructionError: [0, 'InvalidAccountData'] } : null, logs: [], unitsConsumed: 5000 }
    };
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
      net.worker.push(u.pathname + u.search);
      // A real network does not answer in the order it was asked. Slowing this
      // one down is what lets a test provoke the gap where the page does not
      // yet know whose site it is.
      if (u.pathname === '/api/site' && net.siteDelay) {
        await new Promise((r) => setTimeout(r, net.siteDelay));
      }
      // POSTed bodies, so a stub can answer differently depending on what was
      // actually sent rather than only on the path.
      if (req.method() === 'POST') {
        try { net.lastBody = JSON.parse(req.postData() || '{}'); } catch (e) { net.lastBody = {}; }
      }
      // Lets a test make the quote route fail the way production does, with a
      // status the page is supposed to treat differently from a real refusal.
      if (u.pathname === '/api/swap/quote' && net.quoteFail) {
        const busy = net.quoteFail === 429;
        return route.fulfill({
          status: net.quoteFail, contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
          body: JSON.stringify(busy
            ? { error: 'too many quotes at once — trying again in a moment', retry: true }
            : { error: 'no route for that pair right now' })
        });
      }
      if (u.pathname === '/api/swap/quote') {
        net.lastQuote = u.searchParams.get('in');
        net.lastQuoteAmount = u.searchParams.get('amount');
      }
      return json(route, workerAnswer(u.pathname, u));
    }
    if (url.startsWith(RPC)) {
      const body = JSON.parse(req.postData() || '{}');
      const calls = Array.isArray(body) ? body : [body];
      const out = calls.map((c) => { net.rpc.push(c.method); return { jsonrpc: '2.0', id: c.id, result: rpcAnswer(c.method, c.params) }; });
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
// The invite stub's state lives in Node. These let a test drive it from inside
// the page, which is where loadInvite runs.
await page.exposeFunction('net_setInvite', (patch) => { Object.assign(net.invite, patch); return net.invite; });
await page.exposeFunction('net_quoteFail', (status) => { net.quoteFail = status; return status; });
await page.exposeFunction('net_boardThin', (v) => { net.boardThin = v; return v; });
await page.exposeFunction('net_players', (n) => { net.players = n; return n; });
await page.exposeFunction('net_invite', () => net.invite);
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
  // Swap, Store and Book sit in the bar itself; the rest are behind the menu.
  const quick = await page.$$eval('.nav-quick-btn[data-tab]', (els) => els.map((e) => e.dataset.tab));
  eq('the three that earn are in the bar', quick.join(','), 'swap,store,book');
  // The bar, the panel heading and every perk line that mentions it have to
  // agree — including the capital T the rest of the site uses.
  eq('and the booking one is named in full',
    (await page.textContent('.nav-quick-btn[data-tab="book"]')).trim(), 'Book The Fox');
  eq('matching the heading of the page it opens',
    (await page.textContent('#panel-book .bk-lead')).trim(), 'Book The Fox');
  ok('and are not also buried in the menu',
    (await page.$$eval('.nav-item[data-tab]', (els) => els.map((e) => e.dataset.tab)))
      .every((t) => !quick.includes(t)));
  const menuTabs = await page.$$eval('.nav-item[data-tab]',
    (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.tab));
  eq('the menu holds what is left', menuTabs.join(','),
    'links,cleanup,defi,leaderboard,gacha,games,mine,moon,referrals,travel,wishlist');

  // The Launchpad is a page of its own rather than a tab, so it is a link in
  // the same menu and has no panel behind it.
  const lp = page.locator('#nav-launchpad');
  // Named for what it is rather than for one part of it. The tab id stays
  // `leaderboard` so a shared #leaderboard link still works.
  eq('the points page is named Fox Points',
    (await page.locator('.nav-item[data-tab="leaderboard"] .nav-item-name').textContent()).trim(), 'Fox Points');
  ok('and its own heading agrees',
    /Fox Points/.test(await page.textContent('#panel-leaderboard .section-label')));
  ok('a link straight to #leaderboard still works', await page.evaluate(() => {
    location.hash = '#leaderboard';
    const el = document.querySelector('[data-tab="leaderboard"]');
    switchTab('leaderboard', el);
    const ok = document.getElementById('panel-leaderboard').classList.contains('active');
    location.hash = '';
    switchTab('links');
    return ok;
  }));

  eq('the Launchpad sits in the menu as a link out', await lp.getAttribute('href'), 'launch.html');
  eq('and does not stand out as the one underlined thing in it',
    await lp.evaluate((e) => getComputedStyle(e).textDecorationLine), 'none');
  eq('named like everything else', (await lp.locator('.nav-item-name').textContent()).trim(), 'Creator Launchpad');
  eq('and still in alphabetical order', await page.$$eval('.nav-item',
    (els) => els.filter((e) => !e.hidden).map((e) => (e.querySelector('.nav-item-name') || e).textContent.trim()))
    .then((n) => n.slice(1).join(',')),
    await page.$$eval('.nav-item',
      (els) => els.filter((e) => !e.hidden).map((e) => (e.querySelector('.nav-item-name') || e).textContent.trim()))
      .then((n) => n.slice(1).slice().sort((a, b) => a.localeCompare(b)).join(',')));
  ok('with Contact first, as the landing page', menuTabs[0] === 'links', menuTabs.join(','));

  // The order is a rule, not a list somebody retypes. Sorted by what is on
  // screen, so a page added later cannot land in the wrong place.
  const names = await page.$$eval('.nav-item[data-tab] .nav-item-name',
    (els) => els.map((e) => e.textContent.trim()));
  eq('and the rest alphabetical, by the name people actually read',
    names.slice(1).join(','), names.slice(1).slice().sort((a, b) => a.localeCompare(b)).join(','));

  // Ten entries are taller than most screens. Capping the height and letting
  // it scroll hid the last two — Referrals and Wishlist — below the fold with
  // nothing to suggest the menu scrolled, so they read as missing entirely.
  // Two columns on a desktop fits every entry without scrolling.
  const menuAt = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      openMenu();
      const m = document.getElementById('nav-menu');
      const box = m.getBoundingClientRect();
      const hidden = [...m.querySelectorAll('.nav-item')]
        .filter((e) => e.getBoundingClientRect().bottom > box.bottom + 1)
        .map((e) => (e.querySelector('.nav-item-name') || e).textContent.trim());
      const r = { hidden: hidden, scrolls: m.classList.contains('scrolls'),
                  cols: getComputedStyle(m).gridTemplateColumns.split(' ').length };
      closeMenu();
      return r;
    });
  };

  const wide = await menuAt(1200, 800);
  eq('on a desktop every entry is reachable without scrolling', wide.hidden.join(','), '');
  eq('because it lays out in two columns', wide.cols, 2);
  ok('so nothing has to be scrolled for', !wide.scrolls);

  // On a phone it does scroll, and that has to be visible rather than silent.
  const narrow = await menuAt(390, 700);
  ok('on a phone it scrolls', narrow.scrolls);
  ok('and says so, rather than letting the last entries vanish', narrow.scrolls);
  await page.setViewportSize({ width: 900, height: 700 });

  for (const tab of quick) {
    await page.click('.nav-quick-btn[data-tab="' + tab + '"]');
    ok('the ' + tab + ' tab opens straight from the bar',
      await page.locator('#panel-' + tab).evaluate((p) => p.classList.contains('active')));
    ok('and the bar button shows as current',
      await page.locator('.nav-quick-btn[data-tab="' + tab + '"]').evaluate((b) => b.classList.contains('active')));
  }
  for (const tab of menuTabs) {
    await page.click('#nav-trigger');
    await page.click('.nav-item[data-tab="' + tab + '"]');
    ok('the ' + tab + ' tab shows its panel', await page.locator('#panel-' + tab).evaluate((p) => p.classList.contains('active')));
  }

  section('the store');
  await page.click('.nav-quick-btn[data-tab="store"]');
  await page.waitForFunction(() => document.getElementById('product-stock').textContent !== '93 available', null, { timeout: 10000 });
  eq('stock comes from the shop, not the page', (await page.textContent('#product-stock')).trim(), '88 available');
  eq('and so does the order count', (await page.textContent('#store-progress')).trim(), '12 / 100');
  eq('the bar matches', await page.evaluate(() => document.getElementById('store-fill').style.width), '12%');

  // The numbers in the markup are a placeholder for the moment before the shop
  // answers, not a fallback. Leaving them up when it cannot be reached tells
  // somebody there is stock because that is what was typed into the page.
  const outage = await page.evaluate(async () => {
    storeLoaded = false;
    const real = window.fetch;
    window.fetch = (u, o) => /\/api\/store/.test(String(u)) ? Promise.reject(new Error('down')) : real(u, o);
    await loadStore();
    window.fetch = real;
    return {
      stock: document.getElementById('product-stock').textContent.trim(),
      progress: document.getElementById('store-progress').textContent.trim(),
      fill: document.getElementById('store-fill').style.width
    };
  });
  eq('a shop that cannot be reached says so', outage.stock, 'stock unavailable');
  ok('rather than a number somebody typed into the page months ago',
    !/available|Sold out/.test(outage.progress) && outage.progress === '—', outage.progress);
  eq('and the bar does not claim a figure either', outage.fill, '0px');

  await page.evaluate(() => { storeLoaded = false; return loadStore(); });
  await page.waitForFunction(() => /88 available/.test(document.getElementById('product-stock').textContent),
    null, { timeout: 10000 });
  ok('and it recovers when the shop comes back', true);

  // Live features have partners too, and the same rule applies: name them.
  ok('the store says who fulfils it', /store\.fun/.test(await page.textContent('#panel-store')));
  ok('and who is coming', /Nomu/.test(await page.textContent('#panel-store')));

  section('the collectible: the mint instruction, byte for byte');
  {
    // index.html encodes the Candy Guard mint by hand rather than shipping
    // Metaplex's SDK. The fixture is what that SDK produces for the same
    // inputs, so any drift in accounts, order, flags or data shows up here
    // instead of on someone's 0.1 SOL.
    const built = await page.evaluate(async (f) => {
      const ix = await collectibleMintIx({
        candyMachine: f.input.candyMachine,
        candyGuard: f.input.candyGuard,
        collection: f.input.collection,
        treasury: f.input.treasury,
        minter: f.input.minter,
        asset: f.input.asset,
        mintLimitId: f.input.mintLimitId
      });
      return {
        programId: ix.programId.toBase58(),
        data: Array.from(ix.data).map((b) => b.toString(16).padStart(2, '0')).join(''),
        keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable }))
      };
    }, MINT_FIXTURE);

    eq('the same program', built.programId, MINT_FIXTURE.programId);
    eq('the same instruction data', built.data, MINT_FIXTURE.data);
    eq('the same number of accounts', built.keys.length, MINT_FIXTURE.keys.length);
    eq('the same accounts, in the same order, with the same flags',
      JSON.stringify(built.keys), JSON.stringify(MINT_FIXTURE.keys));
  }

  section('the collectible: the card');
  {
    // The mint is open. The card is on the shelf and the button works.
    eq('the card is on show', await page.evaluate(() => document.getElementById('collectible-card').hidden), false);
    eq('and the button can be pressed', await page.evaluate(() => document.getElementById('collectible-mint').disabled), false);
    eq('the page names the wallet the takings go to',
      await page.evaluate(() => MINT.treasury), 'FndhEjYMXMhihnoUfZbgm7mTWgCpcwoT3NikTABLV37m');

    // The switch that kept it shut still works, because it is what a future
    // pause would use.
    eq('turning it off hides the card again', await page.evaluate(() => {
      MINT.live = false;
      collectibleLoaded = false;
      loadCollectible();
      const hidden = document.getElementById('collectible-card').hidden;
      MINT.live = true;
      collectibleLoaded = false;
      return hidden;
    }), true);
    await page.evaluate(() => loadCollectible());
    await page.waitForFunction(() => document.getElementById('collectible-card').hidden === false, null, { timeout: 10000 });

    // Once the addresses are in, it reads the count from the worker.
    await page.evaluate(() => {
      MINT.candyMachine = '11111111111111111111111111111112';
      MINT.candyGuard = '11111111111111111111111111111113';
      MINT.collection = '11111111111111111111111111111114';
      MINT.live = true;               // as it will be once the mint opens
      collectibleLoaded = false;
      return loadCollectible();
    });
    await page.waitForFunction(() => /of/.test(document.getElementById('collectible-minted').textContent), null, { timeout: 10000 });
    eq('opening the mint shows the card', await page.evaluate(() => document.getElementById('collectible-card').hidden), false);

    // What is on the card is progress through the whole run, not what this
    // wallet has: the interesting number is how much is left for everyone.
    eq('the card counts the whole run, not this wallet',
      (await page.textContent('#collectible-minted')).trim(), '37 of 100,000');
    // The count is already beside the price, so the bar says how far along the
    // run is — and 0.037% is never rounded up to a percent it has not reached.
    eq('and the bar says how far along the run is without flattering it',
      (await page.textContent('#collectible-progress')).trim(), 'under 0.1%');
    eq('a run that is genuinely underway says so in percent',
      await page.evaluate(() => {
        paintMintProgress(12500, 100000);
        const t = document.getElementById('collectible-progress').textContent;
        paintMintProgress(37, 100000);
        return t;
      }), '13%');

    // 37 of 100,000 is 0.037%, which draws as nothing. The stripe has to be
    // visible without the percentage being rounded up to meet it.
    const bar = await page.evaluate(() => {
      const f = document.getElementById('collectible-fill');
      return { css: f.style.width, drawn: f.getBoundingClientRect().width, started: f.classList.contains('started') };
    });
    eq('the fill is set to the true fraction', bar.css, (37 / 100000) * 100 + '%');
    ok('which is drawn wide enough to see', bar.drawn >= 5 && bar.drawn <= 12, String(bar.drawn));
    ok('and marked as started', bar.started);

    // An empty run must not show the same stripe, or the bar would claim a
    // sale before there was one.
    const none = await page.evaluate(() => {
      paintMintProgress(0, 100000);
      const f = document.getElementById('collectible-fill');
      const r = { drawn: f.getBoundingClientRect().width, started: f.classList.contains('started'),
                  text: document.getElementById('collectible-minted').textContent };
      paintMintProgress(37, 100000);
      return r;
    });
    // Sub-pixel rather than exactly zero: the bar rounds its own width. What
    // matters is that there is nothing to see.
    ok('nothing minted draws nothing', none.drawn < 1, String(none.drawn));
    ok('and is not marked as started', !none.started);
    eq('and the bar says none yet rather than 0%',
      await page.evaluate(() => {
        paintMintProgress(0, 100000);
        const t = document.getElementById('collectible-progress').textContent;
        paintMintProgress(37, 100000);
        return t;
      }), 'none yet');
    eq('and says so plainly', none.text, '0 of 100,000');

    // Sold out cannot overflow the bar.
    const full = await page.evaluate(() => {
      paintMintProgress(100000, 100000);
      const w = document.getElementById('collectible-fill').style.width;
      paintMintProgress(37, 100000);
      return w;
    });
    eq('a finished run fills the bar exactly once', full, '100%');
    eq('and the button opens up', await page.evaluate(() => document.getElementById('collectible-mint').disabled), false);
    ok('the page says it can never be moved',
      /cannot be sold, sent or burned/.test(await page.textContent('.mint-warning')));
    // The image is lazy and the card was hidden, so it only fetches once the
    // mint opens — which is the behaviour, not a delay to work around.
    await page.waitForFunction(() => {
      const img = document.getElementById('collectible-art');
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 15000 }).catch(() => {});
    const art = await page.evaluate(() => {
      const img = document.getElementById('collectible-art');
      return { w: img ? img.naturalWidth : 0, placeholder: !!document.querySelector('.mint-art-missing') };
    });
    eq('the artwork loads at full size', art.w, 687);
    ok('and is served from a path that never 404ed, so no stale miss is cached',
      await page.evaluate(() => /soulbound\.jpg/.test(document.getElementById('collectible-art').src)));
    ok('so no "artwork coming" placeholder is shown', !art.placeholder);

    // The plushie's carousel runs every few seconds over every .carousel-img
    // on the page. The collectible had that class, so it was being treated as
    // a fourth slide of the plushie and left invisible.
    const shown = await page.evaluate(() => {
      goSlide(1); goSlide(2);           // as the timer does, on its own
      const img = document.getElementById('collectible-art');
      const r = img.getBoundingClientRect();
      return { opacity: getComputedStyle(img).opacity, width: Math.round(r.width) };
    });
    eq('the carousel cannot fade the collectible out', shown.opacity, '1');
    ok('and it keeps its width', shown.width > 100, JSON.stringify(shown));
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
  // Said as a percentage off, which is what someone can actually weigh —
  // "0.1%" alone means nothing without knowing the standard rate.
  ok('including the swap discount, as a percentage',
    /50% off swap fees/.test(moon.perks.join(' ')), moon.perks.join(' | '));
  ok('and the booking discount', /30% off Book The Fox/.test(moon.perks.join(' ')));
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

  section('booking: the rate card');
  {
    // "from $180 /week" was the best rate, only reached at three months. The
    // cheapest way in is $250 for one week, so an advertiser clicked expecting
    // $180 and found $250.
    await page.evaluate(() => switchTab('book'));
    await page.waitForSelector('.bk-ad', { timeout: 15000 });
    const ad = (await page.textContent('.bk-ad')).replace(/\s+/g, ' ');
    ok('the advertising price is one you can actually pay today', /\$250/.test(ad), ad);
    ok('and the cheaper rate is explained rather than advertised as the price',
      /down to \$180 on three months or more/.test(ad), ad);

    await page.evaluate(() => switchTab('book'));
    await page.waitForSelector('.bk-card', { timeout: 15000 });

    const consult = page.locator('.bk-card', { hasText: 'Project consulting' });
    eq('the consulting hour is on the card', await consult.count(), 1);
    eq('at its price', (await consult.locator('.bk-price').first().textContent()).replace(/\s+/g, ' ').trim().slice(0, 4), '$100');

    // Seven lines are served and seven have to appear. A card that quietly
    // renders the first few would sell an hour on a shorter promise than the
    // one that was made.
    // Its own wording. The default for an async booking says "no calendar
    // needed · made for you", which is not an hour on a call.
    eq('the hour says how it is scheduled',
      (await consult.locator('.bk-meta').first().textContent()).trim(),
      '60 minutes · one to one · we agree a time after you book');
    eq('and the button asks for an hour',
      (await consult.locator('button.bk-go').first().textContent()).trim(), 'Book an hour');
    eq('while the other async service keeps the default wording',
      (await page.locator('.bk-card', { hasText: 'Custom content' }).locator('.bk-meta').first().textContent()).trim(),
      'No calendar needed · made for you');

    const lines = await consult.locator('.bk-inc li').allTextContents();
    eq('everything the hour covers is listed, not just the first few', lines.length, 7);
    eq('in the order it was written', lines.map((t) => t.trim()).join(' · '),
      'Consulting and advisory for your project · An idea session focused on growth and revenue · ' +
      'Go-to-market strategy · Marketing advisory · Community building strategy · ' +
      'Solana networking · Events planning');
  }

  section('booking: a basket survives wandering off and coming back');
  {
    await page.evaluate(() => { try { localStorage.removeItem('sq.book.cart'); } catch (e) {} });
    await page.click('.nav-quick-btn[data-tab="book"]');
    await page.waitForSelector('.bk-card', { timeout: 15000 });

    // one Space into the basket
    await page.locator('.bk-card', { hasText: 'Hosted X Space' }).locator('button.bk-go').click();
    await page.waitForSelector('.bk-slot', { timeout: 10000 });
    await page.locator('.bk-slot').first().click();
    await page.fill('#bk-name', 'Test Guest');
    await page.fill('#bk-contact', '@guest');
    await page.click('#bk-add');
    await page.waitForFunction(() => !document.getElementById('bk-cart').hidden, null, { timeout: 10000 });

    eq('adding one puts it in the basket',
      await page.$$eval('#bk-cart .bk-cart-line', (e) => e.length), 1);
    eq('and hands you back the full list of services',
      await page.evaluate(() => document.getElementById('bk-list').hidden), false);

    // wander off to another tab entirely and come back
    await page.click('.nav-quick-btn[data-tab="swap"]');
    await page.click('.nav-quick-btn[data-tab="book"]');
    eq('the basket is still there after leaving the tab',
      await page.$$eval('#bk-cart .bk-cart-line', (e) => e.length), 1);

    // now the advertising slot, from the same basket
    await page.locator('.bk-ad button.bk-go').click();
    await page.waitForSelector('#ad-add', { timeout: 10000 });
    await page.fill('#ad-name', 'Test Guest');
    await page.fill('#ad-contact', '@guest');
    await page.click('#ad-add');
    await page.waitForFunction(() => document.querySelectorAll('#bk-cart .bk-cart-line').length === 2, null, { timeout: 10000 });
    ok('a service and an ad sit in the basket together', true);
    ok('and it adds up', /\$450/.test(await page.textContent('#bk-cart')), await page.textContent('#bk-cart'));

    // a reload must not lose reservations that are already held on the server
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });
    await page.click('.nav-quick-btn[data-tab="book"]');
    await page.waitForSelector('#bk-cart .bk-cart-line', { timeout: 15000 });
    eq('and it survives a reload', await page.$$eval('#bk-cart .bk-cart-line', (e) => e.length), 2);

    // checkout, from wherever you happen to be
    await page.click('.bk-cart-go');
    await page.waitForSelector('#cart-go', { timeout: 10000 });
    eq('the basket is reviewed before paying',
      await page.$$eval('.bk-cart-review .bk-cart-line', (e) => e.length), 2);
    ok('with the details already filled in from the first booking',
      (await page.inputValue('#cart-name')) === 'Test Guest');
    await page.click('#cart-go');
    await page.waitForSelector('#pay-status', { timeout: 15000 });
    eq('one payment covers the lot', net.cartPosts, 1);

    // An ad paid for inside a basket still has to hand over its artwork, or
    // it is paid for and never runs.
    await page.evaluate(() => showCartDone(window._pay.d, 'sig123'));
    const adBtn = page.locator('button', { hasText: 'Add your banner artwork' });
    eq('the basket asks for the banner artwork afterwards', await adBtn.count(), 1);
    await adBtn.click();
    await page.waitForSelector('#ad-url', { timeout: 10000 });
    ok('and the form asks where the click should go', true);
    ok('with a way back out of it', await page.locator('#bk-flow .bk-back').count() > 0);

    // and a line can be taken out again
    await page.click('.bk-back');
    await page.waitForSelector('#bk-cart .bk-cart-x', { timeout: 10000 });
    await page.locator('#bk-cart .bk-cart-x').first().click();
    eq('removing a line leaves the rest', await page.$$eval('#bk-cart .bk-cart-line', (e) => e.length), 1);
    await page.evaluate(() => { cartClear(); });
  }

  section('booking: what happens after the money moves');
  {
    await page.click('.nav-quick-btn[data-tab="book"]');
    await page.waitForSelector('.bk-card', { timeout: 15000 });

    // A paid Space asks for what is needed to run it, while they are still here
    await page.evaluate(() => showBookingDone(
      { ref: 'FOX-BK0001', type: 'space', startsAt: Date.now() + 5 * 86400000 }, false, 'sigabc'));
    ok('a paid booking asks for the details I need',
      await page.locator('#bk-brief-after').count() > 0);
    ok('and says what to put in it',
      /Guest handles/.test(await page.textContent('.bk-brief-box')), await page.textContent('.bk-brief-box'));
    await page.fill('#bk-brief-after', 'guests: @a, @b · topic: the launch');
    await page.click('#bk-brief-send');
    await page.waitForFunction(() => /Got it/.test(document.getElementById('bk-brief-msg').textContent), null, { timeout: 10000 });
    eq('the details reach me', net.briefs, 1);

    // With no scheduling link — how it actually ships — the hour is arranged
    // by hand, so the next thing needed is when they are free.
    await page.evaluate(() => showBookingDone({ ref: 'FOX-CN0001', type: 'consult' }, false, null));
    eq('with no link it offers no button to pick a time',
      await page.locator('a.bk-go', { hasText: 'Pick your hour' }).count(), 0);
    ok('and says a time will be agreed instead',
      /Tell me when you are free/.test(await page.textContent('.bk-done')), await page.textContent('.bk-done'));
    ok('asking for a timezone and some times that suit',
      /timezone/.test(await page.textContent('.bk-brief-box')), await page.textContent('.bk-brief-box'));

    // And if a link is ever configured, it takes over.
    await page.evaluate(() => showBookingDone(
      { ref: 'FOX-CN0001', type: 'consult', calendly: 'https://calendly.com/solquicks/secret-hour' }, false, null));
    const pick = page.locator('a.bk-go', { hasText: 'Pick your hour' });
    eq('a configured link is handed over instead', await pick.count(), 1);
    eq('pointing at the event', await pick.getAttribute('href'), 'https://calendly.com/solquicks/secret-hour');
    ok('and it still asks what the call is about', await page.locator('#bk-brief-after').count() > 0);

    // Coming back later with only a reference
    await page.evaluate(() => backToRateCard());
    await page.waitForSelector('#bk-find', { timeout: 10000 });
    await page.fill('#bk-find', 'FOX-AD0001');
    await page.click('.bk-find-row button');
    await page.waitForSelector('#bk-flow .bk-step', { timeout: 10000 });
    ok('an advertiser can find the run they paid for',
      /advertising/.test(await page.textContent('#bk-flow .bk-step')));
    const send = page.locator('button', { hasText: 'Send the artwork' });
    eq('and finish the artwork they never sent', await send.count(), 1);
    await send.click();
    await page.waitForSelector('#ad-url', { timeout: 10000 });
    ok('which opens the same artwork form', true);

    await page.evaluate(() => backToRateCard());
    await page.fill('#bk-find', 'FOX-NOPE99');
    await page.click('.bk-find-row button');
    await page.waitForFunction(() => /no booking/i.test(document.getElementById('bk-find-msg').textContent), null, { timeout: 10000 });
    ok('a reference nobody holds says so plainly', true);
  }

  section('swap: quote');
  await page.click('.nav-quick-btn[data-tab="swap"]');
  await page.waitForFunction(() => document.getElementById('sw-in-token').textContent.trim() === 'SOL');
  await page.click('#wallet-chip');
  await page.click('.wm-option:has-text("Test Wallet")');
  await page.waitForFunction((w) => typeof Wallet !== "undefined" && Wallet.pubkey === w, WALLET);
  ok('the test wallet connects', true);
  await page.waitForFunction(() => /Balance 2 SOL/.test(document.getElementById('sw-bal').textContent), null, { timeout: 10000 });
  ok('the SOL balance is read from the chain', true);

  // an estimate must appear with the keystroke, before any quote comes back
  await page.waitForFunction(() => Object.keys(swapPrices || {}).length > 0, null, { timeout: 10000 });
  await page.fill('#sw-in-amount', '1');
  const instant = await page.evaluate(() => ({
    value: document.getElementById('sw-out-amount').value,
    marked: document.getElementById('sw-out-amount').classList.contains('est')
  }));
  eq('a figure appears the moment an amount is typed', instant.value, '100');
  ok('and is marked as an estimate until the quote lands', instant.marked, JSON.stringify(instant));
  await page.waitForSelector('#sw-detail:not([hidden])', { timeout: 10000 });
  eq('and the real quote replaces it, no longer marked an estimate',
    await page.evaluate(() => document.getElementById('sw-out-amount').classList.contains('est')), false);
  eq('with the quoted amount', await page.inputValue('#sw-out-amount'), '99.8');
  ok('the fee line shows 0.2%', /0\.2%/.test(await page.textContent('#sw-fee')));
  eq('the route is shown', (await page.textContent('#sw-route')).trim(), 'Meteora DLMM');
  ok('Auto slippage shows the value the server picked', /Auto · 0\.5%/.test(await page.textContent('#sw-slip-auto')));
  ok('the swap button is ready', /Swap SOL for USDC/.test(await page.textContent('#sw-go')));
  // Scoped: the same small-print style is used on the store panel too.
  ok('the swap names who routes it', /Jupiter/.test(await page.textContent('#panel-swap .sw-foot')));
  ok('and who is coming', /Titan/.test(await page.textContent('#panel-swap .sw-foot')));

  section('swap: a leaderboard of one says so instead of naming me');
  {
    // The board is on my own site with my own wallet on it. One name reads as
    // nobody is here — and the one name being mine reads as nobody but me,
    // which is worse. The staking board already solved this; this one had not.
    await page.evaluate(() => loadSwapLeaderboard());
    await page.waitForSelector('#sw-board:not([hidden])', { timeout: 10000 });

    const thin = await page.evaluate(() => ({
      list: document.getElementById('sw-board-list').textContent.replace(/\s+/g, ' ').trim(),
      last: document.getElementById('sw-board-last').textContent.trim(),
      prizes: document.getElementById('sw-board-prizes').textContent.trim()
    }));
    ok('one swapper is reported as a count', /1 wallet swapping this week/.test(thin.list), thin.list);
    ok('and nobody is named', !/…/.test(thin.list), thin.list);
    ok('with what it takes to join them', /\$25/.test(thin.list), thin.list);
    eq('last week is not named either, for the same reason', thin.last, '');

    // "1st 500 · 2nd 250 · 3rd 100 Fox Points" reads as money right up to the
    // last two words, next to a column of real dollar amounts.
    ok('the prizes say what they are before they say how much',
      thin.prizes.indexOf('Fox Points') < thin.prizes.indexOf('500'), thin.prizes);

    // Once there is a real race, the names are the point.
    await page.evaluate(() => { net_boardThin(false); return loadSwapLeaderboard(); });
    await page.waitForFunction(() => document.querySelectorAll('#sw-board-list .sw-hrow').length === 3,
      null, { timeout: 10000 });
    const full = await page.evaluate(() => ({
      rows: document.querySelectorAll('#sw-board-list .sw-hrow').length,
      last: document.getElementById('sw-board-last').textContent.trim()
    }));
    eq('three swappers are listed by name', full.rows, 3);
    ok('and last week is named too', /Last week: 1st/.test(full.last), full.last);
    await page.evaluate(() => { net_boardThin(true); return loadSwapLeaderboard(); });
  }

  section('swap: being busy does not become "No route"');
  {
    // The failure people were hitting: Jupiter throttles us, the worker said
    // "no route for that pair right now", and a working swap turned into a
    // dead button with a stale figure still sitting above it.
    const before = await page.inputValue('#sw-out-amount');
    eq('there is a good quote to start from', before, '99.8');

    await page.evaluate(() => net_quoteFail(429));
    await page.evaluate(() => quoteSwap({ auto: true }));
    await page.waitForFunction(() => /Busy for a moment/.test(document.getElementById('sw-msg').textContent),
      null, { timeout: 10000 });

    const during = await page.evaluate(() => ({
      out: document.getElementById('sw-out-amount').value,
      go: document.getElementById('sw-go').textContent.trim(),
      disabled: document.getElementById('sw-go').disabled,
      msg: document.getElementById('sw-msg').textContent
    }));
    eq('a failed refresh keeps the price that was already good', during.out, before);
    ok('the swap can still be taken', !during.disabled && /Swap SOL for USDC/.test(during.go), JSON.stringify(during));
    ok('and it says the figure is from a moment ago rather than crying no route',
      /from \d+s ago/.test(during.msg) && !/no route/i.test(during.msg), during.msg);

    // It retries on its own — which is the refresh people were doing by hand.
    await page.evaluate(() => net_quoteFail(0));
    await page.waitForFunction(() => !/Busy for a moment/.test(document.getElementById('sw-msg').textContent),
      null, { timeout: 15000 });
    eq('and recovers without anyone touching it', await page.inputValue('#sw-out-amount'), '99.8');

    // A brand new amount that cannot be priced is different: there is no good
    // figure to keep, so none must be left lying around.
    await page.evaluate(() => net_quoteFail(429));
    await page.fill('#sw-in-amount', '1.5');
    await page.waitForFunction(() => /Try again/.test(document.getElementById('sw-go').textContent),
      null, { timeout: 10000 });
    const fresh = await page.evaluate(() => ({
      out: document.getElementById('sw-out-amount').value,
      usd: document.getElementById('sw-out-usd').textContent,
      go: document.getElementById('sw-go').textContent.trim()
    }));
    eq('no stale number is left under the error', fresh.out, '');
    eq('nor a stale dollar value', fresh.usd, '');
    eq('and the button says what to do, not that the pair is dead', fresh.go, 'Try again');

    // A genuine refusal still says so plainly.
    await page.evaluate(() => net_quoteFail(502));
    await page.fill('#sw-in-amount', '1.75');
    await page.waitForFunction(() => /No route/.test(document.getElementById('sw-go').textContent),
      null, { timeout: 10000 });
    ok('a pair that really has no route is still called that',
      /no route/i.test(await page.textContent('#sw-msg')), await page.textContent('#sw-msg'));
    eq('with nothing stale above it', await page.inputValue('#sw-out-amount'), '');

    await page.evaluate(() => net_quoteFail(0));
    await page.fill('#sw-in-amount', '1');
    await page.waitForFunction(() => document.getElementById('sw-out-amount').value === '99.8', null, { timeout: 10000 });
    ok('and everything works again afterwards', true);
  }

  section('it can be installed on a phone');
  {
    // A Seeker user should be able to keep this on the home screen, and the
    // dapp store listing wants the same things a manifest declares.
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return null;
      const res = await fetch(link.href);
      return { type: res.headers.get('content-type'), body: await res.json() };
    });
    ok('the page declares a manifest', !!manifest);
    eq('it stands alone rather than opening in a browser tab', manifest.body.display, 'standalone');
    ok('it names itself', /solquicks/i.test(manifest.body.name));
    const sizes = manifest.body.icons.map((i) => i.sizes);
    ok('with the icon sizes a home screen needs', sizes.includes('192x192') && sizes.includes('512x512'), sizes.join(','));
    ok('and one that can be masked to the phone\'s icon shape',
      manifest.body.icons.some((i) => i.purpose === 'maskable'));

    // An icon that 404s leaves a blank square on the home screen.
    const icons = await page.evaluate(async (list) => {
      const out = {};
      for (const src of list) {
        const r = await fetch(new URL(src, location.href).href);
        out[src] = r.status;
      }
      return out;
    }, manifest.body.icons.map((i) => i.src).concat(['icons/apple-touch-icon.png']));
    ok('every icon it points at exists', Object.values(icons).every((c) => c === 200), JSON.stringify(icons));
  }

  section('swap: a slippage refusal offers the fix');
  {
    // The setting that would have let it through is at the bottom of a panel
    // most people never open, so the message carries it.
    const shown = await page.evaluate(() => {
      const msg = document.getElementById('sw-msg');
      msg.textContent = '';
      offerSlippageFix(new Error('Transaction failed: custom program error: 0x1771'));
      const btn = msg.querySelector('.sw-fixbtn');
      return btn ? btn.textContent : null;
    });
    eq('it offers the next step up, not an arbitrary number', shown, 'Allow 1% and re-price');

    const after = await page.evaluate(() => {
      document.querySelector('#sw-msg .sw-fixbtn').click();
      return { slippage: swapSlippage, msg: document.getElementById('sw-msg').textContent };
    });
    eq('pressing it raises the tolerance', after.slippage, 100);
    ok('and says so rather than leaving the error up', /now 1%/.test(after.msg), after.msg);

    // It must not creep past the highest step, and must stay quiet for
    // failures that have nothing to do with slippage.
    const capped = await page.evaluate(() => {
      setSlippage(300);
      const msg = document.getElementById('sw-msg');
      msg.textContent = '';
      offerSlippageFix(new Error('custom program error: 0x1771'));
      const atCap = !!msg.querySelector('.sw-fixbtn');
      msg.textContent = '';
      offerSlippageFix(new Error('User rejected the request'));
      return { atCap, onCancel: !!msg.querySelector('.sw-fixbtn') };
    });
    ok('it stops at the top step', !capped.atCap);
    ok('and says nothing when slippage was not the problem', !capped.onCancel);
    await page.evaluate(() => { setSlippage('auto'); document.getElementById('sw-msg').textContent = ''; });
  }

  section('swap: typing a dollar amount');
  {
    // The box means tokens until asked otherwise — that is the default, and
    // the toggle has to convert rather than reinterpret what is typed.
    eq('it starts in the token, named on the toggle', (await page.textContent('#sw-unit')).trim(), 'SOL');
    await page.fill('#sw-in-amount', '2');
    await page.waitForTimeout(300);
    await page.click('#sw-unit');
    eq('switching to dollars converts what was typed', await page.inputValue('#sw-in-amount'), '200.00');
    eq('and the toggle says so', (await page.textContent('#sw-unit')).trim(), '$');
    await page.waitForFunction(() => /≈ 2 SOL/.test(document.getElementById('sw-in-usd').textContent),
      null, { timeout: 10000 });
    ok('the line below says what that buys', true);

    // $50 of SOL at $100 is half a SOL: the quote must ask for 0.5, not 50.
    await page.fill('#sw-in-amount', '50');
    await page.waitForFunction(() => document.getElementById('sw-detail').hidden === false, null, { timeout: 10000 });
    await page.waitForTimeout(400);
    eq('the quote is priced in tokens, not dollars', net.lastQuoteAmount, '500000000');

    await page.click('#sw-unit');
    eq('switching back shows the token amount', await page.inputValue('#sw-in-amount'), '0.5');
    eq('and the toggle names the token again', (await page.textContent('#sw-unit')).trim(), 'SOL');
    await page.fill('#sw-in-amount', '1');
    await page.waitForTimeout(400);
  }

  section('swap: your swaps list stays short');
  await page.waitForFunction(() => document.querySelectorAll('#sw-history-list .sw-hrow').length > 0, null, { timeout: 10000 });
  const firstFew = await page.evaluate(() => ({
    rows: document.querySelectorAll('#sw-history-list .sw-hrow').length,
    button: document.getElementById('sw-history-more').textContent,
    hidden: document.getElementById('sw-history-more').hidden
  }));
  eq('only the most recent five are listed', firstFew.rows, 5);
  eq('with a way to see the rest', firstFew.button, 'Show all 9 swaps');
  await page.click('#sw-history-more');
  const opened = await page.evaluate(() => ({
    rows: document.querySelectorAll('#sw-history-list .sw-hrow').length,
    button: document.getElementById('sw-history-more').textContent
  }));
  eq('opening it shows them all', opened.rows, 9);
  eq('and offers to collapse again', opened.button, 'Show fewer');
  await page.click('#sw-history-more');
  eq('collapsing goes back to five', await page.evaluate(() => document.querySelectorAll('#sw-history-list .sw-hrow').length), 5);

  section('swap: token picker hides worthless spam');
  await page.click('#sw-in-token');
  await page.waitForSelector('.sw-result-sym');
  eq('with a mouse, the search box takes focus so you can type straight away',
    await page.evaluate(() => document.activeElement && document.activeElement.id), 'sw-search');
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

  section('Fox Points: a board of two, both of them mine');
  {
    // Same rule as the swap and staking boards. Two names reads as nobody is
    // here; two names that both belong to the site owner reads as nobody but
    // him, which is worse than no board.
    await page.evaluate(() => switchTab('leaderboard'));
    await page.evaluate(() => { net_players(2); return renderLeaderboard(); });
    await page.waitForFunction(() => /earning so far/.test(document.getElementById('lb-table').textContent),
      null, { timeout: 10000 });
    const thin = (await page.textContent('#lb-table')).replace(/\s+/g, ' ').trim();
    ok('two players are reported as a count', /earning so far/.test(thin), thin);
    ok('and nobody is named', !/…/.test(thin), thin);

    await page.evaluate(() => { net_players(4); return renderLeaderboard(); });
    await page.waitForFunction(() => document.querySelectorAll('#lb-table .lb-table-row').length >= 3,
      null, { timeout: 10000 });
    ok('four players are listed by name',
      (await page.locator('#lb-table .lb-table-row').count()) >= 3);

    await page.evaluate(() => { net_players(0); return renderLeaderboard(); });
    await page.waitForFunction(() => /Be the first fox/.test(document.getElementById('lb-table').textContent),
      null, { timeout: 10000 });
    ok('and an empty board invites the first one', true);
    await page.evaluate(() => { net_players(2); });
  }

  section('wallet cleanup: what burning an NFT actually gives back');
  {
    // The page used to say "about 0.002 SOL". A token account's rent-exempt
    // minimum is 0.00148844 today, and one created before Solana reduced rent
    // holds 0.00203928 — so a single quoted figure is right for some accounts
    // and a third too high for others. It is the number somebody weighs
    // against an NFT before destroying it irreversibly, and the real one is
    // already shown against each row.
    await page.evaluate(() => switchTab('cleanup'));
    const note = (await page.textContent('#cl-nft-note')).replace(/\s+/g, ' ');
    ok('no single figure is quoted for what rent comes back', !/0\.002/.test(note), note);
    ok('it points at the amount shown against each one', /shown against each one/.test(note), note);
    ok('and still says destroying is permanent', /destroying it/.test(note), note);
  }

  section('wallet cleanup: the reclaim button comes back');
  await page.click('#nav-trigger');
  await page.click('.nav-item[data-tab="cleanup"]');
  await page.click('#cl-scan');
  await page.waitForFunction(() => {
    const b = document.getElementById('cl-close-btn');
    return b && !b.hidden && /Close 3/.test(b.textContent);
  }, null, { timeout: 15000 });
  eq('three dead accounts offer their rent back', await page.evaluate(() => document.getElementById('cl-close-btn').disabled), false);

  // closing them: the wallet signs, then the page scans again and finds one more
  net.emptyAccounts = 1;
  await page.click('#cl-close-btn');
  await page.waitForFunction(() => /Close 1/.test(document.getElementById('cl-close-btn').textContent), null, { timeout: 25000 });
  const after = await page.evaluate(() => ({
    disabled: document.getElementById('cl-close-btn').disabled,
    label: document.getElementById('cl-close-btn').textContent,
    message: (document.getElementById('cl-msg') || {}).textContent
  }));
  // this is the bug the page shipped with: rent was visible but the button was dead
  eq('the button is usable again for the rent that is left', after.disabled, false);
  ok('and offers the remaining account', /Close 1 and reclaim/.test(after.label), after.label);
  ok('with the closure confirmed', /Closed 3 accounts/.test(after.message), after.message);
  net.emptyAccounts = 3;

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

  section('swap on a phone: the keyboard stays down until you ask for it');
  {
    // A touch device with no hover: the picker must show the list, not throw a
    // keyboard over it. The tokens someone already holds are the whole point
    // of that first screen.
    const touch = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3
    });
    await standIns(touch);
    await touch.addInitScript(testWallet, WALLET);
    const phone = await touch.newPage();
    phone.on('pageerror', (e) => pageErrors.push('[phone] ' + e.message));
    await phone.goto(SITE + '#swap', { waitUntil: 'domcontentloaded' });
    await phone.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });
    await phone.waitForSelector('#sw-in-token', { state: 'visible', timeout: 20000 });
    await phone.tap('#sw-in-token');
    await phone.waitForSelector('.sw-result-sym');

    const focused = await phone.evaluate(() => document.activeElement && document.activeElement.id);
    ok('opening the picker does not focus the search box', focused !== 'sw-search', 'focus was on ' + focused);
    ok('the tokens you hold are on screen instead',
      (await phone.$$eval('#sw-results .sw-result-sym', (els) => els.map((e) => e.textContent))).length > 0);

    // Tapping it must still work — this is about not doing it uninvited.
    //
    // Clicked rather than tapped. Playwright's synthetic tap does not move
    // focus to an input in Chromium, where a real touch does: that is the
    // browser's own gesture handling, not anything this page controls. Tapping
    // here only ever proved what Playwright does, and it proved it differently
    // depending on where the element happened to sit on the page.
    await phone.tap('#sw-search');
    await phone.click('#sw-search');
    eq('tapping the box still focuses it',
      await phone.evaluate(() => document.activeElement && document.activeElement.id), 'sw-search');
    // The thing that would actually break: code that blurs the box back after
    // the fix for not focusing it uninvited.
    await phone.waitForTimeout(250);
    eq('and nothing takes the focus back off it',
      await phone.evaluate(() => document.activeElement && document.activeElement.id), 'sw-search');
    await touch.close();
  }

  section('the fee-account page points the rent at tokens swapped here');
  {
    // Each fee account costs real rent, and the site's own swappers are not
    // Solana's top fifty. The page must show what is traded here first.
    const fees = await context.newPage();
    fees.on('pageerror', (e) => pageErrors.push('[fees] ' + e.message));
    await fees.goto(SITE + 'fees.html', { waitUntil: 'domcontentloaded' });
    await fees.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });

    // Every mint is a real token mint; no fee account exists yet except USDC's.
    const derived = await fees.evaluate((mints) => {
      const out = {};
      for (const m of mints) out[m] = feeAccountFor(m).toBase58();
      return out;
    }, [USDC, WIF, BONK]);
    const mintAccount = { lamports: 1e9, owner: TOKEN_PROGRAM, data: ['', 'base64'], executable: false, rentEpoch: 0 };
    net.accounts = {};
    for (const m of [USDC, WIF, BONK, RAY]) net.accounts[m] = mintAccount;
    net.accounts[derived[USDC]] = { lamports: 2039280, owner: TOKEN_PROGRAM, data: ['', 'base64'], executable: false, rentEpoch: 0 };

    await fees.click('#connect');            // connecting runs the check itself
    await fees.waitForSelector('#table-wrap table tbody tr', { timeout: 20000 });

    const table = await fees.$$eval('#table-wrap tbody tr', (trs) => trs.map((tr) => ({
      symbol: tr.children[1].textContent.trim(),
      here: tr.children[4].textContent.trim(),
      done: /collecting/.test(tr.children[3].textContent)
    })));
    eq('the most-swapped token here is listed first', table[0].symbol, 'BONK');
    eq('with how often it was swapped', table[0].here, '9×');
    eq('then the next one swapped here', table[1].symbol, 'WIF');
    eq('and a token nobody here has swapped comes after', table[2].symbol, 'USDC');
    eq('one that already collects is marked, not offered', table[2].done, true);

    // Ticking is what spends the money, so it must have a reason behind it.
    const ticks = await fees.$$eval('#table-wrap tbody tr', (trs) => trs.map((tr) => ({
      symbol: tr.children[1].textContent.trim(),
      ticked: !!tr.querySelector('input.pick:checked'),
      offered: !!tr.querySelector('input.pick')
    })));
    const tickedNow = ticks.filter((t) => t.ticked).map((t) => t.symbol).sort();
    eq('the tokens swapped here are ticked', tickedNow.join(','), 'BONK,WIF');
    ok('and nothing else is', ticks.every((t) => t.ticked === (t.symbol === 'BONK' || t.symbol === 'WIF')));

    const logged = await fees.textContent('#log');
    ok('the page names the ones that would pay their rent back', /BONK/.test(logged) && /pay their rent back/.test(logged), logged);
    ok('and no longer says a human has to be told about it', !/Tell Claude/.test(await fees.content()));
    ok('it says the worker picks them up by itself', /15 minutes/.test(await fees.content()));
    ok('the wallet it connected is named, with a way to change it',
      /Use another wallet/.test(await fees.content()));
    ok('and that the rent cannot be got back', /cannot get it back/.test(await fees.content()));

    // xStocks: the busy ones only, because most of the 101 barely trade and
    // rent spent on a token nobody swaps is gone.
    const xs = JSON.parse(fs.readFileSync(path.join(ROOT, 'xstocks.json'), 'utf8'));
    const busy = xs.tokens.filter((t) => t.busy);
    ok('every xStock in the file is a Backed one', xs.tokens.every((t) => t.mint.startsWith('Xs')));
    // A mint asked for by name is a reason of its own: SOL is in neither list
    // here, so it can only be ticked because it was typed in.
    net.accounts[SOL] = mintAccount;
    await fees.fill('#extra', SOL);
    await fees.click('#check');
    await fees.waitForFunction(() => !document.getElementById('check').disabled, null, { timeout: 20000 });
    const withPasted = await fees.$$eval('#table-wrap tbody tr', (trs) => trs.map((tr) => ({
      symbol: tr.children[1].textContent.trim(), ticked: !!tr.querySelector('input.pick:checked')
    })));
    const pastedRow = withPasted.find((t) => t.symbol.startsWith('So11') || t.symbol === 'SOL');
    ok('a mint typed in by hand is ticked', pastedRow && pastedRow.ticked, JSON.stringify(withPasted));
    await fees.fill('#extra', '');

    await fees.click('#xs-busy');
    await fees.waitForFunction(() => document.getElementById('extra').value.length > 0, null, { timeout: 10000 });
    const pasted = await fees.inputValue('#extra');
    eq('the busy xStocks are filled in, not all 101', pasted.split('\n').filter(Boolean).length, busy.length);
    net.accounts[busy[0].mint] = mintAccount;
    await fees.click('#check');
    await fees.waitForFunction(() => !document.getElementById('check').disabled, null, { timeout: 30000 });
    const symbols = await fees.$$eval('#table-wrap tbody tr', (trs) => trs.map((tr) => tr.children[1].textContent.trim()));
    ok('an xStock is listed by its ticker, not the first four characters of its mint',
      symbols.includes(busy[0].symbol), symbols.join(','));
    ok('and they are the ones that trade', pasted.includes(busy[0].mint));
    await fees.click('#xs-busy');
    eq('pressing it twice does not double them up',
      (await fees.inputValue('#extra')).split('\n').filter(Boolean).length, busy.length);
    // The ranking decides the order the budget is spent in, so it has to be
    // the metric asked for and not whatever the list arrived sorted by.
    eq('the column is named after the ranking',
      (await fees.$$eval('#table-wrap thead th', (th) => th.map((e) => e.textContent.trim()))).pop(),
      'Busiest — 24h volume');
    // Changing the ranking re-runs the whole check, which reads the chain. The
    // header and the rows are written separately and the read takes a while,
    // so both are waited for; and the menu is waited for too, because it is
    // disabled while the read runs and a change made in that window used to be
    // swallowed. CI is slow enough to land in exactly that window.
    const rowsNow = () => fees.$$eval('#table-wrap tbody tr', (trs) => trs.map((tr) => tr.children[1].textContent.trim()));
    const ready = () => fees.waitForFunction(
      () => !document.getElementById('rank').disabled && !document.getElementById('check').disabled,
      null, { timeout: 30000 });
    const rankBy = async (rank, heading, was) => {
      await ready();
      await fees.selectOption('#rank', rank);
      await fees.waitForFunction(([h, w]) =>
        new RegExp(h).test(document.querySelector('#table-wrap thead').textContent) &&
        [...document.querySelectorAll('#table-wrap tbody tr')].map((tr) => tr.children[1].textContent.trim()).join(',') !== w,
        [heading, was], { timeout: 30000 });
      return rowsNow();
    };

    const before = (await rowsNow()).join(',');
    const byMcap = await rankBy('mcap', 'Biggest', before);
    // BONK and WIF are swapped here so they lead whatever the ranking. Of the
    // rest, USDC is the busiest by far and RAY barely trades, but RAY is
    // worth five thousand times more — so by market cap RAY must come first.
    ok('ranking by market cap reorders the rest',
      byMcap.includes('RAY') && byMcap.indexOf('RAY') < byMcap.indexOf('USDC'), byMcap.join(','));
    eq('and the figures shown are market caps',
      (await fees.$$eval('#table-wrap tbody tr', (trs) => trs.map((tr) => tr.children[5].textContent.trim())))[byMcap.indexOf('USDC')],
      '$1,000');
    const byVol = await rankBy('volume', 'Busiest', byMcap.join(','));
    ok('and switching back puts the busiest in front again',
      byVol.includes('RAY') && byVol.indexOf('USDC') < byVol.indexOf('RAY'), byVol.join(','));

    // The menu cannot be changed while the read it started is still running.
    // It used to stay live, and a change made then clicked a disabled button
    // and did nothing — the ranking said one thing and the table showed
    // another, with nothing on screen to say why.
    await ready();
    await fees.selectOption('#rank', 'mcap');
    eq('the ranking is held while it is being applied',
      await fees.evaluate(() => document.getElementById('rank').disabled), true);
    await ready();
    eq('and is offered again once the table has caught up',
      await fees.evaluate(() => document.getElementById('rank').disabled), false);

    // Filling a rent budget: ticks the busiest that can be created, and a
    // token the program refuses must not eat a slot in the budget.
    await fees.click('.ghost#none');
    await fees.fill('#budget', '0.0030');          // exactly two at the real rent
    await fees.click('#fill');
    await fees.waitForFunction(() => /ticked — about/.test(document.getElementById('log').textContent),
      null, { timeout: 30000 });
    const filled = await fees.$$eval('#table-wrap input.pick:checked', (e) => e.length);
    eq('the budget decides how many are ticked', filled, 2);
    ok('costed at the rent the chain charges, not a guess',
      /0\.0030 SOL of rent/.test(await fees.textContent('#log')), (await fees.textContent('#log')).slice(-160));
    await fees.click('.ghost#none');

    // A mint the referral program cannot read — every xStock, today — has to
    // be found by simulation and dropped, not discovered when the wallet is
    // already open. One of them used to fail the whole batch.
    net.simFail = true;
    await fees.click('#check');
    await fees.waitForFunction(() => /refused by the referral program/.test(document.getElementById('log').textContent),
      null, { timeout: 30000 });
    const refusedLog = await fees.textContent('#log');
    ok('a refusal is explained, not just reported', /newer Token-2022 extensions/.test(refusedLog), refusedLog.slice(-200));
    // Two refusals for the same reason are one line, not two: a wall of
    // identical red lines reads as a wall of separate problems.
    eq('identical refusals are grouped',
      (refusedLog.match(/cannot be created — Jupiter/g) || []).length, 1);
    const grouped = refusedLog.match(/(\d+) tokens cannot be created — ([^\n]*?)\s{2,}([^\n]+?)(?:\d|$)/);
    ok('the grouped line says how many, and names them',
      grouped && Number(grouped[1]) === grouped[3].split(',').length,
      JSON.stringify(grouped && grouped.slice(1)));
    eq('nothing is left ticked', await fees.$$eval('#table-wrap input.pick:checked', (e) => e.length), 0);
    eq('and the create button is off', await fees.evaluate(() => document.getElementById('create').disabled), true);
    net.simFail = false;

    await fees.click('#xs-all');
    await fees.waitForFunction((n) => document.getElementById('extra').value.split('\n').filter(Boolean).length === n,
      xs.tokens.length, { timeout: 10000 }).catch(() => {});
    eq('the other button offers the whole set',
      (await fees.inputValue('#extra')).split('\n').filter(Boolean).length, xs.tokens.length);
    await fees.close();
  }

  section('invite: the link, and what it honestly says it pays');
  {
    // Signed out, neither card means anything.
    await page.evaluate(() => switchTab('leaderboard'));
    eq('signed out there is no invite card',
      await page.evaluate(() => document.getElementById('iv-card').hidden), true);

    // Stand in a session. The page only ever asks whether it has a token.
    await page.evaluate(() => { FoxPoints.token = 'test-session'; return loadInvite(); });
    await page.waitForSelector('#iv-card', { state: 'visible', timeout: 10000 });

    eq('the link is this site, carrying the code',
      await page.evaluate(() => document.getElementById('iv-link').value),
      (await page.evaluate(() => location.origin + location.pathname)) + '?r=FOX-MINE');

    const lead = await page.textContent('#iv-lead');
    ok('the rate is stated up front', /20% of the swap fee/.test(lead), lead);
    ok('and says what a Ranger would earn instead', /goes up to 50%/.test(lead), lead);

    // Invited, and how many of those actually swapped. The gap between the two
    // is the only honest measure of whether any of this is working.
    const stats = await page.$$eval('.iv-stat',
      (els) => els.map((e) => e.querySelector('b').textContent + ' ' + e.querySelector('span').textContent));
    eq('how many arrived', stats[0], '6 Invited');
    eq('and how many of them actually swapped', stats[1], '2 Swapped');
    eq('and what that earned', stats[2], '$2.40 Earned');

    // The honest bit. A dashboard that implies money is coming, at a volume
    // where it is not, is the thing that loses trust.
    const claim = await page.textContent('#iv-claim');
    ok('a balance under the floor says what it is rather than offering a button',
      /\$2\.40 so far/.test(claim), claim);
    eq('and the button cannot be pressed',
      await page.evaluate(() => document.getElementById('iv-claim-btn').disabled), true);
    ok('with the floor named', /\$10/.test(claim), claim);
    ok('and it says plainly that signups pay nothing',
      /Nothing is paid for a signup/.test(claim), claim);

    // Over the floor.
    await page.evaluate(async () => {
      await net_setInvite({ available: 42.5, earned: 42.5, claimable: true });
      return loadInvite();
    });
    await page.waitForFunction(() => /Claim/.test(document.getElementById('iv-claim').textContent), null, { timeout: 10000 });
    eq('over the floor the button offers the amount',
      (await page.textContent('#iv-claim-btn')).trim(), 'Claim $42.50');
    await page.click('#iv-claim-btn');
    await page.waitForFunction(() => /queued/.test(document.getElementById('iv-msg').textContent), null, { timeout: 10000 });
    ok('claiming says it is paid by hand rather than pretending it is instant',
      /by hand/.test(await page.textContent('#iv-msg')), await page.textContent('#iv-msg'));
    await page.waitForFunction(() => /queued for payment/.test(document.getElementById('iv-claim').textContent), null, { timeout: 10000 });
    ok('and the card then shows it as queued',
      /\$42\.50 is queued/.test(await page.textContent('#iv-claim')), await page.textContent('#iv-claim'));

    // Signing out takes one wallet's earnings off the screen with it.
    await page.evaluate(() => FoxPoints.clearToken());
    eq('signing out hides the card',
      await page.evaluate(() => document.getElementById('iv-card').hidden), true);
  }

  section('invite: arriving on somebody else\'s link');
  {
    // The whole point: the code arrives long before there is a wallet to tie
    // it to, and has to survive the gap.
    await page.goto(SITE + '?r=fox-good', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });

    eq('the code is kept for when a wallet shows up',
      await page.evaluate(() => localStorage.getItem('fox_invite_code')), 'FOX-GOOD');
    ok('and taken out of the address bar, so it is not passed on by accident',
      !/[?&]r=/.test(await page.evaluate(() => location.href)), await page.evaluate(() => location.href));

    await page.evaluate(async () => {
      await net_setInvite({ invitedBy: null });
      switchTab('leaderboard');
      FoxPoints.token = 'test-session';
      return loadInvite();
    });
    await page.waitForSelector('#iv-card', { state: 'visible', timeout: 10000 });
    await page.waitForFunction(
      () => document.getElementById('iv-enter-card').hidden === true, null, { timeout: 10000 });

    eq('connecting a wallet binds it on its own',
      await page.evaluate(async () => (await net_invite()).invitedBy), 'FOX-GOOD');
    eq('and the kept code is used up', await page.evaluate(() => localStorage.getItem('fox_invite_code')), null);
    eq('so the box asking for one is gone',
      await page.evaluate(() => document.getElementById('iv-enter-card').hidden), true);
  }

  section('invite: typing a code in by hand');
  {
    await page.evaluate(async () => {
      localStorage.removeItem('fox_invite_code');
      await net_setInvite({ invitedBy: null });
      switchTab('leaderboard');
      FoxPoints.token = 'test-session';
      return loadInvite();
    });
    await page.waitForSelector('#iv-enter-card', { state: 'visible', timeout: 10000 });
    ok('the box says what using a code is worth',
      /250 Fox Points on your first swap of \$50/.test(await page.textContent('#iv-enter-lead')),
      await page.textContent('#iv-enter-lead'));

    await page.fill('#iv-code', 'FOX-MINE');
    await page.click('#iv-enter-card .iv-copy');
    await page.waitForFunction(() => /own code/.test(document.getElementById('iv-enter-msg').textContent), null, { timeout: 10000 });
    ok('your own code is refused, and says so',
      /own code/.test(await page.textContent('#iv-enter-msg')));
    eq('and the box stays open', await page.evaluate(() => document.getElementById('iv-enter-card').hidden), false);

    await page.fill('#iv-code', 'nonsense');
    await page.click('#iv-enter-card .iv-copy');
    await page.waitForFunction(() => /no such code/.test(document.getElementById('iv-enter-msg').textContent), null, { timeout: 10000 });

    await page.fill('#iv-code', 'fox-good');
    await page.click('#iv-enter-card .iv-copy');
    await page.waitForFunction(() => document.getElementById('iv-enter-card').hidden === true, null, { timeout: 10000 });
    eq('a good one is accepted, however it is typed',
      await page.evaluate(async () => (await net_invite()).invitedBy), 'FOX-GOOD');
  }

  section('the pages that are not open yet');
  {
    // Four revenue lines with a tab each. A page that is coming should look
    // considered, not like one that failed to load — and it has to say what it
    // will be, or the tab is just a dead end with a nice border.
    for (const [tab, lead, mustSay] of [
      ['defi', 'DeFi', /same wallet you swap with/],
      ['wishlist', 'Wishlist', /without a card/],
      ['mine', 'Mine Bitcoin', /no rig, no electricity bill/],
      ['travel', 'Travel', /Flights and stays/],
      // Deliberately generic: there are too many projects worth building this
      // with to name one before it is decided.
      ['games', 'Games', /still open/],
      // Money and chance in the same sentence: whatever the machine ends up
      // being, the page must not imply the odds are a surprise.
      ['gacha', 'Gacha', /odds will be written down before anyone spends/]
    ]) {
      await page.evaluate((t) => switchTab(t), tab);
      await page.waitForSelector('#panel-' + tab + '.active', { timeout: 10000 });
      const panel = page.locator('#panel-' + tab);
      eq(tab + ': the page opens', await panel.locator('.soon').count(), 1);
      eq(tab + ': and is headed with what it will be',
        (await panel.locator('.soon-lead').textContent()).trim(), lead);
      ok(tab + ': says plainly that it is not open',
        /coming soon/i.test(await panel.locator('.soon-tag').textContent()));
      const what = await panel.locator('.soon-what').textContent();
      ok(tab + ': and explains it rather than leaving a blank page', mustSay.test(what), what);
      ok(tab + ': with nothing pretending to work', await panel.locator('button, input, a').count() === 0);
    }

    // A page that names who it is being built with reads as a plan. The same
    // page without it reads as a wish — and three of these had real partners
    // going uncredited.
    const credited = [
      ['mine', ['Sat Rush']],
      ['travel', ['Nomadz']],
      ['wishlist', ['sp3nd']],
      // Two, which is why the credit is a list rather than a single name.
      ['gacha', ['Slabz', 'Collector Crypt']]
    ];
    for (const [tab, names] of credited) {
      await page.evaluate((t) => switchTab(t), tab);
      await page.waitForSelector('#panel-' + tab + '.active', { timeout: 10000 });
      const sel = '#panel-' + tab + ' ';
      eq(tab + ': credits them under one heading',
        (await page.textContent(sel + '.soon-with-head')).trim(), 'Built with');
      eq(tab + ': names ' + names.join(' and '),
        await page.$$eval(sel + '.soon-partner b', (e) => e.map((x) => x.textContent.trim())).then((n) => n.join(',')),
        names.join(','));
      for (const n of names) {
        eq(tab + ': says ' + n + ' once, not twice',
          (await page.textContent(sel + '.soon-what')).includes(n), false);
      }
    }

    // A mark does what a name cannot: it is the difference between a page that
    // claims a partner and one that visibly has one.
    const marks = [
      ['mine', 'Sat Rush'], ['gacha', 'Slabz'], ['gacha', 'Collector Crypt'],
      ['travel', 'Nomadz'], ['wishlist', 'sp3nd']
    ];
    for (const [tab, name] of marks) {
      await page.evaluate((t) => switchTab(t), tab);
      await page.waitForSelector('#panel-' + tab + '.active', { timeout: 10000 });
      // The marks are lazy, so they load when the panel is opened rather than
      // with the page. Waiting is the point: what matters is that it arrives.
      await page.waitForFunction((who) => {
        const rows = [...document.querySelectorAll('.soon-partner')];
        const row = rows.find((r) => (r.querySelector('b') || {}).textContent === who);
        const img = row && row.querySelector('img.soon-logo');
        return !img || img.complete;
      }, name, { timeout: 15000 }).catch(() => {});
      const shown = await page.$$eval('#panel-' + tab + ' .soon-partner', (rows, who) => {
        const row = rows.find((r) => (r.querySelector('b') || {}).textContent === who);
        const img = row && row.querySelector('img.soon-logo');
        if (!img) return { there: false };
        return {
          there: true,
          // naturalWidth is 0 for an image that failed to load, so this is the
          // difference between the markup being right and the file being there.
          loaded: img.complete && img.naturalWidth > 0,
          src: img.getAttribute('src'),
          alt: img.getAttribute('alt')
        };
      }, name);
      ok(tab + ': ' + name + ' shows its mark', shown.there);
      ok(tab + ': and the file behind it really loads', shown.loaded, JSON.stringify(shown));
      ok(tab + ': served from our own repo, not somebody else\'s host',
        /^img\/partners\//.test(shown.src || ''), shown.src);
      // The name is right beside it, so reading the logo out as well would say
      // everything twice.
      eq(tab + ': and is not read out twice to a screen reader', shown.alt, '');
    }

    // Driven off the data rather than off the list above, so a mark added
    // later with a typo in its path is caught here instead of by whoever
    // opens the page and sees a broken image next to a partner's name.
    const declared = await page.evaluate(() => SOON_TABS.flatMap(
      (t) => (t.partners || []).filter((p) => p.logo).map((p) => t.tab + ' ' + p.name + ' ' + p.logo)));
    ok('every mark the data declares is accounted for', declared.length >= 3, declared.join(' | '));
    for (const row of declared) {
      const file = row.split(' ').pop();
      ok('the file for ' + row.split(' ').slice(0, -1).join(' ') + ' is in the repo',
        fs.existsSync(path.join(ROOT, file)), file);
    }

    // A partner named before their mark arrives must still be credited — a
    // missing logo cannot take the credit down with it. Every partner has one
    // today, so this asks the function directly rather than quietly losing the
    // case: the next one named will land here before their logo does.
    const noMark = await page.evaluate(() => soonHtml('Test', 'what', [{ name: 'Nobody', what: 'a line' }]));
    ok('a partner with no mark yet is still credited', /Nobody/.test(noMark), noMark);
    ok('with their line intact', /a line/.test(noMark), noMark);
    ok('and no broken image where the mark would go', !/<img/.test(noMark), noMark);

    // And the other half of it: a mark with no line is drawn without an empty
    // space where the words would be. Slabz and Collector Crypt are both this
    // today, waiting on a sentence from them.
    const noLine = await page.evaluate(() => soonHtml('Test', 'what', [{ name: 'Nobody', logo: 'img/partners/slabz.jpg' }]));
    ok('a mark with no line yet still draws', /<img/.test(noLine), noLine);
    ok('and leaves no empty line behind it', !/<span>/.test(noLine), noLine);

    // The two with nobody to name yet must not grow an empty credit box.
    for (const tab of ['defi', 'games']) {
      await page.evaluate((t) => switchTab(t), tab);
      eq(tab + ': has no partner line, having no partner', await page.locator('#panel-' + tab + ' .soon-with').count(), 0);
    }

    // The badge is how anyone reaches the Launchpad, and it is on every page
    // of every site built from this template — which is the whole plan for
    // how the next creator finds it.
    await page.evaluate(() => switchTab('links'));
    const badge = page.locator('#powered');
    ok('the badge is on the page', await badge.count() === 1);
    ok('and visible without opening anything', await badge.isVisible());
    eq('it names what built the site', (await page.textContent('#powered-name')).trim(), 'solquicks');
    ok('under a "powered by" line', /powered by/i.test(await page.textContent('.powered-by')));

    // "Powered by" is a credit: it says who made this and nothing about what
    // to do next. The invitation is the half that does the work.
    ok('and it invites you to make one too', await page.locator('#powered-cta').isVisible());
    eq('saying so plainly', (await page.textContent('#powered-cta')).trim(), 'Launch your own website');
    eq('with the credit still above it', await page.evaluate(() => {
      const a = document.querySelector('.powered-top').getBoundingClientRect();
      const b = document.getElementById('powered-cta').getBoundingClientRect();
      return a.bottom <= b.top + 1;
    }), true);

    // A site that should carry the credit without the invitation.
    eq('a site can wear the credit without the invitation', await page.evaluate(() => {
      const was = LAUNCHPAD.cta;
      LAUNCHPAD.cta = null;
      const cta = document.getElementById('powered-cta');
      cta.textContent = LAUNCHPAD.cta || '';
      cta.hidden = !LAUNCHPAD.cta;
      const gone = cta.hidden;
      LAUNCHPAD.cta = was;
      cta.textContent = was; cta.hidden = false;
      return gone;
    }), true);

    // It sits in the same corner as the back-to-top button, which was there
    // first. One must not be sitting on top of the other.
    const corner = await page.evaluate(() => {
      const t = document.getElementById('back-to-top');
      t.classList.add('visible');
      const a = document.getElementById('powered').getBoundingClientRect();
      const b = t.getBoundingClientRect();
      t.classList.remove('visible');
      return { overlap: !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top),
               inView: a.right <= window.innerWidth + 1 && a.bottom <= window.innerHeight + 1 };
    });
    ok('it does not sit on top of the back-to-top button', !corner.overlap);
    ok('and stays on the screen', corner.inView);

    // Fixed to the corner, so at the bottom of a page it lands on whatever is
    // there. The footer is centred and nearly full width on a phone, which is
    // exactly the width that runs underneath it.
    const clears = async () => page.evaluate(async () => {
      // The page scrolls smoothly, so scrollTo animates. Measuring straight
      // after it was measuring the footer part-way down — which is why this
      // check passed or failed depending on how busy the machine was. Jump
      // instead, and wait for the position to actually stop changing.
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
      for (let last = -1; last !== window.scrollY;) {
        last = window.scrollY;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      const t = document.getElementById('back-to-top');
      t.classList.add('visible');
      // The line itself, not the footer box — that box includes the padding
      // put there precisely so the text clears the corner.
      const f = document.querySelector('.footer-line').getBoundingClientRect();
      const hits = ['#powered', '#back-to-top'].filter((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return !(f.right < r.left || r.right < f.left || f.bottom < r.top || r.bottom < f.top);
      });
      t.classList.remove('visible');
      return hits;
    });
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(300);
    eq('on a phone the footer scrolls clear of the corner', (await clears()).join(','), '');
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(300);
    eq('and on a desktop too', (await clears()).join(','), '');

    // It has to go to the Launchpad from whatever page you were on.
    eq('it points at the Launchpad', await page.locator('#powered').getAttribute('href'), 'launch.html');

    // A link straight to one of them has to work: these get shared before the
    // page behind them exists, which is rather the point of having them.
    await page.goto(SITE + '#wishlist', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });
    ok('a direct link to one of them opens it',
      await page.evaluate(() => document.getElementById('panel-wishlist').classList.contains('active')));
  }

  section('referrals: says it is coming until it has something to show');
  {
    // The real file ships empty, so this is the state a visitor sees today:
    // the tab is there and says so, rather than disappearing.
    eq('with nothing in the file the tab is still in the menu',
      await page.evaluate(() => document.getElementById('nav-referrals').hidden), false);
    await page.evaluate(() => switchTab('referrals'));
    await page.waitForSelector('#panel-referrals.active', { timeout: 10000 });
    ok('and the page says it is coming', await page.locator('#ref-list .soon').count() === 1);
    ok('naming what it will be, not just that it is empty',
      /referral credit/.test(await page.textContent('#ref-list .soon-what')),
      await page.textContent('#ref-list .soon-what'));
    eq('with the introduction held back until there is something to introduce',
      await page.evaluate(() => document.getElementById('ref-intro').hidden), true);

    // Now stand in a populated file, including one entry that should never
    // become a link.
    await page.route('**/referrals.json', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [
        { name: 'Example Exchange', tag: 'Trading', logo: 'img/referrals/nothing-here.png',
          url: 'https://example.com/join?ref=fox',
          what: 'Spot and perps, on and off Solana.',
          youGet: '10% off fees for 30 days', cta: 'Join with my link' },
        { name: 'No Link Here', url: 'javascript:alert(1)', what: 'Should never be clickable.' },
        { name: 'Missing Everything' }   // no url — dropped entirely
      ] })
    }));
    await page.evaluate(() => loadReferrals());
    await page.waitForFunction(() => document.querySelectorAll('#ref-list .ref-card').length > 0, null, { timeout: 10000 });

    eq('a populated file replaces the notice with the real thing',
      await page.locator('#ref-list .soon').count(), 0);
    eq('and brings the introduction back',
      await page.evaluate(() => document.getElementById('ref-intro').hidden), false);
    eq('an entry with no link is left out entirely',
      await page.evaluate(() => document.querySelectorAll('#ref-list .ref-card').length), 2);

    await page.click('#nav-trigger').catch(() => {});
    await page.evaluate(() => switchTab('referrals'));
    await page.waitForSelector('#panel-referrals.active', { timeout: 10000 });

    const card = await page.evaluate(() => {
      const c = document.querySelector('#ref-list .ref-card');
      const a = c.querySelector('.ref-go');
      return {
        name: c.querySelector('.ref-name').textContent,
        tag: c.querySelector('.ref-tag').textContent,
        what: c.querySelector('.ref-what').textContent,
        get: c.querySelector('.ref-get').textContent,
        href: a.getAttribute('href'),
        rel: a.getAttribute('rel'),
        cta: a.textContent.trim()
      };
    });
    eq('the platform is named', card.name, 'Example Exchange');
    eq('and labelled', card.tag, 'Trading');
    eq('what it does is shown', card.what, 'Spot and perps, on and off Solana.');
    eq('and what the visitor gets', card.get, 'You get: 10% off fees for 30 days');
    eq('the link is the referral link', card.href, 'https://example.com/join?ref=fox');
    eq('its own wording is used for the button', card.cta, 'Join with my link →');

    // These links are paid placement. Saying so to the browser costs nothing
    // and is the same thing the page says to the reader.
    ok('declared to the browser as sponsored', /sponsored/.test(card.rel), card.rel);
    ok('and opened without handing over the referrer', /noopener/.test(card.rel), card.rel);

    // A data file is still data. A javascript: URL in it would run as this
    // page the moment somebody clicked the button.
    eq('a javascript: URL in the data file never becomes a link',
      await page.evaluate(() => document.querySelectorAll('#ref-list .ref-card')[1].querySelector('.ref-go').getAttribute('href')), '#');

    // A logo that 404s, and one that was never given, both land on a letter
    // tile rather than a blank square that looks like a broken image.
    //
    // Read in one go rather than a count and then two lookups: switching to
    // this tab re-runs loadReferrals, which rebuilds the list, and a slower
    // machine lands between the count and the reads. That is what it did in
    // CI while passing here.
    const initials = await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('#ref-list .ref-card')];
      if (cards.length !== 2) return false;
      const marks = cards.map((c) => c.querySelector('.ref-initial'));
      return marks.every(Boolean) ? marks.map((m) => m.textContent) : false;
    }, null, { timeout: 10000 }).then((h) => h.jsonValue());
    eq('a broken logo falls back to the platform initial', initials[0], 'E');
    eq('and so does one that was never given', initials[1], 'N');

    ok('and the page says plainly that these pay me',
      /referral credit/.test(await page.textContent('#panel-referrals .bk-sub')));

    // Emptying it again puts the notice back rather than stranding anyone.
    await page.route('**/referrals.json', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
    await page.evaluate(() => loadReferrals());
    await page.waitForFunction(() => document.querySelectorAll('#ref-list .soon').length === 1, null, { timeout: 10000 });
    eq('emptying the file brings the notice back', await page.locator('#ref-list .soon').count(), 1);
    eq('the tab stays where it was', await page.evaluate(() => document.getElementById('nav-referrals').hidden), false);
    ok('and nobody standing on it is thrown off the page',
      await page.evaluate(() => document.getElementById('panel-referrals').classList.contains('active')));
    await page.unroute('**/referrals.json');
  }

  section('one file, somebody else\'s site');
  {
    // The same page, opened at /c/ripple, has to come up as Ripple's site and
    // not as this one wearing their address. The path form is used here
    // because a test server has no wildcard subdomains; the hostname form runs
    // the same code with the same result.
    // Only the calls this page makes, not the ones the main site made earlier
    // in the run — those correctly carry no site at all.
    const fromHere = net.worker.length;
    await page.goto(SITE + 'c/ripple', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.creator === 'ripple', null, { timeout: 20000 });

    eq('the page is theirs', await page.title(), 'Ripple | @ripple');
    eq('their handle is at the top', (await page.textContent('#site-handle')).trim(), '@ripple');
    eq('and their tagline', (await page.textContent('#site-tagline')).trim(), 'Making waves');
    eq('with their avatar', await page.getAttribute('#site-avatar', 'src'), 'https://img.test/ripple.png');

    // Nothing of mine should be left on it.
    ok('my contact buttons are gone', await page.locator('#site-contact').isVisible() === false);
    ok('and my name is nowhere on the page',
      !/solquicks/i.test(await page.textContent('#panel-links')), await page.textContent('#panel-links'));

    // Their contact page is where anyone landing on the site starts, so the
    // links they gave have to actually be there, and be links.
    const socials = await page.$$eval('#panel-links .link-card', (els) => els.map((e) => ({
      href: e.getAttribute('href'),
      name: e.querySelector('.link-name').textContent.trim(),
      label: e.querySelector('.link-handle').textContent.trim(),
      rel: e.getAttribute('rel') || ''
    })));
    eq('the links they gave are on their contact page', socials.length, 2);
    eq('a handle became a link to the platform', socials[0].href, 'https://x.com/ripple');
    eq('named as the platform', socials[0].name, 'X (Twitter)');
    eq('and showing what they typed', socials[0].label, '@ripple');
    ok('opened without handing over the referrer', /noopener/.test(socials[0].rel), socials[0].rel);
    eq('an email is a mailto', socials[1].href, 'mailto:hi@ripple.io');
    ok('and is not opened in a new tab', socials[1].rel === '', socials[1].rel);

    eq('the three they picked are in the bar',
      (await page.$$eval('.nav-quick-btn', (els) => els.map((e) => e.textContent.trim()))).join(','),
      'Swap,Store,Book');
    eq('and the fourth is in the menu',
      (await page.$$eval('.nav-item[data-tab]', (els) => els.map((e) => e.dataset.tab))).join(','),
      'links,cleanup');

    // A page they did not choose must not be reachable by typing its name in.
    eq('a page they did not pick does not exist here',
      await page.locator('#panel-gacha').count(), 0);
    eq('nor one that was never on offer to them', await page.locator('#panel-moon').count(), 0);

    // Every call that quotes or takes money has to say whose site it is, or a
    // customer is sent to pay the wrong wallet.
    // Landing straight on the booking page is the case that races: the rate
    // card is fetched at startup, while the page still does not know whose
    // site it is, and a card fetched in that gap quotes my wallet on their
    // site. Which is somebody's customer paying the wrong person.
    const beforeBook = net.worker.length;
    net.siteDelay = 600;
    await page.goto(SITE + 'c/ripple#book', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#bk-list .bk-card').length > 0, null, { timeout: 20000 });
    const asked = net.worker.slice(beforeBook).filter((u) => /booking\/types|banner\/rates/.test(u));
    ok('a rate card fetched on landing is still asked for on their behalf',
      asked.length > 0 && asked.every((u) => /site=ripple/.test(u)), asked.join(' | '));
    eq('and it quotes their wallet, not mine',
      await page.evaluate(() => bkData.payTo), '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey');
    net.siteDelay = 0;

    // The badge is the whole distribution plan, so it has to be on their site.
    ok('the powered-by badge is on their site too', await page.locator('#powered').isVisible());
    eq('still naming what built it', (await page.textContent('#powered-name')).trim(), 'solquicks');
    ok('and still inviting the next one', await page.locator('#powered-cta').isVisible());

    // An address nobody has claimed must not quietly render my site.
    await page.goto(SITE + 'c/nobody', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /No site at this address/.test(document.body.textContent), null, { timeout: 20000 });
    ok('an unclaimed address says so rather than showing mine', true);
    ok('and points them at the Launchpad',
      /launch\.html/.test(await page.evaluate(() => document.body.innerHTML)));

    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });
    eq('and the main site is still itself', (await page.textContent('#site-handle')).trim(), '@solquicks');
  }

  section('settings survive a reload');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.solanaWeb3 !== 'undefined', null, { timeout: 20000 });
  await page.click('.nav-quick-btn[data-tab="swap"]');
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
