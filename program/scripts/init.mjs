// Initialize the moon-stake config.
// Treasury defaults to the owner's stake-fee wallet; override with TREASURY=...
// Fee starts at 0 — set it with set_fee once on-chain staking is live.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('AbiL2mVBQgPbCujUuZFbdWXkHVAycriKjmQw16RiTKLG');
const COLLECTION = new PublicKey('5QuB6vy8181PG9g9SiQD6U7TfvuF9hcP9tAjj5DH79oz');
const FEE_LAMPORTS = 0n;

const disc = (name) =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8')))
);
const DEFAULT_TREASURY = '39gxzvkugoEVc4Qd5imJdJ8EiqqwnUGq4RT7f4i4MPGr';
const treasury = new PublicKey(process.env.TREASURY || DEFAULT_TREASURY);

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);

const existing = await conn.getAccountInfo(config);
if (existing) {
  console.log('config already initialized at', config.toBase58());
  process.exit(0);
}

const data = Buffer.concat([
  disc('initialize'),
  COLLECTION.toBuffer(),
  (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(FEE_LAMPORTS); return b; })(),
]);

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: kp.publicKey, isSigner: true, isWritable: true },
    { pubkey: treasury, isSigner: false, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});

const sig = await conn.sendTransaction(new Transaction().add(ix), [kp]);
await conn.confirmTransaction(sig, 'confirmed');
console.log('initialized');
console.log('  config   :', config.toBase58());
console.log('  admin    :', kp.publicKey.toBase58());
console.log('  treasury :', treasury.toBase58());
console.log('  fee      :', FEE_LAMPORTS.toString(), 'lamports');
console.log('  tx       : https://solscan.io/tx/' + sig + '?cluster=devnet');
