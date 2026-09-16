// The collection endpoints: every living Ranger with traits and a rarity rank,
// what has sold lately, and the minted/burned/named line. Harness in harness.mjs.

import { chain, freshEnv, call, wallet, ok, eq, section, finish, runScheduled } from './harness.mjs';

const COLLECTION = wallet(200);
const mint = (n) => wallet(300 + n);

// four Rangers: #1 has the only Gold fur, so it must rank first
const RANGERS = [
  { id: mint(1), name: 'Ranger #1', bg: 'Turtle', fur: 'Gold' },
  { id: mint(2), name: 'Ranger #2', bg: 'Turtle', fur: 'Green' },
  { id: mint(3), name: 'Ranger #3', bg: 'Nebula', fur: 'Green' },
  { id: mint(4), name: '', bg: 'Nebula', fur: 'Green' }   // the one with no name
];
const asset = (r) => ({
  id: r.id,
  content: {
    metadata: { name: r.name, attributes: [{ trait_type: 'Background', value: r.bg }, { trait_type: 'Fur', value: r.fur }] },
    files: [{ uri: 'https://arweave.net/' + r.id, cdn_uri: 'https://cdn.test/' + r.id }],
    links: { image: 'https://arweave.net/' + r.id }
  },
  ownership: { owner: wallet(1) }
});

// DAS reports `total` as the size of the page it returned, not the collection —
// the stand-in copies that, because reading it as a total is what broke this once
const BURNED = [mint(90), mint(91)];
const searchLimits = [];
chain.rpc.searchAssets = (params) => {
  searchLimits.push(params.limit);
  const all = params.burnt === false
    ? RANGERS.map(asset)
    : RANGERS.map(asset).concat(BURNED.map((id) => ({ id, content: { metadata: {}, files: [], links: {} }, ownership: {} })));
  // `total` is the size of the page that came back, exactly as DAS reports it:
  // ask for one asset and it says one, whatever the collection holds
  const items = all.slice(((params.page || 1) - 1) * params.limit, ((params.page || 1) - 1) * params.limit + params.limit);
  return { total: items.length, items: items };
};

const env0 = () => freshEnv({ MOON_RANGERS_COLLECTION: COLLECTION });

section('the collection, with traits and rarity');
{
  const env = env0();
  const r = await call(env, 'GET', '/api/collection');
  eq('every living Ranger is listed', (r.body.rangers || []).length, 4);
  const byName = {};
  for (const x of r.body.rangers) byName[x.mint] = x;
  eq('traits come through', JSON.stringify(byName[mint(2)].traits), JSON.stringify({ Background: 'Turtle', Fur: 'Green' }));
  eq('trait counts are totalled', r.body.traits.Fur.Green + ' green, ' + r.body.traits.Fur.Gold + ' gold', '3 green, 1 gold');
  eq('the rarest Ranger ranks first', byName[mint(1)].rank, 1);
  ok('and the common ones rank below it', [2, 3, 4].every((n) => byName[mint(n)].rank > 1),
    JSON.stringify(r.body.rangers.map((x) => x.rank)));
  eq('artwork prefers the fast copy', byName[mint(1)].image, 'https://cdn.test/' + mint(1));
  eq('with the original kept as a fallback', byName[mint(1)].imageAlt, 'https://arweave.net/' + mint(1));

  const before = chain.rpcCalls.filter((m) => m === 'searchAssets').length;
  await call(env, 'GET', '/api/collection');
  eq('a second visitor is served from cache, not another heavy read',
    chain.rpcCalls.filter((m) => m === 'searchAssets').length, before);
}

