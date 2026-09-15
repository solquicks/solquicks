// The swap API, against the worker that ships: which swaps earn the fee and in
// which token, which Jupiter address is used, wallet holdings across both token
// programs, and swap history read off the chain. Harness in harness.mjs.

import { chain, freshEnv as blankEnv, call, wallet, signIn, ok, eq, section, finish, runScheduled, setClock, START, TREASURY, pay } from './harness.mjs';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const SPAM = 'SpamSpamSpamSpamSpamSpamSpamSpamSpamSpam1111';
const NFT = 'NftNftNftNftNftNftNftNftNftNftNftNftNftNft11';
const FEE = {
  [USDC]: '3w3oJv6xjbUTEJKfLcoijjAtAEUJkZ64po6nBBCjSijn',
  [SOL]: 'AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp',
  [PYUSD]: '6aypgwsaHJmrVA6gS2EH5d67EmQyoSR2CRtoX33iZ9Yh'
};
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PRICES = { [SOL]: 150, [USDC]: 1, [PYUSD]: 1, [BONK]: 0.00002, [WIF]: 2 };
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const RUG = wallet(77); // a validly formed address; the routes reject anything else
const HYPE = wallet(78); // unverified, but with deep liquidity
const META = {
  [SOL]: { symbol: 'SOL', name: 'Wrapped SOL', isVerified: true, liquidity: 900000000 },
  [USDC]: { symbol: 'USDC', name: 'USD Coin', isVerified: true, liquidity: 800000000 },
  [USDT]: { symbol: 'USDT', name: 'Tether', isVerified: true, liquidity: 300000000 },
  [PYUSD]: { symbol: 'PYUSD', name: 'PayPal USD', isVerified: true, liquidity: 20000000 },
  [BONK]: { symbol: 'BONK', name: 'Bonk', isVerified: true, liquidity: 1000000, mcap: 231826835, holderCount: 1019467,
    usdPrice: 0.0000026, stats24h: { priceChange: -3.25 }, audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 30 }, organicScoreLabel: 'high' },
  [WIF]: { symbol: 'WIF', name: 'dogwifhat', isVerified: true, liquidity: 6000000 },
  [HYPE]: { symbol: 'HYPE', name: 'Loud But Unverified', isVerified: false, liquidity: 50000000 },
  [RUG]: { symbol: 'RUG', name: 'Totally Safe', isVerified: false, liquidity: 9000, audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: false, topHoldersPercentage: 80 } }
};

// Jupiter, as far as the worker uses it
chain.jup = (u, init) => {
  if (u.pathname === '/swap/v1/quote') {
    const fee = u.searchParams.get('platformFeeBps');
    const out = 1000000;
    return {
      inputMint: u.searchParams.get('inputMint'), outputMint: u.searchParams.get('outputMint'),
      inAmount: u.searchParams.get('amount'), outAmount: String(out), otherAmountThreshold: String(out * 0.99),
      priceImpactPct: '0.001', routePlan: [], swapUsdValue: '150', platformFee: fee ? { amount: String(out * Number(fee) / 10000), feeBps: Number(fee) } : null
    };
  }
  if (u.pathname === '/swap/v1/swap') return { swapTransaction: 'AAAA', lastValidBlockHeight: 1 };
  if (u.pathname === '/price/v3') {
    const out = {};
    for (const id of u.searchParams.get('ids').split(',')) if (PRICES[id]) out[id] = { usdPrice: PRICES[id] };
    return out;
  }
  if (u.pathname === '/tokens/v2/search') {
    return u.searchParams.get('query').split(',').filter((id) => META[id])
      .map((id) => Object.assign({ id, icon: 'https://img.test/' + META[id].symbol + '.png', decimals: 6 }, META[id]));
  }
};

const quote = async (env, inMint, outMint) => {
  const r = await call(env, 'GET', `/api/swap/quote?in=${inMint}&out=${outMint}&amount=1000000&slippage=50`);
  const sent = chain.jupCalls.filter((c) => c.url.includes('/swap/v1/quote')).pop();
  return { r, sentFee: new URL(sent.url).searchParams.get('platformFeeBps') };
};
const build = async (env, q, extra = {}) => {
  await call(env, 'POST', '/api/swap/build', { body: Object.assign({ quote: q, user: wallet(1) }, extra) });
  return chain.jupCalls.filter((c) => c.url.includes('/swap/v1/swap')).pop().body;
};
// SOL at $150, cached the way the worker caches it, so no price feed is called.
// Any quote for a pair without a fee account prices its SOL fee.
const withSolPrice = (env) => {
  env._db.prepare("INSERT OR REPLACE INTO kv_cache (k, n, ts) VALUES ('solusd', 1500000, ?)").run(Date.now());
  return env;
};
const freshEnv = (overrides) => withSolPrice(blankEnv(overrides));

