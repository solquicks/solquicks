import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const client = await ctx.newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });   // a mid-range phone
await page.goto('https://solquicks.com/?perf=' + Date.now() + '#swap', { waitUntil: 'load' });
await page.waitForTimeout(6000);

const load = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource');
  const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0);
  const paint = performance.getEntriesByType('paint').map((p) => p.name + ' ' + Math.round(p.startTime));
  return {
    domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
    loadEvent: Math.round(n.loadEventEnd || 0),
    transferredKB: Math.round(bytes / 1024),
    requests: res.length,
    paint,
    htmlKB: Math.round((res.find((r) => r.name.includes('solquicks.com/?perf')) || {}).transferSize / 1024)
  };
});
console.log('load:', JSON.stringify(load));

// how much work happens while simply sitting on the swap tab
const idle = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0, longTasks = 0, longMs = 0;
  const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => { longTasks++; longMs += e.duration; }));
  try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const t0 = performance.now();
  const tick = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else { po.disconnect(); resolve({ fps: Math.round(frames / 3), longTasks, longMs: Math.round(longMs) }); } };
  requestAnimationFrame(tick);
}));
console.log('idle on the swap tab:', JSON.stringify(idle));

// typing an amount: how long until the quote is painted
const typed = await page.evaluate(async () => {
  const amt = document.getElementById('sw-in-amount');
  const out = document.getElementById('sw-out-amount');
  out.value = '';
  const t0 = performance.now();
  amt.value = '1';
  amt.dispatchEvent(new Event('input'));
  for (let i = 0; i < 200 && !out.value; i++) await new Promise((r) => setTimeout(r, 50));
  return { msToQuote: Math.round(performance.now() - t0), got: out.value };
});
console.log('typing 1 SOL:', JSON.stringify(typed));

const anim = await page.evaluate(() => ({
  particleCanvas: !!document.getElementById('particle-canvas'),
  canvasPixels: (() => { const c = document.getElementById('particle-canvas'); return c ? c.width * c.height : 0; })(),
  animatedElements: document.querySelectorAll('[style*="animation"], .spinning').length
}));
console.log('animation:', JSON.stringify(anim));
await b.close();
