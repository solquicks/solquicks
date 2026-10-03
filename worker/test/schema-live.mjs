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
// It compares COLUMNS as well as tables, because the same drift happens one
// column at a time and is harder to see: `bookings.bundle_ref` was added to
// schema.sql for bundles, and a table-only check calls that a pass while every
// bundle redemption in production fails on an unknown column.
//
// It needs wrangler to be logged in and reads nothing but names.

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

// The columns each table is declared with. Read off the same CREATE statements
// rather than a second list, so there is nothing to keep in step.
//
// Only the leading identifier of each top-level comma-separated part counts as
// a column, which skips PRIMARY KEY / UNIQUE / CHECK clauses written on their
// own line. Nested parens (a type width, a CHECK) are tracked so a comma inside
// one does not read as a new column.
function columnsOf(table) {
  const re = new RegExp('CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+' + table + '\\s*\\(', 'i');
  const m = re.exec(schema);
  if (!m) return [];

  // The body first, then strip comments, then split. The other way round
  // splits a comment that contains a comma and leaves its second half looking
  // like a column — which is how "sites.label" and "sites.href" were reported
  // missing when neither is a column at all.
  let depth = 1;
  let i = m.index + m[0].length;
  let body = '';
  for (; i < schema.length; i++) {
    const ch = schema[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (!depth) break; }
    body += ch;
  }
  body = body.replace(/--[^\n]*/g, '');

  const parts = [];
  let part = '';
  depth = 0;
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(part); part = ''; continue; }
    part += ch;
  }
  parts.push(part);

  const KEYWORDS = /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i;
  return parts
    .map((p) => p.trim())
    .map((p) => (p.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/) || [])[1])
    .filter((c) => c && !KEYWORDS.test(c));
}

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
const present = wanted.filter((t) => live.has(t));

// One query for every table that does exist, so a missing column is named
// rather than discovered by a 500.
function liveColumns(table) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', dbName, '--remote', '--json',
    '--command', "SELECT name FROM pragma_table_info('" + table + "')"],
    { cwd: new URL('.', here).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const j = out.match(/(\[[\s\S]*\])/);
  return new Set(j ? (JSON.parse(j[1])[0].results || []).map((r) => r.name) : []);
}

const colGaps = [];
for (const t of present) {
  let have;
  try { have = liveColumns(t); } catch (e) { continue; }
  if (!have.size) continue;
  const absent = columnsOf(t).filter((c) => !have.has(c));
  if (absent.length) colGaps.push({ table: t, columns: absent });
}

console.log(wanted.length + ' tables in schema.sql, ' + live.size + ' in ' + dbName +
  '; columns checked on ' + present.length);
if (!missing.length && !colGaps.length) {
  console.log('all present.');
  process.exit(0);
}

if (missing.length) {
  console.log('\nTABLES missing from the live database:');
  for (const t of missing) console.log('  ' + t);
  console.log('\nUntil these exist, anything that touches them answers 500.');
  console.log('Create them with the CREATE statements from schema.sql:');
  console.log('  npx wrangler d1 execute ' + dbName + ' --remote --command "<the CREATE TABLE ...>"');
}
if (colGaps.length) {
  console.log('\nCOLUMNS missing from tables that do exist:');
  for (const g of colGaps) {
    for (const c of g.columns) {
      console.log('  ' + g.table + '.' + c);
      console.log('    npx wrangler d1 execute ' + dbName + ' --remote --command ' +
        '"ALTER TABLE ' + g.table + ' ADD COLUMN ' + c + ' TEXT"   # check the type in schema.sql');
    }
  }
}
process.exit(1);
