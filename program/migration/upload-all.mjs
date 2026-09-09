// Full migration upload. Images first, then JSON rewritten to point at the new
// image URLs. Progress is saved after every file so this can be re-run safely
// without paying twice for anything already uploaded.
import fs from 'node:fs';
import bs58 from 'bs58';
import { TurboFactory } from '@ardrive/turbo-sdk';

const key = JSON.parse(fs.readFileSync('./uploader.json', 'utf8'));
const b58 = (bs58.default || bs58).encode(Uint8Array.from(key));
const turbo = TurboFactory.authenticated({ privateKey: b58, token: 'solana' });

const STATE = './upload-state.json';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { images: {}, meta: {} };
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

async function put(path, contentType) {
  const size = fs.statSync(path).size;
  const r = await turbo.uploadFile({
    fileStreamFactory: () => fs.createReadStream(path),
    fileSizeFactory: () => size,
    dataItemOpts: { tags: [{ name: 'Content-Type', value: contentType }] },
  });
  return r.id;
}

// ── images ──
const images = fs.readdirSync('./prepared/images');
let n = 0;
for (const f of images) {
  const mint = f.replace('.jpeg', '');
  n++;
  if (state.images[mint]) continue;
  state.images[mint] = await put('./prepared/images/' + f, 'image/jpeg');
  save();
  if (n % 20 === 0) console.log('  images', n, '/', images.length);
}
console.log('images done:', Object.keys(state.images).length);

// ── metadata, pointed at the images we just uploaded ──
const metas = fs.readdirSync('./prepared/meta');
n = 0;
for (const f of metas) {
  const mint = f.replace('.json', '');
  n++;
  if (state.meta[mint]) continue;
  const json = JSON.parse(fs.readFileSync('./prepared/meta/' + f, 'utf8'));
  if (state.images[mint]) {
    const url = 'https://arweave.net/' + state.images[mint];
    json.image = url;
    json.properties = json.properties || {};
    json.properties.files = [{ uri: url, type: 'image/jpeg' }];
    json.properties.category = 'image';
  }
  // a trait-swapped Ranger keeps the artwork it already has on Arweave
  const tmp = './prepared/meta/.tmp-' + mint + '.json';
  fs.writeFileSync(tmp, JSON.stringify(json));
  state.meta[mint] = await put(tmp, 'application/json');
  fs.unlinkSync(tmp);
  save();
  if (n % 20 === 0) console.log('  metadata', n, '/', metas.length);
}
console.log('metadata done:', Object.keys(state.meta).length);

const map = {};
for (const [mint, id] of Object.entries(state.meta)) map[mint] = 'https://arweave.net/' + id;
fs.writeFileSync('./new-uris.json', JSON.stringify(map, null, 2));
console.log('wrote new-uris.json —', Object.keys(map).length, 'Rangers ready for the on-chain update');
console.log('remaining credit:', (await turbo.getBalance()).winc, 'winc');