// ═════════════════════════════════════════════════════════════════════════════

section('which swaps earn the fee, and in which token');
{
  const env = withSolPrice(freshEnv());
  // every quote is a $150 swap; 0.2% of it at SOL $150 is 0.002 SOL
  const cases = [
    ['SOL → USDC', SOL, USDC, USDC, 'unchanged: paid in the token received'],
    ['USDC → SOL', USDC, SOL, SOL, 'unchanged: paid in the token received'],
    ['BONK → USDC', BONK, USDC, USDC, 'unchanged: paid in the token received'],
    ['BONK → PYUSD', BONK, PYUSD, PYUSD, 'unchanged: PYUSD as the token received'],
    ['SOL → BONK', SOL, BONK, SOL, 'paid in the SOL sold'],
    ['USDC → WIF', USDC, WIF, USDC, 'paid in the USDC sold'],
    ['BONK → WIF', BONK, WIF, 'sol', 'new: neither side has a fee account, so it is paid in SOL'],
    ['PYUSD → BONK', PYUSD, BONK, 'sol', 'new: a Token-2022 input is untested, so it is paid in SOL']
  ];
  for (const [label, inMint, outMint, feeMint, why] of cases) {
    const inSwap = feeMint !== 'sol';
    const { r, sentFee } = await quote(env, inMint, outMint);
    eq(`${label} — ${why}`, r.body.feeMint, inSwap ? feeMint : SOL);
    eq(`${label}: Jupiter is asked for ${inSwap ? '20 bps' : 'no fee'}`, sentFee, inSwap ? '20' : null);
    eq(`${label}: quoted at 0.2%`, r.body.feeBps, 20);
    const res = await call(env, 'POST', '/api/swap/build', { body: { quote: r.body.quote, user: wallet(1) } });
    const body = chain.jupCalls.filter((c) => c.url.includes('/swap/v1/swap')).pop().body;
    eq(`${label}: the swap is built with ${inSwap ? 'that token’s fee account' : 'no fee account'}`,
      body.feeAccount, inSwap ? FEE[feeMint] : undefined);
    eq(`${label}: ${inSwap ? 'no separate SOL payment' : 'a 0.002 SOL payment to the treasury is added'}`,
      JSON.stringify(res.body.feeTransfer), inSwap ? 'null' : JSON.stringify({ to: TREASURY, lamports: 2000000 }));
  }

  const { r } = await quote(env, SOL, BONK);
  const body = await build(env, r.body.quote, { feeAccount: wallet(66) });
  eq('a fee account sent by the client is ignored', body.feeAccount, FEE[SOL]);
}

section('pairs with no fee account pay in SOL');
{
  const env = withSolPrice(freshEnv());
  const holder = wallet(90);
  env._db.prepare('INSERT INTO holder_positions (wallet, count, first_seen, updated_at) VALUES (?, 1, 1, 1)').run(holder);
  const q = (who) => call(env, 'GET', `/api/swap/quote?in=${BONK}&out=${WIF}&amount=1000000&slippage=50` + (who ? '&wallet=' + who : ''));

  const plain = (await q()).body;
  eq('the quote shows the fee in lamports', plain.feeLamports, 2000000);
  const h = (await q(holder)).body;
  eq('a Moon Ranger is quoted half', h.feeLamports + ' at ' + h.feeBps + ' bps, full ' + h.fullFeeBps, '1000000 at 10 bps, full 20');
  const built = await call(env, 'POST', '/api/swap/build', { body: { quote: h.quote, user: holder } });
  eq('and built at half', built.body.feeTransfer && built.body.feeTransfer.lamports, 1000000);
  const other = await call(env, 'POST', '/api/swap/build', { body: { quote: h.quote, user: wallet(91) } });
  eq('the holder\'s quote used by another wallet is charged in full', other.body.feeTransfer && other.body.feeTransfer.lamports, 2000000);

  const answer = chain.jup;
  chain.jup = (u, init) => {
    const out = answer(u, init);
    if (u.pathname === '/swap/v1/quote') out.swapUsdValue = u.searchParams.get('amount') === '1' ? '0.0001' : undefined;
    return out;
  };
  const noValue = (await q()).body;
  eq('no dollar value on the quote: no fee rather than a guess', noValue.feeLamports + ' ' + noValue.feeMint + ' ' + noValue.feeBps, '0 null 0');
  const dust = (await call(env, 'GET', `/api/swap/quote?in=${BONK}&out=${WIF}&amount=1&slippage=50`)).body;
  eq('a fee under 1000 lamports is skipped', dust.feeLamports, 0);
  chain.jup = answer;

  const noTreasury = withSolPrice(freshEnv({ TREASURY_WALLET: undefined }));
  eq('with no treasury configured, nothing is charged', (await call(noTreasury, 'GET', `/api/swap/quote?in=${BONK}&out=${WIF}&amount=1000000&slippage=50`)).body.feeLamports, 0);
}

