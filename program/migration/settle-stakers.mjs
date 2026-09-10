// Cutover step for moving staking on-chain.
//
// Off-chain "staking" is a database row. When the escrow vault goes live those
// rows must stop earning, WITHOUT anyone losing what they already earned. The
// safe operation is to bank the accrued total and clear the position — exactly
// what unstaking already does — so the points survive and the clock stops.
//
//   node settle-stakers.mjs            dry run, changes nothing
//   node settle-stakers.mjs --commit   writes the SQL out for review
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const STAKE_RATE_PER_DAY = 100;
const DAY_MS = 86400000;
const COMMIT = process.argv.includes('--commit');

function d1(sql) {
  const out = execSync(
    `npx wrangler d1 execute solquicks-points --remote --json --command ${JSON.stringify(sql)}`,
    { cwd: '../../worker', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  const start = out.indexOf('[');
  return JSON.parse(out.slice(start))[0].results;
}

const accrued = (s) => {
  const banked = s.banked || 0;
  if (!s.staked || !s.since) return banked;
  return banked + Math.max(0, Math.floor(((Date.now() - s.since) / DAY_MS) * STAKE_RATE_PER_DAY * (s.count || 0)));
};

const stakes = d1('SELECT wallet, staked, since, count, banked FROM stakes');
const nfts = d1('SELECT wallet, COUNT(*) AS n FROM staked_nfts GROUP BY wallet');
const nftBy = Object.fromEntries(nfts.map((r) => [r.wallet, r.n]));

console.log('wallets with an off-chain position:', stakes.filter((s) => s.staked).length);
console.log('');

const sql = [];
let totalBanked = 0;
for (const s of stakes) {
  const now = accrued(s);
  const gain = now - (s.banked || 0);
  totalBanked += now;
  console.log(
    `  ${s.wallet.slice(0, 8)}…  ${String(nftBy[s.wallet] || 0).padStart(2)} Rangers  ` +
    `banked ${String(s.banked || 0).padStart(6)} + ${String(gain).padStart(6)} accrued = ${String(now).padStart(6)} points`
  );
  // staked=0 stops the clock; banked keeps every point already earned, and the
  // leaderboard reads banked, so nobody's total moves
  sql.push(`UPDATE stakes SET staked = 0, since = 0, count = 0, banked = ${now} WHERE wallet = '${s.wallet}';`);
}
sql.push('DELETE FROM staked_nfts;');

console.log('');
console.log('points preserved across all wallets:', totalBanked);
console.log('staked_nfts rows to clear          :', nfts.reduce((a, r) => a + r.n, 0));

if (!COMMIT) {
  console.log('');
  console.log('Dry run — nothing was changed. Re-run with --commit to write settle.sql.');
} else {
  fs.writeFileSync('./settle.sql', sql.join('\n') + '\n');
  console.log('');
  console.log('Wrote settle.sql. Apply it with:');
  console.log('  npx wrangler d1 execute solquicks-points --remote --file ../program/migration/settle.sql');
}
