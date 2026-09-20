import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import { mplCandyMachine, fetchCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
const cache = JSON.parse(fs.readFileSync('./cache.mainnet.json', 'utf8'));
const umi = createUmi('https://api.mainnet-beta.solana.com').use(mplCandyMachine());
const deadline = Date.now() + 25 * 60 * 1000;
while (Date.now() < deadline) {
  try {
    const cm = await fetchCandyMachine(umi, publicKey(cache.candyMachine));
    if (Number(cm.itemsRedeemed) > 0) { console.log('MINTED: itemsRedeemed =', Number(cm.itemsRedeemed)); process.exit(0); }
  } catch (e) { /* rpc hiccup, keep watching */ }
  await new Promise((r) => setTimeout(r, 20000));
}
console.log('nothing minted in 25 minutes — still waiting');
