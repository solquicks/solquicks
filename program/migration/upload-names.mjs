// Uploads the corrected metadata for Ranger #236 and Ranger #290 to Arweave
// through Turbo, and checks each can be read back before printing its URL.
// Costs a fraction of a cent from the credit bought during the migration.
//
// Run:  node upload-names.mjs
import fs from 'node:fs';
import bs58 from 'bs58';
import { TurboFactory } from '@ardrive/turbo-sdk';

const FILES = [
  { file: './prepared/ranger-236.json', name: 'Ranger #236' },
  { file: './prepared/ranger-290.json', name: 'Ranger #290' }
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
  console.log(`\n${f.name}\n  URL         : ${urls[f.name]}`);
  // A fresh upload 404s on arweave.net for a while — indexing lag, not failure.
  // Two independent AR.IO gateways are the honest check.
  for (const gw of ['https://vilenarios.com', 'https://frostor.xyz']) {
    try {
      const r = await fetch(gw + '/' + res.id);
      const ok = r.ok && JSON.parse(await r.text()).name === f.name;
      console.log(`  ${gw.padEnd(24)}: ${ok ? 'reads back correctly' : 'not there yet'}`);
    } catch (e) { console.log(`  ${gw.padEnd(24)}: not there yet`); }
  }
}
console.log('\ncredit after  :', (await turbo.getBalance()).winc);
console.log('\nPaste both URLs into royalties.html.');
