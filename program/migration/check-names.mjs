// How many Rangers have a blank NAME on chain (not just in the indexer)?
import fs from 'node:fs';
import pkg from '/Users/solquicks/Developer/solquicks.com/program/scripts/node_modules/@solana/web3.js/lib/index.cjs.js';
const { Connection, PublicKey } = pkg;
import { TMETA, parseMetadata } from './meta-ix.mjs';

const conn = new Connection('https://solquicks-rpc-proxy.solquicks-45c.workers.dev', 'confirmed');
const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const mints = Object.keys(uris);

const pdas = mints.map((m) => PublicKey.findProgramAddressSync(
  [Buffer.from('metadata'), new PublicKey(TMETA).toBuffer(), new PublicKey(m).toBuffer()],
  new PublicKey(TMETA))[0]);

let blank = 0, named = 0, feeWrong = 0;
const examples = [];
for (let i = 0; i < pdas.length; i += 100) {
  const infos = await conn.getMultipleAccountsInfo(pdas.slice(i, i + 100));
  infos.forEach((info, j) => {
    if (!info) return;
    const m = parseMetadata(new Uint8Array(info.data));
    if (!m.name) { blank++; if (examples.length < 3) examples.push(mints[i + j]); }
    else { named++; }
    if (m.sellerFeeBasisPoints !== 300) feeWrong++;
  });
}
console.log('on-chain NAME blank :', blank);
console.log('on-chain NAME set   :', named);
console.log('royalty not 300 bps :', feeWrong);
