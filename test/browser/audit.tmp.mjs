import { chromium } from 'playwright';
const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0,130)));
page.on('console', m => { if (m.type()==='error') errs.push('CONSOLE ' + m.text().slice(0,130)); });
const t = (s) => (s||'').replace(/\s+/g,' ').trim();

await page.goto('https://solquicks.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(6000);
const out = {};

// SAVINGS — what it shows with no derivable rate
await page.evaluate(() => switchTab('defi')); await page.waitForTimeout(2500);
out.savings = await page.evaluate(() => {
  const p = document.getElementById('panel-defi');
  return { rate: (document.querySelector('#df-rate')||{}).textContent,
           text: (p.innerText||'').replace(/\s+/g,' ').slice(0,150) };
});

// SWAP — a real quote, no wallet needed
await page.evaluate(() => switchTab('swap')); await page.waitForTimeout(1500);
await page.fill('#sw-in-amount', '1');
await page.evaluate(() => quoteSwap());
await page.waitForFunction(() => !!window.swapQuote, null, { timeout: 20000 }).catch(()=>{});
out.swap = await page.evaluate(() => ({
  quoted: !!window.swapQuote,
  out: (document.getElementById('sw-out-amount')||{}).value,
  rate: (document.getElementById('sw-rate')||{}).textContent,
  fee: (document.getElementById('sw-fee')||{}).textContent,
  button: (document.getElementById('sw-go')||{}).textContent,
  tokens: window.swapTokens ? window.swapTokens.length : 0
}));

// BOOK — rate card and bundles
await page.evaluate(() => switchTab('book')); await page.waitForTimeout(2500);
out.book = await page.evaluate(() => ({
  services: document.querySelectorAll('.bk-card').length,
  bundles: document.querySelectorAll('.bk-pack').length,
  adPrice: (document.querySelector('.bk-ad .bk-price')||{}).textContent,
  mcNote: !!document.querySelector('.bk-note')
}));

// MOON — analytics and collection
await page.evaluate(() => switchTab('moon')); await page.waitForTimeout(4000);
out.moon = await page.evaluate(() => ({
  holders: (document.getElementById('an-holders')||{}).textContent,
  floor: (document.getElementById('an-floor')||{}).textContent,
  stakers: ((document.getElementById('an-stakers')||{}).textContent||'').replace(/\s+/g,' ').trim().slice(0,60),
  text: (document.getElementById('panel-moon').innerText||'').replace(/\s+/g,' ').slice(0,90)
}));

// LEADERBOARD
await page.evaluate(() => switchTab('leaderboard')); await page.waitForTimeout(2500);
out.leaderboard = await page.evaluate(() => ({
  rows: document.querySelectorAll('#lb-table .lb-table-row').length,
  table: (document.getElementById('lb-table')||{}).textContent.replace(/\s+/g,' ').slice(0,80)
}));

// REFERRALS
await page.evaluate(() => switchTab('referrals')); await page.waitForTimeout(2000);
out.referrals = await page.evaluate(() => ({
  cards: document.querySelectorAll('.ref-card').length,
  names: [...document.querySelectorAll('.ref-name')].map(e=>e.textContent.trim()),
  brokenLogos: [...document.querySelectorAll('.ref-card img')].filter(i=>!i.complete||!i.naturalWidth).length
}));

console.log(JSON.stringify(out, null, 1));
console.log('\nerrors:', errs.length ? [...new Set(errs)] : 'none');
await b.close();
