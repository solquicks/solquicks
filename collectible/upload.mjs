// Puts the collectible's artwork and metadata on Arweave through Turbo, and
// reads each one back from two independent gateways before believing it.
//
// Turbo, not Irys: the Rangers migration proved Irys leaves uploads unseeded
// (seededTo: []), which means they can vanish. Uses the same credit and the
// same uploader key as that migration.
//
// Run:  node upload.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { TurboFactory } from '@ardrive/turbo-sdk';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const KEY = '../program/migration/uploader.json';

if (!fs.existsSync(config.artwork)) {
  console.error('No artwork at ' + config.artwork + '. Drop the PNG there first.');
  process.exit(1);
}
if (!fs.existsSync(KEY)) {
  console.error('No Turbo uploader key at ' + KEY + '.');
  process.exit(1);
}

const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
const turbo = TurboFactory.authenticated({
  privateKey: (bs58.default || bs58).encode(Uint8Array.from(key)),
  token: 'solana'
});

async function put(path, contentType) {
  const size = fs.statSync(path).size;
  const res = await turbo.uploadFile({
    fileStreamFactory: () => fs.createReadStream(path),
    fileSizeFactory: () => size,
    dataItemOpts: { tags: [{ name: 'Content-Type', value: contentType }] }
  });
  return 'https://arweave.net/' + res.id;
}

// A fresh upload 404s on arweave.net for a while — that is indexing lag, not
// failure. Two independent AR.IO gateways are the honest check.
async function readsBack(url, check) {
  const id = url.split('/').pop();
  for (const gw of ['https://vilenarios.com', 'https://frostor.xyz']) {
    try {
      const r = await fetch(gw + '/' + id);
      if (r.ok && (await check(r))) return gw;
    } catch (e) { /* try the next gateway */ }
  }
  return null;
}

console.log('credit before :', (await turbo.getBalance()).winc);

const ext = config.artwork.split('.').pop().toLowerCase();
const imageType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;

// Arweave is permanent, so re-running this to fix a description should not
// leave a second copy of the same picture up there for good.
const artHash = crypto.createHash('sha256').update(fs.readFileSync(config.artwork)).digest('hex');
const previous = fs.existsSync('./uploaded.json') ? JSON.parse(fs.readFileSync('./uploaded.json', 'utf8')) : {};
let image;
if (previous.image && previous.artHash === artHash) {
  image = previous.image;
  console.log('\nartwork       :', image, '(unchanged, not uploaded again)');
} else {
  image = await put(config.artwork, imageType);
  console.log('\nartwork       :', image);
  console.log('  reads back  :', (await readsBack(image, function (r) { return r.headers.get('content-type') === imageType; })) || 'not yet — try again in a minute');
}

// Every collectible shares one metadata file: same art, same perks, and the
// number lives in the on-chain name rather than in the JSON.
// Wording and traits come from config.json: they are the part that gets
// argued over, and they should not need a code change to settle.
const asset = {
  name: config.assetName,
  symbol: config.symbol,
  description: config.description,
  image: image,
  external_url: 'https://solquicks.com',
  attributes: config.attributes,
  properties: { files: [{ uri: image, type: imageType }], category: 'image' }
};
const collection = {
  name: config.collectionName,
  symbol: config.symbol,
  description: config.collectionDescription,
  image: image,
  external_url: 'https://solquicks.com',
  properties: { files: [{ uri: image, type: imageType }], category: 'image' }
};

fs.mkdirSync('./prepared', { recursive: true });
fs.writeFileSync('./prepared/asset.json', JSON.stringify(asset, null, 2));
fs.writeFileSync('./prepared/collection.json', JSON.stringify(collection, null, 2));

const assetUri = await put('./prepared/asset.json', 'application/json');
console.log('\nasset metadata:', assetUri);
console.log('  reads back  :', (await readsBack(assetUri, async function (r) {
  return JSON.parse(await r.text()).name === config.assetName;
})) || 'not yet — try again in a minute');

const collectionUri = await put('./prepared/collection.json', 'application/json');
console.log('\ncollection    :', collectionUri);
console.log('  reads back  :', (await readsBack(collectionUri, async function (r) {
  return JSON.parse(await r.text()).name === config.collectionName;
})) || 'not yet — try again in a minute');

fs.writeFileSync('./uploaded.json', JSON.stringify({ image: image, artHash: artHash, asset: assetUri, collection: collectionUri }, null, 2));
console.log('\ncredit after  :', (await turbo.getBalance()).winc);
console.log('\nWrote uploaded.json. Next: node setup.mjs --cluster devnet');
