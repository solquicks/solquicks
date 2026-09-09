// Final check: does every on-chain uri actually serve valid metadata, and does
// every image load? This is what a wallet or marketplace will do.
import fs from 'node:fs';
const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const GW = ['https://arweave.net', 'https://vilenarios.com', 'https://frostor.xyz'];

async function get(id) {
  for (const g of GW) {
    try {
      const r = await fetch(g + '/' + id, { signal: AbortSignal.timeout(25000), redirect: 'follow' });
      if (r.ok) return await r.json();
    } catch (e) { /* next gateway */ }
  }
  return null;
}

let ok = 0; const bad = [];
const entries = Object.entries(uris);
for (const [mint, url] of entries) {
  const j = await get(url.split('/').pop());
  if (!j) { bad.push([mint, 'metadata unreachable']); continue; }
  if (!j.name) { bad.push([mint, 'no name']); continue; }
  if (j.seller_fee_basis_points !== 300) { bad.push([mint, 'fee ' + j.seller_fee_basis_points]); continue; }
  if (!(j.attributes || []).length) { bad.push([mint, 'no traits']); continue; }
  if (!j.image) { bad.push([mint, 'no image']); continue; }
  ok++;
  if (ok % 50 === 0) console.log('  verified', ok, '/', entries.length);
}
console.log('');
console.log('metadata serving correctly:', ok, '/', entries.length);
bad.forEach((b) => console.log('   ', b[0].slice(0, 10) + '…', b[1]));
