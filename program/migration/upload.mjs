// Uploads the prepared Moon Rangers files to Arweave via Irys, paid in SOL.
// Order matters: images first, then JSON rewritten to point at the real image
// URLs. Run with --test to prove the pipeline on one file before spending.
import fs from 'node:fs';
import path from 'node:path';
import bs58 from 'bs58';
import { Uploader } from '@irys/upload';
import { Solana } from '@irys/upload-solana';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PREP = path.join(DIR, 'prepared');
const RPC = 'https://solquicks-rpc-proxy.solquicks-45c.workers.dev';
const TEST = process.argv.includes('--test');

const key = JSON.parse(fs.readFileSync(path.join(DIR, 'uploader.json'), 'utf8'));
const secret = bs58.default ? bs58.default.encode(Uint8Array.from(key)) : bs58.encode(Uint8Array.from(key));

const irys = await Uploader(Solana).withWallet(secret).withRpc(RPC).mainnet();
console.log('uploader address:', irys.address);

const images = fs.readdirSync(path.join(PREP, 'images'));
const metas = fs.readdirSync(path.join(PREP, 'meta'));
const imgBytes = images.reduce((s, f) => s + fs.statSync(path.join(PREP, 'images', f)).size, 0);
const metaBytes = metas.reduce((s, f) => s + fs.statSync(path.join(PREP, 'meta', f)).size, 0);
const total = imgBytes + metaBytes;

const price = await irys.getPrice(total);
const bal = await irys.getBalance();
console.log('bytes to upload :', (total / 1048576).toFixed(1), 'MB across', images.length + metas.length, 'files');
console.log('irys price      :', irys.utils.fromAtomic(price).toString(), 'SOL');
console.log('irys balance    :', irys.utils.fromAtomic(bal).toString(), 'SOL');

if (TEST) {
  const one = path.join(PREP, 'images', images[0]);
  const p1 = await irys.getPrice(fs.statSync(one).size);
  if (bal.lt(p1)) {
    console.log('funding for the test file…');
    await irys.fund(p1.multipliedBy(3).integerValue());
  }
  const r = await irys.uploadFile(one, { tags: [{ name: 'Content-Type', value: 'image/jpeg' }] });
  console.log('TEST UPLOAD ->', 'https://arweave.net/' + r.id);
  process.exit(0);
}