section('what has sold lately');
{
  const env = env0();
  chain.me = (u) => u.pathname.endsWith('/activities') ? [
    { type: 'buyNow', price: 0.5, tokenMint: mint(1), blockTime: 1789000000, buyer: wallet(9), seller: wallet(8) },
    { type: 'bid', price: 9, tokenMint: mint(2), blockTime: 1789000001 },
    { type: 'list', price: 8, tokenMint: mint(3), blockTime: 1789000002 },
    { type: 'buyNow', price: 0.41, tokenMint: mint(3), blockTime: 1788900000, buyer: wallet(9), seller: wallet(7) }
  ] : { symbol: 'moonrangers', floorPrice: 724870000, listedCount: 24, volume7d: 500000000 };

  const r = await call(env, 'GET', '/api/collection/sales');
  eq('only sales, not bids or listings', (r.body.sales || []).length, 2);
  eq('the newest first, with its price', r.body.sales[0].sol, 0.5);
  eq('and the name of the Ranger that sold', r.body.sales[0].name, 'Ranger #1');
  eq('a bid is never reported as a sale', r.body.sales.some((s) => s.sol === 9), false);

  chain.me = () => null;   // the marketplace is down
  const down = await call(freshEnv({ MOON_RANGERS_COLLECTION: COLLECTION }), 'GET', '/api/collection/sales');
  eq('a marketplace outage is a quiet empty list, not an error', down.status + ' ' + down.body.unavailable, '200 true');
}

section('minted, burned, named');
{
  const env = env0();
  chain.me = () => ({ symbol: 'moonrangers', floorPrice: 724870000, listedCount: 24, volume7d: 500000000 });
  await runScheduled(env);
  const a = (await call(env, 'GET', '/api/analytics')).body;
  eq('minted counts the burned ones too, rather than trusting the page total',
    [a.collection.minted, a.collection.burned, a.collection.alive, a.collection.named].join('/'), '6/2/4/3');
  // asking for one asset and reading `total` reported a collection of one
  ok('and it is counted by reading whole pages, never a one-asset page',
    searchLimits.length > 0 && searchLimits.every((n) => n >= 1000), searchLimits.join(','));
  ok('holders are kept as a series now, not just the latest', Array.isArray(a.holders.history) && a.holders.history.length >= 1,
    JSON.stringify(a.holders && a.holders.history));
}

section('how many plushies are left');
{
  const env = env0();
  const feed = (sold, quantity, ended) => ({ data: { products: [
    { slug: 'other-thing', name: 'Not this', quantity: 5, sales_count: '1', price: '10.00' },
    { slug: 'quicks-plushie', name: 'quicks Plushie', quantity: quantity, sales_count: String(sold), price: '40.00', sale_ended: !!ended }
  ] } });

  chain.store = () => feed(7, 100);
  const r = await call(env, 'GET', '/api/store');
  eq('the plushie is picked out of the shop, not the first thing listed', r.body.product.name, 'quicks Plushie');
  eq('sold and left are counted from it', r.body.product.sold + ' sold, ' + r.body.product.available + ' left', '7 sold, 93 left');
  eq('and it is not sold out', r.body.product.soldOut, false);

  chain.store = () => feed(100, 100);
  const done = await call(freshEnv(), 'GET', '/api/store');
  eq('a finished run reads as sold out', done.body.product.soldOut + ' ' + done.body.product.available, 'true 0');

  chain.store = () => null;   // the shop is down
  const down = await call(freshEnv(), 'GET', '/api/store');
  eq('a shop outage says so quietly', down.status + ' ' + down.body.unavailable, '200 true');
  chain.store = null;
}

section('the marketplace rate-limiting us');
{
  const env = env0();
  let first = true;
  chain.me = (u) => {
    if (u.pathname.endsWith('/stats') && first) { first = false; return new Response('', { status: 429 }); }
    return { symbol: 'moonrangers', floorPrice: 700000000, listedCount: 20, volume7d: 1000000000 };
  };
  await runScheduled(env);
  const a = (await call(env, 'GET', '/api/analytics')).body;
  ok('a refused floor request is tried again rather than lost', a.floor && a.floor.lamports === 700000000,
    JSON.stringify(a.floor));
  eq('and nothing is logged when the retry works',
    env._db.prepare("SELECT COUNT(*) AS n FROM error_log WHERE route = 'analytics.floor'").get().n, 0);
}

finish();
