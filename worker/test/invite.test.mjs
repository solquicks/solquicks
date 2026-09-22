// Invites: who brought whom, what that earns, and what it must refuse to pay.
//
// This is money. Every number here is a share of a fee somebody actually paid,
// and the one rule the whole design rests on is that nothing is ever paid for a
// signup — only for fees generated. Most of this file exists to hold that rule
// down, because it is what makes the system unfarmable without any identity
// checks at all. See docs/ranger-referrals-design.md.

import { chain, freshEnv as blankEnv, call, wallet, signIn, ok, eq, section, finish, TREASURY } from './harness.mjs';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const FEE = {
  [SOL]: 'AcNQzKfefKjSCEDBbMXxEQrJgW29UVbQhjmm88k84Mqp',
  [USDC]: '3w3oJv6xjbUTEJKfLcoijjAtAEUJkZ64po6nBBCjSijn'
};
const PRICES = { [SOL]: 150, [USDC]: 1, [BONK]: 0.00002 };
const META = {
  [SOL]: { symbol: 'SOL', name: 'Wrapped SOL', isVerified: true },
  [USDC]: { symbol: 'USDC', name: 'USD Coin', isVerified: true },
  [BONK]: { symbol: 'BONK', name: 'Bonk', isVerified: true }
};

chain.jup = (u) => {
  if (u.pathname === '/price/v3') {
    const out = {};
    for (const id of u.searchParams.get('ids').split(',')) if (PRICES[id]) out[id] = { usdPrice: PRICES[id] };
    return out;
  }
  if (u.pathname === '/tokens/v2/search') {
    return u.searchParams.get('query').split(',').filter((id) => META[id])
      .map((id) => Object.assign({ id, decimals: 6 }, META[id]));
  }
};
chain.rpc.getAccountInfo = () => ({ value: null });

const freshEnv = (o) => {
  const env = blankEnv(o);
  env._db.prepare("INSERT OR REPLACE INTO kv_cache (k, n, ts) VALUES ('solusd', 1500000, ?)").run(Date.now());
  return env;
};

// A swap on chain, as the recorder reads one. solSpent dollars at SOL $150,
// with the site's fee landing in its referral account.
// Base58, so no 0/O/I/l — the record route rejects anything else, and a test
// signature that cannot be recorded silently proves nothing.
const SIG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
let sigN = 0;
function swapTx(who, { usd, feeBps = 20 }) {
  const n = sigN++;
  const sig = SIG_CHARS[n % SIG_CHARS.length].repeat(86) +
    SIG_CHARS[Math.floor(n / SIG_CHARS.length) % SIG_CHARS.length] +
    SIG_CHARS[Math.floor(n / (SIG_CHARS.length ** 2)) % SIG_CHARS.length];
  const solSpent = usd / 150;
  const feeSol = solSpent * feeBps / 10000;
  chain.txs.set(sig, {
    blockTime: 1789400000,
    transaction: { message: { accountKeys: [who, 'tokOut', FEE[SOL]].map((pubkey) => ({ pubkey })) } },
    meta: {
      err: null, fee: 5000,
      preBalances: [10e9, 0, 0], postBalances: [10e9 - solSpent * 1e9 - 5000, 0, 0],
      preTokenBalances: [{ accountIndex: 2, mint: SOL, owner: 'referral',
        uiTokenAmount: { amount: '5000000000', decimals: 9, uiAmount: 5 } }],
      postTokenBalances: [
        { accountIndex: 1, mint: BONK, owner: who,
          uiTokenAmount: { amount: '100000000', decimals: 5, uiAmount: 1000 } },
        { accountIndex: 2, mint: SOL, owner: 'referral',
          uiTokenAmount: { amount: String(Math.round((5 + feeSol) * 1e9)), decimals: 9, uiAmount: 5 + feeSol } }
      ]
    }
  });
  return sig;
}
const swap = (env, who, opts) => call(env, 'POST', '/api/swap/record', { body: { signature: swapTx(who, opts) } });
const invite = (env, token) => call(env, 'GET', '/api/invite', { token }).then((r) => r.body);
const bind = (env, token, code) => call(env, 'POST', '/api/invite/bind', { token, body: { code } });
const points = (env, who) =>
  (env._db.prepare('SELECT points FROM players WHERE wallet = ?').get(who) || {}).points || 0;

