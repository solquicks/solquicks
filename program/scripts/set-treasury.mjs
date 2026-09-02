// Rotate the stake-fee treasury on an already-initialized config.
// Usage: TREASURY=<address> node set-treasury.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('AbiL2mVBQgPbCujUuZFbdWXkHVAycriKjmQw16RiTKLG');
const RPC = process.env.RPC || 'https://api.devnet.solana.com';
const treasury = new PublicKey(process.env.TREASURY || '39gxzvkugoEVc4Qd5imJdJ8EiqqwnUGq4RT7f4i4MPGr');

const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: kp.publicKey, isSigner: true, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: treasury, isSigner: false, isWritable: false },
  ],
  data: disc('set_treasury'),
});

const sig = await conn.sendTransaction(new Transaction().add(ix), [kp]);
await conn.confirmTransaction(sig, 'confirmed');
console.log('treasury set to', treasury.toBase58());
console.log('tx:', sig);
