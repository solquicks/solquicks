import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, keypairIdentity, publicKey, sol, some, none } from '@metaplex-foundation/umi';
import { mplCore, createCollection } from '@metaplex-foundation/mpl-core';
import { create, mplCandyMachine, mintV1, fetchCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';

const umi = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine());
const authority = generateSigner(umi);
umi.use(keypairIdentity(authority));
await umi.rpc.airdrop(authority.publicKey, sol(10));
const bal = async () => Number((await umi.rpc.getBalance(authority.publicKey)).basisPoints) / 1e9;

let before = await bal();
const collection = generateSigner(umi);
await createCollection(umi, {
  collection, name: 'solquicks Collectibles', uri: 'https://arweave.net/' + 'x'.repeat(43),
  plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }]
}).sendAndConfirm(umi);
const afterCollection = await bal();
console.log('collection        :', (before - afterCollection).toFixed(6), 'SOL');

before = afterCollection;
const cm = generateSigner(umi);
await (await create(umi, {
  candyMachine: cm, collection: collection.publicKey, collectionUpdateAuthority: umi.identity,
  itemsAvailable: 100000, isMutable: false, configLineSettings: none(),
  hiddenSettings: some({ name: 'solquicks Collectible #$ID$', uri: 'https://arweave.net/' + 'y'.repeat(43), hash: new Uint8Array(32) }),
  guards: {
    solPayment: some({ lamports: sol(0.1), destination: publicKey('uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc') }),
    mintLimit: some({ id: 1, limit: 1 })
  }
})).sendAndConfirm(umi);
const afterCm = await bal();
console.log('candy machine     :', (before - afterCm).toFixed(6), 'SOL');
console.log('setup total       :', (10 - afterCm).toFixed(6), 'SOL');

// what a buyer pays beyond the 0.1
const buyer = generateSigner(umi);
await umi.rpc.airdrop(buyer.publicKey, sol(1));
const bUmi = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine()).use(keypairIdentity(buyer));
const bBal = async () => Number((await umi.rpc.getBalance(buyer.publicKey)).basisPoints) / 1e9;
const bBefore = await bBal();
const asset = generateSigner(bUmi);
const guard = (await fetchCandyMachine(umi, cm.publicKey)).mintAuthority;
await mintV1(bUmi, {
  candyMachine: cm.publicKey, candyGuard: guard, asset, collection: collection.publicKey,
  mintArgs: { solPayment: some({ destination: publicKey('uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc') }), mintLimit: some({ id: 1 }) }
}).prepend(setComputeUnitLimit(bUmi, { units: 400000 })).sendAndConfirm(bUmi);
const bAfter = await bBal();
console.log('\nbuyer pays        :', (bBefore - bAfter).toFixed(6), 'SOL  (0.1 price + the rest)');
console.log('  beyond the price:', (bBefore - bAfter - 0.1).toFixed(6), 'SOL');
