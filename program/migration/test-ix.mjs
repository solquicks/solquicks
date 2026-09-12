// Proves the encoding before any UI exists: parse a real Ranger, rebuild the
// instruction with only the uri changed, and SIMULATE it on mainnet.
import fs from 'node:fs';
import pkg from '@solana/web3.js';
const { Connection, PublicKey, Transaction, TransactionInstruction } = pkg;
import { TMETA, parseMetadata, updateUriIxData } from './meta-ix.mjs';

const RPC = 'https://solquicks-rpc-proxy.solquicks-45c.workers.dev';
const conn = new Connection(RPC, 'confirmed');
const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const UA = new PublicKey('31jpe6JUemS1YBSnjn8uR9vgfb2eXVAGwGyssMzz6HBU');

const mints = Object.keys(uris).slice(0, 3);
const ixs = [];
for (const mint of mints) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), new PublicKey(TMETA).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(TMETA));
  const info = await conn.getAccountInfo(pda);
  const meta = parseMetadata(new Uint8Array(info.data));
  console.log(`${mint.slice(0, 8)}…  name="${meta.name}" sym=${meta.symbol} fee=${meta.sellerFeeBasisPoints} creators=${meta.creators.length} collection=${meta.collection ? 'yes' : 'no'} mutable=${meta.isMutable}`);
  console.log(`   old uri: ${meta.uri.slice(0, 60)}`);
  console.log(`   new uri: ${uris[mint]}`);
  ixs.push(new TransactionInstruction({
    programId: new PublicKey(TMETA),
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: UA, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(updateUriIxData(meta, uris[mint])),
  }));
}

const tx = new Transaction().add(...ixs);
tx.feePayer = UA;
tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
const sim = await conn.simulateTransaction(tx, undefined, [UA]);
console.log('');
console.log('SIMULATION:', sim.value.err ? 'FAILED ' + JSON.stringify(sim.value.err) : 'SUCCEEDS ✓');
(sim.value.logs || []).filter(l => /Error|error|failed/i.test(l)).slice(0, 3).forEach(l => console.log('  ', l));
console.log('tx size:', tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length, 'bytes for', ixs.length, 'updates');
