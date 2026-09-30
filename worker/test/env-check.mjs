// Every env.X the Worker reads has to be declared: a [vars] entry or a binding
// in wrangler.toml, or a secret named in .dev.vars.example. An undeclared one is
// undefined in production and nothing says so. LAUNCH_ROOT sat under [triggers]
// for exactly that reason, surviving only because the code had a fallback.

import { readFileSync } from 'node:fs';

const here = new URL('..', import.meta.url);
const src = readFileSync(new URL('src/index.js', here), 'utf8');
const toml = readFileSync(new URL('wrangler.toml', here), 'utf8');
const example = readFileSync(new URL('.dev.vars.example', here), 'utf8');

const declared = new Set();
const misplaced = [];
let section = '';
for (const raw of toml.split('\n')) {
  const line = raw.trim();
  const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
  if (header) { section = header[1]; continue; }
  const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!kv) continue;
  const [, key, value] = kv;
  const name = value.replace(/^"|"$/g, '');
  if (section === 'vars') declared.add(key);
  else if (key === 'binding') declared.add(name);
  else if (section === 'ratelimits' && key === 'name') declared.add(name);
  else if (/^[A-Z][A-Z0-9_]+$/.test(key)) misplaced.push(key + ' (under [' + section + '])');
}

const secrets = example.split('\n')
  .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/))
  .filter(Boolean)
  .map((m) => m[1]);
for (const s of secrets) declared.add(s);

const read = new Set([...src.matchAll(/\benv\??\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
const missing = [...read].filter((k) => !declared.has(k)).sort();

let fail = 0;
if (misplaced.length) {
  console.error('::error::Settings outside [vars] in wrangler.toml, so the Worker never sees them: ' + misplaced.join(', '));
  fail = 1;
}
if (missing.length) {
  console.error('::error::The Worker reads settings nobody declared: ' + missing.join(', ') +
    '. Add each to [vars] in wrangler.toml, or to .dev.vars.example if it is a secret.');
  fail = 1;
}
if (!fail) console.log(read.size + ' settings read by the Worker, all declared.');
process.exit(fail);
