// Creates the soulbound collection and the Candy Machine that sells it.
//
// The collection carries a PermanentFreezeDelegate that is frozen with no
// authority. Core collection plugins are inherited by every asset in the
// collection, so each collectible is non-transferable from the moment it is
// minted — and with the authority set to None, permanently. Nobody can thaw
// it, including us. Permanent plugins can only be added at creation, so this
// is the one chance to get it right.
//
// Buyers pay the Candy Machine's solPayment guard, which sends the SOL
// straight to the treasury. Nothing in this repo ever holds it, and no key
// of ours needs to be online for someone to mint.
//
// Run:  node setup.mjs --cluster devnet
//       node setup.mjs --cluster mainnet
import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  generateSigner, keypairIdentity, publicKey, sol, some, none, percentAmount
} from '@metaplex-foundation/umi';
import { mplCore, createCollection } from '@metaplex-foundation/mpl-core';
import { create, mplCandyMachine, fetchCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';

const args = process.argv.slice(2);
const cluster = (args[args.indexOf('--cluster') + 1] || '').toLowerCase();
if (cluster !== 'devnet' && cluster !== 'mainnet') {
  console.error('Usage: node setup.mjs --cluster devnet|mainnet');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
if (!fs.existsSync('./uploaded.json')) {
  console.error('No uploaded.json — run node upload.mjs first.');
  process.exit(1);
}
const uploaded = JSON.parse(fs.readFileSync('./uploaded.json', 'utf8'));

const CACHE = './cache.' + cluster + '.json';
if (fs.existsSync(CACHE)) {
  console.error(CACHE + ' already exists. Delete it only if you really mean to');
  console.error('create a second collection — the old one cannot be undone.');
  process.exit(1);
}

const rpc = cluster === 'devnet'
  ? 'https://api.devnet.solana.com'
  : (process.env.RPC_URL || 'https://api.mainnet-beta.solana.com');
const umi = createUmi(rpc).use(mplCore()).use(mplCandyMachine());

// The authority keypair exists only to sign these two transactions and to own
// the Candy Machine afterwards. It never receives revenue: that goes straight
// to the treasury through the solPayment guard.
if (!fs.existsSync('./authority.json')) {
  const fresh = generateSigner(umi);
  fs.writeFileSync('./authority.json', JSON.stringify(Array.from(fresh.secretKey)));
  console.log('Created authority.json — a fresh keypair for this collection.');
}
const secret = Uint8Array.from(JSON.parse(fs.readFileSync('./authority.json', 'utf8')));
const authority = umi.eddsa.createKeypairFromSecretKey(secret);
umi.use(keypairIdentity(authority));
console.log('cluster   :', cluster);
console.log('authority :', authority.publicKey);

let balance = await umi.rpc.getBalance(authority.publicKey);
if (cluster === 'devnet' && balance.basisPoints < 100000000n) {
  // The public faucet is often dry or rate limited. That is not a failure
  // worth stopping for — the balance check below has the final say.
  try {
    console.log('asking the devnet faucet for 2 SOL...');
    await umi.rpc.airdrop(authority.publicKey, sol(2));
    balance = await umi.rpc.getBalance(authority.publicKey);
  } catch (e) {
    console.log('  faucet said no. Fund it yourself: solana transfer ' + authority.publicKey + ' 0.5 -u devnet');
  }
}
console.log('balance   :', Number(balance.basisPoints) / 1e9, 'SOL');
if (balance.basisPoints < 100000000n) {
  console.error('\nNot enough SOL. Send at least 0.1 SOL to ' + authority.publicKey + ' and run again.');
  process.exit(1);
}

// ── the collection ──
const collection = generateSigner(umi);
console.log('\ncreating collection', collection.publicKey);
await createCollection(umi, {
  collection: collection,
  name: config.collectionName,
  uri: uploaded.collection,
  plugins: [
    { type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }
  ]
}).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
console.log('  frozen for good, no thaw authority');

// ── the candy machine ──
// Hidden Settings rather than config lines: every collectible shares one name
// template and one URI, so a hundred thousand of them cost the same rent as
// ten, and nothing has to be loaded before minting can start. There is no
// reveal, so the hash is only a marker.
const candyMachine = generateSigner(umi);
const hash = new Uint8Array(32);
new TextEncoder().encodeInto('solquicks-collectible-no-reveal', hash);

console.log('creating candy machine', candyMachine.publicKey);
const builder = await create(umi, {
  candyMachine: candyMachine,
  collection: collection.publicKey,
  collectionUpdateAuthority: umi.identity,
  itemsAvailable: config.itemsAvailable,
  isMutable: false,
  configLineSettings: none(),
  hiddenSettings: some({
    name: config.assetName + ' #$ID$',
    uri: uploaded.asset,
    hash: hash
  }),
  guards: {
    solPayment: some({ lamports: sol(config.priceSol), destination: publicKey(config.treasury) }),
    // Deliberately no botTax. It turns a rejected mint into a *successful*
    // transaction that quietly takes the tax and creates nothing, so someone
    // who already owns one would pay to be told no. There is nothing to snipe
    // in an open edition that costs 0.1 SOL a go, so rejections should simply
    // fail and say why.
    mintLimit: some({ id: 1, limit: config.mintLimitPerWallet })
  }
});
await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

const cm = await fetchCandyMachine(umi, candyMachine.publicKey);
const cache = {
  cluster: cluster,
  collection: collection.publicKey,
  candyMachine: candyMachine.publicKey,
  candyGuard: cm.mintAuthority,
  authority: authority.publicKey,
  treasury: config.treasury,
  priceSol: config.priceSol,
  itemsAvailable: Number(cm.data.itemsAvailable),
  assetUri: uploaded.asset,
  createdAt: new Date().toISOString()
};
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));

console.log('\ndone.');
console.log(JSON.stringify(cache, null, 2));
console.log('\nPut these in worker/wrangler.toml and in the MINT block in index.html.');
