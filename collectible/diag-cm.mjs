import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, keypairIdentity, publicKey, sol, some, none } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { create, mplCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';
import { Connection } from '@solana/web3.js';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const uploaded = JSON.parse(fs.readFileSync('./uploaded.json', 'utf8'));
const RPC = 'https://api.mainnet-beta.solana.com';
const umi = createUmi(RPC).use(mplCore()).use(mplCandyMachine());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync('./authority.json', 'utf8'))))));

const cm = generateSigner(umi);
const hash = new Uint8Array(32);
new TextEncoder().encodeInto('solquicks-collectible-no-reveal', hash);
const builder = await create(umi, {
  candyMachine: cm,
  collection: publicKey('GHhygKTrAoPzdFABab4SRErtTcZVfrbhxtpNDWJHLJwW'),
  collectionUpdateAuthority: umi.identity,
  itemsAvailable: config.itemsAvailable,
  isMutable: false,
  configLineSettings: none(),
  hiddenSettings: some({ name: config.assetName + ' #$ID$', uri: uploaded.asset, hash }),
  guards: {
    solPayment: some({ lamports: sol(config.priceSol), destination: publicKey(config.treasury) }),
    mintLimit: some({ id: 1, limit: config.mintLimitPerWallet })
  }
});

console.log('instructions in the transaction:', builder.items.length);
const withHash = await builder.setLatestBlockhash(umi);
const built = withHash.build(umi);
const signed = await umi.identity.signTransaction(built);
const bytes = umi.transactions.serialize(signed);
console.log('serialized size:', bytes.length, 'bytes   (limit 1232)');
console.log('rent needed    :', Number((await umi.rpc.getRent(0)).basisPoints) / 1e9, 'SOL for an empty account');
console.log('balance        :', Number((await umi.rpc.getBalance(umi.identity.publicKey)).basisPoints) / 1e9, 'SOL');

const c = new Connection(RPC, 'confirmed');
const sim = await c.simulateTransaction(toWeb3JsTransaction(signed), { sigVerify: false, replaceRecentBlockhash: true });
console.log('\nsimulation err :', JSON.stringify(sim.value.err));
console.log('units consumed :', sim.value.unitsConsumed);
for (const l of sim.value.logs || []) console.log('  ', l);