section('which Jupiter address is used');
{
  chain.jupCalls.length = 0;
  await quote(freshEnv(), SOL, USDC);
  const keyless = chain.jupCalls[0];
  ok('with no key: lite-api, which still works', keyless.url.startsWith('https://lite-api.jup.ag/'), keyless.url);
  eq('and no key header is sent', keyless.key, null);

  chain.jupCalls.length = 0;
  await quote(freshEnv({ JUPITER_API_KEY: 'jup-test-key' }), SOL, USDC);
  const keyed = chain.jupCalls[0];
  ok('with a key: api.jup.ag, ahead of lite-api being retired', keyed.url.startsWith('https://api.jup.ag/'), keyed.url);
  eq('and the key goes in the header', keyed.key, 'jup-test-key');

  // a key Jupiter refuses, as happened in production on 2026-09-15
  const answer = chain.jup;
  chain.jup = (u, init) => (u.host === 'api.jup.ag' ? new Response('{"code":401,"message":"Unauthorized"}', { status: 401 }) : answer(u, init));
  chain.jupCalls.length = 0;
  const env = freshEnv({ JUPITER_API_KEY: 'a-rejected-key' });
  const r = await call(env, 'GET', `/api/swap/quote?in=${SOL}&out=${USDC}&amount=1000000&slippage=50`);
  eq('a rejected key does not break quotes', r.status, 200);
  ok('the call is retried on lite-api', chain.jupCalls.some((c) => c.url.startsWith('https://lite-api.jup.ag/')));
  eq('without sending the rejected key there', chain.jupCalls.filter((c) => c.url.startsWith('https://lite-api.jup.ag/')).every((c) => c.key === null), true);
  ok('and the rejection is logged so it gets noticed',
    env._db.prepare("SELECT COUNT(*) AS n FROM error_log WHERE route = 'jupiter.key'").get().n > 0);
  chain.jup = answer;
}

section('your tokens');
{
  const owner = wallet(2);
  const acct = (mint, amount, decimals, programId) => ({
    pubkey: 'acct-' + mint.slice(0, 6) + '-' + amount,
    account: { lamports: 2039280, data: { parsed: { info: { mint, owner, state: 'initialized', tokenAmount: { amount: String(amount), decimals, uiAmount: amount / 10 ** decimals } } } } }
  });
  chain.rpc.getTokenAccountsByOwner = ([who, filter]) => ({
    value: filter.programId === TOKEN22
      ? [acct(PYUSD, 25_000_000, 6)]                                            // 25 PYUSD, Token-2022
      : [acct(USDC, 40_500_000, 6), acct(USDC, 0, 6),                          // 40.5 USDC, and an empty account
         acct(BONK, 1_000_000_00000, 5), acct(SPAM, 999_000_000, 6),          // 1,000,000 BONK ($20), unpriced spam
         acct(NFT, 1, 0), acct(SOL, 3_000_000_000, 9)]                         // an NFT, and wrapped SOL
  });
  chain.rpc.getBalance = () => ({ value: 2_000_000_000 });                     // 2 SOL native

  const env = freshEnv();
  const before = chain.rpcCalls.length;
  const r = await call(env, 'GET', '/api/swap/holdings?wallet=' + owner);
  eq('holdings load', r.status, 200);
  const list = r.body.tokens || [];
  const symbols = list.map((t) => t.symbol);
  eq('sorted by dollar value, largest first', symbols.slice(0, 4).join(','), 'SOL,USDC,PYUSD,BONK');
  const pyusd = list.find((t) => t.mint === PYUSD);
  eq('a Token-2022 token like PYUSD is included', pyusd && pyusd.amount, 25);
  eq('SOL is the native balance', list.find((t) => t.mint === SOL).amount, 2);
  ok('wrapped SOL is not counted a second time', list.filter((t) => t.mint === SOL).length === 1);
  ok('the NFT is left out', !list.some((t) => t.mint === NFT));
  eq('USDC across two accounts, the empty one ignored', list.find((t) => t.mint === USDC).amount, 40.5);
  const spam = list.find((t) => t.mint === SPAM);
  ok('an unpriced token is listed, last, with no dollar value', spam && spam.usd === null && list[list.length - 1] === spam);
  eq('total value adds up the priced tokens', r.body.totalUsd, 2 * 150 + 40.5 + 25 + 20);
  const used = chain.rpcCalls.length - before;

  const again = await call(env, 'GET', '/api/swap/holdings?wallet=' + owner);
  eq('a second look within 30 seconds is served from cache', chain.rpcCalls.length - before, used);
  eq('with the same answer', again.body.totalUsd, r.body.totalUsd);
  await call(env, 'GET', '/api/swap/holdings?wallet=' + owner + '&fresh=1');
  ok('after a swap the page can ask for fresh balances', chain.rpcCalls.length - before > used);
  eq('a malformed wallet is refused', (await call(env, 'GET', '/api/swap/holdings?wallet=nope')).status, 400);
}

