// Every table in schema.sql, checked against the database that is actually
// serving. These two drift silently: schema.sql is the source, but production
// is migrated by hand, so a new table lands in the file, passes every test
// against an in-memory copy, deploys green, and then 500s the first time
// somebody touches it.
//
// That is exactly how the savings tables went out: added, tested, deployed,
// and missing from production until an endpoint answered "server error".
//
// Run after any deploy that added a table:
//   node test/schema-live.mjs
//
// It needs wrangler to be logged in and reads nothing but table names.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const here = new URL('..', import.meta.url);
const schema = readFileSync(new URL('schema.sql', here), 'utf8');
const toml = readFileSync(new URL('wrangler.toml', here), 'utf8');

const dbName = (toml.match(/database_name\s*=\s*"([^"]+)"/) || [])[1];
if (!dbName) {
  console.error('no database_name in wrangler.toml');
  process.exit(1);
}

const wanted = [...schema.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)/gi)]
  .map((m) => m[1])
  .filter((n, i, a) => a.indexOf(n) === i)
  .sort();

let out;
try {
  out = execFileSync('npx', ['wrangler', 'd1', 'execute', dbName, '--remote', '--json',
    '--command', "SELECT name FROM sqlite_master WHERE type='table'"],
    { cwd: new URL('.', here).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  console.error('could not read the live database:', (e.stderr || e.message || '').toString().trim().split('\n').pop());
  process.exit(2);
}

// wrangler prints its own chatter before the JSON
const m = out.match(/(\[[\s\S]*\])/);
if (!m) { console.error('could not parse wrangler output'); process.exit(2); }
const live = new Set((JSON.parse(m[1])[0].results || []).map((r) => r.name));

const missing = wanted.filter((t) => !live.has(t));

console.log(wanted.length + ' tables in schema.sql, ' + live.size + ' in ' + dbName);
if (!missing.length) {
  console.log('all present.');
  process.exit(0);
}

console.log('\nMISSING from the live database:');
for (const t of missing) console.log('  ' + t);
console.log('\nUntil these exist, anything that touches them answers 500.');
console.log('Create them with the CREATE statements from schema.sql:');
console.log('  npx wrangler d1 execute ' + dbName + ' --remote --command "<the CREATE TABLE ...>"');
process.exit(1);