// ═════════════════════════════════════════════════════════════════════════════

section('the code');
{
  const env = freshEnv();
  const me = wallet(10);
  const token = signIn(env, me);

  const a = await invite(env, token);
  ok('a wallet is given a code the first time it asks', /^FOX-[A-Z2-9]{4}$/.test(a.code), a.code);
  eq('and the same one every time after', (await invite(env, token)).code, a.code);

  // Read aloud on a stream and typed back in by someone else. O/0 and I/1 are
  // the pair that gets that wrong.
  ok('with no characters that are read back wrong', !/[OI01]/.test(a.code.slice(4)), a.code);

  const other = signIn(env, wallet(11));
  ok('two wallets do not share a code', (await invite(env, other)).code !== a.code);

  eq('signing out means no code at all', (await call(env, 'GET', '/api/invite')).status, 401);
}

section('binding: first touch, and never again');
{
  const env = freshEnv();
  const alice = wallet(12), bob = wallet(13);
  const aliceT = signIn(env, alice), bobT = signIn(env, bob);
  const code = (await invite(env, aliceT)).code;

  eq('a stranger can use the code', (await bind(env, bobT, code)).status, 200);
  eq('and is told what earns the bonus', (await bind(env, bobT, code)).status, 409);
  eq('the invite shows who brought them', (await invite(env, bobT)).invitedBy, code);
  eq('and the referrer counts them', (await invite(env, aliceT)).invited, 1);
  eq('but not as someone who has traded yet', (await invite(env, aliceT)).traded, 0);

  // The obvious one. Without it, everyone refers themselves.
  eq('a wallet cannot use its own code', (await bind(env, aliceT, (await invite(env, aliceT)).code)).status, 400);

  const carol = signIn(env, wallet(14));
  eq('a code nobody owns is refused', (await bind(env, carol, 'FOX-ZZZZ')).status, 404);
  eq('and so is an empty one', (await bind(env, carol, '')).status, 400);
  eq('a code is matched however it is typed',
    (await bind(env, carol, code.toLowerCase())).status, 200);

  // Second referrer for an already-bound wallet: the row is the record of who
  // gets paid, and rewriting it would move earnings from one person to another.
  const dave = signIn(env, wallet(15));
  const carolCode = (await invite(env, carol)).code;
  eq('a wallet that already used a code cannot swap it for another',
    (await bind(env, dave, code)).status + ',' + (await bind(env, dave, carolCode)).status, '200,409');
}

section('binding: a wallet that already traded here was never referred');
{
  const env = freshEnv();
  const alice = signIn(env, wallet(16));
  const regular = wallet(17), regularT = signIn(env, regular);
  const code = (await invite(env, alice)).code;

  eq('their swap is recorded', (await swap(env, regular, { usd: 300 })).status, 200);
  const r = await bind(env, regularT, code);
  eq('an existing trader cannot be claimed after the fact', r.status, 409);
  ok('and is told why', /already swapped/.test(r.body.error), r.body.error);
  eq('so nobody is paid on volume that was always coming',
    (await invite(env, alice)).earnedUsd, 0);
}

