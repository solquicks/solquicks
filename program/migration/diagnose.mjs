// Two symptoms to separate: Solflare showing two collections, and some Rangers
// showing nothing at all.
import fs from 'node:fs';
const uris = JSON.parse(fs.readFileSync('./new-uris.json', 'utf8'));
const GW = ['https://arweave.net', 'https://vilenarios.com', 'https://frostor.xyz'];

async function get(u) {
  const id = u.split('/').pop().split('?')[0];
  for (const g of GW) {
    try { const r = await fetch(g + '/' + id, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
      if (r.ok) return r; } catch (e) {}
  }
  return null;
}

const noLegacy = [], badImage = [], imgHosts = {};
let n = 0;
for (const [mint, url] of Object.entries(uris)) {
  const r = await get(url);
  if (!r) continue;
  const j = await r.json();
  if (!j.collection || !j.collection.name) noLegacy.push(mint);
  const host = (j.image || '').split('/')[2] || 'none';
  imgHosts[host] = (imgHosts[host] || 0) + 1;
  const ir = await get(j.image || '');
  if (!ir) badImage.push([mint, j.name, j.image]);
  if (++n % 50 === 0) console.log('  checked', n);
}
console.log('');
console.log('missing the legacy collection field :', noLegacy.length, '<- this is the Solflare split');
console.log('image not reachable                 :', badImage.length);
console.log('image hosts                         :', JSON.stringify(imgHosts));
badImage.slice(0, 6).forEach((b) => console.log('   ', b[1] || b[0].slice(0, 8), (b[2] || '').slice(0, 60)));
fs.writeFileSync('./needs-collection-field.json', JSON.stringify(noLegacy, null, 2));
