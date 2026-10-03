// If the Worker's source changed, its BUILD marker has to change with it.
//
// This exists because of a day lost on 2026-10-03. Two commits changed the
// booking prices and removed the collectible discount, neither touched BUILD,
// and the Worker was never deployed. So production quoted Space at $200 while
// main said $300, and the one tool meant to catch exactly that — comparing
// /api/health's `build` against the constant in the source — reported a match,
// because the constant was identical on both sides. A stale deploy and a
// current one were indistinguishable by the check designed to distinguish them.
//
// The marker is only useful if it is guaranteed to differ, so that guarantee is
// enforced here rather than remembered.
//
// Run:
//   node test/build-bumped.mjs            # against origin/main
//   node test/build-bumped.mjs <base-ref>

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'origin/main';
const SRC = 'worker/src/index.js';
const here = new URL('../../', import.meta.url).pathname;

const git = (...args) =>
  execFileSync('git', args, { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const buildIn = (text) => {
  const m = /const BUILD = '([^']*)'/.exec(text);
  return m ? m[1] : null;
};

let baseSrc;
try {
  baseSrc = git('show', base + ':' + SRC);
} catch (e) {
  // No base to compare against — a fresh clone, a shallow checkout, or the
  // very first commit. Nothing to assert, and failing here would block a
  // branch for a reason that has nothing to do with it.
  console.log('no ' + base + ' to compare against — skipping');
  process.exit(0);
}

const headSrc = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

if (headSrc === baseSrc) {
  console.log('worker source unchanged against ' + base + ' — nothing to check');
  process.exit(0);
}

const before = buildIn(baseSrc);
const after = buildIn(headSrc);

if (!after) {
  console.error('::error::' + SRC + " has no `const BUILD = '...'`. /api/health needs it to " +
    'report which code is actually serving.');
  process.exit(1);
}

if (before === after) {
  console.error('::error::' + SRC + ' changed but BUILD is still ' + JSON.stringify(after) +
    '. Bump it, or a stale deploy and a current one look identical to ' +
    'test/schema-live.mjs and to /api/health.');
  console.error('');
  console.error('What changed:');
  for (const line of git('diff', '--stat', base, '--', SRC).split('\n')) {
    if (line.trim()) console.error('  ' + line.trim());
  }
  console.error('');
  console.error('Pick a name for what this change does, e.g.:');
  console.error("  const BUILD = 'booking-prices-1';");
  process.exit(1);
}

console.log('worker source changed and BUILD moved ' +
  JSON.stringify(before) + ' → ' + JSON.stringify(after) + '.');
process.exit(0);
