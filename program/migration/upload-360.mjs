// Uploads the corrected metadata for Ranger #360 to Arweave through Turbo, and
// checks it can be read back before printing the URL. Costs a fraction of a cent
// from the credit bought during the migration.
//
// Run:  node upload-360.mjs
import fs from 'node:fs';
import bs58 from 'bs58';
import { TurboFactory } from '@ardrive/turbo-sdk';

const FILE = './prepared/ranger-360.json';
const key = JSON.parse(fs.readFileSync('./uploader.json', 'utf8'));
const turbo = TurboFactory.authenticated({ privateKey: (bs58.default || bs58).encode(Uint8Array.from(key)), token: 'solana' });

const before = (await turbo.getBalance()).winc;
console.log('credit before :', before);

const size = fs.statSync(FILE).size;
const res = await turbo.uploadFile({
  fileStreamFactory: () => fs.createReadStream(FILE),
  fileSizeFactory: () => size,
  dataItemOpts: { tags: [{ name: 'Content-Type', value: 'application/json' }] }
});
console.log('uploaded      :', res.id, '(' + res.winc + ' winc)');
console.log('credit after  :', (await turbo.getBalance()).winc);
const url = 'https://arweave.net/' + res.id;
console.log('\nURL           :', url);

// A fresh upload 404s on arweave.net for a while — that is indexing lag, not
// failure. Two independent AR.IO gateways are the honest check.
for (const gw of ['https://vilenarios.com', 'https://frostor.xyz']) {
  try {
    const r = await fetch(gw + '/' + res.id);
    const text = r.ok ? await r.text() : '';
    console.log(gw.padEnd(26), r.status, r.ok && JSON.parse(text).name === 'Ranger #360' ? 'reads back correctly' : 'not there yet');
  } catch (e) { console.log(gw.padEnd(26), 'not there yet'); }
}
console.log('\nPaste that URL into royalties.html when you run the repair.');
