import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import { mplCore, fetchCollection, fetchAsset } from '@metaplex-foundation/mpl-core';
import { mplCandyMachine, fetchCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
const cache = JSON.parse(fs.readFileSync('./cache.mainnet.json', 'utf8'));
const umi = createUmi('https://api.mainnet-beta.solana.com').use(mplCore()).use(mplCandyMachine());

const col = await fetchCollection(umi, publicKey(cache.collection));
console.log('collection name :', col.name);
console.log('collection uri  :', col.uri);

const cm = await fetchCandyMachine(umi, publicKey(cache.candyMachine));
const h = cm.data.hiddenSettings.value;
console.log('\nnext mints named:', h.name);
console.log('next mints uri  :', h.uri);
console.log('minted so far   :', Number(cm.itemsRedeemed));

const first = await fetchAsset(umi, publicKey('FGD7iLSqNPxeX7MN7u1c9Ge2Hvoaa6gEGh9YX8pWbR6F'));
console.log('\n#0 name (left alone):', first.name);
console.log('#0 uri  (left alone):', first.uri);
console.log('#0 still frozen     :', first.permanentFreezeDelegate.frozen,
  '· thaw authority', first.permanentFreezeDelegate.authority.type);
