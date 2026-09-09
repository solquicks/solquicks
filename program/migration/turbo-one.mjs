import fs from 'node:fs';
import bs58 from 'bs58';
import { TurboFactory } from '@ardrive/turbo-sdk';

const key = JSON.parse(fs.readFileSync('./uploader.json', 'utf8'));
const b58 = (bs58.default || bs58).encode(Uint8Array.from(key));
const turbo = TurboFactory.authenticated({ privateKey: b58, token: 'solana' });

const name = fs.readdirSync('./prepared/images')[0];
const p = './prepared/images/' + name;
const size = fs.statSync(p).size;
const r = await turbo.uploadFile({
  fileStreamFactory: () => fs.createReadStream(p),
  fileSizeFactory: () => size,
  dataItemOpts: { tags: [{ name: 'Content-Type', value: 'image/jpeg' }] },
});
console.log('id      :', r.id);
console.log('winc    :', r.winc);
console.log('url     : https://arweave.net/' + r.id);
fs.writeFileSync('/tmp/turbo-test-id.txt', r.id);