// A finished swap as getTransaction reports it: `who` sells `spend`, receives
// `get`, and optionally pays a fee into one of the site's fee accounts.
function swapTx(sig, who, { solSpent = 0, spend = null, get, fee = null, solFee = 0, failed = false }) {
  const keys = [who, 'tokIn', 'tokOut'].concat(fee ? [fee.account] : []).concat(solFee ? [TREASURY] : []);
  // shaped like jsonParsed token balances: whole base units plus decimals
  const DEC = { [SOL]: 9, [USDC]: 6, [PYUSD]: 6, [BONK]: 5, [WIF]: 6 };
  const bal = (accountIndex, mint, owner, ui) => ({ accountIndex, mint, owner,
    uiTokenAmount: { amount: String(Math.round(ui * 10 ** DEC[mint])), decimals: DEC[mint], uiAmount: ui } });
  const pre = [], post = [];
  if (spend) {
    pre.push(bal(1, spend.mint, who, spend.amount + 1));
    post.push(bal(1, spend.mint, who, 1));
  }
  post.push(bal(2, get.mint, who, get.amount));
  if (fee) {
    pre.push(bal(3, fee.mint, 'referral', 5));
    post.push(bal(3, fee.mint, 'referral', 5 + fee.amount));
  }
  chain.txs.set(sig, {
    blockTime: 1789400000,
    transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })) } },
    meta: {
      err: failed ? { InstructionError: [0, 'Custom'] } : null, fee: 5000,
      preBalances: [10e9, 0, 0].concat(fee ? [0] : [], solFee ? [3e9] : []),
      postBalances: [10e9 - solSpent * 1e9 - solFee - 5000, 0, 0].concat(fee ? [0] : [], solFee ? [3e9 + solFee] : []),
      preTokenBalances: pre, postTokenBalances: post
    }
  });
  return sig;
}

section('swap history');
{
  const env = freshEnv();
  const me = wallet(3);
  const s1 = swapTx('S'.repeat(88), me, { solSpent: 0.5, get: { mint: BONK, amount: 3_700_000 }, fee: { account: FEE[SOL], mint: SOL, amount: 0.001 } });
  const rec = await call(env, 'POST', '/api/swap/record', { body: { signature: s1 } });
  eq('a swap is recorded', rec.status, 200);
  const sw = rec.body.swap || {};
  eq('sold: SOL', sw.in_symbol + ' ' + sw.in_amount, 'SOL 0.5');
  eq('received: BONK', sw.out_symbol + ' ' + sw.out_amount, 'BONK 3700000');
  eq('valued at what was sold', sw.usd, 75);
  eq('the fee paid is read off the chain, in SOL', sw.fee_mint + ' ' + sw.fee_amount, SOL + ' 0.001');
  eq('and it belongs to the wallet that signed it', sw.wallet, me);
  eq('recording twice is harmless', (await call(env, 'POST', '/api/swap/record', { body: { signature: s1 } })).body.already, true);

  eq('a swap not on chain yet is "try again", not an error', (await call(env, 'POST', '/api/swap/record', { body: { signature: 'N'.repeat(88) } })).status, 404);
  swapTx('F'.repeat(88), me, { solSpent: 0.5, get: { mint: BONK, amount: 1 }, failed: true });
  eq('a failed swap is not recorded', (await call(env, 'POST', '/api/swap/record', { body: { signature: 'F'.repeat(88) } })).status, 400);
  eq('a malformed signature is refused', (await call(env, 'POST', '/api/swap/record', { body: { signature: 'x' } })).status, 400);

  // a swap that earned points before history existed
  const s2 = swapTx('P'.repeat(88), me, { spend: { mint: USDC, amount: 20 }, get: { mint: WIF, amount: 10 }, fee: { account: FEE[USDC], mint: USDC, amount: 0.04 } });
  env._db.prepare('INSERT INTO swap_awards (signature, wallet, usd, points, ts) VALUES (?, ?, ?, ?, ?)').run(s2, me, 20, 20, 1);

  const h = await call(env, 'GET', '/api/swap/history?wallet=' + me);
  const rows = h.body.swaps || [];
  eq('history lists both swaps', rows.length, 2);
  const old = rows.find((x) => x.signature === s2);
  ok('including one made before history existed, filled in from its points record', !!old);
  eq('with the points it earned', old && old.points, 20);
  eq('and its pair', old && old.in_symbol + ' → ' + old.out_symbol, 'USDC → WIF');
  eq('another wallet sees none of it', (await call(env, 'GET', '/api/swap/history?wallet=' + wallet(4))).body.swaps.length, 0);
}