section('what a swap by a referred wallet pays');
{
  const env = freshEnv();
  const alice = wallet(20), bob = wallet(21);
  const aliceT = signIn(env, alice), bobT = signIn(env, bob);
  await bind(env, bobT, (await invite(env, aliceT)).code);

  // $1,500 at the standard 20 bps is $3 of fee. Alice holds no Ranger, so she
  // is on the base rate.
  await swap(env, bob, { usd: 1500 });
  const a = await invite(env, aliceT);
  eq('the base rate is 20%', a.basePct, 20);
  eq('a non-Ranger earns 20% of the fee', a.earnedUsd, 0.6);
  eq('counted as one paid swap', a.paidSwaps, 1);
  eq('and the referee now counts as having traded', a.traded, 1);

  // The referee's own side: earned by swapping, never by arriving.
  eq('the referee is paid their bonus for trading', points(env, bob), 250 + 0);
  await swap(env, bob, { usd: 1500 });
  eq('and only once, however much they trade', points(env, bob), 250);

  eq('the referrer earns on every swap, not just the first',
    (await invite(env, aliceT)).earnedUsd, 1.2);

  // A share of points, minted fresh rather than taken out of the referee's.
  ok('and earns points alongside the dollars', (await invite(env, aliceT)).pointsEarned > 0);
}

section('holding a Ranger is what the rate is for');
{
  const env = freshEnv();
  const ranger = wallet(22), plain = wallet(23);
  const rangerT = signIn(env, ranger, { holder: true });
  const plainT = signIn(env, plain);
  const r1 = signIn(env, wallet(24)), r2 = signIn(env, wallet(25));

  await bind(env, r1, (await invite(env, rangerT)).code);
  await bind(env, r2, (await invite(env, plainT)).code);
  await swap(env, wallet(24), { usd: 1500 });
  await swap(env, wallet(25), { usd: 1500 });

  const a = await invite(env, rangerT), b = await invite(env, plainT);
  eq('a Ranger is quoted 50%', a.sharePct, 50);
  eq('and everyone else 20%', b.sharePct, 20);
  eq('on the same $3 of fee, the Ranger earns $1.50', a.earnedUsd, 1.5);
  eq('and the other earns $0.60', b.earnedUsd, 0.6);
  ok('so a Ranger is worth more than twice as much', a.earnedUsd > b.earnedUsd * 2);
}

section('the rate is read at the swap, not stored on the invite');
{
  const env = freshEnv();
  const seller = wallet(26);
  const sellerT = signIn(env, seller, { holder: true });
  const buyerT = signIn(env, wallet(27));
  await bind(env, buyerT, (await invite(env, sellerT)).code);

  await swap(env, wallet(27), { usd: 1500 });
  eq('earns the Ranger rate while the Ranger is held', (await invite(env, sellerT)).earnedUsd, 1.5);

  // Sells the Ranger.
  env._db.prepare('DELETE FROM holder_positions WHERE wallet = ?').run(seller);
  await swap(env, wallet(27), { usd: 1500 });
  const after = await invite(env, sellerT);
  eq('and the base rate afterwards', after.earnedUsd, 1.5 + 0.6);
  eq('what was already earned is not clawed back',
    env._db.prepare('SELECT share_pct FROM invite_earnings WHERE referrer = ? ORDER BY ts LIMIT 1').get(seller).share_pct, 50);
}

section('a swap is never paid for twice');
{
  const env = freshEnv();
  const aliceT = signIn(env, wallet(30));
  const bob = wallet(31);
  await bind(env, signIn(env, bob), (await invite(env, aliceT)).code);

  const sig = swapTx(bob, { usd: 1500 });
  await call(env, 'POST', '/api/swap/record', { body: { signature: sig } });
  const once = (await invite(env, aliceT)).earnedUsd;
  // The reconciler walks recent signatures and records anything the page
  // missed, so the same transaction reaches the recorder more than once.
  await call(env, 'POST', '/api/swap/record', { body: { signature: sig } });
  env._db.prepare('DELETE FROM swaps WHERE signature = ?').run(sig);
  await call(env, 'POST', '/api/swap/record', { body: { signature: sig } });
  eq('recording the same swap again pays nothing more', (await invite(env, aliceT)).earnedUsd, once);
  eq('and leaves one earning row', env._db.prepare('SELECT COUNT(*) AS n FROM invite_earnings').get().n, 1);
}

