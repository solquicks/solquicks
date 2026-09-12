import fs from 'node:fs';
import pkg from '@solana/web3.js';
const { Connection, PublicKey, Transaction, TransactionInstruction } = pkg;
import { TMETA, parseMetadata, updateUriIxData } from './meta-ix.mjs';

const conn = new Connection('https://solquicks-rpc-proxy.solquicks-45c.workers.dev', 'confirmed');
const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const names = JSON.parse(fs.readFileSync('./names.json', 'utf8'));
const UA = new PublicKey('31jpe6JUemS1YBSnjn8uR9vgfb2eXVAGwGyssMzz6HBU');

// how many updates fit in one transaction?
for (const per of [3, 4, 5, 6]) {
  const mints = Object.keys(uris).slice(0, per);
  const ixs = [];
  for (const mint of mints) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), new PublicKey(TMETA).toBuffer(), new PublicKey(mint).toBuffer()],
      new PublicKey(TMETA));
    const info = await conn.getAccountInfo(pda);
    const meta = parseMetadata(new Uint8Array(info.data));
    if (names[mint]) meta.name = names[mint];      // restore the missing name
    ixs.push(new TransactionInstruction({
      programId: new PublicKey(TMETA),
      keys: [{ pubkey: pda, isSigner: false, isWritable: true },
             { pubkey: UA, isSigner: true, isWritable: false }],
      data: Buffer.from(updateUriIxData(meta, uris[mint])),
    }));
  }
  try {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = UA;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
    const sim = await conn.simulateTransaction(tx, undefined, [UA]);
    console.log(`${String(per).padStart(2)} per tx -> ${String(size).padStart(4)} bytes | ${sim.value.err ? 'FAILS ' + JSON.stringify(sim.value.err) : 'simulates OK'}`);
  } catch (e) {
    console.log(`${String(per).padStart(2)} per tx -> TOO LARGE (${String(e.message).slice(0, 60)})`);
  }
}
