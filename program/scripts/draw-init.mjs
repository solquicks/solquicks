// Initialize the moon-draw config. Authority is the local keypair.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('8BqrCR3hdX6o1P3tnEjX5xuV9FbTJLU2F8aNBNF5XvCp');
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8')))
);
const conn = new Connection(process.env.RPC || 'https://api.devnet.solana.com', 'confirmed');
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);

if (await conn.getAccountInfo(config)) {
  console.log('config already initialized at', config.toBase58());
  process.exit(0);
}

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: kp.publicKey, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: disc('initialize'),
});

const tx = new Transaction().add(ix);
const sig = await conn.sendTransaction(tx, [kp]);
await conn.confirmTransaction(sig, 'confirmed');
console.log('initialized');
console.log('  config   :', config.toBase58());
console.log('  authority:', kp.publicKey.toBase58());
console.log('  tx       : https://solscan.io/tx/' + sig + '?cluster=devnet');
