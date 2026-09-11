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
const verifyInvoice = new Function('inspectPayment',
  fnSrc + '\nreturn verifyInvoice;')(async () => chain);

const USDC = n => Math.round(n * 1e6);
const cases = [
  ['USDC, exact amount',        { found:true, payer:'W', usdc:USDC(200), sol:0 },          'W', true],
  ['USDC, overpaid',            { found:true, payer:'W', usdc:USDC(250), sol:0 },          'W', true],
  ['USDC, a cent short',        { found:true, payer:'W', usdc:USDC(199.99), sol:0 },       'W', 'too small'],
  ['SOL only, full value',      { found:true, payer:'W', usdc:0, sol:2_010_000_000 },      'W', 'USDC only'],
  ['nothing reached treasury',  { found:true, payer:'W', usdc:0, sol:0 },                  'W', 'right wallet'],
  ['sent by a different wallet',{ found:true, payer:'X', usdc:USDC(200), sol:0 },          'W', 'your wallet'],
  ['watch path (no wallet)',    { found:true, payer:'X', usdc:USDC(200), sol:0 },          null, true],
  ['not on chain yet',          { found:false },                                            'W', 'not found'],
];
let pass = 0;
for (const [name, p, wallet, expect] of cases) {
  chain = p;
  const { env, inserts } = makeEnv();
  const r = await verifyInvoice(env, wallet, 'SIG-' + name, USDC(200), 'booking:FOX-1');
  const ok = expect === true ? (r.ok && r.currency === 'usdc' && inserts.length === 1 && inserts[0].a[3] === 'booking:FOX-1:usdc')
                             : (!r.ok && r.error.includes(expect) && inserts.length === 0);
  pass += ok;
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(28) + (r.ok ? 'accepted as ' + r.currency : 'refused: ' + r.error));
}
// replay protection
chain = { found:true, payer:'W', usdc:USDC(200), sol:0 };
const { env } = makeEnv(['SIG-REPLAY']);
const r = await verifyInvoice(env, 'W', 'SIG-REPLAY', USDC(200), 'booking:FOX-1');
const replayOk = !r.ok && r.error.includes('already used');
pass += replayOk;
console.log((replayOk ? 'PASS ' : 'FAIL ') + 'same signature twice'.padEnd(28) + 'refused: ' + r.error);
console.log(`\n${pass}/${cases.length + 1} passed`);
process.exit(pass === cases.length + 1 ? 0 : 1);
