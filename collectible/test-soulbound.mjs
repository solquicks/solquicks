import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey, generateSigner, createNoopSigner, keypairIdentity } from '@metaplex-foundation/umi';
import { mplCore, transferV1, fetchAsset } from '@metaplex-foundation/mpl-core';
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';
import { Connection } from '@solana/web3.js';

const OWNER = publicKey('6N1NhZc8CAk3eZYyRWMkKXAqZrV8LSycURz2aMhmUhAd');
const ASSET = publicKey('FGD7iLSqNPxeX7MN7u1c9Ge2Hvoaa6gEGh9YX8pWbR6F');
const COLLECTION = publicKey('GHhygKTrAoPzdFABab4SRErtTcZVfrbhxtpNDWJHLJwW');
const RPC = 'https://api.mainnet-beta.solana.com';
const umi = createUmi(RPC).use(mplCore());
umi.use({ install(u) { u.identity = createNoopSigner(OWNER); u.payer = createNoopSigner(OWNER); } });

const a = await fetchAsset(umi, ASSET);
console.log('asset freeze plugin on the asset itself:', a.permanentFreezeDelegate || 'none (it is inherited from the collection)');

// Build the transfer the owner's wallet would build, and ask the chain.
const builder = transferV1(umi, { asset: ASSET, collection: COLLECTION, newOwner: publicKey('11111111111111111111111111111112') });
const withHash = await builder.setLatestBlockhash(umi);
const tx = toWeb3JsTransaction(withHash.build(umi));
const sim = await new Connection(RPC, 'confirmed').simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
console.log('\ntransfer simulation err:', JSON.stringify(sim.value.err));
for (const l of (sim.value.logs || []).slice(-5)) console.log('  ', l);
