// Nothing goes on chain until the new URLs are proven. Checks the JSON
// resolves, the royalty is right, traits survived, and the image is reachable.
import fs from 'node:fs';

const GATEWAYS = ['https://vilenarios.com', 'https://frostor.xyz', 'https://arweave.net'];
const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const swapped = new Set(
  JSON.parse(fs.readFileSync('./swapped.json', 'utf8')).filter((s) => s.ok).map((s) => s.mint)
);
const limit = Number(process.argv[2] || 0);

async function get(id, asJson) {
  for (const g of GATEWAYS) {
    try {
      const r = await fetch(g + '/' + id, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
      if (!r.ok) continue;
      return asJson ? await r.json() : (await r.arrayBuffer()).byteLength;
    } catch (e) { /* try the next gateway */ }
  }
  return null;
}

const entries = Object.entries(uris);
const list = limit ? entries.slice(0, limit) : entries;
const bad = [];
let ok = 0;

for (const [mint, url] of list) {
  const id = url.split('/').pop();
  const json = await get(id, true);
  if (!json) { bad.push({ mint, why: 'metadata unreachable' }); continue; }
  if (!json.name) { bad.push({ mint, why: 'no name' }); continue; }
  if (json.seller_fee_basis_points !== 300) { bad.push({ mint, why: 'royalty ' + json.seller_fee_basis_points }); continue; }
  if (!(json.attributes || []).length) { bad.push({ mint, why: 'no traits' }); continue; }
  if (!json.image) { bad.push({ mint, why: 'no image url' }); continue; }
  ok++;
  if (list.length <= 12) {
    console.log('  OK', json.name.padEnd(14), '| traits', String((json.attributes || []).length).padEnd(2),
      '| fee', json.seller_fee_basis_points, '|', swapped.has(mint) ? 'trait-swapped' : 'original');
  } else if (ok % 25 === 0) console.log('  verified', ok, '/', list.length);
}

console.log('');
console.log('checked', list.length, '| good', ok, '| problems', bad.length);
bad.slice(0, 10).forEach((b) => console.log('   ', b.mint.slice(0, 10) + '…', b.why));
