import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import { mplCore, fetchAsset } from '@metaplex-foundation/mpl-core';
import { mplCandyMachine, fetchCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
const cache = JSON.parse(fs.readFileSync('./cache.mainnet.json', 'utf8'));
const umi = createUmi('https://api.mainnet-beta.solana.com').use(mplCore()).use(mplCandyMachine());

const cm = await fetchCandyMachine(umi, publicKey(cache.candyMachine));
console.log('minted so far :', Number(cm.itemsRedeemed), 'of', Number(cm.data.itemsAvailable));
console.log('isMutable     :', cm.data.isMutable, cm.data.isMutable ? '(minted assets can be edited)' : '(minted assets are frozen as-is)');

// find the asset the candy machine created
const res = await fetch('https://mainnet.helius-rpc.com/?api-key=' + (process.env.HELIUS_KEY || ''), {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'searchAssets',
    params: { grouping: ['collection', cache.collection], page: 1, limit: 10 } })
}).catch(() => null);
if (res && res.ok) {
  const items = ((await res.json()).result || {}).items || [];
  for (const it of items) console.log('\nasset', it.id, '\n  owner:', it.ownership.owner, '\n  name :', it.content.metadata.name);
}
