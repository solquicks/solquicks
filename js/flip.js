// solquicks.com — flip.
//
// Split out of js/app.js unchanged; only the import line below is new,
// and it was derived from what this code actually references.

import {
  FoxPoints,
  renderLeaderboard
} from './app.js';

// ── POINTS FLIP ──
// Points only, and the outcome is decided by the server — nothing here
// determines the result, it just shows it.
const CF_WAGERS = [10, 50, 100, 500, 1000];
let cfCall = 'heads';
let cfWager = 10;
let cfBusy = false;

function cfPick(side) {
  cfCall = side;
  document.getElementById('cf-heads').classList.toggle('on', side === 'heads');
  document.getElementById('cf-tails').classList.toggle('on', side === 'tails');
}

function cfRenderWagers() {
  const wrap = document.getElementById('cf-wagers');
  if (!wrap) return;
  const balance = FoxPoints.total();
  wrap.innerHTML = CF_WAGERS.map(function (w) {
    const afford = balance >= w;
    return '<button class="cf-wager' + (w === cfWager ? ' on' : '') + '"' +
      (afford ? '' : ' disabled') +
      ' onclick="cfSetWager(' + w + ')">' + w.toLocaleString() + '</button>';
  }).join('');
}

function cfSetWager(w) { cfWager = w; cfRenderWagers(); }

function cfRender() {
  const card = document.getElementById('cf-card');
  if (!card) return;
  // signed-in only: the balance has to be one the server can verify
  card.hidden = !(FoxPoints.token && FoxPoints.server);
  if (card.hidden) return;
  cfRenderWagers();
  const go = document.getElementById('cf-go');
  const canAfford = FoxPoints.total() >= cfWager;
  go.disabled = cfBusy || !canAfford;
  go.textContent = cfBusy ? 'Flipping…' : ('Flip ' + cfWager.toLocaleString());
  if (!canAfford && !cfBusy) {
    document.getElementById('cf-outcome').textContent = 'Not enough points for that wager.';
  }
}

async function cfFlip() {
  if (cfBusy) return;
  cfBusy = true;
  const coin = document.getElementById('cf-coin');
  const out = document.getElementById('cf-outcome');
  out.className = 'cf-outcome';
  out.textContent = '';
  coin.classList.add('spinning');
  cfRender();

  let r;
  try {
    r = await FoxPoints.api('/api/flip', { method: 'POST', body: { wager: cfWager, call: cfCall } });
  } catch (e) {
    r = { error: 'Could not reach the server.' };
  }

  // let the coin actually spin a moment, otherwise the result feels fake
  await new Promise(function (res) { setTimeout(res, 700); });
  coin.classList.remove('spinning');
  cfBusy = false;

  if (!r || r.error) {
    out.textContent = (r && r.error) || 'Something went wrong.';
    cfRender();
    return;
  }

  if (r.player) FoxPoints.server = r.player;
  coin.textContent = r.result === 'heads' ? '🪙' : '🌕';
  out.className = 'cf-outcome ' + (r.won ? 'win' : 'lose');
  out.textContent = r.won
    ? 'It was ' + r.result + ' — you won ' + cfWager.toLocaleString() + '!'
    : 'It was ' + r.result + ' — you lost ' + cfWager.toLocaleString() + '.';

  FoxPoints.render();
  cfRender();
  renderLeaderboard();
}

export {
  cfFlip,
  cfPick,
  cfRender,
  cfSetWager
};
