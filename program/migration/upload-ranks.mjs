// Uploads corrected metadata for the four Rangers carrying another Ranger's
// Rarity Rank, verifies each reads back, and writes the resulting addresses to
// prepared/rank-uris.json so the signing page can be pointed at them.
//
// Run:  node upload-ranks.mjs
import fs from 'node:fs';
import bs58 from 'bs58';
import { TurboFactory } from '@ardrive/turbo-sdk';

const FILES = [
  { file: './prepared/rank-236.json', name: 'Ranger #236' },
  { file: './prepared/rank-290.json', name: 'Ranger #290' },
  { file: './prepared/rank-46.json', name: 'Ranger #46' },
  { file: './prepared/rank-205.json', name: 'Ranger #205' }
];
const key = JSON.parse(fs.readFileSync('./uploader.json', 'utf8'));
const turbo = TurboFactory.authenticated({ privateKey: (bs58.default || bs58).encode(Uint8Array.from(key)), token: 'solana' });

console.log('credit before :', (await turbo.getBalance()).winc);
const urls = {};
for (const f of FILES) {
  const size = fs.statSync(f.file).size;
  const res = await turbo.uploadFile({
    fileStreamFactory: () => fs.createReadStream(f.file),
    fileSizeFactory: () => size,
    dataItemOpts: { tags: [{ name: 'Content-Type', value: 'application/json' }] }
  });
  urls[f.name] = 'https://arweave.net/' + res.id;
  const want = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  const rank = want.attributes.find((a) => a.trait_type === 'Rarity Rank').value;
  console.log(`\n${f.name}  (rank ${rank})\n  ${urls[f.name]}`);
  // arweave.net 404s for hours after an upload while it indexes; these serve it now
  for (const gw of ['https://vilenarios.com', 'https://frostor.xyz']) {
    try {
      const r = await fetch(gw + '/' + res.id);
      const doc = r.ok ? JSON.parse(await r.text()) : null;
      const ok = doc && doc.name === f.name && doc.attributes.some((a) => a.trait_type === 'Rarity Rank' && a.value === rank);
      console.log(`  ${gw.padEnd(24)}: ${ok ? 'reads back correctly' : 'not there yet'}`);
    } catch (e) { console.log(`  ${gw.padEnd(24)}: not there yet`); }
  }
}
fs.writeFileSync('./prepared/rank-uris.json', JSON.stringify(urls, null, 1));
console.log('\ncredit after  :', (await turbo.getBalance()).winc);
console.log('\nSaved to prepared/rank-uris.json — tell Claude it is done.');
