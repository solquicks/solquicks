// Assembles the 219 files ready for Arweave, preserving each Ranger's CURRENT
// state: originals for the 195 never trait-swapped, live metadata for the 24
// that were. Deliberately never overwrites a trait swap with an original.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, 'prepared');
const ROYALTY_BPS = 300;   // matches the chain; the 2023 files said 250

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const swapped = JSON.parse(fs.readFileSync(path.join(DIR, 'swapped.json'), 'utf8'));
const swapById = Object.fromEntries(swapped.map((s) => [s.mint, s]));

fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'meta'), { recursive: true });

let fromOriginal = 0, fromLive = 0, skipped = [];

for (const m of manifest) {
  if (m.source === 'original') {
    const json = JSON.parse(fs.readFileSync(m.jsonPath, 'utf8'));
    json.seller_fee_basis_points = ROYALTY_BPS;
    // image is filled in after upload, once we know the Arweave id
    json.image = null;
    json.properties = json.properties || {};
    fs.copyFileSync(m.imgPath, path.join(OUT, 'images', m.mint + '.jpeg'));
    fs.writeFileSync(path.join(OUT, 'meta', m.mint + '.json'), JSON.stringify(json, null, 2));
    fromOriginal++;
  } else {
    const s = swapById[m.mint];
    if (!s || !s.ok) { skipped.push(m.mint); continue; }
    const json = s.json;
    json.seller_fee_basis_points = ROYALTY_BPS;
    // their artwork already lives on Arweave and resolves, so it is kept as is
    fs.writeFileSync(path.join(OUT, 'meta', m.mint + '.json'), JSON.stringify(json, null, 2));
    fromLive++;
  }
}

console.log('prepared', fromOriginal + fromLive, 'of', manifest.length);
console.log('  from untouched originals :', fromOriginal, '(image + json)');
console.log('  from live trait-swapped  :', fromLive, '(json only — art already permanent)');
console.log('  unrecoverable            :', skipped.length, skipped.join(', '));
const imgs = fs.readdirSync(path.join(OUT, 'images'));
const bytes = imgs.reduce((s, f) => s + fs.statSync(path.join(OUT, 'images', f)).size, 0);
console.log('  images to upload         :', imgs.length, '=', (bytes / 1048576).toFixed(1), 'MB');
