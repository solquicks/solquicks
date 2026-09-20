// Renames the collection and the template future mints are named from.
// Already-minted assets are left alone: they keep the name and the metadata
// URI they were minted with, which is why #0 stays as it was.
import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey, some } from '@metaplex-foundation/umi';
import { mplCore, updateCollectionV1, fetchCollection } from '@metaplex-foundation/mpl-core';
import { mplCandyMachine, fetchCandyMachine, updateCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';

const cache = JSON.parse(fs.readFileSync('./cache.mainnet.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const uploaded = JSON.parse(fs.readFileSync('./uploaded.json', 'utf8'));
const umi = createUmi(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com')
  .use(mplCore()).use(mplCandyMachine());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync('./authority.json', 'utf8'))))));

const before = await fetchCollection(umi, publicKey(cache.collection));
console.log('collection was:', before.name);
await updateCollectionV1(umi, {
  collection: publicKey(cache.collection),
  newName: config.collectionName,
  newUri: uploaded.collection
}).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
console.log('collection now:', config.collectionName);

const cm = await fetchCandyMachine(umi, publicKey(cache.candyMachine));
const wasName = cm.data.hiddenSettings.__option === 'Some' ? cm.data.hiddenSettings.value.name : '?';
console.log('\ntemplate was  :', wasName);
await updateCandyMachine(umi, {
  candyMachine: publicKey(cache.candyMachine),
  data: {
    ...cm.data,
    hiddenSettings: some({
      name: config.assetName + ' #$ID$',
      uri: uploaded.asset,
      hash: cm.data.hiddenSettings.value.hash
    })
  }
}).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
console.log('template now  :', config.assetName + ' #$ID$');

fs.writeFileSync('./cache.mainnet.json', JSON.stringify({ ...cache, assetUri: uploaded.asset, renamedAt: new Date().toISOString() }, null, 2));
console.log('\ndone — #0 keeps its own name and its own metadata.');