section('Moon Ranger holders pay half');
{
  const env = freshEnv();
  const holder = wallet(20), regular = wallet(21);
  env._db.prepare('INSERT INTO holder_positions (wallet, count, first_seen, updated_at) VALUES (?, 1, 1, 1)').run(holder);
  const q = async (who) => {
    const r = await call(env, 'GET', `/api/swap/quote?in=${SOL}&out=${BONK}&amount=1000000&slippage=50` + (who ? '&wallet=' + who : ''));
    return { r, sent: new URL(chain.jupCalls.filter((c) => c.url.includes('/swap/v1/quote')).pop().url).searchParams.get('platformFeeBps') };
  };
  const buildAs = async (user, quote) => call(env, 'POST', '/api/swap/build', { body: { quote, user } });

  const h = await q(holder);
  eq('a holder is quoted 0.1%', h.r.body.feeBps, 10);
  eq('Jupiter is asked for 10 bps', h.sent, '10');
  eq('and told the full rate, to show the saving', h.r.body.fullFeeBps + ' holder=' + h.r.body.holder, '20 holder=true');
  const n = await q(regular);
  eq('anyone else is quoted 0.2%', n.r.body.feeBps, 20);
  eq('a staked Ranger counts as held', (env._db.prepare('INSERT INTO staked_nfts (wallet, mint, since) VALUES (?, ?, ?)').run(wallet(22), 'm1', 1), (await q(wallet(22))).r.body.feeBps), 10);

  eq('a holder swapping at the holder rate is built', (await buildAs(holder, h.r.body.quote)).status, 200);
  eq('a holder quote used by a different wallet is refused', (await buildAs(regular, h.r.body.quote)).status, 409);
  eq('and asks the page to re-quote', (await buildAs(regular, h.r.body.quote)).body.requote, true);
  const stripped = Object.assign({}, n.r.body.quote, { platformFee: null });
  eq('a quote with the fee stripped out is refused', (await buildAs(regular, stripped)).status, 409);
  eq('a pair with no fee needs no fee check', (await buildAs(regular, (await call(env, 'GET', `/api/swap/quote?in=${BONK}&out=${WIF}&amount=1000000&slippage=50`)).body.quote)).status, 200);
}

section('speed setting');
{
  const env = freshEnv();
  const base = (await call(env, 'GET', `/api/swap/quote?in=${SOL}&out=${USDC}&amount=1000000&slippage=50`)).body.quote;
  const priority = async (speed) => {
    await call(env, 'POST', '/api/swap/build', { body: { quote: base, user: wallet(1), speed } });
    return chain.jupCalls.filter((c) => c.url.includes('/swap/v1/swap')).pop().body.prioritizationFeeLamports.priorityLevelWithMaxLamports;
  };
  eq('normal is medium priority, at most 0.0002 SOL', JSON.stringify(await priority('normal')), JSON.stringify({ priorityLevel: 'medium', maxLamports: 200000 }));
  eq('fast is high, at most 0.0005 SOL', JSON.stringify(await priority('fast')), JSON.stringify({ priorityLevel: 'high', maxLamports: 500000 }));
  eq('turbo is very high, capped at 0.001 SOL', JSON.stringify(await priority('turbo')), JSON.stringify({ priorityLevel: 'veryHigh', maxLamports: 1000000 }));
  eq('anything else falls back to normal', (await priority('ludicrous')).priorityLevel, 'medium');
}

