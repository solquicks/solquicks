import fs from 'node:fs';
const src = fs.readFileSync('src/index.js', 'utf8');
const start = src.indexOf('async function verifyInvoice(');
let i = src.indexOf('{', start), depth = 0, end = -1;
for (let j = i; j < src.length; j++) {
  if (src[j] === '{') depth++;
  else if (src[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
}
const fnSrc = src.slice(start, end);

// Stubs: a D1 that remembers inserted signatures, and a controllable chain read.
function makeEnv(seen = []) {
  const used = new Set(seen);
  const inserts = [];
  return { inserts, env: {
    TREASURY_WALLET: 'TREASURY',
    DB: { prepare(sql) { return { bind(...a) { return {
      first: async () => (sql.startsWith('SELECT') && used.has(a[0])) ? { signature: a[0] } : null,
      run: async () => { inserts.push({ sql, a }); used.add(a[0]); return {}; }
    }; } }; } }
  }};
}
let chain = {};
const alerts = [];
const verifyInvoice = new Function('inspectPayment', 'alert', 'INVOICE_CLOCK_SKEW_MS',
  fnSrc + '\nreturn verifyInvoice;')(async () => chain, async (env, t) => { alerts.push(t); }, 5 * 60000);

const USDC = n => Math.round(n * 1e6);
// Every tx carries the invoice's reference key unless a case says otherwise,
// and lands after the invoice was written (T0).
const T0 = 1_800_000_000_000;
const tx = (o) => Object.assign({ found: true, keys: ['W', 'TREASURY', 'REF'], blockTime: T0 + 60000, sol: 0 }, o);
const cases = [
  ['USDC, exact amount',        tx({ payer:'W', usdc:USDC(200) }),                       'W', true],
  // exact, not at-least (security fix 2026-10-29): a payment for something
  // else that happens to be bigger can never be reused here
  ['USDC, overpaid',            tx({ payer:'W', usdc:USDC(250) }),                       'W', 'more than this order'],
  ['USDC, a cent short',        tx({ payer:'W', usdc:USDC(199.99) }),                    'W', 'too small'],
  ['SOL only, full value',      tx({ payer:'W', usdc:0, sol:2_010_000_000 }),            'W', 'USDC only'],
  ['nothing reached treasury',  tx({ payer:'W', usdc:0 }),                               'W', 'right wallet'],
  ['sent by a different wallet',tx({ payer:'X', usdc:USDC(200) }),                       'W', 'your wallet'],
  ['watch path (no wallet)',    tx({ payer:'X', usdc:USDC(200) }),                       null, true],
  ['not on chain yet',          { found:false },                                          'W', 'not found'],
  ['no reference in the tx',    tx({ payer:'W', usdc:USDC(200), keys:['W','TREASURY'] }), 'W', 'not for this order'],
  ['watch path, wrong reference', tx({ payer:'X', usdc:USDC(200), keys:['X','TREASURY','OTHER'] }), null, 'not for this order'],
  ['paid before the invoice',   tx({ payer:'W', usdc:USDC(200), blockTime: T0 - 3600000 }), 'W', 'before this order'],
  ['treasury paying itself',    tx({ payer:'TREASURY', usdc:USDC(200) }),                null, 'come from your wallet'],
];
let pass = 0;
for (const [name, p, wallet, expect] of cases) {
  chain = p;
  const { env, inserts } = makeEnv();
  const r = await verifyInvoice(env, wallet, 'SIG-' + name, USDC(200), 'booking:FOX-1', null, { reference: 'REF', createdAt: T0 });
  const ok = expect === true ? (r.ok && r.currency === 'usdc' && inserts.length === 1 && inserts[0].a[3] === 'booking:FOX-1:usdc')
                             : (!r.ok && r.error.includes(expect) && inserts.length === 0);
  pass += ok;
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(28) + (r.ok ? 'accepted as ' + r.currency : 'refused: ' + r.error));
}
// replay protection
chain = tx({ payer:'W', usdc:USDC(200) });
const { env } = makeEnv(['SIG-REPLAY']);
const r = await verifyInvoice(env, 'W', 'SIG-REPLAY', USDC(200), 'booking:FOX-1', null, { reference: 'REF', createdAt: T0 });
const replayOk = !r.ok && r.error.includes('already used');
pass += replayOk;
console.log((replayOk ? 'PASS ' : 'FAIL ') + 'same signature twice'.padEnd(28) + 'refused: ' + r.error);
const alerted = alerts.some((t) => /Overpayment/.test(t));
pass += alerted;
console.log((alerted ? 'PASS ' : 'FAIL ') + 'an overpayment is flagged for a refund');
console.log(`\n${pass}/${cases.length + 2} passed`);
process.exit(pass === cases.length + 2 ? 0 : 1);
