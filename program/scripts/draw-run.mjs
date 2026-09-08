// Commit a draw and request randomness from the MagicBlock VRF oracle, then
// wait for the callback to land. Usage: node draw-run.mjs <mission> <hash-hex> <total> <winners>
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction, TransactionInstruction, ComputeBudgetProgram,
} from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('8BqrCR3hdX6o1P3tnEjX5xuV9FbTJLU2F8aNBNF5XvCp');
const VRF_PROGRAM = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
const ORACLE_QUEUE = new PublicKey('Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh');

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const str = (s) => {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

const [mission, hashHex, total, winners] = process.argv.slice(2);
if (!mission) { console.error('usage: node draw-run.mjs <mission> <hash-hex> <total> <winners>'); process.exit(1); }

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8')))
);
const conn = new Connection(process.env.RPC || 'https://api.devnet.solana.com', 'confirmed');

const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
const [draw] = PublicKey.findProgramAddressSync([Buffer.from('draw'), Buffer.from(mission, 'utf8')], PROGRAM_ID);
const [identity] = PublicKey.findProgramAddressSync([Buffer.from('identity')], PROGRAM_ID);

console.log('draw account:', draw.toBase58());

// ── commit ──
if (!(await conn.getAccountInfo(draw))) {
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: kp.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: draw, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc('commit_draw'), str(mission),
      Buffer.from(hashHex, 'hex'), u64(total), Buffer.from([Number(winners)]),
    ]),
  });
  const sig = await conn.sendTransaction(new Transaction().add(ix), [kp]);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log('committed  :', sig);
} else {
  console.log('committed  : already');
}

// ── request randomness ──
const parse = (data) => {
  let o = 8;
  const mlen = data.readUInt32LE(o); o += 4;
  const m = data.subarray(o, o + mlen).toString('utf8'); o += mlen;
  const snapshot = data.subarray(o, o + 32); o += 32;
  const totalTickets = data.readBigUInt64LE(o); o += 8;
  const winnerCount = data[o]; o += 1;
  const randomness = data.subarray(o, o + 32); o += 32;
  const requested = data[o] === 1;
  return { mission: m, snapshot: snapshot.toString('hex'), totalTickets, winnerCount, randomness: randomness.toString('hex'), requested };
};

let state = parse((await conn.getAccountInfo(draw)).data);
if (!state.requested) {
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: kp.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: draw, isSigner: false, isWritable: true },
      { pubkey: ORACLE_QUEUE, isSigner: false, isWritable: true },
      { pubkey: identity, isSigner: false, isWritable: false },
      { pubkey: VRF_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('request_draw'), str(mission)]),
  });
  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }))
    .add(ix);
  const sig = await conn.sendTransaction(tx, [kp]);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log('requested  :', sig);
} else {
  console.log('requested  : already');
}

// ── wait for the oracle ──
process.stdout.write('waiting for the oracle ');
for (let i = 0; i < 60; i++) {
  state = parse((await conn.getAccountInfo(draw)).data);
  if (!/^0+$/.test(state.randomness)) break;
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 2000));
}
console.log('');
console.log('mission    :', state.mission);
console.log('snapshot   :', state.snapshot);
console.log('entries    :', state.totalTickets.toString(), 'winners:', state.winnerCount);
console.log('randomness :', /^0+$/.test(state.randomness) ? 'STILL UNSET' : state.randomness);