section('auto slippage');
{
  const env = freshEnv();
  const auto = async (a, b) => {
    const r = await call(env, 'GET', `/api/swap/quote?in=${a}&out=${b}&amount=1000000&slippage=auto`);
    const sent = new URL(chain.jupCalls.filter((c) => c.url.includes('/swap/v1/quote')).pop().url).searchParams.get('slippageBps');
    return r.body.slippageBps + '/' + sent + (r.body.autoSlippage ? ' auto' : '');
  };
  eq('two dollar stablecoins: 0.2%', await auto(USDC, USDT), '20/20 auto');
  eq('two deep, verified tokens: 0.5%', await auto(SOL, USDC), '50/50 auto');
  eq('one side with about $1M of liquidity: 1%', await auto(SOL, BONK), '100/100 auto');
  eq('an unverified token with thin liquidity: 3%', await auto(SOL, RUG), '300/300 auto');
  eq('an unverified token is 3% however deep its liquidity looks', await auto(SOL, HYPE), '300/300 auto');
  eq('a manual choice is still honoured', (await call(env, 'GET', `/api/swap/quote?in=${SOL}&out=${BONK}&amount=1000000&slippage=300`)).body.slippageBps, 300);
}

section('token details');
{
  const env = freshEnv();
  const bonk = (await call(env, 'GET', '/api/swap/token?mint=' + BONK)).body.token;
  eq('market cap, liquidity, holders and the day\'s move', [bonk.mcap, bonk.liquidity, bonk.holders, bonk.change24h].join(' '), '231826835 1000000 1019467 -3.25');
  eq('a clean token has no warnings', bonk.warnings.length, 0);
  const rug = (await call(env, 'GET', '/api/swap/token?mint=' + RUG)).body.token;
  eq('a risky one carries every warning that applies', rug.warnings.length, 5);
  const before = chain.jupCalls.length;
  await call(env, 'GET', '/api/swap/token?mint=' + BONK);
  eq('details are cached rather than fetched every time', chain.jupCalls.length, before);
  eq('an unknown token', (await call(env, 'GET', '/api/swap/token?mint=' + wallet(30))).status, 404);
}

section('what a holder saved, in history');
{
  const env = freshEnv();
  const me = wallet(31);
  swapTx('H'.repeat(88), me, { solSpent: 1, get: { mint: USDC, amount: 149.85 }, fee: { account: FEE[USDC], mint: USDC, amount: 0.15 } });  // 0.1% of what would have been received
  swapTx('J'.repeat(88), me, { spend: { mint: USDC, amount: 100 }, get: { mint: BONK, amount: 38000000 }, fee: { account: FEE[USDC], mint: USDC, amount: 0.2 } }); // 0.2% of what was spent
  const a = (await call(env, 'POST', '/api/swap/record', { body: { signature: 'H'.repeat(88) } })).body.swap;
  eq('a discounted swap reads back as 10 bps', a.fee_bps, 10);
  eq('and saved what it paid: $0.15', a.saved_usd, 0.15);
  const b = (await call(env, 'POST', '/api/swap/record', { body: { signature: 'J'.repeat(88) } })).body.swap;
  eq('a full-rate swap reads back as 20 bps, saving nothing', b.fee_bps + ' ' + b.saved_usd, '20 0');
  const hist = (await call(env, 'GET', '/api/swap/history?wallet=' + me)).body;
  eq('history totals what was saved', hist.savedUsd + ' over ' + hist.discountedSwaps, '0.15 over 1');
}

