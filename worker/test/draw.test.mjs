// Tests the published draw selection. The functions under test are pulled
// straight out of src/index.js so this can never test a stale copy.
//   node test/draw.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');

const wanted = ['hex', 'unhex', 'canonicalSnapshot', 'selectWinners', 'fnvPick'];
const extracted = wanted.map((name) => {
  const m = src.match(new RegExp('^function ' + name + '\\b[\\s\\S]*?\\n}\\n', 'm'));
  if (!m) throw new Error('could not find ' + name + ' in src/index.js');
  return m[0];
}).join('\n');

const assertions = fs.readFileSync(path.join(here, 'draw.assertions.mjs'), 'utf8');
const mod = 'data:text/javascript;base64,' +
  Buffer.from(extracted + '\n' + assertions).toString('base64');
await import(mod);