section('what is never paid for');
{
  const env = freshEnv();
  const aliceT = signIn(env, wallet(32));
  const code = (await invite(env, aliceT)).code;

  // The whole design in one assertion. A hundred wallets entering a code costs
  // a script nothing; if arriving paid, this is where the money would leave.
  for (let i = 0; i < 20; i++) await bind(env, signIn(env, wallet(100 + i)), code);
  const a = await invite(env, aliceT);
  eq('twenty wallets arrive', a.invited, 20);
  eq('and none of them have traded', a.traded, 0);
  eq('so the referrer has earned nothing at all', a.earnedUsd, 0);
  eq('not even points', a.pointsEarned, 0);
  eq('and none of them were paid a bonus for arriving', points(env, wallet(100)), 0);

  // The referee bonus is for trading, and for trading enough to matter.
  const small = wallet(120), smallT = signIn(env, small);
  await bind(env, smallT, code);
  await swap(env, small, { usd: 10 });
  eq('a token swap does not earn the arrival bonus', points(env, small), 0);
  await swap(env, small, { usd: 60 });
  eq('a real one does', points(env, small), 250);
}

section('wash trading is a losing trade');
{
  // The thing an attacker would actually try: a second wallet, their own code,
  // and volume pushed back and forth. It has to cost more than it returns, or
  // every other defence has to be built.
  const env = freshEnv();
  const farmer = wallet(40);
  const farmerT = signIn(env, farmer, { holder: true });  // the best rate there is
  const mule = wallet(41);
  await bind(env, signIn(env, mule), (await invite(env, farmerT)).code);

  const VOLUME = 10000;
  await swap(env, mule, { usd: VOLUME });
  const earned = (await invite(env, farmerT)).earnedUsd;
  const paid = VOLUME * 20 / 10000;

  eq('$10,000 through the mule pays $20 in fees', paid, 20);
  eq('and returns $10 at the very best rate', earned, 10);
  ok('which is a loss, at the most generous rate in the system', earned < paid,
    `earned ${earned} against ${paid} paid`);
}

section('claiming');
{
  const env = freshEnv();
  const alice = wallet(50), bob = wallet(51);
  const aliceT = signIn(env, alice, { holder: true });
  await bind(env, signIn(env, bob), (await invite(env, aliceT)).code);

  const claim = () => call(env, 'POST', '/api/invite/claim', { token: aliceT });

  await swap(env, bob, { usd: 1500 });     // $1.50 at the Ranger rate
  const small = await claim();
  eq('a balance under the minimum cannot be claimed', small.status, 400);
  ok('and says what it is and what the floor is',
    /\$1\.50/.test(small.body.error) && /\$10/.test(small.body.error), small.body.error);

  // Enough to cross the floor.
  for (let i = 0; i < 12; i++) await swap(env, bob, { usd: 1500 });
  const before = await invite(env, aliceT);
  ok('the balance is over the floor', before.availableUsd >= 10, String(before.availableUsd));
  eq('and it says so', before.claimable, true);

  const c = await claim();
  eq('claiming works', c.status, 200);
  eq('for everything that was owed', c.body.claimed, before.availableUsd);
  eq('which queues it rather than sending anything', 
    env._db.prepare("SELECT status FROM invite_claims WHERE wallet = ?").get(alice).status, 'queued');

  const after = await invite(env, aliceT);
  eq('the balance goes to nothing', after.availableUsd, 0);
  eq('while what was earned is still on the record', after.earnedUsd, before.earnedUsd);
  eq('claiming twice is refused', (await claim()).status, 400);

  // Earned after claiming belongs to the next claim, not swallowed by the one
  // already queued and waiting to be paid by hand.
  await swap(env, bob, { usd: 1500 });
  eq('anything earned afterwards is a fresh balance', (await invite(env, aliceT)).availableUsd, 1.5);
}

