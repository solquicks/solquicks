// The independent audit anyone can run: fetch what the site published, read
// what the chain says, and check they agree — without trusting either.
// Usage: node audit-draw.mjs <mission> [--mainnet]
import crypto from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';

const MISSION = process.argv[2];
if (!MISSION) { console.error('usage: node audit-draw.mjs <mission>'); process.exit(1); }
const RPC = process.argv.includes('--mainnet')
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com';

const published = await (await fetch(
  'https://solquicks-points.solquicks-45c.workers.dev/api/mission/draw?mission=' + MISSION
)).json();
if (published.error) { console.error(published.error); process.exit(1); }

const info = await new Connection(RPC, 'confirmed')
  .getAccountInfo(new PublicKey(published.onChain.drawAccount));
if (!info) { console.error('draw account not found on', RPC); process.exit(1); }

const d = info.data;
let o = 8;
const mlen = d.readUInt32LE(o); o += 4;
const mission = d.subarray(o, o + mlen).toString('utf8'); o += mlen;
const chainHash = d.subarray(o, o + 32).toString('hex'); o += 32;
const chainTotal = d.readBigUInt64LE(o); o += 8;
const chainWinners = d[o]; o += 1;
const chainRnd = d.subarray(o, o + 32).toString('hex');

const listHash = crypto.createHash('sha256')
  .update(published.entries.map((e) => e.wallet + ':' + e.tickets).join('\n'))
  .digest('hex');

console.log('entry list hashes to :', listHash);
console.log('chain committed hash :', chainHash);
console.log('site published hash  :', published.snapshotHash);
console.log('');
console.log('chain randomness     :', chainRnd);
console.log('site randomness      :', published.randomness);
console.log('');
console.log('chain entry total    :', String(chainTotal));
console.log('site entry total     :', published.totalTickets);

const pass = listHash === chainHash && chainHash === published.snapshotHash &&
  chainRnd === published.randomness && Number(chainTotal) === published.totalTickets &&
  chainWinners === published.winnerCount && mission === published.mission;
console.log('\nVERDICT:', pass ? 'the published draw matches the chain' : 'MISMATCH');
process.exit(pass ? 0 : 1);
