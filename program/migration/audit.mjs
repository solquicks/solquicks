// Full post-migration audit. The update replaced the entire data struct, so
// the real question is not "did the uri change" but "did anything else".
import fs from 'node:fs';
import pkg from '/Users/solquicks/Developer/solquicks.com/program/scripts/node_modules/@solana/web3.js/lib/index.cjs.js';
const { Connection, PublicKey } = pkg;
import { TMETA, parseMetadata } from './meta-ix.mjs';

const conn = new Connection('https://solquicks-rpc-proxy.solquicks-45c.workers.dev', 'confirmed');
const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const names = JSON.parse(fs.readFileSync('./names.json', 'utf8'));
const mints = Object.keys(uris);
const COLLECTION = '5QuB6vy8181PG9g9SiQD6U7TfvuF9hcP9tAjj5DH79oz';
const b58 = (b) => new PublicKey(b).toBase58();

const bad = { uri: [], name: [], fee: [], creators: [], collection: [], unverified: [] };
const creatorSets = new Map();

for (let i = 0; i < mints.length; i += 100) {
  const pdas = mints.slice(i, i + 100).map((m) => PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), new PublicKey(TMETA).toBuffer(), new PublicKey(m).toBuffer()],
    new PublicKey(TMETA))[0]);
  const infos = await conn.getMultipleAccountsInfo(pdas);
  infos.forEach((info, j) => {
    const mint = mints[i + j];
    if (!info) { bad.uri.push(mint); return; }
    const m = parseMetadata(new Uint8Array(info.data));
    if (m.uri !== uris[mint]) bad.uri.push(mint);
    if (names[mint] && m.name !== names[mint]) bad.name.push(mint);
    if (m.sellerFeeBasisPoints !== 300) bad.fee.push(mint + ":" + m.sellerFeeBasisPoints);
    if (m.creators.length !== 3) bad.creators.push(mint + ':' + m.creators.length);
    if (!m.collection) bad.collection.push(mint);
    else {
      if (b58(m.collection.key) !== COLLECTION) bad.collection.push(mint + ':wrong');
      if (!m.collection.verified) bad.unverified.push(mint);
    }
    const key = m.creators.map((c) => b58(c.address) + '/' + c.share + '/' + (c.verified ? 'v' : '-')).join(' ');
    creatorSets.set(key, (creatorSets.get(key) || 0) + 1);
  });
}

console.log('checked', mints.length, 'Rangers on chain');
console.log('');
console.log('  uri matches target      :', mints.length - bad.uri.length, bad.uri.length ? 'FAIL ' + bad.uri.length : 'all');
console.log('  name restored           :', mints.length - bad.name.length, bad.name.length ? 'FAIL ' + bad.name.length : 'all');
console.log('  royalty still 300 bps   :', mints.length - bad.fee.length, bad.fee.length ? 'CHANGED: ' + bad.fee.slice(0,3) : 'all');
console.log('  creators still intact   :', mints.length - bad.creators.length, bad.creators.length ? 'CHANGED: ' + bad.creators.slice(0,3) : 'all');
console.log('  collection still set    :', mints.length - bad.collection.length, bad.collection.length ? 'BROKEN: ' + bad.collection.slice(0,3) : 'all');
console.log('  collection still VERIFIED:', mints.length - bad.unverified.length, bad.unverified.length ? 'LOST: ' + bad.unverified.length : 'all');
console.log('');
console.log('creator configurations found:', creatorSets.size);
for (const [k, n] of creatorSets) console.log('   ', n, 'x ', k);
