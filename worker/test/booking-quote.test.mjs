// Booking quote maths, run against the code that actually ships.
//
// This is money a customer is asked to pay, decided entirely server-side and
// then displayed as a breakdown the customer reads before approving a transfer.
// Two things can go wrong: the total can be wrong, or the total can be right
// while the breakdown explaining it does not add up. Both are tested here.
//
// Nothing is re-implemented — the constants, quoteFor and usdcUnits are lifted
// out of src/index.js, so a change there fails these tests rather than quietly
// passing a copy.

import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

// kind: 'line' a one-line const, 'array' a multi-line array literal, 'fn' a function
function lift(name, kind) {
  const decl = (kind === 'fn' ? 'function ' : 'const ') + name;
  const start = src.indexOf(decl);
  if (start < 0) throw new Error('could not find ' + decl + ' in src/index.js');

  if (kind === 'line') return src.slice(start, src.indexOf('\n', start));

  const [open, close] = kind === 'fn' ? ['{', '}'] : ['[', ']'];
  let depth = 0;
  for (let j = src.indexOf(open, start); j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close && !--depth) return src.slice(start, j + 1) + ';';
  }
  throw new Error('unbalanced ' + decl);
}

const { quoteFor, usdcUnits, BOOKING_TYPES, RUSH_HOURS, RUSH_PCT, HOLDER_DISCOUNT_PCT } =
  new Function(`
    ${lift('USDC_DECIMALS', 'line')}
    ${lift('RUSH_HOURS', 'line')}
    ${lift('RUSH_PCT', 'line')}
    ${lift('HOLDER_DISCOUNT_PCT', 'line')}
    ${lift('BOOKING_TYPES', 'array')}
    ${lift('usdcUnits', 'fn')}
    ${lift('quoteFor', 'fn')}
    return { quoteFor, usdcUnits, BOOKING_TYPES, RUSH_HOURS, RUSH_PCT, HOLDER_DISCOUNT_PCT };
  `)();

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, wanted ${want}`);

const HOUR = 3600000;
const soon = () => Date.now() + 2 * HOUR;        // inside the rush window
const later = () => Date.now() + 10 * 24 * HOUR; // well outside it
const type = (id) => BOOKING_TYPES.find((t) => t.id === id);

console.log(`constants: rush +${RUSH_PCT}% inside ${RUSH_HOURS}h, holder −${HOLDER_DISCOUNT_PCT}%\n`);

// ── the plain price ──
for (const t of BOOKING_TYPES) {
  const q = quoteFor(t, later(), false);
  eq(`${t.id}: list price with no rush and no discount`, q.total, t.price);
}

// ── holder discount ──
for (const t of BOOKING_TYPES) {
  const q = quoteFor(t, later(), true);
  eq(`${t.id}: holder pays ${100 - HOLDER_DISCOUNT_PCT}%`, q.total, Math.round(t.price * 0.85 * 100) / 100);
}

// ── rush applies only to booked-time services ──
eq('X Space booked in 2 hours carries the rush', quoteFor(type('space'), soon(), false).total, 300);
ok('rush flag is set', quoteFor(type('space'), soon(), false).rush === true);
eq('rushPct is reported for the breakdown', quoteFor(type('space'), soon(), false).rushPct, RUSH_PCT);

// Custom content has no calendar and MC is quoted by hand, so neither can be
// "rushed" — passing a soon date must not silently add 50%.
eq('custom content ignores a soon date', quoteFor(type('custom'), soon(), false).total, 250);
eq('MC ignores a soon date', quoteFor(type('mc'), soon(), false).total, 1000);
ok('custom content never sets the rush flag', quoteFor(type('custom'), soon(), false).rush === false);

// ── the 48 hour boundary ──
const at48 = Date.now() + RUSH_HOURS * HOUR + 5000; // a hair outside
const inside48 = Date.now() + RUSH_HOURS * HOUR - 60000;
eq('exactly outside the window is not a rush', quoteFor(type('space'), at48, false).total, 200);
eq('a minute inside the window is a rush', quoteFor(type('space'), inside48, false).total, 300);

// ── no start time at all ──
eq('a slot type with no date is not rushed', quoteFor(type('space'), null, false).total, 200);

// ── rush and discount together ──
{
  const q = quoteFor(type('space'), soon(), true);
  eq('rush and holder together', q.total, 255); // 200 → 300 → −15%
  eq('base is reported unchanged', q.base, 200);
  eq('discountPct is reported', q.discountPct, HOLDER_DISCOUNT_PCT);
}

// Both adjustments are multiplicative, so applying them in the other order
// gives the same number. Asserted so that nobody "fixes" the order later
// believing it changes what a customer pays — it does not.
for (const t of BOOKING_TYPES) {
  const rushFirst = t.price * (1 + RUSH_PCT / 100) * (1 - HOLDER_DISCOUNT_PCT / 100);
  const discountFirst = t.price * (1 - HOLDER_DISCOUNT_PCT / 100) * (1 + RUSH_PCT / 100);
  ok(`${t.id}: rush-then-discount equals discount-then-rush`,
    Math.abs(rushFirst - discountFirst) < 1e-9);
}

// ── invariants that must hold for every combination ──
{
  let broke = null;
  for (const t of BOOKING_TYPES) {
    for (const when of [null, soon(), later(), Date.now() - HOUR]) {
      for (const holder of [true, false]) {
        const q = quoteFor(t, when, holder);
        const cents = Math.round(q.total * 100);
        if (q.total < 0) broke = `${t.id} went negative`;
        else if (q.total > t.price * 1.5 + 1e-9) broke = `${t.id} exceeded base +${RUSH_PCT}%`;
        else if (q.total < t.price * 0.85 - 1e-9) broke = `${t.id} fell below the holder price`;
        else if (Math.abs(q.total * 100 - cents) > 1e-9) broke = `${t.id} is not a whole number of cents (${q.total})`;
        if (broke) break;
      }
    }
  }
  ok('every combination stays within bounds and lands on whole cents', broke === null, broke || '');
}

// ── the breakdown the customer reads must add up to what they are charged ──
// These two expressions are copied from index.html's payment screen. If either
// side changes without the other, the invoice will explain a different number
// from the one being collected.
{
  let mismatch = null;
  for (const t of BOOKING_TYPES) {
    for (const when of [soon(), later()]) {
      for (const holder of [true, false]) {
        const q = quoteFor(t, when, holder);
        const rushLine = q.rushPct ? Math.round(q.base * q.rushPct) / 100 : 0;
        const discountLine = q.discountPct
          ? q.base * (1 + q.rushPct / 100) * q.discountPct / 100
          : 0;
        const shown = Math.round((q.base + rushLine - discountLine) * 100) / 100;
        if (shown !== q.total) {
          mismatch = `${t.id} holder=${holder} rush=${q.rush}: breakdown shows ${shown}, charged ${q.total}`;
          break;
        }
      }
    }
  }
  ok('the displayed breakdown sums to the total charged', mismatch === null, mismatch || '');
}

// ── the USDC actually requested ──
{
  let bad = null;
  for (const t of BOOKING_TYPES) {
    for (const holder of [true, false]) {
      const q = quoteFor(t, soon(), holder);
      const units = usdcUnits(q.total);
      if (!Number.isInteger(units)) bad = `${t.id}: ${units} is not a whole number of micro-USDC`;
      else if (Math.abs(units / 1e6 - q.total) > 1e-9) bad = `${t.id}: ${units} units ≠ $${q.total}`;
      if (bad) break;
    }
  }
  ok('the USDC amount requested equals the dollar total exactly', bad === null, bad || '');
}

// A float that does not land cleanly on a cent would be charged wrong.
eq('usdcUnits rounds rather than truncates', usdcUnits(0.0000005), 1);
eq('usdcUnits handles a repeating-decimal price', usdcUnits(446.25), 446250000);

// ── rounding, on prices that would actually need it ──
// None of the five current prices produce a fraction of a cent, so the rounding
// in quoteFor is presently a no-op and deleting it breaks nothing. These
// hypothetical prices are the ones that would expose it. The screen renders the
// total with toFixed(2) while the wallet is asked for the unrounded figure, so
// an unrounded $424.575 would display as $424.58 and collect 424.575 USDC —
// a customer approving a number they were never shown.
for (const price of [333, 199, 49.99, 0.01]) {
  const hypothetical = { id: 'hypothetical $' + price, mode: 'slot', price: price };
  const q = quoteFor(hypothetical, soon(), true);
  const cents = Math.round(q.total * 100);
  ok(`$${price} rushed and discounted rounds to a whole cent`,
    Math.abs(q.total * 100 - cents) < 1e-9, `total was ${q.total}`);
  eq(`$${price}: what is displayed is what is collected`,
    usdcUnits(q.total), usdcUnits(Number(q.total.toFixed(2))));
}

// ── a price change should fail loudly here ──
eq('X Space is $200', type('space').price, 200);
eq('Podcast is $350', type('podcast').price, 350);
eq('Stream is $300', type('stream').price, 300);
eq('Custom content is $250', type('custom').price, 250);
eq('MC or speaking is $1,000', type('mc').price, 1000);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
