#!/usr/bin/env node
// Review Moon Rangers game points (security fix 2026-10-29, H3).
//
// The admin token is read from the environment you run this in. It is never
// written to disk or printed.
//
//   ADMIN_TOKEN=… node tools/game-points-admin.mjs list [claimed|earned|approved|rejected]
//   ADMIN_TOKEN=… node tools/game-points-admin.mjs approve 12 13 14 [--note "ok"]
//   ADMIN_TOKEN=… node tools/game-points-admin.mjs reject 15 [--note "bot farm"]
//
// Approving re-checks each wallet's Moon Rangers on-chain at that moment:
// holders get 1.25x, everyone else the base. Items whose check fails are left
// in the queue. API defaults to the live worker; set SOLQUICKS_API to point
// it elsewhere.

const API = process.env.SOLQUICKS_API || 'https://solquicks-points.solquicks-45c.workers.dev';
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) { console.error('Set ADMIN_TOKEN in your environment first.'); process.exit(2); }

const [cmd, ...rest] = process.argv.slice(2);
const noteAt = rest.indexOf('--note');
const note = noteAt >= 0 ? rest[noteAt + 1] : undefined;
const args = noteAt >= 0 ? rest.slice(0, noteAt) : rest;

async function api(path, body) {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
  if (!res.ok) throw new Error(d.error || 'HTTP ' + res.status);
  return d;
}

if (cmd === 'list') {
  const d = await api('/api/admin/game/pending?status=' + encodeURIComponent(args[0] || 'claimed'));
  if (!d.items.length) console.log('Nothing ' + d.status + '.');
  for (const i of d.items) {
    const ev = i.source === 'match' && i.evidence.player
      ? `match ${i.source_id}: ${i.evidence.player.kills}K/${i.evidence.player.deaths}D ${i.evidence.player.won ? 'won' : 'lost'}, ${i.evidence.playersInMatch} players`
      : `${i.source} ${i.source_id}`;
    console.log(`#${i.id}  ${i.wallet}  ${i.base_fp} FP  ${ev}  | wallet: ${i.walletStats.matches} matches, ${i.walletStats.kills} kills`);
  }
} else if (cmd === 'approve' || cmd === 'reject') {
  const ids = args.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) { console.error('Give the item ids.'); process.exit(2); }
  const d = await api('/api/admin/game/pending/decide', { ids, approve: cmd === 'approve', note });
  for (const x of d.decided) console.log(`#${x.id} ${x.status}` + (x.awarded !== undefined ? ` — ${x.awarded} FP (base ${x.base} × ${x.boost})` : ''));
  for (const x of d.skipped) console.log(`#${x.id} skipped — ${x.reason}`);
} else {
  console.error('Usage: list [status] | approve <ids…> [--note …] | reject <ids…> [--note …]');
  process.exit(2);
}
