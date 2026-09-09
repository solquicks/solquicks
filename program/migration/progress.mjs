// How far did the migration actually get? Reads the chain, not the log.
import fs from 'node:fs';
import pkg from '/Users/solquicks/Developer/solquicks.com/program/scripts/node_modules/@solana/web3.js/lib/index.cjs.js';
const { Connection, PublicKey } = pkg;
import { TMETA, parseMetadata } from './meta-ix.mjs';

const conn = new Connection('https://solquicks-rpc-proxy.solquicks-45c.workers.dev', 'confirmed');
const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const names = JSON.parse(fs.readFileSync('./names.json', 'utf8'));
const mints = Object.keys(uris);
const pdas = mints.map((m) => PublicKey.findProgramAddressSync(
  [Buffer.from('metadata'), new PublicKey(TMETA).toBuffer(), new PublicKey(m).toBuffer()],
  new PublicKey(TMETA))[0]);

let done = 0, todo = 0, nameFixed = 0;
for (let i = 0; i < pdas.length; i += 100) {
  const infos = await conn.getMultipleAccountsInfo(pdas.slice(i, i + 100));
  infos.forEach((info, j) => {
    if (!info) return;
    const m = parseMetadata(new Uint8Array(info.data));
    const mint = mints[i + j];
    if (m.uri === uris[mint]) { done++; if (m.name) nameFixed++; } else todo++;
  });
}
console.log('migrated so far :', done, '/', mints.length);
console.log('still to do     :', todo, '(' + Math.ceil(todo / 3) + ' transactions,', Math.ceil(Math.ceil(todo / 3) / 12), 'signing rounds)');
console.log('names restored  :', nameFixed, 'of the migrated ones');
