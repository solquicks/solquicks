import crypto from 'node:crypto';
let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ok  ', name); } else { fails++; console.log('  FAIL', name, extra ?? ''); }
}
const rnd = (s) => crypto.createHash('sha256').update(s).digest('hex');

// canonical form is order-independent and stable
const a = canonicalSnapshot([{wallet:'Bob',tickets:5},{wallet:'Alice',tickets:10}]);
const b = canonicalSnapshot([{wallet:'Alice',tickets:10},{wallet:'Bob',tickets:5}]);
ok('canonical form ignores input order', a === b);
ok('canonical form is the published text', a === 'Alice:10\nBob:5', JSON.stringify(a));

// determinism
const snap = ['W1:10','W2:20','W3:30','W4:40'].join('\n');
const r1 = selectWinners(rnd('x'), snap, 3);
const r2 = selectWinners(rnd('x'), snap, 3);
ok('same randomness gives the same winners', JSON.stringify(r1) === JSON.stringify(r2));
ok('different randomness usually differs',
   JSON.stringify(selectWinners(rnd('y'), snap, 3)) !== JSON.stringify(r1) ||
   JSON.stringify(selectWinners(rnd('z'), snap, 3)) !== JSON.stringify(r1));

// no wallet wins twice
let dupes = 0;
for (let i = 0; i < 500; i++) {
  const w = selectWinners(rnd('seed' + i), snap, 4);
  if (new Set(w.map(x => x.wallet)).size !== w.length) dupes++;
}
ok('a wallet never wins twice in one draw', dupes === 0, 'dupes=' + dupes);

// asking for more winners than entrants returns everyone, once
const all = selectWinners(rnd('q'), snap, 10);
ok('more winners than entrants returns each entrant once', all.length === 4 && new Set(all.map(x=>x.wallet)).size === 4, all.length);

// single entrant
ok('single entrant wins', selectWinners(rnd('s'), 'Solo:1', 3).length === 1);

// empty
ok('empty snapshot draws nobody', selectWinners(rnd('e'), '', 3).length === 0);

// weighting: 1 vs 9 tickets over many draws should land near 10%/90%
const two = 'Small:1\nBig:9';
let small = 0, N = 20000;
for (let i = 0; i < N; i++) if (selectWinners(rnd('w' + i), two, 1)[0].wallet === 'Small') small++;
const pct = small / N;
ok('entries weight the odds (1 vs 9 ~ 10%)', pct > 0.085 && pct < 0.115, (pct*100).toFixed(2) + '%');

// uniformity across equal-weight entrants
const many = Array.from({length: 10}, (_, i) => 'E' + i + ':1').join('\n');
const counts = {};
for (let i = 0; i < 20000; i++) { const w = selectWinners(rnd('u'+i), many, 1)[0].wallet; counts[w] = (counts[w]||0)+1; }
const vals = Object.values(counts);
ok('equal entries win about equally', vals.length === 10 && Math.min(...vals) > 1600 && Math.max(...vals) < 2400,
   Math.min(...vals) + '-' + Math.max(...vals));

// wallets with more entries win more often, monotonically
const ladder = 'A:1\nB:2\nC:4\nD:8';
const lc = {A:0,B:0,C:0,D:0};
for (let i = 0; i < 20000; i++) lc[selectWinners(rnd('l'+i), ladder, 1)[0].wallet]++;
ok('odds rise with entries', lc.A < lc.B && lc.B < lc.C && lc.C < lc.D, JSON.stringify(lc));

// a tampered entry list changes the hash, so it cannot be swapped after commit
const h1 = crypto.createHash('sha256').update(snap).digest('hex');
const h2 = crypto.createHash('sha256').update(snap.replace('W1:10','W1:11')).digest('hex');
ok('editing one entry changes the snapshot hash', h1 !== h2);

console.log(fails === 0 ? '\nall draw tests passed' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