section('paying out, by hand');
{
  const env = freshEnv({ ADMIN_TOKEN: 'sekrit' });
  const alice = wallet(52), bob = wallet(53);
  const aliceT = signIn(env, alice, { holder: true });
  await bind(env, signIn(env, bob), (await invite(env, aliceT)).code);
  for (let i = 0; i < 14; i++) await swap(env, bob, { usd: 1500 });
  await call(env, 'POST', '/api/invite/claim', { token: aliceT });

  const admin = (method, path, body) => call(env, method, path, { body, token: 'sekrit' });

  eq('the payout list needs the admin token',
    (await call(env, 'GET', '/api/admin/invite/claims')).status, 401);

  const list = await admin('GET', '/api/admin/invite/claims');
  eq('it lists what is queued', (list.body.claims || []).length, 1);
  ok('with a total to pay', list.body.owedUsd > 10, String(list.body.owedUsd));
  eq('in one currency, whatever the fees were collected in', list.body.payIn, 'USDC');

  const id = list.body.claims[0].id;
  eq('marking it paid needs the signature of the payment',
    (await admin('POST', '/api/admin/invite/paid', { id })).status, 400);
  eq('and then it settles', (await admin('POST', '/api/admin/invite/paid', { id, signature: 'S'.repeat(88) })).status, 200);
  eq('the same claim cannot be settled twice',
    (await admin('POST', '/api/admin/invite/paid', { id, signature: 'X'.repeat(88) })).status, 404);
  eq('and the signature recorded is the first one',
    env._db.prepare('SELECT signature FROM invite_claims WHERE id = ?').get(id).signature, 'S'.repeat(88));
  eq('nothing is left queued', (await admin('GET', '/api/admin/invite/claims')).body.claims.length, 0);
  eq('and the claimant sees none pending', (await invite(env, aliceT)).queuedClaims.length, 0);
}

section('points are credited, not just logged');
{
  // addPoints adds to a row that has to exist. A wallet earning its first
  // points from an invite, before it has ever earned anything else, would
  // otherwise get an event in its history and nothing in its balance.
  const env = freshEnv();
  const alice = wallet(70), bob = wallet(71);
  const aliceT = signIn(env, alice);
  await bind(env, signIn(env, bob), (await invite(env, aliceT)).code);
  env._db.prepare('DELETE FROM players').run();   // neither has ever earned anything

  await swap(env, bob, { usd: 1500 });
  const logged = (w) => env._db.prepare("SELECT COALESCE(SUM(points), 0) AS n FROM events WHERE wallet = ? AND type = 'invite'").get(w).n;

  ok('the referrer is paid something', points(env, alice) > 0, String(points(env, alice)));
  eq('and the balance matches what the log says', points(env, alice), logged(alice));
  eq('the referee is paid the arrival bonus', points(env, bob), 250);
  eq('with a log that agrees', points(env, bob), logged(bob));
}

section('the referrer never takes anything off the referee');
{
  const env = freshEnv();
  const aliceT = signIn(env, wallet(60));
  const bob = wallet(61), bobT = signIn(env, bob);

  const alone = freshEnv();
  const loner = wallet(62);
  signIn(alone, loner);
  await swap(alone, loner, { usd: 1500 });
  const unreferred = alone._db.prepare('SELECT usd, fee_bps FROM swaps WHERE wallet = ?').get(loner);

  await bind(env, bobT, (await invite(env, aliceT)).code);
  await swap(env, bob, { usd: 1500 });
  const referred = env._db.prepare('SELECT usd, fee_bps FROM swaps WHERE wallet = ?').get(bob);

  eq('a referred wallet is charged exactly what anyone else is',
    referred.fee_bps + '@' + referred.usd, unreferred.fee_bps + '@' + unreferred.usd);
  ok('the share comes out of this site\'s cut, not the customer\'s pocket', true);
}

finish();
