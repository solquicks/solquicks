// The swap API, against the worker that ships: which swaps earn the fee and in
// which token, which Jupiter address is used, wallet holdings across both token
// programs, and swap history read off the chain. Harness in harness.mjs.

import { chain, freshEnv, call, wallet, signIn, ok, eq, section, finish } from './harness.mjs';

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
const META = {
  [SOL]: { symbol: 'SOL', name: 'Wrapped SOL', isVerified: true },
  [USDC]: { symbol: 'USDC', name: 'USD Coin', isVerified: true },
  [PYUSD]: { symbol: 'PYUSD', name: 'PayPal USD', isVerified: true },
  [BONK]: { symbol: 'BONK', name: 'Bonk', isVerified: true },
  [WIF]: { symbol: 'WIF', name: 'dogwifhat', isVerified: true }
};

// Jupiter, as far as the worker uses it
chain.jup = (u, init) => {
  if (u.pathname === '/swap/v1/quote') {
    const fee = u.searchParams.get('platformFeeBps');
    const out = 1000000;
    return {
      inputMint: u.searchParams.get('inputMint'), outputMint: u.searchParams.get('outputMint'),
      inAmount: u.searchParams.get('amount'), outAmount: String(out), otherAmountThreshold: String(out * 0.99),
      priceImpactPct: '0.001', routePlan: [], platformFee: fee ? { amount: String(out * Number(fee) / 10000), feeBps: Number(fee) } : null
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

// ═════════════════════════════════════════════════════════════════════════════

section('which swaps earn the fee, and in which token');
{
  const env = freshEnv();
  const cases = [
    ['SOL → USDC', SOL, USDC, USDC, 'unchanged: paid in the token received'],
    ['USDC → SOL', USDC, SOL, SOL, 'unchanged: paid in the token received'],
    ['BONK → USDC', BONK, USDC, USDC, 'unchanged: paid in the token received'],
    ['BONK → PYUSD', BONK, PYUSD, PYUSD, 'unchanged: PYUSD as the token received'],
    ['SOL → BONK', SOL, BONK, SOL, 'new: paid in the SOL sold'],
    ['USDC → WIF', USDC, WIF, USDC, 'new: paid in the USDC sold'],
    ['BONK → WIF', BONK, WIF, null, 'no fee: neither side has a fee account'],
    ['PYUSD → BONK', PYUSD, BONK, null, 'no fee: taking it from a Token-2022 input is untested']
  ];
  for (const [label, inMint, outMint, feeMint, why] of cases) {
    const { r, sentFee } = await quote(env, inMint, outMint);
    eq(`${label} — ${why}`, r.body.feeMint, feeMint);
    eq(`${label}: Jupiter is asked for ${feeMint ? '20 bps' : 'no fee'}`, sentFee, feeMint ? '20' : null);
    const body = await build(env, r.body.quote);
    eq(`${label}: the swap is built with ${feeMint ? 'that token’s fee account' : 'no fee account'}`,
      body.feeAccount, feeMint ? FEE[feeMint] : undefined);
  }

  const { r } = await quote(env, SOL, BONK);
  const body = await build(env, r.body.quote, { feeAccount: wallet(66) });
  eq('a fee account sent by the client is ignored', body.feeAccount, FEE[SOL]);
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
function swapTx(sig, who, { solSpent = 0, spend = null, get, fee = null, failed = false }) {
  const keys = [who, 'tokIn', 'tokOut'].concat(fee ? [fee.account] : []);
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
      preBalances: [10e9, 0, 0, 0], postBalances: [10e9 - solSpent * 1e9 - 5000, 0, 0, 0],
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

finish();