section('a SOL-paid fee, read back off the chain');
{
  const env = freshEnv();
  const me = wallet(92);
  // $150 of BONK for WIF, with 0.002 SOL ($0.30, 20 bps) sent to the treasury
  swapTx('T'.repeat(88), me, { spend: { mint: BONK, amount: 7_500_000 }, get: { mint: WIF, amount: 74.85 }, solFee: 2_000_000 });
  const a = (await call(env, 'POST', '/api/swap/record', { body: { signature: 'T'.repeat(88) } })).body.swap || {};
  eq('recorded as paid in SOL', a.fee_mint + ' ' + a.fee_amount, SOL + ' 0.002');
  eq('at 20 bps of the swap', a.fee_bps, 20);
  eq('the fee is not mistaken for SOL sold', a.in_symbol + ' ' + a.usd, 'BONK 150');
  swapTx('U'.repeat(88), me, { spend: { mint: BONK, amount: 7_500_000 }, get: { mint: WIF, amount: 74.85 }, solFee: 1_000_000 });
  const b = (await call(env, 'POST', '/api/swap/record', { body: { signature: 'U'.repeat(88) } })).body.swap || {};
  eq('a holder\'s half fee reads back as 10 bps, saving $0.15', b.fee_bps + ' ' + b.saved_usd, '10 0.15');
  swapTx('V'.repeat(88), me, { spend: { mint: BONK, amount: 7_500_000 }, get: { mint: WIF, amount: 74.85 }, solFee: 1000 });
  const c = (await call(env, 'POST', '/api/swap/record', { body: { signature: 'V'.repeat(88) } })).body.swap || {};
  eq('a few lamports sent to the treasury alongside a swap made elsewhere are not a fee', c.fee_mint, null);

  // the scheduled job also watches the treasury, which receives booking payments too
  const swapSig = swapTx('W'.repeat(80) + 'treasury', wallet(93), { spend: { mint: BONK, amount: 7_500_000 }, get: { mint: WIF, amount: 74.85 }, solFee: 2_000_000 });
  const paySig = pay({ from: wallet(94), usdc: 250e6 });
  chain.byRef.set(TREASURY, [{ signature: swapSig, err: null }, { signature: paySig, err: null }]);
  await runScheduled(env);
  eq('a SOL-fee swap nobody reported is found through the treasury', env._db.prepare('SELECT fee_mint FROM swaps WHERE signature = ?').get(swapSig)?.fee_mint, SOL);
  const fetches = () => chain.rpcCalls.filter((m) => m === 'getTransaction').length;
  const before = fetches();
  await runScheduled(env);
  eq('a booking payment is looked at once, then left alone', fetches(), before);
  chain.byRef.delete(TREASURY);
}

section('weekly swap leaderboard');
{
  const env = freshEnv();
  const DAY = 86400000;
  const monday = Date.UTC(2026, 8, 14);                 // the harness clock starts on this Monday
  const [a, b, c, d, e] = [wallet(40), wallet(41), wallet(42), wallet(43), wallet(44)];
  const put = (sig, who, usd, ts, feePaid = true) => env._db.prepare(
    'INSERT INTO swaps (signature, wallet, in_mint, in_amount, out_mint, out_amount, usd, fee_mint, fee_amount, ts) VALUES (?, ?, ?, 1, ?, 1, ?, ?, ?, ?)'
  ).run(sig, who, SOL, USDC, usd, feePaid ? SOL : null, feePaid ? 0.001 : null, ts);
  put('w1', a, 300, monday + DAY); put('w2', a, 50, monday + 2 * DAY);   // a: 350
  put('w3', b, 400, monday + DAY);                                          // b: 400
  put('w4', c, 90, monday + 3 * DAY);                                       // c: 90
  put('w5', d, 10, monday + 3 * DAY);                                       // d: 10, under the minimum
  put('w6', e, 5000, monday + DAY, false);                                  // e: no fee paid — not a site swap
  put('w7', e, 9000, monday - DAY);                                         // e: last week

  const board = (await call(env, 'GET', '/api/swap/leaderboard')).body;
  eq('the week starts on Monday, UTC', board.weekStart, monday);
  eq('ranked by volume this week', board.top.map((r) => r.usd).join(','), '400,350,90,10');
  eq('swaps from two trades add up', board.top[1].swaps, 2);
  ok('a swap that paid no fee does not count', !board.top.some((r) => r.wallet === e));
  eq('prizes and minimum are published', board.prizes.join('/') + ' min $' + board.minUsd, '500/250/100 min $25');

  // the week closes: pay out only after the grace period, and only once
  setClock(monday + 7 * DAY + 3600000);                 // one hour after the week ended
  await runScheduled(env);
  eq('nothing is paid during the grace period', env._db.prepare('SELECT COUNT(*) AS n FROM swap_weekly_awards').get().n, 0);
  setClock(monday + 7 * DAY + 3 * 3600000);
  await runScheduled(env);
  const awards = env._db.prepare('SELECT rank, wallet, points FROM swap_weekly_awards ORDER BY rank').all();
  eq('the top three are paid 500, 250 and 100', awards.map((r) => r.points).join(','), '500,250,100');
  eq('in the right order', awards.map((r) => r.wallet).join(','), [b, a, c].join(','));
  eq('and the points land on their balances', env._db.prepare('SELECT points FROM players WHERE wallet = ?').get(b).points, 500);
  await runScheduled(env);
  eq('a second run pays nobody twice', env._db.prepare('SELECT points FROM players WHERE wallet = ?').get(b).points, 500);
  eq('last week\'s winners are shown', (await call(env, 'GET', '/api/swap/leaderboard')).body.lastWeek.length, 3);
  setClock(START);
}

