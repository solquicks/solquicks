// Solflare groups by the legacy `collection` object inside the metadata JSON,
// not only by the on-chain certified collection. The trait-swapped Rangers were
// written without it, so the collection shows up split in two. This adds the
// field to those and re-uploads them.
import fs from 'node:fs';
import bs58 from 'bs58';
import { TurboFactory } from '@ardrive/turbo-sdk';

const LEGACY = { name: 'Moon Rangers', family: 'LaunchMyNFT' };
const GW = ['https://arweave.net', 'https://vilenarios.com', 'https://frostor.xyz'];

const key = JSON.parse(fs.readFileSync('./uploader.json', 'utf8'));
const b58 = (bs58.default || bs58).encode(Uint8Array.from(key));
const turbo = TurboFactory.authenticated({ privateKey: b58, token: 'solana' });

const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const targets = JSON.parse(fs.readFileSync('./needs-collection-field.json', 'utf8'));
console.log('Rangers to fix:', targets.length);

async function get(id) {
  for (const g of GW) {
    try { const r = await fetch(g + '/' + id, { signal: AbortSignal.timeout(25000), redirect: 'follow' });
      if (r.ok) return await r.json(); } catch (e) {}
  }
  return null;
}

let fixed = 0;
for (const mint of targets) {
  const json = await get(uris[mint].split('/').pop());
  if (!json) { console.log('  skip (unreachable)', mint.slice(0, 10)); continue; }
  json.collection = LEGACY;                       // the only change
  const tmp = './prepared/.fix-' + mint + '.json';
  fs.writeFileSync(tmp, JSON.stringify(json));
  const r = await turbo.uploadFile({
    fileStreamFactory: () => fs.createReadStream(tmp),
    fileSizeFactory: () => fs.statSync(tmp).size,
    dataItemOpts: { tags: [{ name: 'Content-Type', value: 'application/json' }] },
  });
  fs.unlinkSync(tmp);
  uris[mint] = 'https://arweave.net/' + r.id;     // the migrate page picks this up
  fixed++;
  console.log('  ', fixed + '/' + targets.length, json.name || mint.slice(0, 8), '->', r.id.slice(0, 12) + '…');
}

fs.writeFileSync('./new-uris.json', JSON.stringify(uris, null, 2));
console.log('');
console.log('re-uploaded', fixed, '— new-uris.json updated, so Scan will offer exactly these.');