section('a quiet week pays below the minimum to no one');
{
  const env = freshEnv();
  const monday = Date.UTC(2026, 8, 14);
  env._db.prepare('INSERT INTO swaps (signature, wallet, in_mint, in_amount, out_mint, out_amount, usd, fee_mint, fee_amount, ts) VALUES (?, ?, ?, 1, ?, 1, ?, ?, ?, ?)')
    .run('q1', wallet(45), SOL, USDC, 24.99, SOL, 0.001, monday + 86400000);
  setClock(monday + 7 * 86400000 + 3 * 3600000);
  await runScheduled(env);
  eq('$24.99 of volume wins nothing', env._db.prepare('SELECT COUNT(*) AS n FROM swap_weekly_awards').get().n, 0);
  setClock(START);
}

section('site swaps are recorded from the fee accounts');
{
  const env = freshEnv();
  const me = wallet(46);
  const sig = swapTx('F'.repeat(80) + 'feeacct', me, { solSpent: 0.5, get: { mint: BONK, amount: 1000 }, fee: { account: FEE[SOL], mint: SOL, amount: 0.001 } });
  chain.byRef.set(FEE[SOL], [{ signature: sig, err: null }]);
  await runScheduled(env);
  eq('a swap nobody reported is found and recorded', env._db.prepare('SELECT wallet FROM swaps WHERE signature = ?').get(sig)?.wallet, me);
  const before = chain.rpcCalls.filter((m) => m === 'getTransaction').length;
  await runScheduled(env);
  eq('and not fetched again once known', chain.rpcCalls.filter((m) => m === 'getTransaction').length, before);
  chain.byRef.delete(FEE[SOL]);
}

section('points still check who signed the swap');
{
  const env = freshEnv();
  const token = signIn(env, wallet(5));
  const sig = swapTx('Q'.repeat(88), wallet(6), { solSpent: 1, get: { mint: USDC, amount: 150 } });
  const r = await call(env, 'POST', '/api/swap/award', { token, body: { signature: sig } });
  ok('claiming points for someone else’s swap is refused', /not signed by your wallet/.test(r.body.error || ''), JSON.stringify(r.body));
  const mine = swapTx('R'.repeat(88), wallet(5), { solSpent: 1, get: { mint: USDC, amount: 150 } });
  const r2 = await call(env, 'POST', '/api/swap/award', { token, body: { signature: mine } });
  eq('your own $150 swap earns 150 points', r2.body.awarded, 150);
}

section('cleanup scan after closing accounts');
{
  // Closing accounts, then re-scanning, used to show the closed accounts again:
  // the scan was cached for 60 seconds and read the finalized chain state.
  const owner = wallet(7);
  let empties = 5;
  const commitments = [];
  chain.rpc.getTokenAccountsByOwner = ([who, filter, opts]) => {
    commitments.push(opts && opts.commitment);
    if (filter.programId === TOKEN22) return { value: [] };
    return { value: Array.from({ length: empties }, (_, i) => ({
      pubkey: 'empty' + i,
      account: { lamports: 2039280, data: { parsed: { info: { mint: USDC, owner, state: 'initialized', tokenAmount: { amount: '0', decimals: 6, uiAmount: 0 } } } } }
    })) };
  };
  chain.rpc.getAssetBatch = () => [];
  const env = freshEnv();
  // the scan also shows a SOL price, cached for five minutes; start with one cached
  env._db.prepare("INSERT OR REPLACE INTO kv_cache (k, n, ts) VALUES ('solusd', 1500000, ?)").run(Date.now());
  const scan = (fresh) => call(env, 'GET', '/api/cleanup/scan?wallet=' + owner + (fresh ? '&fresh=1' : ''));
  const emptyCount = (r) => (r.body.accounts || []).filter((a) => a.empty).length;

  eq('a first scan finds the 5 empty accounts', emptyCount(await scan()), 5);
  empties = 0; // the person closes them
  eq('an ordinary re-scan within a minute is the cached one', emptyCount(await scan()), 5);
  eq('the re-scan the page makes after closing asks for fresh numbers, and gets 0', emptyCount(await scan(true)), 0);
  ok('and every token-account read uses confirmed, not finalized, state',
    commitments.length > 0 && commitments.every((c) => c === 'confirmed'), JSON.stringify(commitments));
}

finish();
