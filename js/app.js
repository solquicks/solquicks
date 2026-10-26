import {
  cfFlip,
  cfPick,
  cfRender,
  cfSetWager
} from './flip.js';

// solquicks.com — the whole front end.
//
// Moved out of index.html on 2026-10-14 exactly as it was, so this file can be
// split feature by feature into js/ modules. A separate module cannot import
// from an inline <script>, so becoming a file is what makes splitting possible
// at all.
// Devnet mode is opt-in via ?devnet=1. Declared first: anything below may
// reference it, and a `const` cannot be read before its declaration runs.
const DEVNET_MODE = new URLSearchParams(location.search).has('devnet');

/// A shared swap link: ?swap=SOL-BONK, or mint addresses for tokens outside the
/// popular list, with an optional &amount=. Read once at load, before switching
/// to the Swap tab rewrites the address.
var swapLinkPending = (function () {
  try {
    const p = new URLSearchParams(location.search);
    const parts = String(p.get('swap') || '').split('-');
    if (parts.length !== 2 || !parts.every(function (x) { return /^[A-Za-z0-9]{1,44}$/.test(x); })) return null;
    const amount = Number(p.get('amount'));
    return { in: parts[0], out: parts[1], amount: amount > 0 && isFinite(amount) ? amount : null };
  } catch (e) { return null; }
})();

// switchTab can fire during tab restore, before the analytics section's
// own declarations have run. `var` is deliberate: a `let` here throws when
// read early, which silently kills the rest of the script.
var analyticsTimer = null;

// How many names a leaderboard needs before it shows them rather than
// reporting a count. A board of one is not a board — it is the owner
// looking at himself.
//
// ONE constant for every board on the site. There used to be three copies
// of this number, which is why the Fox Points board was raised to two on
// 2026-10-03 and the swap board stayed hidden anyway, and the staking board
// after that. A product rule in three places drifts in three directions.
var BOARD_OPENS_AT = 2;

// The server behind every /api call. Declared up here for the same reason:
// restoring a tab from the address bar loads that tab's data immediately,
// and a `const` further down the file cannot be read before it runs — which
// is exactly how the collection quietly failed to load for anyone following
// a link straight to #moon.
const POINTS_API = 'https://solquicks-points.solquicks-45c.workers.dev';

// ── PARTICLES ──
(function() {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let W, H;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function Particle() {
    this.x = Math.random() * W;
    this.y = Math.random() * H;
    this.vx = (Math.random() - 0.5) * 0.45;
    this.vy = (Math.random() - 0.5) * 0.45;
    this.radius = Math.random() * 1.6 + 0.4;
    this.alpha = Math.random() * 0.55 + 0.1;
    this.alphaDir = (Math.random() > 0.5 ? 1 : -1) * 0.003;
  }

  for (let i = 0; i < 80; i++) particles.push(new Particle());

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.alpha += p.alphaDir;
      if (p.alpha >= 0.65 || p.alpha <= 0.08) p.alphaDir *= -1;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,130,30,' + (p.alpha * 0.5) + ')';
      ctx.fill();
    });
    // draw faint connection lines between close particles
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 90) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = 'rgba(240,130,30,' + (0.05 * (1 - dist / 90)) + ')';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ── NAV MENU ──
// One dropdown instead of a row of pills: it holds as many destinations as
// the site grows to, and every entry gets a line saying what it actually is
// — which a one-word tab never could.
function toggleMenu() {
  const t = document.getElementById('nav-trigger');
  if (t.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu();
}

function openMenu() {
  const menu = document.getElementById('nav-menu');
  menu.hidden = false;
  document.getElementById('nav-trigger').setAttribute('aria-expanded', 'true');
  // Measured on opening rather than guessed at from a breakpoint: whether
  // it scrolls depends on how many entries there are and how tall the
  // window is, and entries are added at runtime.
  menu.classList.toggle('scrolls', menu.scrollHeight > menu.clientHeight + 2);
}

function closeMenu() {
  const menu = document.getElementById('nav-menu');
  if (menu) menu.hidden = true;
  const t = document.getElementById('nav-trigger');
  if (t) t.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', function (ev) {
  const nav = document.querySelector('.nav');
  if (nav && !nav.contains(ev.target)) closeMenu();
});
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape') return;
  const t = document.getElementById('nav-trigger');
  if (t && t.getAttribute('aria-expanded') === 'true') { closeMenu(); t.focus(); }
});

// ── TABS ──
/// What the trigger should call a tab. Read from whichever control offers
/// it — the menu row's name, or the bar button's own text.
function tabLabel(tab) {
  const el = document.querySelector('[data-tab="' + tab + '"]');
  if (!el) return '';
  const named = el.querySelector('.nav-item-name');
  return (named ? named.textContent : el.textContent).trim();
}

/// Switches on the tab name rather than the button that was clicked: the
/// same tab now has two controls (a menu row or a button in the bar, not
/// both), and either must light up whichever exists.
function switchTab(tab, btn) {
  document.querySelectorAll('.nav-item, .nav-quick-btn').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('[data-tab="' + tab + '"]').forEach(function (el) { el.classList.add('active'); });
  // choosing closes the menu, and the trigger takes on the page name
  closeMenu();
  const label = tabLabel(tab);
  if (label) document.getElementById('nav-current').textContent = label;
  const panel = document.getElementById('panel-' + tab);
  // Reset animation so it replays on every tab switch
  panel.style.animation = 'none';
  panel.offsetHeight; // force reflow
  panel.style.animation = '';
  panel.classList.add('active');
  const profileBand = document.querySelector('.profile-band');
  if (tab === 'links') {
    profileBand.classList.remove('collapsed');
  } else {
    profileBand.classList.add('collapsed');
  }
  // Trigger stat counters when Media tab opens
  if (tab === 'media') { runStatCounters(); }
  // Collection stats are public, so they load on tab open rather than
  // waiting for a wallet. Refresh only while the tab is actually showing.
  if (tab === 'book') {
    if (!bkData && typeof loadBooking === 'function') loadBooking();
    if (!bkPacks && typeof loadBundles === 'function') loadBundles();
    if (typeof paintCart === 'function') paintCart();
  }
  if (tab === 'swap' && typeof loadSwap === 'function') loadSwap();
  // Deferred for the same reason Savings is: landing on #store runs this
  // while the script is still being read, and loadCollectible reaches for
  // MINT, which is declared further down. A function is hoisted and looks
  // ready; the const it needs is not.
  if (tab === 'store' && typeof loadStore === 'function') {
    setTimeout(function () { loadStore(); loadCollectible(); loadPointsPacks(); }, 0);
  }
  if (tab === 'referrals' && typeof loadReferrals === 'function') loadReferrals();
  // The rate is re-read on every open rather than once on load: it is a
  // variable rate and a number from an hour ago is not the number.
  if (tab === 'defi' && typeof loadDefiRate === 'function') {
    // Deferred by a tick. Landing on #savings runs this while the script is
    // still being read, and `defi` and `Wallet` are declared further down —
    // so touching them threw "cannot access before initialization" and the
    // wallet never came up at all on this tab. A function is hoisted and
    // looks ready; a const is not. Waiting one turn is enough.
    setTimeout(function () {
      loadDefiRate();
      loadDefiBalances();
      // What a position is worth changes while somebody is looking at it,
      // so it is asked again every half minute rather than frozen at the
      // moment the tab opened — and only while the tab is open, because
      // there is no reason to poll a page nobody is on.
      clearInterval(defi.tick);
      defi.tick = setInterval(function () {
        const panel = document.getElementById('panel-defi');
        if (!panel || !panel.classList.contains('active')) {
          clearInterval(defi.tick);
          defi.tick = null;
          return;
        }
        if (defi.held > 0) paintDefiPosition();
      }, 30000);
      const box = document.getElementById('df-amount');
      if (box && !box._bound) {
        box._bound = true;
        box.addEventListener('input', defiAmountChanged);
      }
    }, 0);
  }
  if (tab === 'moon') {
    if (typeof loadCollection === 'function') loadCollection();
    if (typeof loadAnalytics === 'function') {
      loadAnalytics();
      if (!analyticsTimer) analyticsTimer = setInterval(loadAnalytics, 300000);
    }
  } else if (analyticsTimer) {
    clearInterval(analyticsTimer);
    analyticsTimer = null;
  }
  // Remember the tab so a refresh lands where you were, and so a tab can
  // be linked to directly.
  try {
    history.replaceState(null, '', tab === 'links' ? location.pathname : '#' + hashFor(tab));
  } catch (e) {}
}

/// Any control for a tab, in the menu or in the bar. Looking only inside
/// the menu would have broken every #swap, #store and #book link the
/// moment those three moved out of it.
/// The address bar should say what the page says. The tab is still called
/// `defi` inside — renaming the id would break every #defi link anybody has
/// already shared — so the name and the id are allowed to differ, and both
/// hashes resolve to the same tab.
const TAB_HASHES = { defi: 'savings' };
const hashFor = (tab) => TAB_HASHES[tab] || tab;
const tabForHash = function (name) {
  for (const tab in TAB_HASHES) if (TAB_HASHES[tab] === name) return tab;
  return name;
};

function tabButton(name) {
  return document.querySelector('[data-tab="' + tabForHash(name) + '"]');
}

// ── pages that are not open yet ──────────────────────────────────────
// Each of these is a revenue line waiting on the thing behind it. They get
// a tab and a page now so the shape of the site is settled, and each says
// plainly that it is not open — an empty page with no explanation reads as
// broken, and a page that pretends to work is worse.
//
// Defined here rather than written into the markup four times: adding the
// fifth is one line, and the tab, the menu entry and the page cannot drift
// apart from each other.
// What the badge in the corner says. On a creator's own site the name is
// the only line that changes: the badge still names the thing that built
// it, which is how the creator after them finds it.
//
// The call to action is the half that does the work. "Powered by" alone is
// a credit — it tells you who made this and nothing about what to do next.
// Set cta to null on any site that should carry the credit without the
// invitation.
const LAUNCHPAD = { name: 'solquicks', cta: 'Launch your own website' };

const SOON_TABS = [
  {
    // Built, so this entry is here only for its place in the menu — the
    // panel below is written out rather than generated.
    tab: 'defi', name: 'Savings', icon: '◉', live: true,
    note: 'Earn on the USDC you already hold',
    lead: 'Savings',
    what: ''
  },
  {
    tab: 'mine', name: 'Mine Bitcoin', icon: '₿',
    partners: [
      { name: 'Sat Rush', logo: 'img/partners/sat-rush.jpg',
        what: 'Bitcoin mining you take part in by depositing, rather than by running hardware.' }
    ],
    note: 'Deposit USDC, earn Bitcoin',
    lead: 'Mine Bitcoin',
    what: 'Deposit USDC and earn Bitcoin — no rig, no electricity bill and ' +
      'nothing to plug in. The rates and the terms are still being worked out.'
  },
  {
    tab: 'gacha', name: 'Gacha', icon: '✹',
    // Name and mark only. The line describing what each of these does is
    // theirs to write — describing somebody else's business for them, on a
    // page that credits them, is not ours to guess at.
    partners: [
      { name: 'Slabz', logo: 'img/partners/slabz.jpg',
        what: 'Graded cards, sealed and held on chain — some of what the machine pulls from.' },
      { name: 'Collector Crypt', logo: 'img/partners/collector-crypt.jpg',
        what: 'Real trading cards, vaulted and tradeable as tokens, so a pull can be a card you could hold.' }
    ],
    note: 'Pull the handle, see what comes out',
    lead: 'Gacha',
    what: 'A pull of the handle for something out of the collection. What goes ' +
      'in the machine, what it costs and what the odds are have still to be ' +
      'settled — and the odds will be written down before anyone spends anything.'
  },
  {
    tab: 'travel', name: 'Travel', icon: '✈',
    partners: [
      { name: 'Nomadz', logo: 'img/partners/nomadz.jpg',
        what: 'Travel booked on chain, for people who already live out of a wallet.' }
    ],
    note: 'Book trips, powered by Nomadz',
    lead: 'Travel',
    what: 'Flights and stays booked straight from a wallet. What is bookable, ' +
      'and on what terms, is still being worked out.'
  },
  {
    // Built — its panel is markup in index.html, not a generated card.
    tab: 'games', name: 'Games', icon: '◈', live: true,
    note: 'Play free, earn Fox Points',
    lead: 'Games',
    what: ''
  },
  {
    tab: 'wishlist', name: 'Wishlist', icon: '✦',
    partners: [
      { name: 'sp3nd', logo: 'img/partners/sp3nd.jpg',
        what: 'Real-world checkout paid from a wallet, with no card in between.' }
    ],
    note: 'My Amazon wishlist, paid in crypto',
    lead: 'Wishlist',
    what: 'My Amazon wishlist, so anything on it can be sent straight from a ' +
      'wallet, without a card or a checkout in between.'
  }
];

/// The one place a not-yet-open page is described, so all four look the
/// same and none of them looks like a page that failed to load.
function soonHtml(lead, what, partners) {
  // A list, not one: Gacha is built with two, and the next feature along
  // will be too. One shape for every page beats a special case per page.
  const with_ = partners || [];
  return '<div class="soon">' +
    '<div class="soon-tag">Coming soon</div>' +
    '<div class="soon-lead">' + escapeHtml(lead) + '</div>' +
    '<p class="soon-what">' + escapeHtml(what) + '</p>' +
    // Named where there is a name. A page that says who it is being built
    // with reads as a plan; the same page without it reads as a wish, and
    // several of these had real partners going uncredited.
    (with_.length
      ? '<div class="soon-with"><div class="soon-with-head">Powered by</div>' +
        // The group is centred, the rows inside it are not. Centring each
        // row on its own put Slabz's mark and Collector Crypt's at
        // different places on the line, because their names are different
        // lengths — tidy one at a time, ragged together.
        // One partner has nothing to line up with, so it is centred. The
        // ranging-left only exists to stop two marks sitting at different
        // places on the line because their names are different lengths.
        '<div class="soon-with-list' + (with_.length === 1 ? ' one' : '') + '">' +
        with_.map(function (p) {
          return '<div class="soon-partner">' +
            '<div class="soon-partner-top">' +
              // Only ever a file in this repo. A mark is somebody else's
              // property and showing it reads as their endorsement, so the
              // path is never something that arrived at runtime.
              (p.logo ? '<img class="soon-logo" src="' + escapeHtml(p.logo) + '" alt="" loading="lazy"/>' : '') +
              '<b>' + escapeHtml(p.name) + '</b>' +
            '</div>' +
            // The line goes under the pair rather than beside it, so a long
            // one does not drag the name off centre.
            (p.what ? '<span>' + escapeHtml(p.what) + '</span>' : '') +
            '</div>';
        }).join('') +
        '</div></div>'
      : '') +
    '</div>';
}

/// Contact stays first as the landing page and the rest are alphabetical.
/// Sorted rather than written in order, because the order is a rule and a
/// rule that is retyped by hand is a rule that eventually is not followed.
function sortNavMenu() {
  const menu = document.getElementById('nav-menu');
  const items = [...menu.querySelectorAll('.nav-item')];
  const name = function (el) {
    const n = el.querySelector('.nav-item-name');
    return (n ? n.textContent : el.textContent).trim().toLowerCase();
  };
  items.sort(function (a, b) {
    if (a.dataset.tab === 'links') return -1;
    if (b.dataset.tab === 'links') return 1;
    return name(a).localeCompare(name(b));
  });
  // The Launchpad entry is a link to another page rather than a tab, so it
  // has no data-tab — it still sorts by its name like the rest.
  for (const el of items) menu.appendChild(el);
}

(function buildSoonTabs() {
  const menu = document.getElementById('nav-menu');
  const after = document.getElementById('panel-referrals');
  for (const page of SOON_TABS) {
    if (page.inMenu !== false) buildMenuItem(menu, page);
    // A tab that has been built keeps its menu entry and brings its own
    // panel. Generating a "coming soon" one over the top would bury it.
    if (page.live) continue;
    const panel = document.createElement('div');
    panel.id = 'panel-' + page.tab;
    panel.className = 'panel';
    panel.innerHTML = soonHtml(page.lead, page.what, page.partners);
    after.parentNode.insertBefore(panel, after.nextSibling);
  }
  sortNavMenu();
  document.getElementById('powered-name').textContent = LAUNCHPAD.name;
  const cta = document.getElementById('powered-cta');
  cta.textContent = LAUNCHPAD.cta || '';
  cta.hidden = !LAUNCHPAD.cta;
})();

function buildMenuItem(menu, page) {
  {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.tab = page.tab;
    btn.onclick = function () { switchTab(page.tab, btn); };
    btn.innerHTML = '<span class="nav-item-icon" aria-hidden="true">' + page.icon + '</span>' +
      '<span><span class="nav-item-name"></span>' +
      '<span class="nav-item-note"></span></span>';
    // Set as text, not built into the markup, so a name with an ampersand
    // in it can never become part of the page's structure.
    btn.querySelector('.nav-item-name').textContent = page.name;
    btn.querySelector('.nav-item-note').textContent = page.note;
    menu.appendChild(btn);
  }
}

// ── whose site is this ───────────────────────────────────────────────
// One file serves every creator. Which one it is rendering is decided by
// the address it was opened at: <slug>.solquicks.com, or /c/<slug> where a
// wildcard subdomain is not available.
//
// Nothing about a creator's site is in this file. It is all one row, read
// once at load, which is what makes the template a template.
const SITE_ROOT = 'solquicks.com';
var CREATOR = null;

function siteSlugFromLocation() {
  const path = location.pathname.match(/^\/c\/([a-z0-9-]{3,32})\/?$/);
  if (path) return path[1];
  const host = location.hostname.toLowerCase();
  if (host === SITE_ROOT || host === 'www.' + SITE_ROOT) return null;
  if (!host.endsWith('.' + SITE_ROOT)) return null;   // localhost, previews
  const label = host.slice(0, -(SITE_ROOT.length + 1));
  // One label, and one that could really be a slug we issued. "a.b" is not
  // a creator, it is somebody probing.
  return /^[a-z0-9-]{3,32}$/.test(label) ? label : null;
}

/// Turns this page into that creator's site: their name at the top, their
/// pages in the bar, and everything they did not choose taken away.
function applySite(site) {
  CREATOR = site;
  document.title = site.name + (site.handle ? ' | ' + site.handle : '');
  document.documentElement.dataset.creator = site.slug;

  const handle = (site.handle || '').replace(/^@/, '');
  const handleEl = document.getElementById('site-handle');
  // Rebuilt rather than assigned into, so a name can never be markup.
  handleEl.innerHTML = '';
  if (handle) {
    const at = document.createElement('span');
    at.textContent = '@';
    handleEl.append(at, document.createTextNode(handle));
  } else {
    handleEl.textContent = site.name;
  }
  document.getElementById('site-tagline').textContent = site.tagline || '';
  if (/^https:\/\//i.test(site.avatar || '') ||
      /^data:image\/(png|jpeg|webp);base64,/.test(site.avatar || '')) {
    const img = document.getElementById('site-avatar');
    img.src = site.avatar;
    img.alt = site.name;
  }
  // My Telegram and my email have no business on somebody else's site.
  document.getElementById('site-contact').hidden = true;

  const links = document.getElementById('panel-links');
  const socials = site.socials || [];
  if (links) {
    links.innerHTML = '<p class="section-label">Find me on</p><div class="links-list"></div>';
    const list = links.querySelector('.links-list');
    if (!socials.length) {
      list.outerHTML = '<div class="soon"><div class="soon-lead">' + escapeHtml(site.name) + '</div>' +
        '<p class="soon-what">' + escapeHtml(site.tagline || 'Links coming soon.') + '</p></div>';
    } else {
      for (const soc of socials) {
        // Built as elements rather than markup: every part of this came
        // from what somebody typed into the Launchpad.
        const a = document.createElement('a');
        a.className = 'link-card';
        a.href = soc.href;
        if (soc.href.slice(0, 7) !== 'mailto:') {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        const icon = document.createElement('div');
        icon.className = 'link-icon';
        icon.textContent = (soc.name || '?')[0].toUpperCase();
        icon.style.cssText = 'display:grid;place-items:center;font-weight:800;background:var(--cream)';
        const info = document.createElement('div');
        info.className = 'link-info';
        const nm = document.createElement('div');
        nm.className = 'link-name';
        nm.textContent = soc.name;
        const hd = document.createElement('div');
        hd.className = 'link-handle';
        hd.textContent = soc.label;
        info.append(nm, hd);
        a.append(icon, info);
        list.appendChild(a);
      }
    }
  }

  // The bar gets their three; the menu keeps Contact and adds the rest.
  const keep = site.topTabs.concat(site.moreTabs);
  const quick = document.getElementById('nav-quick');
  quick.innerHTML = '';
  for (const tab of site.topTabs) {
    const b = document.createElement('button');
    b.className = 'nav-quick-btn';
    b.dataset.tab = tab;
    b.textContent = tabName(tab);
    b.onclick = function () { switchTab(tab, b); };
    quick.appendChild(b);
  }
  for (const el of document.querySelectorAll('.nav-item[data-tab]')) {
    if (el.dataset.tab !== 'links' && keep.indexOf(el.dataset.tab) < 0) el.remove();
  }
  // A page nobody put on this site should not be reachable by typing its
  // name into the address bar either.
  for (const panel of document.querySelectorAll('.panel[id^="panel-"]')) {
    const tab = panel.id.slice('panel-'.length);
    if (tab !== 'links' && keep.indexOf(tab) < 0) panel.remove();
  }
  sortNavMenu();
}

/// Added to every call that quotes or takes money. On a creator's site it
/// is their slug, which is what routes the payment to their wallet; here it
/// is nothing at all. One helper so that no call can quietly forget it and
/// send somebody's customer to the wrong address.
function siteParam(prefix) {
  return CREATOR ? prefix + 'site=' + encodeURIComponent(CREATOR.slug) : '';
}
function withSite(body) {
  return CREATOR ? Object.assign({ site: CREATOR.slug }, body) : body;
}
/// Anything that quotes or takes money waits for this first. The page
/// starts up before it knows whose site it is, and a rate card fetched in
/// that gap quotes my wallet on somebody else's site.
function siteKnown() {
  return typeof whoseSite === 'undefined' ? Promise.resolve() : whoseSite;
}

const TAB_NAMES = {
  swap: 'Swap', store: 'Store', book: 'Book', cleanup: 'Cleanup',
  gacha: 'Gacha', wishlist: 'Wishlist', defi: 'Savings', referrals: 'Referrals',
  mine: 'Mine Bitcoin', travel: 'Travel', games: 'Games'
};
function tabName(tab) {
  return TAB_NAMES[tab] || tab;
}

// The page is held back by the head script until this has answered, so
// that nobody sees my site briefly wearing their address.
const whoseSite = (async function () {
  const slug = siteSlugFromLocation();
  if (!slug) return null;
  try {
    const res = await fetch(POINTS_API + '/api/site?slug=' + encodeURIComponent(slug));
    const d = await res.json();
    if (d && d.site) { applySite(d.site); return d.site; }
    // A subdomain nobody has claimed. Rendering my site at their address
    // would be worse than saying plainly that there is nothing here.
    //
    // Covered rather than emptied: the rest of the page is still starting
    // up behind this, and taking its elements away mid-flight makes every
    // loader fall over on something that was there a moment ago.
    const cover = document.createElement('div');
    cover.id = 'no-site';
    cover.style.cssText = 'position:fixed;inset:0;z-index:999;background:var(--bg);' +
      'display:grid;place-items:center;padding:20px;overflow:auto';
    cover.innerHTML = '<div class="soon">' +
      '<div class="soon-tag">Nothing here yet</div>' +
      '<div class="soon-lead">No site at this address</div>' +
      '<p class="soon-what">This name has not been claimed. ' +
      '<a href="https://' + SITE_ROOT + '/launch.html">Launch your own website</a>.</p></div>';
    document.body.appendChild(cover);
    return null;
  } catch (e) {
    return null;   // the main site is what is left, which is a safe default
  } finally {
    document.documentElement.classList.remove('site-loading');
  }
})();

// Restore the tab from the URL on load.
(function restoreTab() {
  if (swapLinkPending) { switchTab('swap', tabButton('swap')); return; }
  const name = location.hash.replace('#', '');
  if (!name) return;
  const btn = tabButton(name);
  // The tab, not the hash. They differ for Savings, whose panel is still
  // panel-defi — and switchTab given "savings" went looking for a panel
  // that does not exist, threw, and left the page with no panel showing at
  // all. Which is what landing on the page and refreshing it did.
  if (btn) switchTab(btn.dataset.tab || tabForHash(name), btn);
})();

// an Enter press in the lookup box should search
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter' && ev.target && ev.target.id === 'an-addr') lookupWallet();
});

window.addEventListener('hashchange', function () {
  const btn = tabButton(location.hash.replace('#', '') || 'links');
  if (btn && !btn.classList.contains('active')) switchTab(btn.dataset.tab, btn);
});

// ── SERIES ──
function switchSeries(s, btn) {
  const toggle = btn.closest('.series-toggle');
  toggle.querySelectorAll('.series-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('series-hs').style.display = s === 'hs' ? 'flex' : 'none';
  document.getElementById('series-ff').style.display = s === 'ff' ? 'flex' : 'none';
}

function switchMediaType(type, btn) {
  document.querySelectorAll('.media-type-toggle .series-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.media-sub').forEach(el => el.classList.remove('active'));
  document.getElementById('media-' + type).classList.add('active');
}

function filterStreams(query) {
  const cards = document.querySelectorAll('#solflare-stream-list .stream-card');
  const q = query.toLowerCase().trim();
  let visible = 0;
  cards.forEach(card => {
    const title = card.querySelector('.stream-title').textContent.toLowerCase();
    const num = card.querySelector('.stream-num').textContent.toLowerCase();
    const match = q === '' || title.includes(q) || num.includes(q);
    card.style.display = match ? 'flex' : 'none';
    if (match) visible++;
  });
  const noResults = document.getElementById('stream-no-results');
  if (noResults) noResults.style.display = visible === 0 ? 'block' : 'none';
}

function switchStreamSeries(series, btn) {
  document.querySelectorAll('.stream-series-toggle .series-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.stream-series-panel').forEach(el => el.style.display = 'none');
  document.getElementById('stream-' + series).style.display = 'block';
}

// ── CAROUSEL ──
function goSlide(n) {
  document.querySelectorAll('.carousel-img').forEach((el, i) => el.classList.toggle('active', i === n));
  document.querySelectorAll('.cdot').forEach((el, i) => el.classList.toggle('active', i === n));
}
let slideIdx = 0;
setInterval(() => { slideIdx = (slideIdx + 1) % 3; goSlide(slideIdx); }, 3500);

// ── WALLET ──


// ── BACK TO TOP ──
(function() {
  window.addEventListener('scroll', function() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;
    if (window.scrollY > 300) { btn.classList.add('visible'); }
    else { btn.classList.remove('visible'); }
  }, { passive: true });
})();
  
// ── STAT COUNTERS (was referenced but never defined) ──
function runStatCounters() {
  document.querySelectorAll('.stat-num').forEach(function(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = '1';
    const target = parseInt(el.textContent, 10);
    if (isNaN(target)) return;
    const t0 = performance.now();
    function tick(t) {
      const p = Math.min((t - t0) / 900, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}




// ── DAILY POINTS ──
// Claimed on a button rather than automatically: the automatic version ran
// before the session finished restoring, so it took the anonymous path and
// the points landed in local storage where a signed-in player never saw them.
async function claimDaily() {
  const btn = document.getElementById('daily-claim');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Claiming…';

  if (FoxPoints.token && FoxPoints.server) {
    const r = await FoxPoints.api('/api/visit', { method: 'POST' });
    if (r && r.player) FoxPoints.server = r.player;
  }
  FoxPoints.render();
  renderLeaderboard();
  renderDailyClaim();
}

function renderDailyClaim() {
  const btn = document.getElementById('daily-claim');
  if (!btn) return;
  const amount = (FoxPoints.server && FoxPoints.server.dailyAmount) || FOX_EVENTS.visit.pts;
  btn.hidden = false;

  // Signed out there is nowhere to put the points, so the button says so
  // rather than offering a claim that quietly does nothing.
  if (!FoxPoints.server) {
    btn.disabled = true;
    btn.textContent = 'Connect a wallet to claim';
    return;
  }

  const available = FoxPoints.server.dailyAvailable !== false;
  btn.disabled = !available;
  btn.textContent = available
    ? 'Claim ' + amount + ' daily points'
    : 'Claimed today — back tomorrow';
}

// ── SPONSOR BANNER ──
// Live ads come from the booking system; banner.json `active` stays as a
// manual override for anything sold off-platform. An unsold slot advertises
// itself rather than falling back to house promos.
(async function () {
  const el = document.getElementById('banner');
  if (!el) return;

  let slot = null;
  try {
    const res = await fetch(POINTS_API + '/api/banner/live');
    const d = await res.json();
    if (d && d.slot) {
      slot = {
        sponsor: d.slot.sponsor, headline: d.slot.headline,
        url: d.slot.url, image: d.slot.image_url
      };
    }
  } catch (e) { /* fall through to the manual override */ }

  if (!slot) {
    try {
      const res = await fetch('banner.json', { cache: 'no-store' });
      const cfg = await res.json();
      const today = new Date().toISOString().slice(0, 10);
      if (cfg.active && (!cfg.active.until || cfg.active.until >= today)) slot = cfg.active;
    } catch (e) { /* nothing booked */ }
  }

  if (!slot) { renderBannerAvailable(el); return; }

  document.getElementById('banner-headline').textContent = slot.headline || '';
  document.getElementById('banner-sponsor').textContent = slot.sponsor || '';
  const art = document.getElementById('banner-art');
  if (slot.image) {
    const img = document.createElement('img');
    img.src = slot.image;
    img.alt = '';
    img.loading = 'lazy';
    art.innerHTML = '';
    art.appendChild(img);
  } else {
    art.textContent = slot.emoji || '🦊';
  }
  el.href = slot.url || '#';
  el.classList.add('visible');

  const slotId = 'ad:' + (slot.sponsor || 'unknown');
  countBanner(slotId, 'view');
  el.addEventListener('click', function () { countBanner(slotId, 'click'); });
})();

/// An empty slot is inventory, so say so and make it one click to buy.
function renderBannerAvailable(el) {
  el.classList.add('visible', 'for-sale');
  el.removeAttribute('target');
  el.href = 'javascript:void(0)';
  document.getElementById('banner-tag').textContent = 'Available';
  document.getElementById('banner-tag').classList.add('house');
  const art = document.getElementById('banner-art');
  art.textContent = 'Your advertising space here';
  art.classList.add('banner-pitch-text');
  document.getElementById('banner-headline').textContent = 'Book this space';
  document.getElementById('banner-sponsor').textContent = '';
  const go = el.querySelector('.banner-go');
  if (go) go.textContent = 'Book it →';
  el.addEventListener('click', function (ev) {
    ev.preventDefault();
    const btn = tabButton('book');
    if (btn) switchTab('book', btn);
    setTimeout(function () {
      const card = document.querySelector('.bk-ad');
      if (!card) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('bk-ad-flash');
      setTimeout(function () { card.classList.remove('bk-ad-flash'); }, 1600);
    }, 300);
  });
}

function countBanner(slotId, kind) {
  try {
    fetch(POINTS_API + '/api/banner/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: slotId, kind: kind })
    });
  } catch (e) { /* stats are not worth an error */ }
}

// ── FOX POINTS ──
// Points are tracked server-side (Cloudflare Worker + D1) so a balance
// can't be edited in devtools and follows the wallet across devices.
// Signed-out visitors earn nothing: a browser-side tally could never be
// carried over without trusting the browser's own number for it, and the
// site should not show a total it has no way to honour.
// POINTS_API is declared at the top of this script, because tab restore runs
// before this point and anything it loads needs the address.

const FOX_EVENTS = {
  visit:    { pts: 10,  label: 'Daily points 👋' },
  plushie:  { pts: 500, label: 'Plushie purchase 🧸' },
  game:     { pts: 25,  label: 'Game played 🎮' },
  gacha:    { pts: 50,  label: 'Gacha pull 🎰' },
  stake:    { pts: 100, label: 'Moon Ranger staking 🌕' },
  swap:     { pts: 0,   label: 'Token swap ⇅' },
  cleanup:  { pts: 0,   label: 'Wallet cleanup ♻' },
  burn:     { pts: 0,   label: 'Wallet cleanup ♻' },
  mission:  { pts: 0,   label: 'Mission reward 🎯' },
  migrated: { pts: 0,   label: 'Points carried over 📦' },
  spin:     { pts: 0,   label: 'Giveaway wheel spin 🎡' } // retired; kept so past entries still render
};

const FoxPoints = {
  server: null,   // player object from the API when signed in
  token: null,

  loadToken() {
    try {
      const raw = localStorage.getItem('fox_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.token || s.expires < Date.now()) return null;
      return s;
    } catch (e) { return null; }
  },
  saveToken(token, expires, wallet) {
    try { localStorage.setItem('fox_session', JSON.stringify({ token, expires, wallet })); } catch (e) {}
  },
  clearToken() {
    try { localStorage.removeItem('fox_session'); } catch (e) {}
    this.token = null; this.server = null;
    // These are one wallet's earnings and its own code. They belong to
    // nobody the moment that wallet is gone.
    for (const id of ['iv-card', 'iv-enter-card']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
  },

  // points still accruing from staking count toward the displayed total,
  // so a staked Ranger visibly moves the number without needing a claim
  total() {
    if (!this.server) return 0;
    return (this.server.total !== undefined) ? this.server.total : this.server.points;
  },
  pending() { return this.server ? (this.server.pending || 0) : 0; },
  logEntries() { return this.server ? this.server.log : []; },

  async api(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    const res = await fetch(POINTS_API + path, {
      method: opts.method || 'GET', headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401 && this.token) { this.clearToken(); }
    return res.json().catch(function () { return null; });
  },

  async refresh() {
    if (!this.token) return;
    const r = await this.api('/api/me');
    if (r && r.player) this.server = r.player;
    this.render();
    renderStaking();
    // A restored session skipped this, so the Ranger grid stayed empty on
    // every page reload — it only ever appeared right after signing in.
    if (typeof loadRangers === 'function') loadRangers();
    if (typeof loadMission === 'function') loadMission();
    if (typeof loadSwapPoints === 'function') loadSwapPoints().then(flushSwapPoints);
    if (typeof loadInvite === 'function') loadInvite();
  },

  render() {
    const totalEl = document.getElementById('lb-total');
    if (totalEl) totalEl.textContent = this.total().toLocaleString();

    const noteEl = document.getElementById('lb-rank-note');
    if (noteEl) {
      const pend = this.pending();
      if (this.server && pend > 0) {
        noteEl.innerHTML = 'Includes <strong>' + pend.toLocaleString() +
          '</strong> still accruing from staking.';
      } else {
        noteEl.innerHTML = this.server
          ? 'Saved to your wallet — these follow you to any device.'
          : '<strong>Connect a wallet</strong> to start earning Fox Points.';
      }
    }

    if (typeof cfRender === 'function') cfRender();
    if (typeof renderDailyClaim === 'function') renderDailyClaim();

    const logEl = document.getElementById('lb-log');
    if (!logEl) return;
    const log = this.logEntries();
    if (!log || log.length === 0) {
      logEl.innerHTML = this.server
        ? '<div class="lb-log-empty">No points yet — go do something foxy 🦊</div>'
        : '<div class="lb-log-empty">Connect a wallet to start earning 🦊</div>';
      return;
    }
    logEl.innerHTML = log.map(function (item) {
      const cfg = FOX_EVENTS[item.e] || { label: item.e };
      const d = new Date(item.t);
      const when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return '<div class="lb-log-row"><span class="lb-log-what">' + cfg.label +
        '</span><span class="lb-log-when">' + when +
        '</span><span class="lb-log-pts">+' + item.p + '</span></div>';
    }).join('');
  },

  // Prove wallet ownership, then move any local points onto the account.
  async signIn(provider, wallet) {
    const n = await this.api('/api/nonce', { method: 'POST', body: { wallet } });
    if (!n || !n.message) throw new Error('could not start sign-in');

    const encoded = new TextEncoder().encode(n.message);
    let sigBytes;
    if (provider.kind === 'privy') {
      // Privy takes the message as text and hands back a base64 string,
      // where the wallet-standard path deals in bytes both ways.
      const out = await Privy.provider.request({
        method: 'signMessage', params: { message: n.message } });
      sigBytes = Uint8Array.from(atob(out.signature), function (ch) { return ch.charCodeAt(0); });
    } else if (provider.kind === 'standard') {
      const feat = provider.w.features['solana:signMessage'];
      if (!feat) throw new Error('this wallet cannot sign messages');
      const out = await feat.signMessage({ account: walletAccount(provider, wallet), message: encoded });
      sigBytes = out[0].signature;
    } else {
      const out = await provider.w.signMessage(encoded, 'utf8');
      sigBytes = out.signature || out;
    }
    let bin = '';
    const arr = new Uint8Array(sigBytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);

    const s = await this.api('/api/session', {
      method: 'POST',
      body: { wallet: wallet, nonce: n.nonce, signature: btoa(bin) }
    });
    if (!s || !s.token) throw new Error((s && s.error) || 'sign-in failed');

    this.token = s.token;
    this.server = s.player;
    this.saveToken(s.token, s.expires, wallet);

    this.render();
    renderLeaderboard();
    if (typeof loadRangers === 'function') loadRangers();
  }
};

// Retired: points used to accrue in localStorage for signed-out visitors and
// were carried over on sign-in, which meant the browser reported its own
// balance. Clear the leftover key so an old total can't linger in anyone's
// storage. Safe to delete this line once it has been live for a while.
try { localStorage.removeItem('foxpoints'); } catch (e) {}

// restore a saved session on load
(function () {
  if (typeof DEVNET_MODE !== 'undefined' && DEVNET_MODE) {
    const el = document.getElementById('moon-devnet');
    if (el) el.hidden = false;
  }
  const s = FoxPoints.loadToken();
  if (s) { FoxPoints.token = s.token; FoxPoints.refresh(); }
  FoxPoints.render();
})();

// ── SOLANA WALLET (dependency-free, Wallet Standard + injected fallback) ──
// Moon Rangers (MNRNG) — certified collection, verified on-chain against
// items 9D2Cgb… and 6ZKk3k…. Verified creator is EhpKLi9zp7NMMgw1gj1QbnH5XXNEuh1eaUa6Uit3ZuLE.
const MOON_RANGERS_COLLECTION = '5QuB6vy8181PG9g9SiQD6U7TfvuF9hcP9tAjj5DH79oz';
const STAKE_RATE_PER_DAY = 100;
const DAY_MS = 86400000;
// On-chain reads go through our Cloudflare Worker proxy, which holds the
// Helius API key server-side (encrypted secret) so no key is ever public.
// The worker only returns CORS headers for solquicks.com. Source:
// helius-labs/helius-rpc-proxy. Empty = ownership checks are skipped.
const HELIUS_RPC = 'https://solquicks-rpc-proxy.solquicks-45c.workers.dev';

// How many Moon Rangers the connected wallet holds.
// null = checking, -1 = check failed, -2 = checks not configured, 0+ = verified count
let rangerCount = null;

async function checkRangers(owner) {
  const res = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'rangers', method: 'searchAssets',
      params: {
        ownerAddress: owner,
        grouping: ['collection', MOON_RANGERS_COLLECTION],
        page: 1, limit: 1000
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'das-error');
  return data.result.total || 0;
}

async function refreshRangers() {
  if (!Wallet.pubkey) { rangerCount = null; renderStaking(); return; }
  if (!HELIUS_RPC) { rangerCount = -2; renderStaking(); return; }
  rangerCount = null;
  renderStaking();
  try {
    rangerCount = await checkRangers(Wallet.pubkey);
    settleStakeCount(rangerCount);
  } catch (e) {
    console.error('Ranger check failed:', e);
    rangerCount = -1;
  }
  renderStaking();
}

// ── signing in instead of connecting ───────────────────────────────────
// A wallet made from an email, a phone number or a Google account, for
// anyone who has never installed an extension. It signs like any other
// wallet here — the four signing paths below each have a branch for it —
// but the key lives in a frame on Privy's origin and never in this page.
//
// The App ID is a public identifier. Privy only answers to it from the
// origins allowlisted in their dashboard, which is what stops somebody
// else's site using it.
const PRIVY_APP_ID = 'cmumeogp100bs0djspgu988bc';

const Privy = {
  sdk: null, client: null, provider: null, account: null, pending: null,
  way: 'email', sentTo: '',

  // 800KB is not something to put on every visitor, so it is only fetched
  // once somebody says they have no wallet.
  load() {
    if (window.PrivySDK) return Promise.resolve(window.PrivySDK);
    if (!this.pending) {
      const self = this;
      this.pending = new Promise(function (ok, fail) {
        const el = document.createElement('script');
        el.src = 'vendor/privy.js';
        el.onload = function () {
          if (window.PrivySDK) ok(window.PrivySDK);
          else fail(new Error('Sign-in could not load. Reload and try again.'));
        };
        el.onerror = function () {
          self.pending = null;   // let a later press try again
          fail(new Error('Sign-in could not load. Reload and try again.'));
        };
        document.head.appendChild(el);
      });
    }
    return this.pending;
  },

  async start() {
    if (this.client) return this.client;
    const SDK = await this.load();
    const c = new SDK.Privy({ appId: PRIVY_APP_ID, storage: new SDK.LocalStorage() });
    await c.initialize();

    // The key is generated and used inside this frame, on Privy's origin.
    // Messages are read from that one frame and nowhere else — anything
    // else posting to this window is ignored, which is the whole point of
    // putting it in a frame at all.
    const frame = document.createElement('iframe');
    frame.src = c.embeddedWallet.getURL();
    frame.title = 'Privy wallet';
    frame.style.display = 'none';
    document.body.appendChild(frame);
    c.setMessagePoster(frame.contentWindow);
    window.addEventListener('message', function (e) {
      if (e.source !== frame.contentWindow) return;
      let data = e.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (err) { return; } }
      c.embeddedWallet.onMessage(data);
    });

    this.sdk = SDK;
    this.client = c;
    return c;
  },

  /// What the dashboard has switched on. Asked rather than assumed, so a
  /// method that is off is never offered as a button that cannot work.
  async methods() {
    try {
      const c = await this.start();
      const a = await c.app.getConfig();
      return { email: a.email_auth !== false, phone: a.sms_auth !== false,
               google: a.google_oauth !== false, apple: a.apple_oauth !== false };
    } catch (e) {
      return { email: true, phone: false, google: false, apple: false };
    }
  },

  async sendCode(way, to) {
    const c = await this.start();
    if (way === 'email') await c.auth.email.sendCode(to);
    else await c.auth.phone.sendCode(to);
    this.way = way;
    this.sentTo = to;
  },

  async verify(code) {
    const c = await this.start();
    if (this.way === 'email') await c.auth.email.loginWithCode(this.sentTo, code);
    else await c.auth.phone.loginWithCode(this.sentTo, code);
    return this.adopt();
  },

  /// Everything after a successful sign-in, however they signed in, so a
  /// creator arriving by Google cannot end up on a different wallet from
  /// one arriving by email.
  async adopt() {
    const SDK = await this.load();
    const c = await this.start();
    const got = await c.user.get();
    let account = SDK.getUserEmbeddedSolanaWallet(got && got.user);
    if (!account) {
      const made = await c.embeddedWallet.createSolana();
      account = SDK.getUserEmbeddedSolanaWallet(made && made.user);
    }
    if (!account || !account.address) throw new Error('The wallet did not come back. Try again.');

    // The provider is what actually signs. It needs the entropy details
    // that tie this user to this wallet; without them it cannot open the
    // key in the frame.
    const user = (await c.user.get()).user;
    const ent = SDK.getEntropyDetailsFromUser(user);
    this.provider = await c.embeddedWallet.getSolanaProvider(
      account, ent.entropyId, ent.entropyIdVerifier);
    this.account = account;
    return account.address;
  }
};

const Wallet = {
  list: [],
  active: null,
  pubkey: null,

  discover() {
    const found = [];
    // Wallet Standard: wallets register themselves on app-ready
    const register = function() {
      for (let i = 0; i < arguments.length; i++) {
        const w = arguments[i];
        if (w && w.features && w.features['standard:connect'] &&
            (w.chains || []).some(function(c) { return String(c).indexOf('solana') === 0; })) {
          found.push({ kind: 'standard', name: w.name, icon: w.icon, w: w });
        }
      }
    };
    try {
      window.addEventListener('wallet-standard:register-wallet', function(e) {
        try { e.detail({ register: register }); } catch (err) {}
      });
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: register } }));
    } catch (e) {}

    // Legacy injected providers (any wallet that injects a Solana provider)
    const seen = {};
    found.forEach(function(f) { seen[f.name] = true; });
    const injected = [
      { name: 'Solflare', p: window.solflare },
      { name: 'Backpack', p: window.backpack },
      { name: 'Glow', p: window.glow },
      { name: 'Jupiter', p: window.jupiter }
    ];
    injected.forEach(function(entry) {
      if (entry.p && typeof entry.p.connect === 'function' && !seen[entry.name]) {
        seen[entry.name] = true;
        found.push({ kind: 'injected', name: entry.name, icon: entry.p.icon || null, w: entry.p });
      }
    });

    // window.solana last, and almost never a wallet of its own. Most
    // wallets set it as well as registering under their own name, so it
    // was being listed a second time as "Solana Wallet" with a purse for
    // a logo — the same wallet, twice, once anonymously.
    //
    // Matched on the object rather than the name: the duplicate carried a
    // different name, which is exactly why a name-based check let it
    // through.
    const generic = window.solana;
    if (generic && typeof generic.connect === 'function' &&
        !found.some(function(f) { return f.w === generic; })) {
      const named = generic.name ||
        (generic.isJupiter && 'Jupiter') || (generic.isBackpack && 'Backpack') ||
        (generic.isGlow && 'Glow') || (generic.isSolflare && 'Solflare') || null;
      // No name and no icon leaves nothing to show but a blank row beside
      // real wallets, which is worse than one fewer option.
      if (named || generic.icon) {
        found.push({ kind: 'injected', name: named || 'Browser wallet',
          icon: generic.icon || null, w: generic });
      }
    }

    this.list = found;
    return found;
  },

  async connect(choice) {
    const target = choice || this.list[0];
    if (!target) throw new Error('no-wallet');
    let key = null;
    if (target.kind === 'privy') {
      // Already signed in by the time the sheet hands this over — the
      // address came back with the wallet, so there is nothing to approve.
      key = target.address;
      if (!key) throw new Error('no-account');
    } else if (target.kind === 'standard') {
      const res = await target.w.features['standard:connect'].connect();
      const acct = (res && res.accounts && res.accounts[0]) || target.w.accounts[0];
      if (!acct) throw new Error('no-account');
      key = acct.address;
    } else {
      const res = await target.w.connect();
      key = (res && res.publicKey ? res.publicKey : target.w.publicKey);
      if (!key) throw new Error('no-account');
      key = key.toString();
    }
    this.active = target;
    this.pubkey = key;
    rememberWallet(target, key);
    watchWalletAccount(target);
    this.render();
    return key;
  },

  /// `forget` is the difference between somebody pressing Disconnect and a
  /// wallet going quiet on its own. Pressing it means forget this wallet.
  /// A wallet locking, switching account or reloading its extension means
  /// nothing of the sort — and wiping the remembered wallet there is why a
  /// hard refresh could not reconnect: there was nothing left to reconnect
  /// to.
  disconnect(forget = true) {
    try {
      if (this.active && this.active.kind === 'injected' && this.active.w.disconnect) this.active.w.disconnect();
      if (this.active && this.active.kind === 'standard' && this.active.w.features['standard:disconnect'])
        this.active.w.features['standard:disconnect'].disconnect();
    } catch (e) {}
    this.active = null;
    this.pubkey = null;
    rangerCount = null;
    FoxPoints.clearToken();
    if (forget) { try { localStorage.removeItem('wallet_last'); } catch (e) {} }
    this.render();
    renderStaking();
    renderLeaderboard();
  },

  short(k) {
    k = k || this.pubkey || '';
    return k ? k.slice(0, 4) + '…' + k.slice(-4) : '';
  },

  render() {
    const chip = document.getElementById('wallet-chip');
    const label = document.getElementById('wallet-chip-label');
    if (!chip || !label) return;
    if (this.pubkey) {
      label.textContent = this.short();
      chip.classList.add('connected');
      chip.title = this.pubkey + ' — click to disconnect';
    } else {
      label.textContent = 'Connect';
      chip.classList.remove('connected');
      chip.title = 'Connect a Solana wallet';
    }
    // The Swap tab may have been opened before a wallet existed, so its
    // balance line has to be refreshed whenever the connection changes.
    if (typeof refreshSwapBalance === 'function') refreshSwapBalance();
    // Same for Savings: connecting is exactly when somebody wants to be shown
    // what they already have, and disconnecting is when it must stop being
    // shown — a position left on screen after a disconnect is somebody
    // else's number.
    if (typeof loadDefiBalances === 'function') loadDefiBalances();
  }
};

/// Which wallet app and address were connected, so a reload reconnects that
/// one. Older visits stored just the address as a plain string.
function rememberWallet(target, address) {
  try {
    localStorage.setItem('wallet_last', JSON.stringify({
      name: target.name, address: address, kind: target.kind }));
  } catch (e) {}
}
function rememberedWallet() {
  try {
    const raw = localStorage.getItem('wallet_last');
    if (!raw) return null;
    if (raw.charAt(0) !== '{') return { name: null, address: raw };
    const v = JSON.parse(raw);
    return v && v.address ? v : null;
  } catch (e) { return null; }
}

/// The account a Wallet Standard wallet should act for: the one this site is
/// connected as. A wallet holding several accounts lists them all, and asking
/// accounts[0] to sign could put the wrong account in front of the person.
function walletAccount(provider, address) {
  const want = address || Wallet.pubkey;
  const accounts = (provider && provider.w && provider.w.accounts) || [];
  const match = accounts.find(function (a) { return a.address === want; });
  if (!match) throw new Error('Your wallet is on a different account from the one connected here. Reconnect to continue.');
  return match;
}

/// Follows the connected wallet when its account changes. If the account this
/// site is connected as is still offered, nothing happens — a wallet listing
/// or reordering its accounts is not a reason to switch.
function watchWalletAccount(target) {
  if (!target || target._watched) return;
  target._watched = true;
  try {
    const events = target.kind === 'standard' && target.w.features['standard:events'];
    if (events) {
      events.on('change', function (props) {
        if (props && props.accounts) walletAccountsChanged(target, props.accounts.map(function (a) { return a.address; }));
      });
    } else if (target.kind === 'injected' && typeof target.w.on === 'function') {
      target.w.on('accountChanged', function (pk) { walletAccountsChanged(target, pk ? [pk.toString()] : []); });
    }
  } catch (e) { /* a wallet without events simply is not followed */ }
}

function walletAccountsChanged(target, addresses) {
  if (Wallet.active !== target || !Wallet.pubkey) return;
  if (addresses.indexOf(Wallet.pubkey) >= 0) return;
  // the Fox Points sign-in was proven for the previous account, not this one
  FoxPoints.clearToken();
  // No accounts means locked, or no longer authorised — not "forget this
  // wallet". The session goes, the memory of which wallet it was stays, so
  // a reload picks it straight back up.
  if (!addresses.length) { Wallet.disconnect(false); return; }
  Wallet.pubkey = addresses[0];
  rememberWallet(target, addresses[0]);
  Wallet.render();
  renderStaking();
  renderLeaderboard();
  refreshRangers();
}

function closeWalletModal() {
  const el = document.getElementById('wm-backdrop');
  if (el) el.remove();
  document.removeEventListener('keydown', wmEscHandler);
}

function wmEscHandler(e) { if (e.key === 'Escape') closeWalletModal(); }

function connectWallet() {
  closeWalletModal();
  const wallets = Wallet.discover();

  const backdrop = document.createElement('div');
  backdrop.className = 'wm-backdrop';
  backdrop.id = 'wm-backdrop';
  backdrop.addEventListener('click', function(e) { if (e.target === backdrop) closeWalletModal(); });

  const sheet = document.createElement('div');
  sheet.className = 'wm-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Connect a wallet');

  const head = document.createElement('div');
  head.className = 'wm-head';
  const title = document.createElement('div');
  title.className = 'wm-title';
  title.textContent = 'Connect a wallet';
  const close = document.createElement('button');
  close.className = 'wm-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  close.onclick = closeWalletModal;
  head.appendChild(title);
  head.appendChild(close);
  sheet.appendChild(head);

  const sub = document.createElement('div');
  sub.className = 'wm-sub';
  sub.textContent = wallets.length
    ? 'Pick one to stake your Moon Ranger and track Fox Points.'
    : 'No Solana wallet found in this browser.';
  sheet.appendChild(sub);

  if (!wallets.length) {
    const empty = document.createElement('div');
    empty.className = 'wm-empty';
    empty.textContent = 'Install a Solana wallet extension, or open solquicks.com inside your wallet app\'s built-in browser, then tap Connect again.';
    sheet.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'wm-list';
    wallets.forEach(function(w) {
      const btn = document.createElement('button');
      btn.className = 'wm-option';
      btn.type = 'button';

      const icon = document.createElement('div');
      icon.className = 'wm-icon';
      if (w.icon && /^data:image\//.test(w.icon)) {
        const img = document.createElement('img');
        img.src = w.icon;
        img.alt = '';
        icon.appendChild(img);
      } else {
        icon.textContent = '👛';
      }

      const name = document.createElement('div');
      name.className = 'wm-name';
      name.textContent = w.name;

      const go = document.createElement('div');
      go.className = 'wm-go';
      go.textContent = '→';

      btn.appendChild(icon);
      btn.appendChild(name);
      btn.appendChild(go);

      btn.onclick = async function() {
        const others = sheet.querySelectorAll('.wm-option');
        others.forEach(function(o) { o.disabled = true; });
        name.textContent = 'Connecting…';
        const priorErr = sheet.querySelector('.wm-err');
        if (priorErr) priorErr.remove();
        try {
          await Wallet.connect(w);
          name.textContent = 'Sign in…';
          try {
            await FoxPoints.signIn(w, Wallet.pubkey);
          } catch (e) {
            console.warn('sign-in skipped:', e && e.message);
          }
          closeWalletModal();
          renderStaking();
          renderLeaderboard();
          refreshRangers();
        } catch (err) {
          others.forEach(function(o) { o.disabled = false; });
          name.textContent = w.name;
          const msg = document.createElement('div');
          msg.className = 'wm-err';
          msg.textContent = (err && /reject|denied|cancel/i.test(err.message || ''))
            ? 'Connection cancelled in your wallet.'
            : 'Could not connect. Try again.';
          sheet.appendChild(msg);
        }
      };
      list.appendChild(btn);
    });
    sheet.appendChild(list);
  }

  // The way in for anybody without an extension. Offered under the wallets
  // rather than above them, because someone who has a wallet should not be
  // nudged away from it — their own keys beat ours every time.
  const or = document.createElement('div');
  or.className = 'wm-or';
  or.innerHTML = '<span>or</span>';
  sheet.appendChild(or);

  const signinBtn = document.createElement('button');
  signinBtn.className = 'wm-option wm-signin';
  signinBtn.type = 'button';
  signinBtn.id = 'wm-signin';
  const sIcon = document.createElement('div');
  sIcon.className = 'wm-icon';
  sIcon.textContent = '✉';
  const sName = document.createElement('div');
  sName.className = 'wm-name';
  sName.textContent = 'No wallet? Sign in instead';
  const sGo = document.createElement('div');
  sGo.className = 'wm-go';
  sGo.textContent = '→';
  signinBtn.append(sIcon, sName, sGo);
  signinBtn.onclick = function () { showSigninSheet(sheet); };
  sheet.appendChild(signinBtn);

  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', wmEscHandler);
  const first = sheet.querySelector('.wm-option') || close;
  if (first) first.focus();
}

/// Swaps the connect sheet for the sign-in form. Replaces the sheet's body
/// rather than opening a second dialog, so there is only ever one thing on
/// screen and Escape still closes the lot.
async function showSigninSheet(sheet) {
  const body = [...sheet.children].filter(function (el) { return !el.classList.contains('wm-head'); });
  body.forEach(function (el) { el.remove(); });

  const sub = document.createElement('div');
  sub.className = 'wm-sub';
  sub.textContent = 'We make you a Solana wallet. The keys are yours — we never see them.';
  sheet.appendChild(sub);

  const box = document.createElement('div');
  box.className = 'wm-signin-box';
  sheet.appendChild(box);

  const err = document.createElement('div');
  err.className = 'wm-err';
  err.hidden = true;
  sheet.appendChild(err);
  const fail = function (e) {
    err.hidden = false;
    err.textContent = signinTrouble(e);
  };
  const busy = function (text) { err.hidden = false; err.textContent = text; };

  box.textContent = 'Loading…';
  const on = await Privy.methods();
  box.textContent = '';

  // Only what the dashboard has switched on, so nobody is handed a button
  // that cannot work.
  const providers = [['google', 'Continue with Google'], ['apple', 'Continue with Apple']];
  for (const [id, label] of providers) {
    if (!on[id]) continue;
    const b = document.createElement('button');
    b.className = 'wm-option';
    b.type = 'button';
    b.id = 'wm-oauth-' + id;
    b.innerHTML = '<div class="wm-icon">◎</div>';
    const n = document.createElement('div');
    n.className = 'wm-name';
    n.textContent = label;
    b.appendChild(n);
    b.onclick = async function () {
      busy('Taking you to ' + label.replace('Continue with ', '') + '…');
      try {
        const c = await Privy.start();
        const back = window.location.origin + window.location.pathname;
        const out = await c.auth.oauth.generateURL(id, back);
        const url = (out && out.url) || out;
        if (!url) throw new Error('Sign-in did not come back with anywhere to go.');
        try { localStorage.setItem('wm_oauth', id); } catch (e) {}
        window.location.assign(url);
      } catch (e) { fail(e); }
    };
    box.appendChild(b);
  }

  if (!on.email && !on.phone) {
    if (!box.children.length) fail(new Error('Making a wallet here is switched off right now.'));
    return;
  }

  const form = document.createElement('div');
  form.className = 'wm-form';
  const ways = document.createElement('div');
  ways.className = 'wm-ways';
  // One way left is not a choice, so it is not presented as one.
  ways.hidden = !(on.email && on.phone);
  const field = document.createElement('input');
  field.className = 'wm-input';
  field.id = 'wm-id';
  const send = document.createElement('button');
  send.className = 'wm-go-btn';
  send.type = 'button';
  send.id = 'wm-send';
  send.textContent = 'Send me a code';

  let way = on.email ? 'email' : 'phone';
  const setWay = function (w) {
    way = w;
    [...ways.children].forEach(function (b) { b.className = 'wm-way' + (b.dataset.way === w ? ' on' : ''); });
    field.type = w === 'email' ? 'email' : 'tel';
    field.placeholder = w === 'email' ? 'you@example.com' : '+1 555 000 1234';
    // "US and Canada only" is a limit of the SMS provider that Privy's
    // config does not expose, so it is said here or not at all.
    field.setAttribute('aria-label', w === 'email' ? 'Your email' : 'Your phone number (US and Canada)');
  };
  for (const [w, label] of [['email', 'Email'], ['phone', 'Phone (US/CA)']]) {
    if (!on[w]) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.way = w; b.textContent = label;
    b.onclick = function () { setWay(w); };
    ways.appendChild(b);
  }
  setWay(way);

  send.onclick = async function () {
    const to = field.value.trim();
    if (!to) { fail(new Error(way === 'email' ? 'Put your email in first.' : 'Put your number in first.')); return; }
    send.disabled = true;
    busy('Sending you a code…');
    try {
      await Privy.sendCode(way, to);
      err.hidden = true;
      codeStep(to);
    } catch (e) { fail(e); send.disabled = false; }
  };

  form.append(ways, field, send);
  box.appendChild(form);

  function codeStep(to) {
    form.remove();
    const c = document.createElement('div');
    c.className = 'wm-form';
    const lbl = document.createElement('div');
    lbl.className = 'wm-sub';
    lbl.textContent = 'Enter the code we sent to ' + to;
    const input = document.createElement('input');
    input.className = 'wm-input wm-code';
    input.id = 'wm-code';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'one-time-code';
    input.maxLength = 8;
    input.placeholder = '000000';
    const go = document.createElement('button');
    go.className = 'wm-go-btn';
    go.type = 'button';
    go.id = 'wm-verify';
    go.textContent = 'Make my wallet';
    go.onclick = async function () {
      const code = input.value.trim();
      if (!code) { fail(new Error('Put the code in first.')); return; }
      go.disabled = true;
      busy('Checking the code, then making your wallet…');
      try {
        const address = await Privy.verify(code);
        await finishPrivyConnect(address, to);
      } catch (e) { fail(e); go.disabled = false; }
    };
    c.append(lbl, input, go);
    box.appendChild(c);
    input.focus();
  }
}

/// The last step, shared by the code route and the OAuth return: adopt the
/// wallet, prove it to Fox Points, and close the sheet. One place, so the
/// two routes cannot end up in different states.
async function finishPrivyConnect(address, label) {
  const target = { kind: 'privy', name: 'Email sign-in', address: address };
  await Wallet.connect(target);
  try {
    await FoxPoints.signIn(target, address);
  } catch (e) {
    console.warn('sign-in skipped:', e && e.message);
  }
  closeWalletModal();
  renderStaking();
  renderLeaderboard();
  refreshRangers();
}

/// Coming back from Google or Apple. Runs once on load, and only when this
/// page is actually a redirect landing — the one-use code is taken out of
/// the URL before anything is done with it, so a reload cannot spend it
/// twice and a copied link carries nobody's sign-in.
async function finishWalletOauth() {
  const q = new URLSearchParams(window.location.search);
  const code = q.get('privy_oauth_code');
  const state = q.get('privy_oauth_state');
  let provider = null;
  try { provider = localStorage.getItem('wm_oauth'); } catch (e) {}
  if (!code && !state && !provider) return false;

  try { window.history.replaceState({}, '', window.location.origin + window.location.pathname); } catch (e) {}
  try { localStorage.removeItem('wm_oauth'); } catch (e) {}
  if (!code || !state) return false;

  try {
    const c = await Privy.start();
    await c.auth.oauth.loginWithCode(code, state, provider || undefined);
    const address = await Privy.adopt();
    await finishPrivyConnect(address, provider);
  } catch (e) {
    console.warn('oauth sign-in failed:', e && e.message);
  }
  return true;
}

/// Privy's messages are written for developers. These are the ones somebody
/// can act on; anything else is passed through rather than hidden, because
/// a vague failure on the step that connects their wallet is worse than an
/// awkward sentence.
function signinTrouble(e) {
  const raw = ((e && (e.message || e.error)) || '') + '';
  const low = raw.toLowerCase();
  const off = raw.match(/Login with ([A-Za-z]+) not allowed/i);
  if (off) return off[1] + ' sign-in is not switched on yet. Use a code instead.';
  if (low.indexOf('invalid') >= 0 && low.indexOf('code') >= 0) return 'That code is not right. Check it and try again.';
  if (low.indexOf('expired') >= 0) return 'That code has expired. Send yourself another.';
  if (low.indexOf('too many') >= 0 || low.indexOf('rate') >= 0) return 'Too many tries. Wait a minute and try again.';
  if (low.indexOf('recovery') >= 0) return 'This sign-in needs a recovery step we have not built yet. Use a wallet app for now.';
  if (low.indexOf('failed to fetch') >= 0 || low.indexOf('network') >= 0) return 'Could not reach sign-in. Check your connection.';
  return raw || 'That did not work. Try again.';
}

// ── Savings: USDC in, yield out ─────────────────────────────────────────
// Every amount here is in USDC's smallest unit — whole millionths — because
// that is what the protocol counts in and what a transaction carries.
// Floats only exist in the box somebody types into.
// USDC_DECIMALS is defined once, in the USDC section further down. Two
// copies of the same number is how one of them eventually goes stale.
const defi = { side: 'in', apy: null, quote: null, timer: null, busy: false,
  usdc: null, held: null, sol: null, tick: null };

/// Text to millionths. Refuses anything that is not a plain number, and
/// anything with more decimal places than USDC has — "1.0000001" would
/// otherwise round into an amount nobody typed.
function usdcUnits(text) {
  const t = String(text || '').trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [whole, frac = ''] = t.split('.');
  if (frac.length > USDC_DECIMALS) return null;
  const units = Number(whole || '0') * Math.pow(10, USDC_DECIMALS) +
    Number((frac + '000000').slice(0, USDC_DECIMALS) || '0');
  if (!Number.isSafeInteger(units) || units <= 0) return null;
  return units;
}

// Two places, because this is money being read by a person. The exact
// figure is what gets signed; six decimals on screen is noise that makes
// 24.974234 harder to read than 24.97.
const usdcText = (units) => (units / Math.pow(10, USDC_DECIMALS))
  .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// USDC+ is the token Reflect gives back. Its mint was read out of a deposit
// transaction they built and confirmed on chain: an SPL mint, 6 decimals,
// same as USDC. Held here rather than fetched because a mint address does
// not change, and a wrong one would show somebody the wrong balance.
const USDC_PLUS_MINT = 'USDCSzr4fZ2se8RRRiFN8VBcvt8dLzHxuBfw7RZEkyS';
// What a deposit and the signature cost in SOL, with room to spare. Below
// this a transaction will not land, and finding that out after signing is
// the worst place to find it out.
const DEFI_SOL_RESERVE = 0.003;

/// Everything the tab needs to know about this wallet: the USDC they can
/// deposit, the USDC+ they already hold, and whether there is enough SOL to
/// pay for the transaction at all.
async function loadDefiBalances() {
  const bal = document.getElementById('df-bal');
  const pos = document.getElementById('df-position');
  if (!bal) return;
  if (!Wallet.pubkey) {
    defi.usdc = null; defi.held = null; defi.sol = null;
    bal.textContent = '';
    pos.hidden = true;
    paintDefiButton();
    return;
  }
  try {
    const [usdc, held, sol] = await Promise.all([
      tokenBalance(Wallet.pubkey, USDC_MINT),
      tokenBalance(Wallet.pubkey, USDC_PLUS_MINT),
      tokenBalance(Wallet.pubkey, SOL_MINT)
    ]);
    defi.usdc = usdc; defi.held = held; defi.sol = sol;
  } catch (e) {
    // A balance that could not be read is not a balance of zero. Showing
    // zero would tell somebody they have nothing when they may have plenty.
    defi.usdc = null; defi.held = null; defi.sol = null;
  }
  paintDefiBalance();
  paintDefiPosition();
  paintDefiButton();
  loadDefiHistory();
}

function paintDefiBalance() {
  const bal = document.getElementById('df-bal');
  const chips = document.getElementById('df-chips');
  const have = defi.side === 'in' ? defi.usdc : defi.held;
  const unit = defi.side === 'in' ? 'USDC' : 'USDC+';
  document.getElementById('df-unit').textContent = unit;
  chips.textContent = '';
  if (have === null || have === undefined) { bal.textContent = ''; return; }
  bal.textContent = 'You have ' + have.toLocaleString(undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + unit;
  if (!(have > 0)) return;

  const put = function (value) {
    // Written out in full rather than rounded for display: rounding here
    // would ask for more than they hold, or quietly leave some behind.
    document.getElementById('df-amount').value = String(value);
    defiAmountChanged();
  };
  // Only amounts they can actually cover. A chip that cannot be pressed is
  // worse than one that is not there.
  for (const round of [25, 100, 500]) {
    if (round > have) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = round.toLocaleString();
    b.onclick = function () { put(round); };
    chips.appendChild(b);
  }
  const max = document.createElement('button');
  max.type = 'button';
  max.id = 'df-max';
  max.textContent = 'Max';
  max.onclick = function () { put(have); };
  chips.appendChild(max);
}

/// What they are holding, and what it is worth today. Worth is asked of
/// Reflect rather than assumed equal, because the whole point of the token
/// is that it grows apart from what was put in.
async function paintDefiPosition() {
  const pos = document.getElementById('df-position');
  if (!pos) return;
  if (!defi.held || defi.held <= 0) { pos.hidden = true; return; }
  pos.hidden = false;
  document.getElementById('df-pos-held').textContent =
    defi.held.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDC+';

  const units = Math.round(defi.held * Math.pow(10, USDC_DECIMALS));
  const worthEl = document.getElementById('df-pos-worth');
  const gainEl = document.getElementById('df-pos-gain');
  worthEl.textContent = '…';
  gainEl.hidden = true;
  try {
    const r = await fetch(POINTS_API + '/api/reflect/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side: 'redeem', amount: units })
    });
    const b = await r.json();
    if (!r.ok || typeof b.outAmount !== 'number') throw new Error('no quote');
    worthEl.textContent = usdcText(b.outAmount) + ' USDC';

    // Earnings are what it is worth now less what was actually put in.
    //
    // This used to subtract the token count from its own value, which is
    // not earnings at all — it is the exchange rate. A deposit of 1 USDC
    // buys 0.9916 USDC+ that redeems for 1 USDC, so that sum reported
    // "+0.0084 earned" on the day somebody deposited, before anything had
    // happened. Flattering, and wrong, on the one number that matters.
    //
    // What went in is only knowable from what this site recorded, so when
    // there is no record there is no claim.
    const net = await netDeposited();
    if (net === null || net <= 0) { gainEl.hidden = true; return; }
    const gain = b.outAmount - Math.round(net * Math.pow(10, USDC_DECIMALS));
    gainEl.hidden = false;
    gainEl.className = 'df-pos-gain' + (gain < 0 ? ' down' : '');
    gainEl.textContent = gain === 0
      ? 'Level with what you put in'
      : (gain > 0 ? '+' + usdcText(gain) + ' earned' : usdcText(-gain) + ' below what you put in');
  } catch (e) {
    // Better to show nothing than a number that is not the number.
    worthEl.textContent = '—';
  }
}

/// What this wallet has actually put in, from what the site recorded —
/// deposits less withdrawals. Null when there is nothing recorded, which is
/// not the same as zero: a deposit made before this was written down, or
/// from somewhere else, is invisible here and must not be reported as a
/// profit or a loss.
async function netDeposited() {
  if (!Wallet.pubkey) return null;
  try {
    const r = await fetch(POINTS_API + '/api/reflect/history?wallet=' + encodeURIComponent(Wallet.pubkey));
    const b = await r.json();
    const rows = (b && b.rows) || [];
    if (!rows.length) return null;
    let net = 0;
    for (const row of rows) net += (row.side === 'out' ? -1 : 1) * Number(row.amount || 0);
    return net;
  } catch (e) {
    return null;
  }
}

/// The button says what is actually in the way, rather than going dark and
/// leaving somebody to work it out.
function paintDefiButton() {
  const go = document.getElementById('df-go');
  if (!go) return;
  const units = usdcUnits(document.getElementById('df-amount').value);
  if (units === null) { go.disabled = true; go.textContent = 'Enter an amount'; return; }
  if (!Wallet.pubkey) { go.disabled = false; go.textContent = 'Connect a wallet'; return; }

  const have = defi.side === 'in' ? defi.usdc : defi.held;
  if (have !== null && have !== undefined && units > Math.round(have * Math.pow(10, USDC_DECIMALS))) {
    go.disabled = true;
    go.textContent = defi.side === 'in' ? 'More than you have' : 'More than you deposited';
    return;
  }
  // A transaction that cannot pay its own fee fails after it has been
  // signed, which is the one place a refusal is no use to anybody.
  if (defi.sol !== null && defi.sol !== undefined && defi.sol < DEFI_SOL_RESERVE) {
    go.disabled = true;
    go.textContent = 'Not enough SOL for the fee';
    return;
  }
  if (!defi.quote || defi.quote.in !== units) { go.disabled = true; go.textContent = 'Checking…'; return; }
  go.disabled = false;
  go.textContent = defi.side === 'in' ? 'Deposit' : 'Withdraw';
}

const sinceText = function (ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days >= 2) return days + ' days';
  const hours = Math.max(1, Math.round((Date.now() - ts) / 3600000));
  return hours + (hours === 1 ? ' hour' : ' hours');
};

async function loadDefiRate() {
  const el = document.getElementById('df-apy');
  const note = document.getElementById('df-apy-note');
  if (!el) return;
  try {
    const r = await fetch(POINTS_API + '/api/reflect/apy');
    const b = await r.json();
    if (!r.ok || typeof b.apy !== 'number') {
      const err = new Error(b.error || 'no rate');
      err.notPublished = b.published === false;
      throw err;
    }
    defi.apy = b.apy;
    el.hidden = false;
    document.getElementById('df-apy-label').hidden = false;
    el.textContent = b.apy.toFixed(2) + '%';
    // Where the number came from, because they are not the same claim. One
    // is Reflect publishing a rate; the other is this site having watched
    // what the token actually redeemed for and worked it out.
    note.textContent = b.measured
      ? 'Measured here from what the token has actually paid, over the last ' + sinceText(b.since)
      : (b.at ? 'Variable rate, published ' + new Date(b.at).toLocaleDateString() : 'Variable rate');
  } catch (e) {
    // No number at all rather than a dash. A dash in the size this is set
    // in reads as a stray mark, and "Earning now" over nothing reads worse
    // than the sentence underneath on its own.
    el.textContent = '';
    el.hidden = true;
    document.getElementById('df-apy-label').hidden = true;
    // Two different things, and a person deciding whether to deposit is
    // owed the difference: nobody has published a rate yet, or we could
    // not go and look. Depositing works either way.
    note.textContent = e && e.notPublished
      ? 'No rate published yet. Depositing and withdrawing still work.'
      : 'Could not reach the rate just now. Depositing still works.';
  }
}

function setDefiSide(side) {
  defi.side = side;
  document.getElementById('df-side-in').className = 'df-side' + (side === 'in' ? ' on' : '');
  document.getElementById('df-side-out').className = 'df-side' + (side === 'out' ? ' on' : '');
  document.getElementById('df-amount-label').textContent = side === 'in' ? 'You deposit' : 'You withdraw';
  paintDefiBalance();
  defiAmountChanged();
}

function defiAmountChanged() {
  const units = usdcUnits(document.getElementById('df-amount').value);
  defi.quote = null;
  document.getElementById('df-quote').textContent = '';
  // Last time's receipt belongs to last time. Leaving it up while somebody
  // types the next amount reads as though this one has already gone
  // through.
  const receipt = document.getElementById('df-receipt');
  if (receipt) receipt.hidden = true;
  clearTimeout(defi.timer);
  paintDefiButton();
  if (units === null) return;
  // Nothing to quote if they cannot afford it anyway — and the button is
  // already saying so.
  const have = defi.side === 'in' ? defi.usdc : defi.held;
  if (have !== null && have !== undefined && units > Math.round(have * Math.pow(10, USDC_DECIMALS))) return;
  defi.timer = setTimeout(function () { quoteDefi(units); }, 350);
}

async function quoteDefi(units) {
  const asked = units;
  try {
    const r = await fetch(POINTS_API + '/api/reflect/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side: defi.side === 'in' ? 'mint' : 'redeem', amount: units })
    });
    const b = await r.json();
    // They kept typing while this was in the air; this answer is for an
    // amount they are no longer asking about.
    if (asked !== usdcUnits(document.getElementById('df-amount').value)) return;
    if (!r.ok || typeof b.outAmount !== 'number') throw new Error(b.error || 'no quote');
    defi.quote = { in: units, out: b.outAmount };
    document.getElementById('df-quote').textContent =
      (defi.side === 'in' ? 'You receive about ' : 'You get back about ') + usdcText(b.outAmount);
    paintDefiButton();
  } catch (e) {
    if (asked !== usdcUnits(document.getElementById('df-amount').value)) return;
    document.getElementById('df-quote').textContent = '';
    defi.quote = null;
    paintDefiButton();
    note('df-msg', (e && e.message) || 'Could not get a quote.', 'bad');
  }
}

async function doDefi() {
  if (defi.busy) return;
  const units = usdcUnits(document.getElementById('df-amount').value);
  if (units === null) return;
  if (!Wallet.pubkey) { connectWallet(); return; }

  const go = document.getElementById('df-go');
  defi.busy = true;
  go.disabled = true;
  note('df-msg', 'Building your transaction…', '');
  try {
    // The quote is what they were shown, so it is the floor they get. A
    // deposit sent with no floor accepts whatever comes back.
    const floor = defi.quote && defi.quote.in === units
      ? Math.floor(defi.quote.out * 0.99)   // 1% of room, so a moving rate does not simply fail
      : null;
    const body = { wallet: Wallet.pubkey, amount: units };
    if (floor !== null) body.minReceived = floor;

    const r = await fetch(POINTS_API + (defi.side === 'in' ? '/api/reflect/deposit' : '/api/reflect/withdraw'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const b = await r.json();
    if (!r.ok || !b.transaction) throw new Error(b.error || 'could not build that');

    note('df-msg', 'Approve it in your wallet…', '');
    const signature = await sendBuiltTransaction(b.transaction);
    note('df-msg', '', '');
    // Cleared first. defiAmountChanged takes last time's receipt down, so
    // showing this one before clearing the box hid it again immediately.
    document.getElementById('df-amount').value = '';
    defiAmountChanged();
    showDefiReceipt(defi.side, units, signature);
    // Written down so they can look back at it. Never awaited and never
    // allowed to fail the deposit — the money has already moved, and a
    // failed note about it is not a failed deposit.
    recordSaving(defi.side, units, signature).catch(function () { /* the chain is the record */ });
    loadDefiRate();
    // The balances have just changed, and the position with them.
    loadDefiBalances();
    return signature;
  } catch (e) {
    note('df-msg', defiTrouble(e), 'bad');
  } finally {
    defi.busy = false;
    go.disabled = false;
  }
}

/// Signs and sends a transaction somebody else built, with whatever wallet
/// is connected — extension or signed-in. The swap has its own version of
/// this because it appends instructions of its own first; this one sends
/// what it was given, unchanged.
async function sendBuiltTransaction(base64) {
  const provider = Wallet.active;
  if (!provider) throw new Error('Connect a wallet first.');
  const { VersionedTransaction } = w3();
  const bytes = Uint8Array.from(atob(base64), function (c) { return c.charCodeAt(0); });
  const tx = VersionedTransaction.deserialize(bytes);
  const connection = rpc();

  if (provider.kind === 'privy') {
    const out = await Privy.provider.request({
      method: 'signAndSendTransaction', params: { transaction: tx, connection: connection } });
    return signatureOf(out.signature);
  }
  if (provider.kind === 'injected' && provider.w.signAndSendTransaction) {
    const res = await provider.w.signAndSendTransaction(tx);
    return signatureOf(res.signature || res);
  }
  if (provider.kind === 'injected' && provider.w.signTransaction) {
    const signed = await provider.w.signTransaction(tx);
    return await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  }
  if (provider.kind === 'standard') {
    const feat = provider.w.features['solana:signAndSendTransaction'];
    if (!feat) throw new Error('This wallet cannot send transactions.');
    const out = await feat.signAndSendTransaction({
      account: walletAccount(provider), chain: 'solana:mainnet', transaction: tx.serialize() });
    return signatureOf(out[0].signature);
  }
  throw new Error('This wallet cannot send transactions.');
}

function showDefiReceipt(side, units, signature) {
  const box = document.getElementById('df-receipt');
  if (!box) return;
  document.getElementById('df-receipt-head').textContent =
    (side === 'in' ? 'Deposited ' : 'Withdrew ') + usdcText(units) + ' USDC';
  const link = document.getElementById('df-receipt-link');
  link.href = 'https://solscan.io/tx/' + encodeURIComponent(signature);
  box.hidden = false;
}

async function recordSaving(side, units, signature) {
  await fetch(POINTS_API + '/api/reflect/record', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet: Wallet.pubkey, signature: signature, side: side,
      amount: units / Math.pow(10, USDC_DECIMALS)
    })
  });
  loadDefiHistory();
}

async function loadDefiHistory() {
  const box = document.getElementById('df-history');
  const rows = document.getElementById('df-history-rows');
  if (!box) return;
  if (!Wallet.pubkey) { box.hidden = true; rows.textContent = ''; return; }
  try {
    const r = await fetch(POINTS_API + '/api/reflect/history?wallet=' + encodeURIComponent(Wallet.pubkey));
    const b = await r.json();
    const list = (b && b.rows) || [];
    if (!list.length) { box.hidden = true; rows.textContent = ''; return; }
    rows.textContent = '';
    for (const row of list) {
      const el = document.createElement('div');
      el.className = 'df-row';
      const what = document.createElement('span');
      // Built as text, never as markup: these come back from a database
      // and go on the page.
      what.innerHTML = '';
      const b1 = document.createElement('b');
      b1.textContent = (row.side === 'in' ? 'Deposited ' : 'Withdrew ') +
        Number(row.amount).toLocaleString(undefined,
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDC';
      const when = document.createElement('span');
      when.className = 'df-row-when';
      when.textContent = ' · ' + new Date(row.ts).toLocaleDateString();
      what.append(b1, when);
      const link = document.createElement('a');
      link.href = 'https://solscan.io/tx/' + encodeURIComponent(row.signature);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View';
      el.append(what, link);
      rows.appendChild(el);
    }
    box.hidden = false;
  } catch (e) {
    // A history that cannot be read is not a history of nothing.
    box.hidden = true;
  }
}

function defiTrouble(e) {
  const raw = ((e && e.message) || '') + '';
  const low = raw.toLowerCase();
  if (low.indexOf('user rejected') >= 0 || low.indexOf('rejected the request') >= 0) {
    return 'You turned that down — nothing was sent.';
  }
  if (low.indexOf('insufficient') >= 0) return 'Not enough USDC in that wallet.';
  return raw || 'That did not work.';
}

function walletChipClick() {
  if (Wallet.pubkey) {
    if (confirm('Disconnect ' + Wallet.short() + '?')) Wallet.disconnect();
  } else {
    connectWallet();
  }
}

// silent reconnect if the wallet is already authorized
(async function() {
  // Coming back from Google or Apple takes precedence: this load is the
  // tail of a sign-in that is already half done.
  try { if (await finishWalletOauth()) return; } catch (e) { /* falls through to the usual path */ }
  Wallet.discover();
  setTimeout(async function() {
    Wallet.discover();
    const prior = rememberedWallet();
    if (!prior) { Wallet.render(); return; }
    // Reconnect only the wallet that was connected, as the same address. This
    // used to take the first wallet that had ever approved the site, so with
    // two wallets installed a reload could quietly switch to the other one.
    const offers = function (w) {
      try {
        if (w.kind === 'injected') return !!(w.w.isConnected && w.w.publicKey && w.w.publicKey.toString() === prior.address);
        return (w.w.accounts || []).some(function (a) { return a.address === prior.address; });
      } catch (e) { return false; }
    };
    // Somebody who signed in rather than connecting has no extension to
    // find, so none of the above would ever match them and every reload
    // would sign them out. Privy keeps the session; this just picks it up.
    if (prior.kind === 'privy') {
      try {
        const address = await Privy.adopt();
        if (address === prior.address) {
          Wallet.active = { kind: 'privy', name: prior.name || 'Email sign-in', address: address };
          Wallet.pubkey = address;
        } else {
          // Signed in as somebody else since. Not our call to guess which
          // they meant, so they start again rather than being silently
          // pointed at a different wallet.
          try { localStorage.removeItem('wallet_last'); } catch (e) {}
        }
      } catch (e) { /* session gone or expired — they sign in again */ }
      const s1 = FoxPoints.loadToken();
      if (s1 && s1.wallet && s1.wallet !== Wallet.pubkey) FoxPoints.clearToken();
      Wallet.render();
      return;
    }

    const candidates = Wallet.list.filter(offers);
    const pick = candidates.find(function (w) { return w.name === prior.name; }) || candidates[0];
    if (pick) {
      Wallet.active = pick;
      Wallet.pubkey = prior.address;
      watchWalletAccount(pick);
    }
    // a saved Fox Points sign-in belongs to one wallet; never show it under another
    const session = FoxPoints.loadToken();
    if (session && session.wallet && session.wallet !== Wallet.pubkey) FoxPoints.clearToken();
    Wallet.render();
    renderStaking();
    renderLeaderboard();
    if (Wallet.pubkey) refreshRangers();
  }, 400);
})();



// ── ON-CHAIN STAKING (devnet) ──
// Off by default. Add ?devnet=1 to the URL to drive the real program on
// devnet; ordinary visitors never touch this path and keep the off-chain
// staking they have today.
const CHAIN = {
  // Must match declare_id! in program/programs/moon-stake/src/lib.rs. It did
  // not: this pointed at AbiL2mVB…, an earlier devnet build that is still
  // deployed, so the ?devnet=1 path was driving a stale program.
  programId: 'DSWFRcF4Ky9Nw7RQUUa2M9nnXD4kRrbYGjegF7dyJ9B5',
  rpc: 'https://api.devnet.solana.com',
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ataProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  metadataProgram: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  systemProgram: '11111111111111111111111111111111'
};

// The soulbound collectible. Addresses are written by collectible/setup.mjs
// into collectible/cache.mainnet.json — copy them here after that runs.
// While they are empty the store shows the card as "opening soon" and the
// mint button stays disabled, so a half-configured site cannot take money.
const MINT = {
  candyMachine: '6wjQnzNY2yiRd2mFdkkjd8KzzHR31PRrdWmdpqi38rsH',
  candyGuard: '4XPdr5vnEMJAKzCuMUQBTsriuACEXxS6DtQ9zutCsEPA',
  collection: 'GHhygKTrAoPzdFABab4SRErtTcZVfrbhxtpNDWJHLJwW',
  // Open. #0 was minted and checked first: it arrived, the 0.1 reached the
  // treasury in the same transaction, and a transfer of it is refused by
  // the chain rather than merely discouraged.
  live: true,
  // The collectible's takings go to the staking wallet, not the Seeker
  // the rest of the site pays into. Must match the solPayment guard: the
  // program checks it, so a mismatch fails the mint rather than paying
  // the wrong address.
  treasury: 'FndhEjYMXMhihnoUfZbgm7mTWgCpcwoT3NikTABLV37m',
  priceSol: 0.1,
  mintLimitId: 1,
  candyMachineProgram: 'CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J',
  candyGuardProgram: 'CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ',
  coreProgram: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
  systemProgram: '11111111111111111111111111111111',
  sysvarInstructions: 'Sysvar1nstructions1111111111111111111111111',
  recentSlothashes: 'SysvarS1otHashes111111111111111111111111111'
};

function mintConfigured() {
  if (!(MINT.candyMachine && MINT.candyGuard && MINT.collection)) return false;
  if (MINT.live) return true;
  try { return new URLSearchParams(location.search).get('mint') === 'preview'; } catch (e) { return false; }
}

function w3() {
  const lib = window.solanaWeb3;
  if (!lib) throw new Error('Solana library is still loading — try again in a second.');
  return lib;
}

/// Anchor identifies an instruction by the first 8 bytes of
/// sha256("global:<name>"), so the discriminator has to be derived, not guessed.
async function anchorDiscriminator(name) {
  const bytes = new TextEncoder().encode('global:' + name);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(hash).slice(0, 8);
}

function pda(seeds, programId) {
  const { PublicKey } = w3();
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(programId))[0];
}

function chainAccounts(ownerStr, mintStr) {
  const { PublicKey } = w3();
  const owner = new PublicKey(ownerStr);
  const mint = new PublicKey(mintStr);
  const config = pda([new TextEncoder().encode('config')], CHAIN.programId);
  const record = pda([new TextEncoder().encode('stake'), mint.toBuffer()], CHAIN.programId);
  const metadata = pda(
    [new TextEncoder().encode('metadata'),
     new PublicKey(CHAIN.metadataProgram).toBuffer(),
     mint.toBuffer()],
    CHAIN.metadataProgram
  );
  return {
    owner, mint, config, record, metadata,
    ownerToken: ataFor(owner, mint),
    // The vault is a PDA of the staking program, not an associated token
    // account. An ATA address can be created by anyone; a program's own PDA
    // cannot, which is what stops a stranger occupying the vault and
    // blocking that Ranger from ever being staked.
    vaultToken: pda([new TextEncoder().encode('vault'), mint.toBuffer()], CHAIN.programId)
  };
}

/// Read the treasury out of the on-chain config rather than hardcoding it,
/// so a rotated treasury does not silently break staking.
async function readTreasury(connection, config) {
  const info = await connection.getAccountInfo(config);
  if (!info) throw new Error('The staking program has not been set up on this network.');
  const { PublicKey } = w3();
  return new PublicKey(info.data.subarray(8 + 32, 8 + 64)); // after discriminator + admin
}

async function buildStakeTx(connection, ownerStr, mintStr) {
  const { PublicKey, TransactionInstruction, Transaction } = w3();
  const a = chainAccounts(ownerStr, mintStr);
  const treasury = await readTreasury(connection, a.config);
  const keys = [
    { pubkey: a.owner, isSigner: true, isWritable: true },
    { pubkey: a.config, isSigner: false, isWritable: true },
    { pubkey: treasury, isSigner: false, isWritable: true },
    { pubkey: a.mint, isSigner: false, isWritable: false },
    { pubkey: a.ownerToken, isSigner: false, isWritable: true },
    { pubkey: a.record, isSigner: false, isWritable: true },
    { pubkey: a.vaultToken, isSigner: false, isWritable: true },
    { pubkey: a.metadata, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(CHAIN.tokenProgram), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(CHAIN.systemProgram), isSigner: false, isWritable: false }
  ];
  const ix = new TransactionInstruction({
    programId: new PublicKey(CHAIN.programId),
    keys,
    data: await anchorDiscriminator('stake') // Uint8Array; Buffer is not available in the browser
  });
  return new Transaction().add(ix);
}

async function buildUnstakeTx(connection, ownerStr, mintStr) {
  const { PublicKey, TransactionInstruction, Transaction } = w3();
  const a = chainAccounts(ownerStr, mintStr);
  const keys = [
    { pubkey: a.owner, isSigner: true, isWritable: true },
    { pubkey: a.config, isSigner: false, isWritable: true },
    { pubkey: a.record, isSigner: false, isWritable: true },
    { pubkey: a.vaultToken, isSigner: false, isWritable: true },
    { pubkey: a.ownerToken, isSigner: false, isWritable: true },
    { pubkey: new PublicKey(CHAIN.tokenProgram), isSigner: false, isWritable: false }
  ];
  const ix = new TransactionInstruction({
    programId: new PublicKey(CHAIN.programId),
    keys,
    data: await anchorDiscriminator('unstake')
  });
  return new Transaction().add(ix);
}

/// One mint from the Candy Guard, encoded by hand. Bundling Metaplex's SDK
/// would mean several hundred kilobytes and loosening the page's script
/// policy to load it, for an instruction that is thirteen fixed accounts
/// and two derived ones. test/browser/site.test.mjs replays this against
/// bytes produced by the real SDK (mint-ix.fixture.json) and fails on any
/// difference, so hand-rolling it does not mean trusting it.
///
/// The guard reads its own settings from remaining accounts: the treasury
/// the price goes to, and the counter that holds a wallet to one.
async function collectibleMintIx(o) {
  const { PublicKey, TransactionInstruction } = w3();
  const enc = new TextEncoder();
  const cmProgram = new PublicKey(MINT.candyMachineProgram);
  const guardProgram = new PublicKey(MINT.candyGuardProgram);
  const candyMachine = new PublicKey(o.candyMachine);
  const candyGuard = new PublicKey(o.candyGuard);
  const minter = new PublicKey(o.minter);
  const asset = new PublicKey(o.asset);

  const authorityPda = PublicKey.findProgramAddressSync(
    [enc.encode('candy_machine'), candyMachine.toBuffer()], cmProgram)[0];
  const mintCounter = PublicKey.findProgramAddressSync(
    [enc.encode('mint_limit'), Uint8Array.of(o.mintLimitId), minter.toBuffer(),
     candyGuard.toBuffer(), candyMachine.toBuffer()], guardProgram)[0];

  const keys = [
    { pubkey: candyGuard, isSigner: false, isWritable: false },
    { pubkey: cmProgram, isSigner: false, isWritable: false },
    { pubkey: candyMachine, isSigner: false, isWritable: true },
    { pubkey: authorityPda, isSigner: false, isWritable: true },
    { pubkey: minter, isSigner: true, isWritable: true },
    { pubkey: minter, isSigner: true, isWritable: true },
    // The owner slot, left unset: an omitted optional account is written as
    // the program's own address, and the minter becomes the owner.
    { pubkey: guardProgram, isSigner: false, isWritable: false },
    { pubkey: asset, isSigner: true, isWritable: true },
    { pubkey: new PublicKey(o.collection), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(MINT.coreProgram), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(MINT.systemProgram), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(MINT.sysvarInstructions), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(MINT.recentSlothashes), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(o.treasury), isSigner: false, isWritable: true },
    { pubkey: mintCounter, isSigner: false, isWritable: true }
  ];

  // mint_v1(mintArgs: bytes, group: Option<String>) — the guards take no
  // arguments here, so an empty vector and no group label.
  const disc = await anchorDiscriminator('mint_v1');
  const data = new Uint8Array(disc.length + 4 + 1);
  data.set(disc, 0);
  return new TransactionInstruction({ programId: guardProgram, keys: keys, data: data });
}

/// Sign and send through whichever wallet is connected, then wait for
/// confirmation so the UI never claims success before the chain agrees.
async function sendChainTx(tx) {
  const { Connection } = w3();
  const connection = new Connection(CHAIN.rpc, 'confirmed');
  const provider = Wallet.active;
  if (!provider) throw new Error('Connect a wallet first.');

  tx.feePayer = new (w3().PublicKey)(Wallet.pubkey);
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  let signature;
  if (provider.kind === 'privy') {
    const out = await Privy.provider.request({
      method: 'signAndSendTransaction', params: { transaction: tx, connection: connection } });
    signature = signatureOf(out.signature);
  } else if (provider.kind === 'injected' && provider.w.signAndSendTransaction) {
    const res = await provider.w.signAndSendTransaction(tx);
    signature = signatureOf(res.signature || res);
  } else if (provider.kind === 'injected' && provider.w.signTransaction) {
    const signed = await provider.w.signTransaction(tx);
    signature = await connection.sendRawTransaction(signed.serialize());
  } else if (provider.kind === 'standard') {
    const feat = provider.w.features['solana:signAndSendTransaction'];
    if (!feat) throw new Error('This wallet cannot send transactions.');
    const out = await feat.signAndSendTransaction({
      account: walletAccount(provider),
      chain: 'solana:devnet',
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false })
    });
    const { PublicKey } = w3();
    signature = signatureOf(out[0].signature);
  } else {
    throw new Error('This wallet cannot send transactions.');
  }

  await confirmSignature(connection, signature);
  return signature;
}

async function chainStake(mintStr) {
  const { Connection } = w3();
  const connection = new Connection(CHAIN.rpc, 'confirmed');
  const tx = await buildStakeTx(connection, Wallet.pubkey, mintStr);
  return sendChainTx(tx);
}

async function chainUnstake(mintStr) {
  const { Connection } = w3();
  const connection = new Connection(CHAIN.rpc, 'confirmed');
  const tx = await buildUnstakeTx(connection, Wallet.pubkey, mintStr);
  return sendChainTx(tx);
}


/// Devnet path: stake or unstake the picked Rangers through the on-chain
/// program, one transaction each, reporting what actually happened rather
/// than assuming success.
async function chainToggleStake() {
  const btn = document.getElementById('moon-stake-btn');
  const status = document.getElementById('moon-stake-status');
  const staked = stakedMints.slice();
  const toStake = [...picked].filter(function (m) { return staked.indexOf(m) < 0; });
  const targets = toStake.length ? toStake : staked;
  if (!targets.length) { alert('Pick a Ranger first.'); return; }

  const unstaking = toStake.length === 0;
  btn.disabled = true;
  const done = [];
  const failed = [];

  for (const mint of targets) {
    try {
      status.textContent = (unstaking ? 'Unstaking' : 'Staking') + ' ' +
        (done.length + failed.length + 1) + ' of ' + targets.length + '…';
      const sig = unstaking ? await chainUnstake(mint) : await chainStake(mint);
      done.push({ mint: mint, sig: sig });
    } catch (e) {
      failed.push({ mint: mint, why: (e && e.message) || String(e) });
    }
  }

  btn.disabled = false;
  if (done.length) {
    // reflect the new on-chain truth rather than guessing
    stakedMints = unstaking
      ? stakedMints.filter(function (m) { return !done.some(function (d) { return d.mint === m; }); })
      : stakedMints.concat(done.map(function (d) { return d.mint; }));
    picked.clear();
    renderPicker();
    renderStaking();
  }

  const lines = [];
  if (done.length) {
    lines.push(done.length + ' ' + (unstaking ? 'unstaked' : 'staked') + ' on devnet.');
    lines.push('View: https://solscan.io/tx/' + done[0].sig + '?cluster=devnet');
  }
  if (failed.length) {
    lines.push('');
    lines.push(failed.length + ' failed:');
    failed.forEach(function (f) { lines.push('  ' + f.mint.slice(0, 6) + '… — ' + f.why); });
  }
  alert(lines.join('\n'));
}

// ── RANGER PICKER ──
// Players choose which Rangers to stake rather than staking everything.
let rangerList = [];      // [{mint, name, image}]
let stakedMints = [];     // mints currently staked, per the server
let stakedAt = {};        // mint → when it was locked, for days and points earned
let picked = new Set();   // mints ticked in the UI
let stakeFeeLamports = 0;
let treasuryWallet = null;

async function loadRangers() {
  if (!FoxPoints.token) { rangerList = []; stakedMints = []; stakedAt = {}; renderPicker(); return; }
  const r = await FoxPoints.api('/api/rangers');
  if (!r || !r.verified) { rangerList = []; stakedMints = []; stakedAt = {}; renderPicker(); return; }
  rangerList = r.rangers || [];
  stakedMints = r.staked || [];
  stakedAt = r.stakedAt || {};
  stakeFeeLamports = r.feeLamports || 0;
  treasuryWallet = r.treasury || null;
  picked = new Set(rangerList
    .filter(function (x) { return stakedMints.indexOf(x.mint) < 0; })
    .map(function (x) { return x.mint; }));
  renderPicker();
}

function renderPicker() {
  const wrap = document.getElementById('moon-picker');
  const grid = document.getElementById('rg-grid');
  if (!wrap || !grid) return;

  if (!rangerList.length) { wrap.hidden = true; return; }
  wrap.hidden = false;

  grid.innerHTML = rangerList.map(function (r) {
    const locked = stakedMints.indexOf(r.mint) >= 0;
    const on = picked.has(r.mint);
    const cls = 'rg-card' + (locked ? ' locked' : (on ? ' picked' : ''));
    // Straight from Arweave, which serves browsers happily and spreads the
    // load. Falls through the CDN copy, the original, our proxy, then a glyph.
    const chain = [r.image, r.imageAlt, POINTS_API + '/api/img?mint=' + encodeURIComponent(r.mint)]
      .filter(Boolean);
    const img = '<img class="rg-img" src="' + escapeHtml(chain[0] || '') + '" alt="" loading="lazy" ' +
      'data-fallbacks="' + escapeHtml(JSON.stringify(chain.slice(1))) + '" ' +
      'onerror="rgImgFallback(this)"/>';
    // a locked Ranger says how long it has been earning, and how much
    const since = stakedAt[r.mint];
    const days = locked && since ? Math.floor((Date.now() - since) / 86400000) : null;
    const stat = days === null ? ''
      : '<div class="rg-stat">' + (days === 0 ? 'staked today' : days + ' day' + (days === 1 ? '' : 's')) +
        ' · ' + (days * STAKE_RATE_PER_DAY).toLocaleString() + ' pts</div>';
    return '<div class="' + cls + '" data-mint="' + escapeHtml(r.mint) + '" ' +
      (locked ? '' : 'onclick="togglePick(this)"') + '>' +
      img + '<div class="rg-name">' + escapeHtml(r.name) + '</div>' + stat +
      '<div class="rg-tick">' + (locked ? '✓' : '✓') + '</div></div>';
  }).join('');

  const unstakedCount = rangerList.filter(function (r) { return stakedMints.indexOf(r.mint) < 0; }).length;
  const selall = document.getElementById('rg-selall');
  if (selall) {
    selall.hidden = unstakedCount === 0;
    selall.textContent = (picked.size === unstakedCount && unstakedCount > 0) ? 'Clear selection' : 'Select all';
  }

  const cost = document.getElementById('rg-cost');
  if (cost) {
    if (picked.size === 0) {
      cost.textContent = stakedMints.length ? stakedMints.length + ' staked · earning ' + (stakedMints.length * 100) + ' / day' : '';
    } else if (stakeFeeLamports > 0) {
      const sol = (stakeFeeLamports * picked.size) / 1e9;
      cost.innerHTML = 'Stake ' + picked.size + ' · <strong>' + sol.toFixed(3) + ' SOL</strong> · +' + (picked.size * 100) + ' pts/day';
    } else {
      cost.innerHTML = 'Stake ' + picked.size + ' · <strong>+' + (picked.size * 100) + ' pts/day</strong>';
    }
  }
}

/// Walks the remaining sources before giving up on a Ranger's artwork.
function rgImgFallback(img) {
  let left = [];
  try { left = JSON.parse(img.getAttribute('data-fallbacks') || '[]'); } catch (e) {}
  if (left.length) {
    const next = left.shift();
    img.setAttribute('data-fallbacks', JSON.stringify(left));
    img.src = next;
    return;
  }
  const div = document.createElement('div');
  div.className = 'rg-img rg-fallback';
  div.textContent = '\ud83c\udf15';
  img.replaceWith(div);
}

function togglePick(el) {
  const mint = el.getAttribute('data-mint');
  if (picked.has(mint)) picked.delete(mint); else picked.add(mint);
  renderPicker();
}

function toggleSelectAll() {
  const available = rangerList.filter(function (r) { return stakedMints.indexOf(r.mint) < 0; });
  if (picked.size === available.length) picked.clear();
  else available.forEach(function (r) { picked.add(r.mint); });
  renderPicker();
}

// ── MOON RANGER STAKING ──
function stakeKey() { return 'moonstake_' + (Wallet.pubkey || 'anon'); }

const EMPTY_STAKE = { staked: false, since: 0, count: 0, banked: 0 };

function loadStake() {
  let s;
  try { s = JSON.parse(localStorage.getItem(stakeKey())); } catch (e) { s = null; }
  if (!s) return Object.assign({}, EMPTY_STAKE);
  // migrate the old single-Ranger record (claimed counter, no count/banked)
  if (s.claimed !== undefined && s.banked === undefined) {
    const earned = s.staked && s.since
      ? Math.max(0, Math.floor(((Date.now() - s.since) / DAY_MS) * STAKE_RATE_PER_DAY) - s.claimed)
      : 0;
    s = { staked: !!s.staked, since: s.staked ? Date.now() : 0, count: 1, banked: earned };
  }
  if (s.count === undefined) s.count = 1;
  if (s.banked === undefined) s.banked = 0;
  return s;
}
function saveStake(s) { try { localStorage.setItem(stakeKey(), JSON.stringify(s)); } catch (e) {} }

// 100 points per day, per Ranger held
function stakeRate(s) { return STAKE_RATE_PER_DAY * (s.count || 0); }

function stakeAccrued(s) {
  if (!s.staked) return s.banked || 0;
  const elapsed = Date.now() - (s.since || Date.now());
  return (s.banked || 0) + Math.max(0, Math.floor((elapsed / DAY_MS) * stakeRate(s)));
}

// Holdings changed mid-stake: bank what was earned at the old rate, then
// continue at the new one. Prevents both retroactive inflation and
// earning on Rangers that have since been sold.
function settleStakeCount(newCount) {
  const s = loadStake();
  if (!s.staked || s.count === newCount) return;
  s.banked = stakeAccrued(s);
  s.since = Date.now();
  s.count = newCount;
  saveStake(s);
}

async function toggleStake() {
  if (!Wallet.pubkey) { connectWallet(); return; }
  if (DEVNET_MODE) { return chainToggleStake(); }

  if (FoxPoints.token && FoxPoints.server) {
    const isStaked = FoxPoints.server.stake && FoxPoints.server.stake.staked;
    let r;
    if (isStaked && picked.size === 0) {
      r = await FoxPoints.api('/api/unstake', { method: 'POST', body: {} });
    } else {
      if (picked.size === 0) { alert('Pick at least one Moon Ranger to stake.'); return; }
      r = await FoxPoints.api('/api/stake', { method: 'POST', body: { mints: [...picked] } });
    }
    if (r && r.error) {
      alert(r.error === 'no Moon Ranger in this wallet'
        ? 'No Moon Ranger found in this wallet.\n\nStaking is for holders — grab one and reconnect.'
        : r.error);
      return;
    }
    if (r && r.player) FoxPoints.server = r.player;
    await loadRangers();
    FoxPoints.render(); renderStaking(); renderLeaderboard();
    return;
  }
  const s = loadStake();
  if (!s.staked && rangerCount !== -2 && !(rangerCount > 0)) {
    alert(rangerCount === -1
      ? 'Could not check your wallet right now. Try again in a moment.'
      : 'No Moon Ranger found in this wallet.\n\nStaking is for holders — grab one and reconnect.');
    return;
  }
  if (s.staked) {
    const pending = stakeAccrued(s);
    if (pending > 0 && !confirm('You have ' + pending + ' unclaimed points. Unstake anyway?\n\n(Claim them first to keep them.)')) return;
    saveStake(Object.assign({}, EMPTY_STAKE));
  } else {
    // -2 means checks aren't configured yet; treat as a single Ranger
    const count = rangerCount > 0 ? rangerCount : 1;
    saveStake({ staked: true, since: Date.now(), count: count, banked: 0 });
  }
  renderStaking();
}

// ── USDC ──
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

function ataFor(owner, mint) {
  const { PublicKey } = w3();
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBytes(), new PublicKey(TOKEN_PROGRAM).toBytes(), new PublicKey(mint).toBytes()],
    new PublicKey(ATA_PROGRAM)
  )[0];
}

/// Sends USDC — the only currency bookings are paid in. Booking payments are
/// real money on mainnet, so they get their own send path: `sendChainTx` is
/// pinned to devnet for staking and must stay that way.
/// TransferChecked rather than Transfer: it carries the mint and decimals, so
/// a wrong-token or wrong-scale transfer fails on chain instead of quietly
/// moving the wrong amount.
async function sendUsdc(to, units, reference) {
  const { Connection, PublicKey, Transaction, TransactionInstruction } = w3();
  const provider = Wallet.active;
  if (!provider) throw new Error('Connect a wallet first.');

  const connection = rpc();
  const from = new PublicKey(Wallet.pubkey);
  const source = ataFor(Wallet.pubkey, USDC_MINT);
  const dest = ataFor(to, USDC_MINT);

  const src = await connection.getAccountInfo(source);
  if (!src) throw new Error('That wallet holds no USDC.');

  const data = new Uint8Array(10);
  data[0] = 12; // TransferChecked
  new DataView(data.buffer).setBigUint64(1, BigInt(units), true);
  data[9] = USDC_DECIMALS;

  const keys = [
    { pubkey: source, isSigner: false, isWritable: true },
    { pubkey: new PublicKey(USDC_MINT), isSigner: false, isWritable: false },
    { pubkey: dest, isSigner: false, isWritable: true },
    { pubkey: from, isSigner: true, isWritable: false }
  ];
  if (reference) keys.push({ pubkey: new PublicKey(reference), isSigner: false, isWritable: false });

  return sendInstructions([new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM), keys: keys, data: data
  })]);
}

/// Turns the page's own instructions into a versioned transaction and sends
/// it through sendVersionedTx — the path swaps take, which already works with
/// the wallets people use here. Cleanup and USDC payments used to hand wallets
/// a legacy Transaction object through a separate copy of the send logic, and
/// cleanup still failed with "Buffer is not defined" after the page's own use
/// of Buffer was removed. One format and one send path takes that difference away.
async function sendInstructions(instructions) {
  const { PublicKey, TransactionMessage, VersionedTransaction } = w3();
  if (!Wallet.active) throw new Error('Connect a wallet first.');
  const latest = await rpc().getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: new PublicKey(Wallet.pubkey),
    recentBlockhash: latest.blockhash,
    instructions: instructions
  }).compileToV0Message();
  const bytes = new VersionedTransaction(message).serialize();
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return sendVersionedTx(btoa(binary), latest.lastValidBlockHeight);
}

/// web3.js stamps every request with a `solana-client` header. The RPC proxy
/// does not list it in Access-Control-Allow-Headers, so the CORS preflight
/// fails and every call through Connection dies — balances, blockhashes and
/// confirmations alike. Strip it on the way out.
function rpc(commitment) {
  const { Connection } = w3();
  return new Connection(HELIUS_RPC, {
    commitment: commitment || 'confirmed',
    fetchMiddleware: function (url, options, next) {
      if (options && options.headers) {
        delete options.headers['solana-client'];
        delete options.headers['Solana-Client'];
      }
      next(url, options);
    }
  });
}

/// web3.js `confirmTransaction` waits on a WebSocket subscription, and the
/// RPC proxy does not speak WebSocket — so it never hears back and hangs
/// until the blockhash expires, leaving a finished swap looking stuck.
/// Poll over plain HTTP instead.
async function confirmSignature(connection, signature, lastValidBlockHeight) {
  const deadline = Date.now() + 90000;
  let checks = 0;
  while (Date.now() < deadline) {
    const res = await connection.getSignatureStatuses([signature]);
    const status = res && res.value && res.value[0];
    if (status) {
      if (status.err) {
        const e = new Error('The transaction failed on chain.');
        e.sentSignature = signature;
        throw e;
      }
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return signature;
      }
    }
    // every few rounds, check the blockhash has not aged out — otherwise a
    // dropped transaction would sit here for the full ninety seconds
    if (lastValidBlockHeight && ++checks % 4 === 0) {
      const height = await connection.getBlockHeight('confirmed').catch(function () { return 0; });
      if (height && height > lastValidBlockHeight) {
        const e = new Error('That expired before it landed. Nothing was swapped — try again.');
        e.sentSignature = signature;
        throw e;
      }
    }
    await new Promise(function (r) { setTimeout(r, 1500); });
  }
  const e = new Error('Still confirming — it may well have gone through.');
  e.sentSignature = signature;
  throw e;
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/// A transaction signature is 64 bytes; a public key is 32. Passing one to
/// `new PublicKey()` throws "Invalid public key input" — which is exactly
/// what a successful swap used to report. Encode the bytes directly.
function b58encode(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digits = [0];
  for (let i = 0; i < input.length; i++) {
    let carry = input[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (let i = 0; i < input.length && input[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

/// Wallets return a signature as raw bytes, or occasionally already encoded.
function signatureOf(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.signature === 'string') return value.signature;
  const bytes = (value && value.signature) || value;
  return b58encode(bytes);
}

// ── WALLET CLEANUP ──
// Closing an empty account is free money. Burning a token that still has a
// balance is permanent. The code keeps those apart at every step, and
// nothing that still holds anything is ever selected on the user's behalf.
var clScan = null;
var clSelected = {};
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const CLOSE_PER_TX = 18;
const BURN_PER_TX = 8;

async function scanCleanup(fresh) {
  const btn = document.getElementById('cl-scan');
  const msg = document.getElementById('cl-msg');
  if (!Wallet.pubkey) {
    try { await connectWallet(); } catch (e) { /* closed the picker */ }
    if (!Wallet.pubkey) return;
  }
  btn.disabled = true;
  btn.textContent = 'Reading your wallet…';
  try {
    // fresh after closing or burning, or the result from before the action comes back
    const res = await fetch(POINTS_API + '/api/cleanup/scan?wallet=' + encodeURIComponent(Wallet.pubkey) +
      (fresh === true ? '&fresh=1' : ''));
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    clScan = d;
    clSelected = {};
    renderCleanup();
    document.getElementById('cl-start').hidden = true;
    document.getElementById('cl-results').hidden = false;
  } catch (e) {
    msg.className = 'sw-msg bad';
    msg.textContent = e.message || 'Could not read that wallet.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan my wallet';
  }
}

function resetCleanup() {
  document.getElementById('cl-start').hidden = false;
  document.getElementById('cl-results').hidden = true;
  document.getElementById('cl-msg').textContent = '';
  clScan = null;
  clSelected = {};
}

function clEmptyAccounts() {
  return clScan.accounts.filter(function (a) { return a.empty && !a.frozen; });
}
function clHeldAccounts() {
  return clScan.accounts.filter(function (a) {
    return !a.empty && !a.frozen && a.mint !== WSOL_MINT;
  });
}

/// Wrapped SOL is its own case: closing the account unwraps the balance
/// back to SOL. Burning it would destroy real money, so it never appears
/// in the burn list at all.
function clWrappedSol() {
  return clScan.accounts.filter(function (a) {
    return a.mint === WSOL_MINT && !a.empty && !a.frozen;
  });
}

function clNfts() {
  return clScan.accounts.filter(function (a) {
    return !a.empty && !a.frozen && a.nft && a.mint !== WSOL_MINT;
  });
}
function clTokens() {
  return clScan.accounts.filter(function (a) {
    return !a.empty && !a.frozen && !a.nft && a.mint !== WSOL_MINT;
  });
}

var clCat = 'rent';

/// Switching category is just showing a pane — the selection survives it,
/// so a burn can span tokens and NFTs without losing what you ticked.
function clShow(cat) {
  clCat = cat;
  ['rent', 'tok', 'nft', 'locked'].forEach(function (c) {
    const pane = document.getElementById('cl-pane-' + c);
    if (pane) pane.hidden = c !== cat;
    const tab = document.querySelector('.cl-tab[data-cat="' + c + '"]');
    if (tab) tab.classList.toggle('on', c === cat);
  });
}

function renderCleanup() {
  const empty = clEmptyAccounts();
  const nfts = clNfts();
  const toks = clTokens();
  const frozen = clScan.accounts.filter(function (a) { return a.frozen; });
  const wsol = clWrappedSol();
  const gross = clScan.emptyRentLamports / 1e9;
  const keep = gross * (1 - clScan.feePct / 100);

  document.getElementById('cl-summary').innerHTML =
    '<div class="cl-cell"><div class="cl-val' + (keep > 0 ? ' good' : '') + '">' + keep.toFixed(4) +
    '</div><div class="cl-key">SOL to reclaim</div></div>' +
    '<div class="cl-cell"><div class="cl-val">' + clScan.accounts.length + '</div><div class="cl-key">Token accounts</div></div>' +
    '<div class="cl-cell"><div class="cl-val">' + (nfts.length + toks.length) +
    '</div><div class="cl-key">Holding something</div></div>';

  // counts live on the tabs, so the shape of the wallet is visible at a glance
  const counts = { rent: empty.length + wsol.length, tok: toks.length, nft: nfts.length, locked: frozen.length };
  Object.keys(counts).forEach(function (c) {
    document.getElementById('cl-n-' + c).textContent = counts[c];
    const tab = document.querySelector('.cl-tab[data-cat="' + c + '"]');
    if (tab) tab.classList.toggle('empty', counts[c] === 0);
  });

  const note = document.getElementById('cl-empty-note');
  const closeBtn = document.getElementById('cl-close-btn');
  if (empty.length) {
    note.innerHTML = '<strong>' + empty.length + '</strong> account' + (empty.length === 1 ? '' : 's') +
      ' hold nothing at all. Closing them destroys no tokens and returns <strong>' +
      gross.toFixed(4) + ' SOL</strong> of rent — you keep <strong>' + keep.toFixed(4) +
      ' SOL</strong> after the ' + clScan.feePct + '% fee.';
    closeBtn.hidden = false;
    // Whatever the last run did to this button, a fresh scan is a fresh start:
    // closing accounts switched it off and nothing ever switched it back on,
    // so the next lot of rent could be seen but never claimed.
    closeBtn.disabled = false;
    const txs = Math.ceil(empty.length / CLOSE_PER_TX);
    closeBtn.textContent = 'Close ' + empty.length + ' and reclaim ' + keep.toFixed(4) + ' ◎' +
      (txs > 1 ? ' (' + txs + ' signatures)' : '');
  } else {
    note.innerHTML = '<span class="cl-empty-note-none">No empty accounts in this wallet — nothing to reclaim. ' +
      'Rent builds up as you sell or burn tokens, so try a wallet you have traded from.</span>';
    closeBtn.hidden = true;
  }

  const wsolBlock = document.getElementById('cl-wsol-block');
  if (wsol.length) {
    const total = wsol.reduce(function (s, a) { return s + a.amount; }, 0);
    wsolBlock.hidden = false;
    document.getElementById('cl-wsol-note').innerHTML =
      'You have <strong>' + total.toLocaleString(undefined, { maximumFractionDigits: 6 }) +
      ' wrapped SOL</strong>. Closing that account unwraps it straight back to ordinary SOL — ' +
      'nothing is burned and nothing is lost.';
    const wsolBtn = document.getElementById('cl-wsol-btn');
    wsolBtn.disabled = false;          // same trap as the close button above
    wsolBtn.textContent =
      'Unwrap ' + total.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ◎ and close';
  } else {
    wsolBlock.hidden = true;
  }

  document.getElementById('cl-nfts').innerHTML = nfts.length
    ? nfts.map(clRow).join('')
    : '<div class="cl-none">No NFTs holding a balance in this wallet.</div>';
  document.getElementById('cl-toks').innerHTML = toks.length
    ? toks.map(clRow).join('')
    : '<div class="cl-none">No tokens with a balance in this wallet.</div>';

  document.getElementById('cl-nft-count').textContent = nfts.length + ' collectible' + (nfts.length === 1 ? '' : 's');
  const priced = toks.filter(function (t) { return t.priced; }).length;
  document.getElementById('cl-tok-count').textContent =
    toks.length + ' token' + (toks.length === 1 ? '' : 's') +
    (priced ? ' · ' + priced + ' with a known price' : '');

  document.getElementById('cl-frozen-note').innerHTML = frozen.length
    ? '<strong>' + frozen.length + '</strong> account' + (frozen.length === 1 ? ' is' : 's are') +
      ' frozen — usually staked, listed for sale, or locked by another service. They cannot be ' +
      'closed until released, so they are left out of everything above.'
    : '<span class="cl-empty-note-none">Nothing in this wallet is locked.</span>';
  document.getElementById('cl-frozen-list').innerHTML = frozen.map(function (a) {
    const label = a.name || a.symbol || (a.mint.slice(0, 6) + '…' + a.mint.slice(-4));
    return '<div class="cl-row cl-locked-row">' +
      (a.image ? '<img src="' + escapeHtml(a.image) + '" alt="" loading="lazy">' : '<img alt="">') +
      '<span class="cl-body"><span class="cl-name">' + escapeHtml(label) + '</span>' +
      '<span class="cl-sub">' + a.amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) + '</span></span>' +
      '<span class="cl-worth">locked</span></div>';
  }).join('');

  // open on whatever this wallet actually has something to do in
  const first = counts.rent ? 'rent' : counts.tok ? 'tok' : counts.nft ? 'nft' : 'locked';
  clShow(clCat && counts[clCat] ? clCat : first);
  paintBurnConfirm();
}

function clRow(a) {
  const label = a.name || a.symbol || (a.mint.slice(0, 6) + '…' + a.mint.slice(-4));
  const tags = [];
  if (a.nft) tags.push('<span class="cl-tag-nft">Collectible</span>');
  if (!a.priced) tags.push('<span class="cl-tag-unpriced">No price found — that does not mean worthless</span>');
  const checked = clSelected[a.account] ? ' checked' : '';
  return '<label class="cl-row' + (clSelected[a.account] ? ' on' : '') + '" data-acct="' + a.account + '">' +
    '<input type="checkbox"' + checked + ' onchange="toggleBurn(this,\'' + a.account + '\')">' +
    (a.image ? '<img src="' + escapeHtml(a.image) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<img alt="">') +
    '<span class="cl-body"><span class="cl-name">' + escapeHtml(label) + '</span>' +
    '<span class="cl-sub">' + a.amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) +
    (a.symbol && !a.nft ? ' ' + escapeHtml(a.symbol) : '') + '</span>' +
    (tags.length ? '<span class="cl-tagline">' + tags.join('') + '</span>' : '') +
    '</span>' +
    '<span class="cl-worth">' + (a.priced ? '$' + a.usd.toFixed(2) : '—') +
    '<span class="cl-rent">+' + (a.rent / 1e9).toFixed(5) + ' ◎</span></span></label>';
}

/// Select-all is per group, and it toggles — so it is as easy to clear a
/// mistaken selection as to make one.
function selectGroup(which) {
  const list = which === 'nft' ? clNfts() : clTokens();
  const allOn = list.every(function (a) { return clSelected[a.account]; });
  list.forEach(function (a) {
    if (allOn) delete clSelected[a.account];
    else clSelected[a.account] = true;
  });
  renderCleanup();
}

function toggleBurn(box, account) {
  const row = box.closest('.cl-row');
  if (box.checked) clSelected[account] = true; else delete clSelected[account];
  row.classList.toggle('on', box.checked);
  paintBurnConfirm();
}

/// Running total of what the current selection actually returns. Every
/// account carries its own rent from the scan, so this is the real figure
/// rather than a count multiplied by an assumed rent.
function paintTally(chosen) {
  const bar = document.getElementById('cl-tally');
  if (!chosen.length) { bar.hidden = true; return; }
  bar.hidden = false;

  const grossLamports = chosen.reduce(function (s, a) { return s + a.rent; }, 0);
  const gross = grossLamports / 1e9;
  const fee = gross * (clScan.feePct / 100);
  const keep = gross - fee;
  const price = Number(clScan.solUsd) || 0;

  document.getElementById('cl-tally-sol').innerHTML =
    keep.toFixed(4) + ' <span>SOL</span>';
  document.getElementById('cl-tally-usd').textContent =
    price ? '≈ $' + (keep * price).toFixed(2) : '';

  const pts = chosen.length * (clScan.pointsPerBurn || 0);
  const parts = [
    chosen.length + ' account' + (chosen.length === 1 ? '' : 's') + ' selected',
    gross.toFixed(4) + ' ◎ rent',
    '− ' + fee.toFixed(4) + ' ◎ fee (' + clScan.feePct + '%)'
  ];
  if (pts) parts.push('+' + pts.toLocaleString() + ' Fox Points');
  document.getElementById('cl-tally-break').textContent = parts.join('   ·   ');
}

/// The confirm step spells out exactly what is about to be destroyed, in
/// dollars where a price exists and by name where it does not.
function paintBurnConfirm() {
  const wrap = document.getElementById('cl-confirm');
  const chosen = clHeldAccounts().filter(function (a) { return clSelected[a.account]; });
  paintTally(chosen);
  if (!chosen.length) { wrap.hidden = true; return; }
  wrap.hidden = false;

  const nfts = chosen.filter(function (a) { return a.nft; });
  const unpriced = chosen.filter(function (a) { return !a.priced; });
  const worth = chosen.reduce(function (s, a) { return s + (a.usd || 0); }, 0);
  const rent = chosen.reduce(function (s, a) { return s + a.rent; }, 0) / 1e9;
  const keep = rent * (1 - clScan.feePct / 100);

  const inNfts = chosen.filter(function (a) { return a.nft; }).length;
  const inToks = chosen.length - inNfts;
  const where = [];
  if (inToks) where.push(inToks + ' from Tokens');
  if (inNfts) where.push(inNfts + ' from NFTs');
  let note = '<span class="cl-where">Selected: ' + where.join(' · ') + '</span>' +
    'You are about to <strong>permanently destroy ' + chosen.length + ' holding' +
    (chosen.length === 1 ? '' : 's') + '</strong> to reclaim ' + keep.toFixed(4) + ' SOL.';
  if (worth > 0) note += ' Known value being burned: <strong>$' + worth.toFixed(2) + '</strong>.';
  if (nfts.length) note += ' <strong>' + nfts.length + ' of them look like collectibles.</strong>';
  if (unpriced.length) {
    note += ' ' + unpriced.length + ' have no price — that usually means illiquid, not worthless.';
  }
  document.getElementById('cl-confirm-note').innerHTML = note;

  const input = document.getElementById('cl-confirm-input');
  const btn = document.getElementById('cl-burn-btn');
  btn.disabled = input.value.trim().toUpperCase() !== 'BURN';
  input.oninput = function () {
    btn.disabled = input.value.trim().toUpperCase() !== 'BURN';
  };
}

// ── instructions ──
function closeAccountIx(account, owner, programId) {
  const { PublicKey, TransactionInstruction } = w3();
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(account), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(owner), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(owner), isSigner: true, isWritable: false }
    ],
    data: new Uint8Array([9])   // CloseAccount
  });
}

/// BurnChecked rather than Burn: it carries the mint and decimals, so a
/// mismatch fails on chain instead of burning the wrong amount.
function burnCheckedIx(account, mint, owner, amountRaw, decimals, programId) {
  const { PublicKey, TransactionInstruction } = w3();
  const data = new Uint8Array(10);
  data[0] = 15;
  new DataView(data.buffer).setBigUint64(1, BigInt(amountRaw), true);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(account), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(owner), isSigner: true, isWritable: false }
    ],
    data: data
  });
}

/// A plain SOL transfer, written out by hand. web3.js 1.98's browser build
/// encodes the u64 lamport amount in SystemProgram.transfer through a helper
/// that reaches for Node's global Buffer, which browsers do not have — so it
/// threw "Buffer is not defined" and no cleanup could ever be sent.
/// Layout: u32 instruction index 2 (Transfer), then u64 lamports, little-endian.
function systemTransferIx(from, to, lamports) {
  const { PublicKey, TransactionInstruction } = w3();
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, BigInt(lamports), true);
  return new TransactionInstruction({
    programId: new PublicKey('11111111111111111111111111111111'),
    keys: [
      { pubkey: new PublicKey(from), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(to), isSigner: false, isWritable: true }
    ],
    data: data
  });
}

async function sendCleanupBatch(instructions, feeLamports) {
  const all = instructions.slice();
  // the fee rides in the same transaction as the closes that fund it, so it
  // is impossible to take a cut of rent that was never reclaimed
  if (feeLamports > 0 && clScan.treasury) {
    all.push(systemTransferIx(Wallet.pubkey, clScan.treasury, feeLamports));
  }
  return sendInstructions(all);
}

/// Points are worked out server-side from the instructions in the confirmed
/// transaction, so this only nudges it — nothing here decides the number.
async function awardCleanupPoints(signature, msg) {
  if (!FoxPoints.token) {
    if (msg) msg.innerHTML += ' <span style="color:var(--muted);font-weight:600">Sign in to earn Fox Points for tidying up.</span>';
    return;
  }
  try {
    const r = await FoxPoints.api('/api/cleanup/award', { method: 'POST', body: { signature: signature } });
    if (!r || r.error) return;
    if (r.player) { FoxPoints.server = r.player; FoxPoints.render(); }
    if (msg && r.awarded > 0) msg.innerHTML += ' <strong>+' + r.awarded + ' Fox Points</strong>';
    else if (msg && r.cappedOut) msg.innerHTML += ' <span style="color:var(--muted);font-weight:600">Daily points cap reached.</span>';
    renderLeaderboard();
  } catch (e) { /* the close succeeded; points are a bonus */ }
}

/// A cleanup that fails in someone's wallet cannot be reproduced from here, so
/// the error and where it was thrown are logged. "Buffer is not defined" had
/// to be chased blind; the stack would have named the file at once.
function reportCleanupFailure(e) {
  const m = String((e && e.message) || e || '');
  if (/reject|denied|cancell?ed/i.test(m)) return;
  const at = String((e && e.stack) || '').split('\n').slice(1, 3).map(function (l) { return l.trim(); }).join(' < ');
  try {
    fetch(POINTS_API + '/api/swap/failed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: ('cleanup: ' + m + (at ? ' @ ' + at : '')).slice(0, 300), wallet: Wallet.pubkey || null })
    });
  } catch (err) { /* never let reporting break the page */ }
}

async function closeEmpty() {
  const btn = document.getElementById('cl-close-btn');
  const msg = document.getElementById('cl-msg');
  msg.className = 'sw-msg';
  msg.textContent = '';
  const accounts = clEmptyAccounts();
  if (!accounts.length) return;

  btn.disabled = true;
  let done = 0;
  let lastSig = null;
  try {
    for (let i = 0; i < accounts.length; i += CLOSE_PER_TX) {
      const batch = accounts.slice(i, i + CLOSE_PER_TX);
      btn.textContent = 'Signing ' + (Math.floor(i / CLOSE_PER_TX) + 1) + ' of ' +
        Math.ceil(accounts.length / CLOSE_PER_TX) + '…';
      const ixs = batch.map(function (a) {
        return closeAccountIx(a.account, Wallet.pubkey, a.programId);
      });
      const rent = batch.reduce(function (s, a) { return s + a.rent; }, 0);
      lastSig = await sendCleanupBatch(ixs, Math.floor(rent * clScan.feePct / 100));
      if (lastSig) awardCleanupPoints(lastSig, null);
      done += batch.length;
    }
    msg.className = 'sw-msg good';
    msg.textContent = 'Closed ' + done + ' accounts. The rent is back in your wallet.';
    if (lastSig) awardCleanupPoints(lastSig, msg);
    await scanCleanup(true);
  } catch (e) {
    msg.className = 'sw-msg bad';
    msg.textContent = (done ? 'Closed ' + done + ' before stopping. ' : '') + friendlySwapError(e);
    reportCleanupFailure(e);
    btn.disabled = false;
    btn.textContent = 'Try again';
  }
}

/// No burn instruction here — CloseAccount alone unwraps and returns it.
async function unwrapSol() {
  const btn = document.getElementById('cl-wsol-btn');
  const msg = document.getElementById('cl-msg');
  msg.className = 'sw-msg';
  msg.textContent = '';
  const accounts = clWrappedSol();
  if (!accounts.length) return;
  btn.disabled = true;
  btn.textContent = 'Check your wallet…';
  try {
    const ixs = accounts.map(function (a) {
      return closeAccountIx(a.account, Wallet.pubkey, a.programId);
    });
    // the fee is on the rent deposit only, never on the unwrapped balance
    const rent = accounts.reduce(function (s, a) { return s + a.rent; }, 0);
    await sendCleanupBatch(ixs, Math.floor(rent * clScan.feePct / 100));
    msg.className = 'sw-msg good';
    msg.textContent = 'Unwrapped. The SOL is back in your wallet.';
    await scanCleanup(true);
  } catch (e) {
    msg.className = 'sw-msg bad';
    msg.textContent = friendlySwapError(e);
    reportCleanupFailure(e);
    btn.disabled = false;
  }
}

async function burnSelected() {
  const btn = document.getElementById('cl-burn-btn');
  const msg = document.getElementById('cl-msg');
  msg.className = 'sw-msg';
  msg.textContent = '';
  const chosen = clHeldAccounts().filter(function (a) { return clSelected[a.account]; });
  if (!chosen.length) return;

  btn.disabled = true;
  let done = 0;
  let lastSig = null;
  try {
    for (let i = 0; i < chosen.length; i += BURN_PER_TX) {
      const batch = chosen.slice(i, i + BURN_PER_TX);
      btn.textContent = 'Signing ' + (Math.floor(i / BURN_PER_TX) + 1) + ' of ' +
        Math.ceil(chosen.length / BURN_PER_TX) + '…';
      const ixs = [];
      batch.forEach(function (a) {
        ixs.push(burnCheckedIx(a.account, a.mint, Wallet.pubkey, a.amountRaw, a.decimals, a.programId));
        ixs.push(closeAccountIx(a.account, Wallet.pubkey, a.programId));
      });
      const rent = batch.reduce(function (s, a) { return s + a.rent; }, 0);
      lastSig = await sendCleanupBatch(ixs, Math.floor(rent * clScan.feePct / 100));
      done += batch.length;
      if (lastSig) awardCleanupPoints(lastSig, null);
    }
    msg.className = 'sw-msg good';
    msg.textContent = 'Burned and closed ' + done + '. Rent is back in your wallet.';
    document.getElementById('cl-confirm-input').value = '';
    await scanCleanup(true);
  } catch (e) {
    msg.className = 'sw-msg bad';
    msg.textContent = (done ? 'Finished ' + done + ' before stopping. ' : '') + friendlySwapError(e);
    reportCleanupFailure(e);
    btn.disabled = false;
    btn.textContent = 'Burn and close';
  }
}

// ── WALLET CLEANUP END ──
// ── SWAP ──
// Quotes and route-building go through the Worker, so the browser never
// talks to Jupiter directly and the CSP stays as tight as it is.
var swapTokens = null;
var swapQuote = null;
var swapSlippage = 'auto';   // or a number of basis points the person picked
var swapSpeed = (function () { try { return localStorage.getItem('sq.swap.speed') || 'normal'; } catch (e) { return 'normal'; } })();
// On unless this visitor has turned it off. A protected swap is sent privately
// so sandwich bots cannot trade around it, and costs 0.000005 SOL.
// Bot protection needs a wallet that will sign WITHOUT sending, because the
// page itself posts the signed bytes to Sender. A mobile wallet's in-app
// browser handles that badly: Solflare signs, shows the swap as complete,
// and the promise never comes back to the page — so nothing is ever sent
// and the page waits for a signature that was never broadcast.
//
// With protection off the wallet signs AND sends, which is the path mobile
// wallets are built around. So it defaults off where sign-only is the risk,
// and stays a choice: anyone who turns it on is remembered.
var SWAP_SIGN_TIMEOUT_MS = 45000;
function signOnlyIsRisky() {
  try {
    // No hover and no fine pointer is a touch device, which in practice
    // means a wallet's in-app browser rather than an extension.
    return !(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  } catch (e) { return false; }
}
var swapProtect = (function () {
  try {
    const saved = localStorage.getItem('sq.swap.protect');
    if (saved) return saved !== 'off';
  } catch (e) { /* storage unavailable; fall through to the default */ }
  return !signOnlyIsRisky();
})();
var swapTokenSeq = 0;
var swapDebounce = null;
var swapSeq = 0;
var swapPair = { in: null, out: null };
var swapPrices = {};
var swapQuoteAbort = null;   // the request in flight, so a stale one can be dropped
var pickerSide = null;
var pickerDebounce = null;
// Numbers, or null when unknown — plus the mints they were read for. Without
// those, a balance read for the previous tokens looks like a balance for the
// current ones, and a check against it compares one token's amount against
// another token's holdings. Changing tokens, or changing them while a read
// is still in flight, both land there.
var swapBalances = { in: null, out: null, inMint: null, outMint: null };
// What a swap must leave behind when it is SOL being sold: a transaction
// cannot be paid for out of a balance the swap itself consumed.
var SWAP_SOL_RESERVE = 0.01;
var swapHoldings = null;                     // the connected wallet's tokens, largest first
var swapHoldingsFor = undefined;             // which wallet those holdings belong to
var swapQuoteAt = 0;                         // when the price on screen was fetched
var swapQuoteKey = '';                       // the pair and amount that price is for
var swapShownOut = 0;                        // the output amount the customer last saw
var swapQuoting = false;
var swapBusy = false;                        // a swap is being built, signed or sent
var swapTicker = null;

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const QUOTE_REFRESH_MS = 15000;
// a price this much worse than the one on screen is shown before anyone signs
const PRICE_MOVED_PCT = 0.5;

function storedList(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function storeList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* private mode */ }
}
// just enough to put a token back on screen later
function tokenRecord(t) {
  return { mint: t.mint, symbol: t.symbol, name: t.name || '', decimals: t.decimals,
    icon: t.icon || null, verified: !!t.verified, warnings: t.warnings || [] };
}
function fmtAmount(n) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  if (Math.abs(n) >= 1e6) return n.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 1 ? 4 : 6 });
}
function fmtUsd(n) {
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadSwap() {
  if (swapTokens) { loadSwapHistory(); loadSwapLeaderboard(); return; }
  try {
    const res = await fetch(POINTS_API + '/api/swap/tokens');
    const d = await res.json();
    swapTokens = d.tokens;
  } catch (e) { return; }

  swapPair.in = swapTokens[0];   // SOL
  swapPair.out = swapTokens[1];  // USDC
  paintPair();
  setSlippage(swapSlippage);
  setSwapSpeed(swapSpeed);
  setSwapProtect(swapProtect);
  paintRecentPairs();

  const amt = document.getElementById('sw-in-amount');
  amt.addEventListener('input', function () {
    // a figure appears with the keystroke; the real quote replaces it
    showEstimate();
    clearTimeout(swapDebounce);
    swapDebounce = setTimeout(quoteSwap, 150);
  });
  amt.addEventListener('focus', function () { document.getElementById('sw-leg-in').classList.add('focus'); });
  amt.addEventListener('blur', function () { document.getElementById('sw-leg-in').classList.remove('focus'); });

  const search = document.getElementById('sw-search');
  search.addEventListener('input', function () {
    clearTimeout(pickerDebounce);
    pickerDebounce = setTimeout(runTokenSearch, 250);
  });

  refreshSwapBalance();
  refreshSwapPrices();
  loadSwapPoints().then(flushSwapPoints);
  if (!swapTicker) swapTicker = setInterval(tickSwapQuote, 1000);
  if (swapLinkPending) applySwapLink();
  loadSwapLeaderboard();
}

function paintPair() {
  document.getElementById('sw-in-token').textContent = swapPair.in.symbol;
  document.getElementById('sw-out-token').textContent = swapPair.out.symbol;
  paintSwapUnit();       // the toggle names whichever token is being sold
  renderTokenWarnings();
  loadTokenPanel();
}

/// Warnings travel with the token, so they show while it is selected — not
/// only in the list where they are easy to click past.
function renderTokenWarnings() {
  const box = document.getElementById('sw-warnbox');
  const all = [];
  for (const side of ['in', 'out']) {
    const t = swapPair[side];
    if (t && t.warnings && t.warnings.length) {
      all.push({ symbol: t.symbol, warnings: t.warnings });
    }
  }
  if (!all.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = all.map(function (t) {
    return '<strong>Care with ' + escapeHtml(t.symbol) + '</strong><ul>' +
      t.warnings.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('') + '</ul>';
  }).join('');
}

async function refreshSwapPrices() {
  if (!swapPair.in || !swapPair.out) return;
  try {
    const res = await fetch(POINTS_API + '/api/swap/prices?ids=' +
      swapPair.in.mint + ',' + swapPair.out.mint);
    const d = await res.json();
    swapPrices = d.prices || {};
  } catch (e) { swapPrices = {}; }
  paintUsd();
}

/// What the amount is roughly worth in the other token, from the prices the
/// page already holds. Shown the moment someone types, so the box is never
/// empty while the route is being found — and marked as an estimate, because
/// it knows nothing about liquidity, the route or the fee.
/// The amount box holds tokens unless someone asks for dollars. Everything
/// downstream — the quote, the estimate, the points, what gets recorded —
/// reads swapInputTokens() rather than the box, so there is exactly one
/// place where the unit is understood and no way for the two to disagree.
var swapUsdMode = false;

function swapInputTokens() {
  const raw = parseFloat(String(document.getElementById('sw-in-amount').value).replace(/,/g, ''));
  if (!(raw > 0)) return NaN;
  if (!swapUsdMode) return raw;
  const price = swapPrices[swapPair.in.mint];
  return price > 0 ? raw / price : NaN;
}

/// Switches the box between the token and dollars, converting what is
/// already typed so the swap being described does not change underneath.
function toggleSwapUnit() {
  const price = swapPrices[swapPair.in.mint];
  const box = document.getElementById('sw-in-amount');
  const msg = document.getElementById('sw-msg');
  if (!swapUsdMode && !(price > 0)) {
    msg.className = 'sw-msg';
    msg.textContent = 'No dollar price for ' + swapPair.in.symbol + ' yet — type the amount in ' + swapPair.in.symbol + '.';
    return;
  }
  const tokens = swapInputTokens();
  swapUsdMode = !swapUsdMode;
  if (tokens > 0 && price > 0) {
    box.value = swapUsdMode
      ? (tokens * price).toFixed(2)
      : trimNumber(tokens, swapPair.in.decimals);
  }
  paintSwapUnit();
  showEstimate();
  quoteSwap();
}

/// Drops trailing zeros without turning a small number into 0.
function trimNumber(n, decimals) {
  const d = Math.min(decimals === undefined ? 6 : decimals, 9);
  return String(Number(n.toFixed(d)));
}

function paintSwapUnit() {
  const btn = document.getElementById('sw-unit');
  const box = document.getElementById('sw-in-amount');
  if (!btn) return;
  btn.textContent = swapUsdMode ? '$' : swapPair.in.symbol;
  btn.classList.toggle('on', swapUsdMode);
  btn.title = swapUsdMode ? 'Type an amount of ' + swapPair.in.symbol + ' instead' : 'Type a dollar amount instead';
  box.placeholder = swapUsdMode ? '$0.00' : '0.00';
}

function showEstimate() {
  const outEl = document.getElementById('sw-out-amount');
  const raw = swapInputTokens();
  const inPrice = swapPrices[swapPair.in.mint], outPrice = swapPrices[swapPair.out.mint];
  if (!raw || raw <= 0 || !inPrice || !outPrice) {
    if (!swapQuote) { outEl.value = ''; outEl.classList.remove('est'); }
    paintUsd();
    return;
  }
  const est = raw * inPrice / outPrice;
  outEl.value = est.toLocaleString(undefined, { maximumFractionDigits: est >= 1000 ? 2 : 6 });
  outEl.classList.add('est');
  document.getElementById('sw-quoting').textContent = '· finding the best route…';
  paintUsd();
}

/// A rate in tokens means little; the dollar figure is how anyone actually
/// checks whether a swap is fair.
function paintUsd() {
  const set = function (elId, mint, amountStr) {
    const el = document.getElementById(elId);
    const price = swapPrices[mint];
    const amount = parseFloat(String(amountStr).replace(/,/g, ''));
    el.textContent = price && amount > 0
      ? '≈ $' + (amount * price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';
  };
  // In dollar mode the box already says the dollars, so the line below it
  // is only useful if it says how much of the token that buys.
  const inEl = document.getElementById('sw-in-usd');
  const tokens = swapInputTokens();
  if (swapUsdMode) {
    inEl.textContent = tokens > 0 ? '≈ ' + trimNumber(tokens, swapPair.in.decimals) + ' ' + swapPair.in.symbol : '';
  } else {
    set('sw-in-usd', swapPair.in.mint, document.getElementById('sw-in-amount').value);
  }
  set('sw-out-usd', swapPair.out.mint, document.getElementById('sw-out-amount').value);
}

// ── token picker ──
function openTokenPicker(side) {
  pickerSide = side;
  document.getElementById('sw-picker').hidden = false;
  const search = document.getElementById('sw-search');
  search.value = '';
  swapShowWorthless = false;
  renderPickerHome();
  // On a phone, focusing the box throws the keyboard up over the list —
  // so the first thing you see when picking a token is half a screen of
  // keyboard, and the tokens you actually hold are hidden behind it. The
  // list is the point; searching is the fallback. Focus only where a
  // keyboard is already there.
  if (hasRealKeyboard()) search.focus();
}

/// A mouse and a hover state mean a desktop, where focusing an input costs
/// nothing. Coarse pointers get the list instead.
function hasRealKeyboard() {
  return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/// Airdropped spam: not on Jupiter's verified list and worth under a cent.
/// An unverified token that has a real price is kept, since plenty of those
/// trade with real liquidity.
var swapShowWorthless = false;
function isWorthless(t) {
  return !t.verified && !(t.usd >= 0.01);
}

function toggleWorthless() {
  swapShowWorthless = !swapShowWorthless;
  renderPickerHome();
}

function closeTokenPicker() {
  document.getElementById('sw-picker').hidden = true;
  pickerSide = null;
}

/// Before anything is typed: what the wallet already holds, then favourites,
/// then tokens swapped recently, then the popular list.
function renderPickerHome() {
  const sections = [];
  if (Wallet.pubkey) {
    const all = swapHoldings ? swapHoldings.tokens : null;
    const worthless = all ? all.filter(isWorthless).length : 0;
    sections.push({
      title: 'Your tokens',
      tokens: all && !swapShowWorthless ? all.filter(function (t) { return !isWorthless(t); }) : all,
      hidden: worthless,
      empty: swapHoldings && swapHoldings.failed ? 'Could not read your wallet just now.' : 'No tokens in this wallet yet.'
    });
  }
  const favs = storedList('sq.swap.favs');
  if (favs.length) sections.push({ title: 'Favourites', tokens: favs });
  const recent = [];
  for (const p of storedList('sq.swap.pairs')) {
    for (const t of [p.in, p.out]) {
      if (t && !recent.some(function (r) { return r.mint === t.mint; })) recent.push(t);
    }
  }
  if (recent.length) sections.push({ title: 'Recent', tokens: recent.slice(0, 6) });
  sections.push({ title: 'Popular', tokens: swapTokens.map(function (t) { return Object.assign({ verified: true, warnings: [] }, t); }) });
  renderTokenResults(sections);
}

async function runTokenSearch() {
  const q = document.getElementById('sw-search').value.trim();
  const box = document.getElementById('sw-results');
  if (q.length < 2) { renderPickerHome(); return; }
  box.innerHTML = '<div class="sw-empty">Searching…</div>';
  try {
    const res = await fetch(POINTS_API + '/api/swap/search?q=' + encodeURIComponent(q));
    const d = await res.json();
    renderTokenResults([{ title: null, tokens: d.tokens || [],
      empty: 'Nothing found. Paste a mint address to look one up directly.' }]);
  } catch (e) {
    box.innerHTML = '<div class="sw-empty">Could not search just now.</div>';
  }
}

function renderTokenResults(sections) {
  const box = document.getElementById('sw-results');
  const flat = [];
  const favs = storedList('sq.swap.favs').map(function (f) { return f.mint; });
  const held = {};
  if (swapHoldings) for (const h of swapHoldings.tokens) held[h.mint] = h;

  let html = '';
  for (const s of sections) {
    if (s.title) html += '<div class="sw-section">' + escapeHtml(s.title) + '</div>';
    if (s.tokens === null) { html += '<div class="sw-empty">Reading your wallet…</div>'; continue; }
    const hiddenToggle = s.hidden
      ? '<button class="sw-hidden-toggle" type="button" onclick="toggleWorthless()">' +
        (swapShowWorthless ? 'Hide ' : 'Show ') + s.hidden + ' unverified token' + (s.hidden === 1 ? '' : 's') +
        ' with no value</button>'
      : '';
    if (!s.tokens.length) {
      html += hiddenToggle || '<div class="sw-empty">' + escapeHtml(s.empty || 'Nothing here yet.') + '</div>';
      continue;
    }
    for (const t of s.tokens) {
      const i = flat.push(t) - 1;
      const warn = (t.warnings || [])[0];
      const h = held[t.mint];
      const fav = favs.indexOf(t.mint) >= 0;
      html += '<div class="sw-result">' +
        '<button class="sw-result-pick" onclick="chooseToken(' + i + ')">' +
        (t.icon ? '<img src="' + escapeHtml(t.icon) + '" alt="" loading="lazy">' : '<img alt="">') +
        '<span class="sw-result-body">' +
        '<span class="sw-result-sym">' + escapeHtml(t.symbol || '?') +
        (t.verified ? '<span class="sw-tick" title="On Jupiter’s verified list">✓</span>' : '') + '</span>' +
        '<span class="sw-result-name">' + escapeHtml(t.name || '') + '</span>' +
        (warn ? '<span class="sw-result-warn">⚠ ' + escapeHtml(warn) + '</span>' : '') +
        '</span>' +
        (h ? '<span class="sw-result-bal">' + escapeHtml(fmtAmount(h.amount)) +
          (h.usd !== null && h.usd !== undefined ? '<small>' + fmtUsd(h.usd) + '</small>' : '') + '</span>' : '') +
        '</button>' +
        '<button class="sw-star' + (fav ? ' on' : '') + '" onclick="toggleFavourite(' + i + ')" ' +
        'aria-pressed="' + fav + '" aria-label="' + (fav ? 'Remove from' : 'Add to') + ' favourites">' +
        (fav ? '★' : '☆') + '</button></div>';
    }
    html += hiddenToggle;
  }
  box.innerHTML = html;
  box._list = flat;
  box._sections = sections;
}

/// Starred tokens are kept on this device and listed near the top of the picker.
function toggleFavourite(i) {
  const box = document.getElementById('sw-results');
  const t = box._list && box._list[i];
  if (!t) return;
  let favs = storedList('sq.swap.favs');
  favs = favs.some(function (f) { return f.mint === t.mint; })
    ? favs.filter(function (f) { return f.mint !== t.mint; })
    : [tokenRecord(t)].concat(favs).slice(0, 12);
  storeList('sq.swap.favs', favs);
  if (document.getElementById('sw-search').value.trim().length < 2) renderPickerHome();
  else renderTokenResults(box._sections);
}

function chooseToken(i) {
  const t = document.getElementById('sw-results')._list[i];
  if (!t) return;
  const other = pickerSide === 'in' ? 'out' : 'in';
  // choosing the token already on the other side just flips the pair
  if (swapPair[other] && swapPair[other].mint === t.mint) {
    swapPair[other] = swapPair[pickerSide];
  }
  swapPair[pickerSide] = t;
  closeTokenPicker();
  paintPair();
  refreshSwapBalance();
  refreshSwapPrices();
  quoteSwap();
}

// ── share links and receipts ──
var lastSwap = null;

function swapLinkFor(tIn, tOut, amount) {
  const popular = function (t) { return (swapTokens || []).some(function (p) { return p.mint === t.mint; }); };
  const part = function (t) { return popular(t) ? t.symbol : t.mint; };
  return 'https://solquicks.com/?swap=' + encodeURIComponent(part(tIn)) + '-' + encodeURIComponent(part(tOut)) +
    (amount > 0 ? '&amount=' + encodeURIComponent(String(amount)) : '');
}

/// Copies a link that opens this exact pair — and the amount, if one is typed.
async function shareSwapLink() {
  const msg = document.getElementById('sw-msg');
  if (!swapPair.in || !swapPair.out) return;
  const link = swapLinkFor(swapPair.in, swapPair.out, swapInputTokens());
  msg.dataset.kind = '';
  try {
    await navigator.clipboard.writeText(link);
    msg.className = 'sw-msg good';
    msg.textContent = 'Link copied: ' + link;
  } catch (e) {
    msg.className = 'sw-msg';
    msg.textContent = 'Copy this link: ' + link;
  }
}

async function swapLinkToken(ref) {
  const known = (swapTokens || []).find(function (t) { return t.symbol.toUpperCase() === ref.toUpperCase() || t.mint === ref; });
  if (known) return Object.assign({ verified: true, warnings: [] }, known);
  if (ref.length < 32) return null;
  const res = await fetch(POINTS_API + '/api/swap/token?mint=' + encodeURIComponent(ref));
  const d = await res.json().catch(function () { return {}; });
  if (!d.token) return null;
  const k = d.token;
  return { mint: k.mint, symbol: k.symbol, name: k.name, decimals: k.decimals, icon: k.icon, verified: k.verified, warnings: k.warnings || [] };
}

/// Opens a shared link on the pair it names. Tokens from outside the popular
/// list arrive with their warnings, exactly as if they had been searched for.
async function applySwapLink() {
  const link = swapLinkPending;
  swapLinkPending = null;
  // drop the link from the address, so a refresh keeps whatever pair is chosen next
  try { history.replaceState(null, '', location.pathname + '#swap'); } catch (e) {}
  const msg = document.getElementById('sw-msg');
  try {
    const both = await Promise.all([swapLinkToken(link.in), swapLinkToken(link.out)]);
    if (!both[0] || !both[1] || both[0].mint === both[1].mint) throw new Error('bad link');
    swapPair.in = both[0];
    swapPair.out = both[1];
    paintPair();
    refreshSwapBalance();
    refreshSwapPrices();
    if (link.amount) {
      document.getElementById('sw-in-amount').value = swapUsdMode && swapPrices[swapPair.in.mint] > 0
        ? (link.amount * swapPrices[swapPair.in.mint]).toFixed(2)
        : String(link.amount);
      quoteSwap();
    }
  } catch (e) {
    msg.className = 'sw-msg bad';
    msg.textContent = 'That swap link names a token that could not be found.';
  }
}

/// A card to post: what was swapped, its value, and any Fox Points earned.
async function openSwapReceipt() {
  if (!lastSwap) return;
  const r = lastSwap;
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const color = function (name, fallback) { return (css.getPropertyValue(name) || '').trim() || fallback; };
  try { await document.fonts.ready; } catch (e) {}

  g.fillStyle = color('--cream', '#F7F1E8');
  g.fillRect(0, 0, W, H);
  g.fillStyle = color('--card', '#FFFFFF');
  g.strokeStyle = color('--ink', '#2E2440');
  g.lineWidth = 6;
  const x0 = 50, y0 = 50, w = W - 100, h = H - 100, rad = 40;
  g.beginPath();
  g.moveTo(x0 + rad, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + h, rad); g.arcTo(x0 + w, y0 + h, x0, y0 + h, rad);
  g.arcTo(x0, y0 + h, x0, y0, rad); g.arcTo(x0, y0, x0 + w, y0, rad); g.closePath();
  g.fill(); g.stroke();

  const avatar = await new Promise(function (resolve) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { resolve(null); };
    img.src = 'avatar.png';
  });
  if (avatar) {
    g.save(); g.beginPath(); g.arc(200, 225, 90, 0, Math.PI * 2); g.clip();
    g.drawImage(avatar, 110, 135, 180, 180); g.restore();
  }
  const display = '"Baloo 2", system-ui, sans-serif';
  g.fillStyle = color('--orange', '#E3883A');
  g.font = '800 34px ' + display;
  g.fillText('SWAPPED ON SOLQUICKS.COM', 330, 190);
  g.fillStyle = color('--ink', '#2E2440');
  g.font = '800 64px ' + display;
  const line = fmtAmount(r.in.amount) + ' ' + r.in.symbol + '  →  ' + fmtAmount(r.out.amount) + ' ' + r.out.symbol;
  let size = 64;
  while (g.measureText(line).width > W - 420 && size > 30) { size -= 2; g.font = '800 ' + size + 'px ' + display; }
  g.fillText(line, 330, 275);
  g.fillStyle = color('--ink-soft', '#5B5170');
  g.font = '700 32px system-ui, sans-serif';
  if (r.usd) g.fillText('≈ ' + fmtUsd(r.usd), 330, 330);
  if (r.points > 0) {
    g.fillStyle = color('--green', '#3F9A5A');
    g.font = '800 44px ' + display;
    g.fillText('+' + r.points.toLocaleString() + ' Fox Points', 110, 450);
  }
  g.fillStyle = color('--muted', '#8B819D');
  g.font = '700 28px system-ui, sans-serif';
  g.fillText(new Date(r.at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + '  ·  @solquicks', 110, 530);

  const text = 'Just swapped ' + fmtAmount(r.in.amount) + ' ' + r.in.symbol + ' for ' + fmtAmount(r.out.amount) + ' ' + r.out.symbol +
    ' on solquicks.com' + (r.points > 0 ? ' and earned ' + r.points.toLocaleString() + ' Fox Points' : '') + ' 🦊';
  const backdrop = document.createElement('div');
  backdrop.className = 'rc-backdrop';
  backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
  const sheet = document.createElement('div');
  sheet.className = 'rc-sheet';
  const preview = document.createElement('img');
  preview.src = canvas.toDataURL('image/png');
  preview.alt = text;
  preview.className = 'rc-preview';
  const row = document.createElement('div');
  row.className = 'rc-actions';
  const post = document.createElement('a');
  post.className = 'sw-go rc-btn';
  post.textContent = 'Post on X';
  post.target = '_blank';
  post.rel = 'noopener noreferrer';
  post.href = 'https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(r.link);
  const save = document.createElement('a');
  save.className = 'sw-go rc-btn rc-ghost';
  save.textContent = 'Save image';
  save.download = 'solquicks-swap.png';
  save.href = preview.src;
  const close = document.createElement('button');
  close.className = 'rc-close';
  close.type = 'button';
  close.textContent = 'Close';
  close.onclick = function () { backdrop.remove(); };
  row.appendChild(post); row.appendChild(save);
  sheet.appendChild(preview); sheet.appendChild(row); sheet.appendChild(close);
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
}

/// Where the swap actually goes, e.g. "Raydium → Orca" or "Meteora 60% + Orca 40%".
function routeText(plan) {
  const steps = (plan || []).map(function (st) {
    const label = (st.swapInfo && st.swapInfo.label) || '?';
    return st.percent && st.percent < 100 ? label + ' ' + st.percent + '%' : label;
  });
  return steps.join(' → ');
}

function setSwapSpeed(speed) {
  swapSpeed = ['normal', 'fast', 'turbo'].indexOf(speed) >= 0 ? speed : 'normal';
  try { localStorage.setItem('sq.swap.speed', swapSpeed); } catch (e) {}
  document.querySelectorAll('.sw-speed button').forEach(function (b) {
    b.classList.toggle('on', b.dataset.speed === swapSpeed);
  });
}

/// `remember` only when the visitor chose: painting the buttons on load used to
/// write the default back, which would have pinned everyone to the old one.
function setSwapProtect(on, remember) {
  swapProtect = !!on;
  if (remember) { try { localStorage.setItem('sq.swap.protect', swapProtect ? 'on' : 'off'); } catch (e) {} }
  document.querySelectorAll('.sw-protect button').forEach(function (b) {
    b.classList.toggle('on', (b.dataset.protect === 'on') === swapProtect);
  });
}

function fmtCompactUsd(n) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  return '$' + Number(n).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
}

/// Market cap, liquidity, holders and the day's move for the token being bought.
async function loadTokenPanel() {
  const box = document.getElementById('sw-token');
  const t = swapPair.out;
  if (!box || !t) return;
  const seq = ++swapTokenSeq;
  try {
    const res = await fetch(POINTS_API + '/api/swap/token?mint=' + t.mint);
    const d = await res.json();
    if (seq !== swapTokenSeq) return;
    if (!d.token) { box.hidden = true; return; }
    const k = d.token;
    const change = k.change24h === null ? '' :
      '<span class="' + (k.change24h >= 0 ? 'sw-up' : 'sw-down') + '">' +
      (k.change24h >= 0 ? '+' : '') + k.change24h.toFixed(2) + '% 24h</span>';
    const price = k.price ? '$' + Number(k.price).toLocaleString(undefined, { maximumSignificantDigits: 4 }) : '–';
    box.innerHTML =
      '<div class="sw-token-head">' + (k.icon ? '<img src="' + escapeHtml(k.icon) + '" alt="" loading="lazy">' : '') +
      '<strong>' + escapeHtml(k.symbol || t.symbol) + '</strong>' +
      (k.verified ? '<span class="sw-tick" title="On Jupiter’s verified list">✓</span>' : '') +
      '<span class="sw-token-price">' + price + ' ' + change + '</span></div>' +
      '<div class="sw-token-stats">' +
      '<div><span>Market cap</span><b>' + fmtCompactUsd(k.mcap) + '</b></div>' +
      '<div><span>Liquidity</span><b>' + fmtCompactUsd(k.liquidity) + '</b></div>' +
      '<div><span>Holders</span><b>' + (k.holders ? Number(k.holders).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 }) : '–') + '</b></div>' +
      '</div>';
    box.hidden = false;
  } catch (e) { if (seq === swapTokenSeq) box.hidden = true; }
}

function tokenBy(mint) {
  if (swapPair.in && swapPair.in.mint === mint) return swapPair.in;
  if (swapPair.out && swapPair.out.mint === mint) return swapPair.out;
  return (swapTokens || []).find(function (t) { return t.mint === mint; });
}

function setSlippage(bps) {
  swapSlippage = bps;
  document.querySelectorAll('.sw-slip button[data-bps]').forEach(function (b) {
    b.classList.toggle('on', b.dataset.bps === String(bps));
  });
  if (bps !== 'auto') document.getElementById('sw-slip-auto').textContent = 'Auto';
  if (swapQuote) quoteSwap();
}

function flipSwap() {
  const tmp = swapPair.in;
  swapPair.in = swapPair.out;
  swapPair.out = tmp;
  paintPair();
  refreshSwapBalance();
  refreshSwapPrices();
  quoteSwap();
}

// ── recent pairs ──
/// The last few pairs actually swapped, one tap to set up again.
function rememberPair() {
  const pairs = storedList('sq.swap.pairs').filter(function (p) {
    return !(p.in.mint === swapPair.in.mint && p.out.mint === swapPair.out.mint);
  });
  pairs.unshift({ in: tokenRecord(swapPair.in), out: tokenRecord(swapPair.out) });
  storeList('sq.swap.pairs', pairs.slice(0, 4));
  paintRecentPairs();
}

function paintRecentPairs() {
  const box = document.getElementById('sw-recent');
  const pairs = storedList('sq.swap.pairs');
  box.hidden = !pairs.length;
  box.innerHTML = pairs.map(function (p, i) {
    return '<button class="sw-chip" onclick="useRecentPair(' + i + ')">' +
      escapeHtml(p.in.symbol) + ' → ' + escapeHtml(p.out.symbol) + '</button>';
  }).join('');
}

function useRecentPair(i) {
  const p = storedList('sq.swap.pairs')[i];
  if (!p) return;
  swapPair.in = p.in;
  swapPair.out = p.out;
  paintPair();
  refreshSwapBalance();
  refreshSwapPrices();
  quoteSwap();
}

// ── balances ──
/// Looks up token accounts by mint, which finds them under either token
/// program. Deriving the classic associated account instead is why a
/// Token-2022 token like PYUSD never showed a balance.
async function tokenBalance(owner, mint) {
  const { PublicKey } = w3();
  const conn = rpc();
  if (mint === SOL_MINT) return (await conn.getBalance(new PublicKey(owner))) / 1e9;
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
  let total = 0;
  for (const a of res.value) total += Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0);
  return total;
}

/// Both sides of the pair, read from the chain for just these two tokens so
/// they are right even a moment after a swap.
async function refreshSwapBalance() {
  const el = document.getElementById('sw-bal');
  const outEl = document.getElementById('sw-bal-out');
  const pcts = document.getElementById('sw-pcts');
  if (!el || !swapPair.in || !swapPair.out) return;
  if ((Wallet.pubkey || null) !== swapHoldingsFor) {   // a different wallet, or none
    loadSwapHoldings();
    loadSwapHistory();
  }
  if (!Wallet.pubkey) {
    swapBalances = { in: null, out: null, inMint: null, outMint: null };
    el.textContent = ''; el.onclick = null; outEl.textContent = ''; pcts.hidden = true;
    paintAfterSwap();
    return;
  }
  const owner = Wallet.pubkey, inMint = swapPair.in.mint, outMint = swapPair.out.mint;
  const both = await Promise.all([
    tokenBalance(owner, inMint).catch(function () { return null; }),
    tokenBalance(owner, outMint).catch(function () { return null; })
  ]);
  // the pair or the wallet may have changed while those were in flight
  if (owner !== Wallet.pubkey || inMint !== swapPair.in.mint || outMint !== swapPair.out.mint) return;
  swapBalances = { in: both[0], out: both[1], inMint: inMint, outMint: outMint };
  el.textContent = both[0] === null ? '' : 'Balance ' + fmtAmount(both[0]) + ' ' + swapPair.in.symbol;
  el.style.cursor = both[0] ? 'pointer' : '';
  el.onclick = both[0] ? function () { setSwapPct(100); } : null;
  pcts.hidden = !both[0];
  outEl.textContent = both[1] === null ? '' : 'You have ' + fmtAmount(both[1]) + ' ' + swapPair.out.symbol;
  paintAfterSwap();
  // The balance usually lands after the quote, so the button has to be
  // re-decided here too — otherwise an affordable-looking button survives
  // the moment we learn it is not.
  const go = document.getElementById('sw-go');
  if (go && swapQuote) {
    const cannot = swapAffordable();
    go.disabled = !!cannot;
    go.textContent = cannot || ('Swap ' + swapPair.in.symbol + ' for ' + swapPair.out.symbol);
  }
}

/// 25%, 50% or all of the balance. "All" of SOL leaves a little behind for
/// network fees, or the swap could not be paid for.
function setSwapPct(pct) {
  const bal = swapBalances.in;
  if (!bal) return;
  let amount = bal * pct / 100;
  if (swapPair.in.mint === SOL_MINT) amount = Math.min(amount, Math.max(0, bal - SWAP_SOL_RESERVE));
  const d = swapPair.in.decimals;
  // rounded down, so it can never be more than is actually there
  amount = Math.floor(amount * Math.pow(10, d)) / Math.pow(10, d);
  const price = swapPrices[swapPair.in.mint];
  document.getElementById('sw-in-amount').value = amount <= 0 ? ''
    : swapUsdMode && price > 0 ? (amount * price).toFixed(2)
    : amount.toFixed(d).replace(/\.?0+$/, '');
  showEstimate();        // the same instant figure as typing gives
  quoteSwap();
}

function paintAfterSwap() {
  const line = document.getElementById('sw-after-line');
  const el = document.getElementById('sw-after');
  if (!line) return;
  const raw = swapInputTokens();
  // Same staleness trap as the affordability check: a balance read for the
  // previous pair would be shown as this pair's.
  const known = swapBalances.inMint === swapPair.in.mint && swapBalances.outMint === swapPair.out.mint;
  if (!swapQuote || !known || swapBalances.in === null || swapBalances.out === null || !(raw > 0)) { line.hidden = true; return; }
  line.hidden = false;
  if (raw > swapBalances.in) {
    el.textContent = 'not enough ' + swapPair.in.symbol;
    el.classList.add('sw-warn');
    return;
  }
  el.classList.remove('sw-warn');
  const out = Number(swapQuote.outAmount) / Math.pow(10, swapPair.out.decimals);
  el.textContent = fmtAmount(swapBalances.in - raw) + ' ' + swapPair.in.symbol +
    ' · ' + fmtAmount(swapBalances.out + out) + ' ' + swapPair.out.symbol;
}

async function loadSwapHoldings(fresh) {
  const owner = Wallet.pubkey || null;
  swapHoldingsFor = owner;
  swapHoldings = null;
  if (!owner) return;
  try {
    const res = await fetch(POINTS_API + '/api/swap/holdings?wallet=' + owner + (fresh ? '&fresh=1' : ''));
    const d = await res.json();
    if (owner !== Wallet.pubkey) return;
    if (d.error) throw new Error(d.error);
    swapHoldings = {
      totalUsd: d.totalUsd,
      tokens: (d.tokens || []).map(function (t) {
        return Object.assign({}, t, { warnings: t.verified ? [] : ['Not on Jupiter’s verified list'] });
      })
    };
  } catch (e) {
    if (owner === Wallet.pubkey) swapHoldings = { tokens: [], totalUsd: 0, failed: true };
  }
  // the picker may be open and waiting on this
  if (pickerSide && document.getElementById('sw-search').value.trim().length < 2) renderPickerHome();
}

// ── history ──
/// Adds a swap to history. The chain may not have it the instant the wallet
/// confirms, so "not found yet" is retried a few times before giving up.
/// Hands the signature to the worker the moment it exists, so a swap that
/// really happened gets recorded even if this page never gets to finish.
///
/// Deliberately not awaited and deliberately silent: it must not slow the
/// swap down, and it must not be able to turn a successful swap into a
/// visible error. keepalive lets it survive the tab closing, which is the
/// case it exists for.
function registerPendingSwap(signature) {
  try {
    fetch(POINTS_API + '/api/swap/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: signature }),
      keepalive: true
    }).catch(function () {});
  } catch (e) { /* the sweep is a safety net, never a dependency */ }
}

async function recordSwap(signature) {
  for (const wait of [0, 3000, 8000, 20000]) {
    if (wait) await new Promise(function (r) { setTimeout(r, wait); });
    try {
      const res = await fetch(POINTS_API + '/api/swap/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: signature })
      });
      if (res.status !== 404) {
        const d = await res.json().catch(function () { return null; });
        if (d && d.swap && lastSwap && lastSwap.signature === signature) {
          lastSwap.in.amount = d.swap.in_amount;
          lastSwap.out.amount = d.swap.out_amount;
          if (d.swap.usd) lastSwap.usd = d.swap.usd;
        }
        break;
      }
    } catch (e) { /* try again */ }
  }
  loadSwapHistory();
  loadSwapLeaderboard();
}

/// This week's top swappers by volume through the site, with the prizes for
/// the top three and last week's winners.
async function loadSwapLeaderboard() {
  const box = document.getElementById('sw-board');
  if (!box) return;
  try {
    const res = await fetch(POINTS_API + '/api/swap/leaderboard');
    const d = await res.json();
    if (!d.top) return;
    const left = Math.max(0, d.weekEnd - Date.now());
    const days = Math.floor(left / 86400000), hours = Math.floor(left / 3600000) % 24;
    document.getElementById('sw-board-ends').textContent = '· ends in ' + (days ? days + 'd ' : '') + hours + 'h';
    const place = ['1st', '2nd', '3rd'];
    // The unit goes first. "1st 500 · 2nd 250 · 3rd 100 Fox Points" reads
    // as money for as long as it takes to reach the last two words, and
    // beside a column of dollar amounts that is long enough to mislead.
    document.getElementById('sw-board-prizes').textContent =
      'Fox Points: ' + d.prizes.map(function (p, i) { return place[i] + ' ' + p.toLocaleString(); }).join(' · ') +
      ' · at least $' + d.minUsd + ' of swaps to place';
    const list = document.getElementById('sw-board-list');
    // Say the number instead of naming a single wallet, and open the list
    // once there is a race worth showing.
    const RACE_NEEDS = BOARD_OPENS_AT;
    list.innerHTML = d.top.length && d.top.length < RACE_NEEDS
      ? '<div class="sw-empty">' + d.top.length + ' wallet' + (d.top.length === 1 ? '' : 's') +
        ' swapping this week. The board opens up as soon as somebody else joins — ' +
        '$' + d.minUsd + ' is all it takes to place.</div>'
      : d.top.length ? d.top.map(function (r) {
      const me = Wallet.pubkey && r.wallet === Wallet.pubkey;
      return '<div class="sw-hrow' + (me ? ' sw-board-me' : '') + '"><div>' +
        '<div class="sw-hpair"><span class="sw-board-rank">' + r.rank + '</span>' +
        (me ? 'You' : escapeHtml(r.wallet.slice(0, 4) + '…' + r.wallet.slice(-4))) +
        tierBadge(r.tier) + '</div>' +
        '<div class="sw-hmeta">' + r.swaps + ' swap' + (r.swaps === 1 ? '' : 's') + '</div></div>' +
        '<div class="sw-hright">' + fmtUsd(r.usd) +
        (r.rank <= d.prizes.length && r.usd >= d.minUsd ? '<span class="sw-hpts">+' + d.prizes[r.rank - 1].toLocaleString() + ' pts</span>' : '') +
        '</div></div>';
    }).join('') : '<div class="sw-empty">No swaps yet this week. First place is open.</div>';
    // Last week's winners are only worth naming if last week was a race.
    // One name here is the same problem as one name above.
    document.getElementById('sw-board-last').textContent = d.lastWeek.length >= RACE_NEEDS
      ? 'Last week: ' + d.lastWeek.map(function (r) { return place[r.rank - 1] + ' ' + r.wallet.slice(0, 4) + '…' + r.wallet.slice(-4); }).join(', ')
      : '';
    box.hidden = false;
  } catch (e) { /* the board is a bonus; swapping is unaffected */ }
}

/// A small mark beside a wallet on the leaderboard. Rangers get the rocket
/// they have always had a claim to; a collectible gets its own, smaller one.
function tierBadge(tier) {
  if (tier === 'ranger') return ' <span class="sw-badge" title="Moon Ranger holder">🦊</span>';
  if (tier === 'collectible') return ' <span class="sw-badge" title="solquicks soulbound holder">🚀</span>';
  return '';
}

async function loadSwapHistory() {
  const box = document.getElementById('sw-history');
  const owner = Wallet.pubkey;
  if (!box) return;
  if (!owner) { box.hidden = true; return; }
  try {
    const res = await fetch(POINTS_API + '/api/swap/history?wallet=' + owner);
    const d = await res.json();
    if (owner !== Wallet.pubkey) return;
    const rows = d.swaps || [];
    box.hidden = !rows.length;
    const title = box.querySelector('.sw-history-title');
    title.textContent = 'Your swaps';
    if (d.savedUsd > 0) {
      const saved = document.createElement('span');
      saved.className = 'sw-saving';
      saved.textContent = 'Saved ' + fmtUsd(d.savedUsd) + ' with your Moon Ranger discount';
      title.appendChild(saved);
    }
    swapHistoryRows = rows;
    paintSwapHistory();
  } catch (e) { /* history is a convenience; swapping is unaffected */ }
}

/// A long history pushed the week's top swappers off the screen, so only the
/// most recent few are shown until someone asks for the rest.
var swapHistoryOpen = false;
const SWAP_HISTORY_SHOWN = 5;
var swapHistoryRows = [];

function toggleSwapHistory() {
  swapHistoryOpen = !swapHistoryOpen;
  paintSwapHistory();
}

function paintSwapHistory() {
  const list = document.getElementById('sw-history-list');
  const more = document.getElementById('sw-history-more');
  const rows = swapHistoryRows;
  const shown = swapHistoryOpen ? rows : rows.slice(0, SWAP_HISTORY_SHOWN);
  const label = function (sym, mint) { return escapeHtml(sym || mint.slice(0, 4) + '…'); };
  list.innerHTML = shown.map(function (s) {
    const at = new Date(s.ts);
    const when = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' +
      at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return '<div class="sw-hrow"><div>' +
      '<div class="sw-hpair">' + escapeHtml(fmtAmount(s.in_amount)) + ' ' + label(s.in_symbol, s.in_mint) +
      ' → ' + escapeHtml(fmtAmount(s.out_amount)) + ' ' + label(s.out_symbol, s.out_mint) + '</div>' +
      '<div class="sw-hmeta">' + escapeHtml(when) + ' · <a href="https://solscan.io/tx/' +
      encodeURIComponent(s.signature) + '" target="_blank" rel="noopener noreferrer">view</a></div>' +
      '</div><div class="sw-hright">' + (s.usd !== null && s.usd !== undefined ? fmtUsd(s.usd) : '') +
      (s.points ? '<span class="sw-hpts">+' + Number(s.points).toLocaleString() + ' pts</span>' : '') +
      '</div></div>';
  }).join('');
  more.hidden = rows.length <= SWAP_HISTORY_SHOWN;
  more.textContent = swapHistoryOpen
    ? 'Show fewer'
    : 'Show all ' + rows.length + ' swaps';
}

// ── live price ──
/// Keeps the price on screen current: refreshed every 15 seconds while it is
/// being looked at, and not while a swap is under way or the tab is hidden.
function tickSwapQuote() {
  const btn = document.getElementById('sw-refresh');
  if (!btn) return;
  if (!swapQuote || swapBusy) { btn.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((swapQuoteAt + QUOTE_REFRESH_MS - Date.now()) / 1000));
  btn.textContent = '↻ ' + left + 's';
  const watched = document.visibilityState === 'visible' &&
    document.getElementById('panel-swap').classList.contains('active');
  if (left === 0 && watched && !pickerSide && !swapQuoting) quoteSwap({ auto: true });
}

// Two goes, spaced out, then it stops and leaves the button to the person.
// Retrying for ever against something that is rate limiting us is how a
// page makes its own problem worse.
const QUOTE_RETRY_MS = [1200, 3000];
var swapRetries = 0;
var swapRetryTimer = null;

function scheduleQuoteRetry(key) {
  clearTimeout(swapRetryTimer);
  if (swapRetries >= QUOTE_RETRY_MS.length) { swapRetries = 0; return; }
  const wait = QUOTE_RETRY_MS[swapRetries++];
  swapRetryTimer = setTimeout(function () {
    // Only if nothing has changed in the meantime: a new pair or amount
    // has its own quote on the way already.
    const now = swapPair.in.mint + '>' + swapPair.out.mint + ':' + swapInputTokens() + ':' + swapSlippage;
    if (now === key && !swapQuoting && !swapBusy) quoteSwap({ auto: true });
  }, wait);
}

/// Whether the typed amount can actually be paid, and what to say if not.
///
/// This did not exist, and its absence is what made a swap look broken. The
/// button stayed enabled for an amount the wallet did not hold, the wallet
/// refused to sign, and the message blamed "the swap plus network fees" —
/// which reads as a SOL problem to somebody holding plenty of SOL. Three
/// separate things had to be guessed at to work out that the input token
/// had simply run out.
///
/// `null` means go ahead. A string is the reason not to, written to name
/// the token that is short.
function swapAffordable() {
  const raw = swapInputTokens();
  // Only a balance read for the token currently being sold can answer this.
  // A read for a different mint is not a small inaccuracy — it is another
  // token's number, and acting on it either blocks a payable swap or allows
  // an unpayable one.
  const bal = swapBalances.inMint === swapPair.in.mint ? swapBalances.in : null;
  // Unknown is not the same as zero — no wallet connected, the read failed,
  // or the tokens just changed. Refusing on an unknown blocks a swap that
  // is perfectly payable.
  if (bal === null || !(raw > 0)) return null;
  if (raw > bal) {
    return 'Not enough ' + swapPair.in.symbol + ' — you have ' + fmtAmount(bal);
  }
  // Selling SOL has to leave enough behind to pay for the transaction, or
  // it cannot be sent at all. `setSwapPct` already reserves this; typing
  // the number by hand bypassed that.
  if (swapPair.in.mint === SOL_MINT && bal - raw < SWAP_SOL_RESERVE) {
    return 'Leave at least ' + SWAP_SOL_RESERVE + ' SOL for network fees';
  }
  return null;
}

async function quoteSwap(opts) {
  const auto = !!(opts && opts.auto);
  const tIn = swapPair.in;
  const tOut = swapPair.out;
  const raw = swapInputTokens();
  const go = document.getElementById('sw-go');
  const detail = document.getElementById('sw-detail');
  const msg = document.getElementById('sw-msg');
  const key = tIn.mint + '>' + tOut.mint + ':' + raw + ':' + swapSlippage;
  // a refresh leaves a success message alone; a new amount or pair clears everything
  if (!auto || msg.dataset.kind) { msg.textContent = ''; msg.className = 'sw-msg'; msg.dataset.kind = ''; }
  paintUsd();

  if (!raw || raw <= 0) {
    swapQuote = null;
    document.getElementById('sw-out-amount').classList.remove('est');
    document.getElementById('sw-out-amount').value = '';
    document.getElementById('sw-out-usd').textContent = '';
    detail.hidden = true;
    go.disabled = true;
    go.textContent = 'Enter an amount';
    paintAfterSwap();
    return;
  }

  const amount = Math.round(raw * Math.pow(10, tIn.decimals));
  const seq = ++swapSeq;
  swapQuoting = true;
  if (!auto) {
    document.getElementById('sw-quoting').textContent = '· finding the best route…';
    go.disabled = true;
  }

  // an older request still in flight is abandoned rather than allowed to
  // land on top of this one
  if (swapQuoteAbort) swapQuoteAbort.abort();
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  swapQuoteAbort = abort;

  try {
    const res = await fetch(POINTS_API + '/api/swap/quote?in=' + tIn.mint + '&out=' + tOut.mint +
      '&amount=' + amount + '&slippage=' + swapSlippage +
      (Wallet.pubkey ? '&wallet=' + Wallet.pubkey : ''), abort ? { signal: abort.signal } : undefined);
    const d = await res.json();
    if (seq !== swapSeq) return;   // a newer keystroke already won
    document.getElementById('sw-quoting').textContent = '';
    if (d.error) {
      const err = new Error(d.error);
      // The worker says which failures are worth another go. Being
      // throttled is; there being no route is not.
      err.retryable = !!d.retry || res.status === 429;
      throw err;
    }
    swapRetries = 0;

    const previous = swapQuoteKey === key ? swapShownOut : 0;
    swapQuote = d.quote;
    swapQuoteAt = Date.now();
    swapQuoteKey = key;
    swapShownOut = Number(d.quote.outAmount);
    const out = Number(d.quote.outAmount) / Math.pow(10, tOut.decimals);
    const min = Number(d.quote.otherAmountThreshold) / Math.pow(10, tOut.decimals);
    // whole-token precision is noise on a memecoin amount in the millions
    const places = function (n) { return { maximumFractionDigits: n >= 1000 ? 2 : 6 }; };
    const outEl = document.getElementById('sw-out-amount');
    outEl.value = out.toLocaleString(undefined, places(out));
    outEl.classList.remove('est');       // no longer an estimate
    paintUsd();

    const rate = out / raw;
    document.getElementById('sw-rate').textContent =
      '1 ' + tIn.symbol + ' ≈ ' + rate.toLocaleString(undefined, places(rate)) + ' ' + tOut.symbol;

    const impact = Number(d.quote.priceImpactPct) * 100;
    const impactEl = document.getElementById('sw-impact');
    impactEl.textContent = impact < 0.01 ? '<0.01%' : impact.toFixed(2) + '%';
    impactEl.classList.toggle('sw-warn', impact >= 1);

    document.getElementById('sw-min').textContent =
      min.toLocaleString(undefined, places(min)) + ' ' + tOut.symbol;

    // The quote always prices the fee in the output token, but it can be taken
    // from the token being sold instead — the server says which.
    const pf = d.quote.platformFee;
    const feeEl = document.getElementById('sw-fee');
    let feeText = 'none on this pair';
    if (d.feeLamports) {
      feeText = fmtAmount(d.feeLamports / 1e9) + ' SOL (' + (d.feeBps / 100) + '%)';
    } else if (pf && d.feeMint) {
      feeText = (d.feeMint === tIn.mint
        ? fmtAmount(raw * pf.feeBps / 10000) + ' ' + tIn.symbol
        : fmtAmount(Number(pf.amount) / Math.pow(10, tOut.decimals)) + ' ' + tOut.symbol) +
        ' (' + (pf.feeBps / 100) + '%)';
    }
    feeEl.textContent = feeText;
    // what a Moon Ranger saves on this swap, from the dollar value Jupiter reports
    if (d.holder && d.feeBps < d.fullFeeBps) {
      const savedUsd = Number(d.quote.swapUsdValue || 0) * (d.fullFeeBps - d.feeBps) / 10000;
      // Said as a percentage off, not in basis points: "50% off" is a
      // discount anyone can weigh, "10 bps" is a unit you have to know.
      const off = Math.round((1 - d.feeBps / d.fullFeeBps) * 100);
      const who = d.tier === 'collectible' ? 'Collectible' : 'Moon Ranger';
      const note = document.createElement('span');
      note.className = 'sw-saving';
      note.textContent = who + ' ' + off + '% off' + (savedUsd > 0
        ? ', saving ' + (savedUsd < 0.01 ? 'under $0.01' : fmtUsd(savedUsd)) : '');
      feeEl.appendChild(note);
    }

    document.getElementById('sw-route').textContent = routeText(d.quote.routePlan);
    document.getElementById('sw-route-line').hidden = !(d.quote.routePlan || []).length;
    if (d.autoSlippage) document.getElementById('sw-slip-auto').textContent = 'Auto · ' + (d.slippageBps / 100) + '%';

    paintSwapPoints();
    paintAfterSwap();
    detail.hidden = false;
    // The quote is good; whether it can be paid for is a separate question,
    // and the button is where the answer belongs. Showing a price and then
    // letting the wallet do the refusing is how this looked broken.
    const cannot = swapAffordable();
    go.disabled = !!cannot;
    go.textContent = cannot || ('Swap ' + tIn.symbol + ' for ' + tOut.symbol);

    if (previous && swapShownOut < previous * (1 - PRICE_MOVED_PCT / 100)) {
      const drop = (1 - swapShownOut / previous) * 100;
      msg.className = 'sw-msg sw-moved';
      msg.dataset.kind = 'moved';
      msg.textContent = 'The price moved: you would now receive ' + fmtAmount(out) + ' ' + tOut.symbol +
        ', ' + drop.toFixed(1) + '% less than a moment ago.';
    } else if (impact >= 3) {
      msg.className = 'sw-msg bad';
      msg.dataset.kind = 'impact';
      msg.textContent = 'Price impact is ' + impact.toFixed(1) + '% — that is a lot. Try a smaller amount.';
    }
  } catch (e) {
    // a request abandoned because a newer keystroke replaced it is not a failure
    if (e && (e.name === 'AbortError' || /abort/i.test(e.message || ''))) return;
    if (seq !== swapSeq) return;
    document.getElementById('sw-quoting').textContent = '';

    // A dropped connection is as temporary as being throttled, and the
    // page cannot tell them apart from here.
    const temporary = !!(e && e.retryable) || (e instanceof TypeError);

    // A refresh that failed for a temporary reason leaves the quote that
    // is already on screen alone. It was good a second ago, and blanking a
    // working swap into "No route" turns a hiccup into a dead end — which
    // is exactly what people were hitting, and refreshing to get past.
    if (temporary && swapQuote && swapQuoteKey === key) {
      msg.className = 'sw-msg';
      // Marked, so the quote that succeeds after this one clears it. An
      // empty kind means "nothing to clear", and the notice would have
      // stayed on screen over a price that had already recovered.
      msg.dataset.kind = 'busy';
      msg.textContent = 'Busy for a moment — the price above is from ' +
        Math.max(1, Math.round((Date.now() - swapQuoteAt) / 1000)) + 's ago.';
      scheduleQuoteRetry(key);
      paintAfterSwap();
      return;
    }

    swapQuote = null;
    detail.hidden = true;
    go.disabled = true;
    // Never leave the old figure sitting under an error: it is the number
    // somebody would act on, and it is no longer being offered.
    const outEl = document.getElementById('sw-out-amount');
    outEl.value = '';
    outEl.classList.remove('est');
    document.getElementById('sw-out-usd').textContent = '';

    go.textContent = temporary ? 'Try again' : 'No route';
    msg.className = 'sw-msg bad';
    msg.dataset.kind = 'error';
    msg.textContent = e.message || 'Could not price that swap.';
    if (temporary) scheduleQuoteRetry(key);
    paintAfterSwap();
  } finally {
    if (seq === swapSeq) swapQuoting = false;
  }
}

var swapPointsInfo = null;

async function loadSwapPoints() {
  if (!FoxPoints.token) { swapPointsInfo = null; return; }
  try {
    const r = await FoxPoints.api('/api/swap/points');
    swapPointsInfo = r && !r.error ? r : null;
  } catch (e) { swapPointsInfo = null; }
}

/// Says what the swap is worth in points before it happens — the reason to
/// swap here rather than anywhere else should not be a surprise afterwards.
function paintSwapPoints() {
  const el = document.getElementById('sw-points');
  if (!el) return;
  const price = swapPrices[swapPair.in.mint];
  const raw = swapInputTokens();
  const usd = price && raw > 0 ? raw * price : 0;

  if (!FoxPoints.token) { el.textContent = 'sign in to earn'; return; }
  if (!swapPointsInfo) { el.textContent = '–'; return; }
  if (!usd) { el.textContent = '–'; return; }
  if (usd < swapPointsInfo.minUsd) {
    el.textContent = 'none under $' + swapPointsInfo.minUsd;
    return;
  }
  const earn = Math.min(swapPointsInfo.remaining, Math.round(usd * swapPointsInfo.perUsd));
  el.textContent = earn > 0
    ? '+' + earn.toLocaleString()
    : 'daily cap reached';
}

/// A swap can land while the page is signed out, or while confirmation is
/// still timing out. Park the signature and settle up later rather than
/// silently dropping points somebody earned.
function queueSwapPoints(signature) {
  try {
    const q = JSON.parse(localStorage.getItem('fox.swapPointsQueue') || '[]');
    if (q.indexOf(signature) < 0) q.push(signature);
    localStorage.setItem('fox.swapPointsQueue', JSON.stringify(q.slice(-20)));
  } catch (e) { /* private mode */ }
}

function dequeueSwapPoints(signature) {
  try {
    const q = JSON.parse(localStorage.getItem('fox.swapPointsQueue') || '[]');
    localStorage.setItem('fox.swapPointsQueue',
      JSON.stringify(q.filter(function (s) { return s !== signature; })));
  } catch (e) { /* private mode */ }
}

async function flushSwapPoints() {
  if (!FoxPoints.token) return;
  let q;
  try { q = JSON.parse(localStorage.getItem('fox.swapPointsQueue') || '[]'); } catch (e) { return; }
  if (!q.length) return;
  const left = [];
  for (const sig of q) {
    try {
      const r = await FoxPoints.api('/api/swap/award', { method: 'POST', body: { signature: sig } });
      // a transient failure keeps its place in the queue; a rejection does not
      if (!r || (r.error && /not found yet/i.test(r.error))) left.push(sig);
      else if (r && r.player) { FoxPoints.server = r.player; FoxPoints.render(); }
    } catch (e) { left.push(sig); }
  }
  try { localStorage.setItem('fox.swapPointsQueue', JSON.stringify(left)); } catch (e) {}
  await loadSwapPoints();
  paintSwapPoints();
}

/// Points are worked out server-side from what the chain says was spent, so
/// this call only nudges it — nothing here decides the number.
async function awardSwapPoints(signature, msg) {
  queueSwapPoints(signature);
  if (!FoxPoints.token) {
    msg.innerHTML += ' <span style="color:var(--muted);font-weight:600">Sign in and these points are added automatically.</span>';
    return;
  }
  try {
    const r = await FoxPoints.api('/api/swap/award', { method: 'POST', body: { signature: signature } });
    if (!r || r.error) return;
    if (r.player) { FoxPoints.server = r.player; FoxPoints.render(); }
    dequeueSwapPoints(signature);
    await loadSwapPoints();
    paintSwapPoints();
    if (r.awarded > 0) {
      if (lastSwap && lastSwap.signature === signature) lastSwap.points = r.awarded;
      msg.innerHTML += ' <strong>+' + r.awarded + ' Fox Points</strong>';
    } else if (r.cappedOut) {
      msg.innerHTML += ' <span style="color:var(--muted);font-weight:600">Daily points cap reached.</span>';
    } else if (r.note) {
      msg.innerHTML += ' <span style="color:var(--muted);font-weight:600">' + escapeHtml(r.note) + '</span>';
    }
    renderLeaderboard();
  } catch (e) { /* the swap succeeded; points are a bonus */ }
}

async function doSwap() {
  const go = document.getElementById('sw-go');
  const msg = document.getElementById('sw-msg');
  if (!swapQuote || swapBusy) return;
  msg.className = 'sw-msg';
  msg.textContent = '';
  msg.dataset.kind = '';

  if (!Wallet.pubkey) {
    try { await connectWallet(); } catch (e) { /* closed the picker */ }
    if (!Wallet.pubkey) {
      msg.className = 'sw-msg bad';
      msg.textContent = 'Connect a wallet to swap.';
      return;
    }
    refreshSwapBalance();
  }

  // Checked again here, not only on the button. Connecting a wallet is what
  // first tells us the balance, and it happens on the click itself — so the
  // button was painted before anything was known about what it could pay.
  const cannot = swapAffordable();
  if (cannot) {
    msg.className = 'sw-msg bad';
    msg.textContent = cannot + '.';
    go.disabled = true;
    go.textContent = cannot;
    return;
  }

  go.disabled = true;
  swapBusy = true;
  try {
    // A price the customer looked at a while ago is checked again before they
    // sign. If it has got meaningfully worse, they see the new one and tap again.
    if (Date.now() - swapQuoteAt > QUOTE_REFRESH_MS) {
      go.textContent = 'Checking the price…';
      swapBusy = false;
      await quoteSwap({ auto: true });
      swapBusy = true;
      if (!swapQuote || msg.dataset.kind === 'moved') return;
      go.disabled = true;
    }
    go.textContent = 'Building route…';
    const res = await fetch(POINTS_API + '/api/swap/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quote: swapQuote, user: Wallet.pubkey, speed: swapSpeed })
    });
    const d = await res.json();
    if (d.requote) {
      // the quote was made for a different fee rate than this wallet gets —
      // typically a Moon Ranger discount picked up after connecting
      await quoteSwap();
      msg.className = 'sw-msg sw-moved';
      msg.dataset.kind = 'moved';
      msg.textContent = 'The price was refreshed with your fee rate. Check it and tap swap again.';
      return;
    }
    if (d.error) throw new Error(d.error);

    // Every step used to show "Check your wallet…", so a hang at signing, at
    // sending and at confirming all looked identical — which is why a swap
    // that never left the browser read the same as one waiting on the chain.
    const step = function (t) { go.textContent = t; };
    step('Check your wallet…');
    let sig;
    try {
      const extras = await swapFeeInstructions(d.feeTransfer);
      sig = swapProtect
        ? await sendProtectedSwap(d.swapTransaction, d.lastValidBlockHeight, extras, step)
        : await sendVersionedTx(await swapWithFee(d.swapTransaction, extras), d.lastValidBlockHeight, step);
    } catch (sendErr) {
      // A wallet that never answered submitted nothing, so this must not be
      // dressed up as "sent" — there is no signature to check and no swap
      // to record. It gets the plain message below instead.
      if (sendErr && sendErr.signTimedOut) {
        msg.className = 'sw-msg bad';
        msg.textContent = sendErr.message;
        go.textContent = 'Swap';
        return;                      // the finally re-enables the button
      }
      // If it reached the network, the swap may well have landed — saying
      // "failed" when the money already moved is the worst outcome here.
      if (sendErr && sendErr.sentSignature) {
        msg.className = 'sw-msg';
        msg.innerHTML = 'Sent, but confirmation timed out. ' +
          '<a href="https://solscan.io/tx/' + encodeURIComponent(sendErr.sentSignature) +
          '" target="_blank" rel="noopener noreferrer">Check it here</a> before trying again.';
        awardSwapPoints(sendErr.sentSignature, msg);
        recordSwap(sendErr.sentSignature);
        go.textContent = 'Swap';
        go.disabled = false;
        return;
      }
      throw sendErr;
    }
    lastSwap = {
      signature: sig, at: Date.now(), points: 0,
      in: { symbol: swapPair.in.symbol, amount: swapInputTokens() },
      out: { symbol: swapPair.out.symbol, amount: Number(swapQuote.outAmount) / Math.pow(10, swapPair.out.decimals) },
      usd: Number(swapQuote.swapUsdValue) || null,
      link: swapLinkFor(swapPair.in, swapPair.out)
    };
    msg.className = 'sw-msg good';
    msg.innerHTML = 'Swapped. <a href="https://solscan.io/tx/' + encodeURIComponent(sig) +
      '" target="_blank" rel="noopener noreferrer">View it</a> · ' +
      '<button class="sw-inline" type="button" onclick="openSwapReceipt()">Share receipt</button>';
    awardSwapPoints(sig, msg);
    recordSwap(sig);
    rememberPair();
    document.getElementById('sw-in-amount').value = '';
    document.getElementById('sw-out-amount').value = '';
    document.getElementById('sw-detail').hidden = true;
    swapQuote = null;
    go.textContent = 'Swap again';
    refreshSwapBalance();
    loadSwapHoldings(true);
  } catch (e) {
    msg.className = 'sw-msg bad';
    msg.textContent = friendlySwapError(e);
    offerSlippageFix(e);
    go.textContent = 'Try again';
    reportSwapFailure(e);
  } finally {
    swapBusy = false;
    go.disabled = false;
  }
}

/// A pair with no fee account pays the fee as SOL sent to the treasury. The
/// worker sets the amount; the page only checks the wallet can afford it with
/// room left for network fees and new token accounts. If not, the swap still
/// goes through, without the fee.
const SWAP_SOL_RESERVE_LAMPORTS = 5000000;
async function swapFeeInstructions(feeTransfer) {
  if (!feeTransfer || !(feeTransfer.lamports > 0) || !feeTransfer.to) return [];
  const sol = await tokenBalance(Wallet.pubkey, SOL_MINT).catch(function () { return null; });
  if (sol === null || sol * 1e9 < feeTransfer.lamports + SWAP_SOL_RESERVE_LAMPORTS) return [];
  return [systemTransferIx(Wallet.pubkey, feeTransfer.to, feeTransfer.lamports)];
}

/// Silent failures cannot be fixed. Cancellations are not failures, so they
/// are not reported.
function reportSwapFailure(e) {
  const m = String((e && e.message) || e || '');
  if (/reject|denied|cancell?ed/i.test(m)) return;
  try {
    fetch(POINTS_API + '/api/swap/failed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: m.slice(0, 300),
        inMint: swapPair.in && swapPair.in.mint,
        outMint: swapPair.out && swapPair.out.mint,
        wallet: Wallet.pubkey || null
      })
    });
  } catch (err) { /* never let reporting break the page */ }
}

/// Jupiter hands back a ready-made versioned transaction; all we do is get
/// it signed and wait for the chain to agree.
async function sendVersionedTx(base64, lastValidBlockHeight, step) {
  step = step || function () {};
  const { Connection, VersionedTransaction, PublicKey } = w3();
  const provider = Wallet.active;
  if (!provider) throw new Error('Connect a wallet first.');

  const bytes = Uint8Array.from(atob(base64), function (c) { return c.charCodeAt(0); });
  const tx = VersionedTransaction.deserialize(bytes);
  const connection = rpc();

  let signature;
  if (provider.kind === 'privy') {
    const out = await Privy.provider.request({
      method: 'signAndSendTransaction', params: { transaction: tx, connection: connection } });
    signature = signatureOf(out.signature);
  } else if (provider.kind === 'injected' && provider.w.signAndSendTransaction) {
    const res = await provider.w.signAndSendTransaction(tx);
    signature = signatureOf(res.signature || res);
  } else if (provider.kind === 'injected' && provider.w.signTransaction) {
    // Sign-only here too, so the same watchdog applies: nothing has been
    // submitted while we are waiting, so giving up is safe.
    const signed = await Promise.race([
      provider.w.signTransaction(tx),
      new Promise(function (_, reject) {
        setTimeout(function () {
          const e = new Error('Your wallet did not send the signed swap back, so nothing ' +
            'was submitted and nothing was taken. Try again.');
          e.signTimedOut = true;
          reject(e);
        }, SWAP_SIGN_TIMEOUT_MS);
      })
    ]);
    step('Sending…');
    signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  } else if (provider.kind === 'standard') {
    const feat = provider.w.features['solana:signAndSendTransaction'];
    if (!feat) throw new Error('This wallet cannot send transactions.');
    const out = await feat.signAndSendTransaction({
      account: walletAccount(provider),
      chain: 'solana:mainnet',
      transaction: tx.serialize()
    });
    signature = signatureOf(out[0].signature);
  } else {
    throw new Error('This wallet cannot send transactions.');
  }

  step('Confirming…');
  registerPendingSwap(signature);
  // confirm against the blockhash the transaction was built with, not a
  // fresh one fetched after sending
  try {
    await confirmSignature(connection, signature, lastValidBlockHeight);
  } catch (e) {
    // carry the signature out so the caller can tell "maybe landed" from
    // "definitely did not"
    e.sentSignature = signature;
    throw e;
  }
  return signature;
}

/// Bot protection. A normal send goes out through public RPC, where a sandwich
/// bot can see the swap before it lands and trade around it. With protection on,
/// the swap gets a small tip added and goes through Helius Sender with
/// mev-protect, which only hands it to validators that do not sandwich.
/// It needs a wallet that can sign without sending, and the extra instruction
/// has to fit; when either fails the swap goes the normal way instead.
const SENDER_URL = 'https://sender.helius-rpc.com/fast?swqos_only=true&mev-protect=true';
const SENDER_TIP_LAMPORTS = 5000;
const SENDER_TIP_ACCOUNTS = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE', 'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta', '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD', '2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ',
  'wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF', '3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT',
  '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey', '4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or'
];

function signOnlyFor(provider) {
  if (provider.kind === 'privy') {
    return async function (tx) {
      const out = await Privy.provider.request({
        method: 'signTransaction', params: { transaction: tx } });
      return out.signedTransaction.serialize();
    };
  }
  if (provider.kind === 'injected' && provider.w.signTransaction) {
    return async function (tx) { return (await provider.w.signTransaction(tx)).serialize(); };
  }
  const feat = provider.kind === 'standard' && provider.w.features['solana:signTransaction'];
  if (feat) {
    return async function (tx) {
      const out = await feat.signTransaction({
        account: walletAccount(provider),
        chain: 'solana:mainnet',
        transaction: tx.serialize()
      });
      return out[0].signedTransaction;
    };
  }
  return null;
}

/// Address lookup tables, decoded by hand: web3.js's own decoder reaches for
/// Node's Buffer, which browsers do not have. An account is a 56-byte header
/// followed by the addresses, 32 bytes each. Null for anything that is not one.
async function lookupTables(keys) {
  const { AddressLookupTableAccount, PublicKey } = w3();
  if (!keys.length) return [];
  const res = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'alt', method: 'getMultipleAccounts',
      params: [keys.map(function (k) { return k.toBase58(); }), { encoding: 'base64' }]
    })
  });
  const data = await res.json();
  if (!data.result) return null;
  const tables = data.result.value.map(function (acct, i) {
    if (!acct || acct.owner !== 'AddressLookupTab1e1111111111111111111111111') return null;
    const bytes = Uint8Array.from(atob(acct.data[0]), function (c) { return c.charCodeAt(0); });
    if (bytes.length < 56 || (bytes.length - 56) % 32 !== 0) return null;
    const addresses = [];
    for (let o = 56; o < bytes.length; o += 32) addresses.push(new PublicKey(bytes.slice(o, o + 32)));
    return new AddressLookupTableAccount({ key: keys[i], state: { addresses: addresses } });
  });
  return tables.some(function (t) { return !t; }) ? null : tables;
}

/// Unpacks Jupiter's transaction, appends instructions of our own (a SOL fee,
/// a Sender tip) and packs it again. Returns null when it cannot be done safely.
async function withInstructions(base64, extras) {
  const { TransactionMessage, VersionedTransaction } = w3();
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64), function (c) { return c.charCodeAt(0); }));
  const tables = await lookupTables(tx.message.addressTableLookups.map(function (l) { return l.accountKey; }));
  if (!tables) return null;
  const message = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: tables });
  if (message.payerKey.toBase58() !== Wallet.pubkey) return null;
  for (const ix of extras) message.instructions.push(ix);
  const repacked = new VersionedTransaction(message.compileToV0Message(tables));
  if (repacked.serialize().length > 1232) return null;
  return repacked;
}

function txBase64(tx) {
  let binary = '';
  for (const b of tx.serialize()) binary += String.fromCharCode(b);
  return btoa(binary);
}

/// The swap as it goes to the wallet: Jupiter's transaction, plus the SOL fee
/// when the pair pays one. If it cannot be added, the swap goes without it.
async function swapWithFee(base64, extras) {
  if (!extras.length) return base64;
  const tx = await withInstructions(base64, extras).catch(function () { return null; });
  return tx ? txBase64(tx) : base64;
}

/// `step` reports progress to the button, so a hang is attributable to the
/// stage it happened in rather than looking the same everywhere.
async function sendProtectedSwap(base64, lastValidBlockHeight, extras, step) {
  extras = extras || [];
  step = step || function () {};
  const provider = Wallet.active;
  if (!provider) throw new Error('Connect a wallet first.');
  const sign = signOnlyFor(provider);
  let tx = null;
  if (sign) {
    const tipTo = SENDER_TIP_ACCOUNTS[Math.floor(Math.random() * SENDER_TIP_ACCOUNTS.length)];
    const tip = systemTransferIx(Wallet.pubkey, tipTo, SENDER_TIP_LAMPORTS);
    try { tx = await withInstructions(base64, extras.concat([tip])); } catch (e) { tx = null; }
  }
  if (!tx) return sendVersionedTx(await swapWithFee(base64, extras), lastValidBlockHeight);

  // A wallet that never answers used to leave the page waiting forever. The
  // transaction is not sent until the bytes come back, so a timeout here is
  // safe: nothing has left the wallet and nothing can land later.
  const signed = await Promise.race([
    sign(tx),
    new Promise(function (_, reject) {
      setTimeout(function () {
        const e = new Error(
          'Your wallet did not send the signed swap back, so nothing was submitted and ' +
          'nothing was taken. This is what bot protection costs on a phone — it needs the ' +
          'wallet to sign without sending, which mobile wallets often do not return. ' +
          'Turn bot protection off and try again.');
        e.signTimedOut = true;
        reject(e);
      }, SWAP_SIGN_TIMEOUT_MS);
    })
  ]);
  step('Sending…');
  const signature = b58encode(w3().VersionedTransaction.deserialize(signed).signatures[0]);
  let binary = '';
  for (const b of signed) binary += String.fromCharCode(b);
  const wire = btoa(binary);
  const toSender = function () {
    return fetch(SENDER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: '1', method: 'sendTransaction',
        params: [wire, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]
      })
    }).then(function (r) { return r.json(); });
  };

  let accepted;
  try { accepted = !(await toSender()).error; } catch (e) { accepted = false; }
  if (!accepted) {
    // already signed, so the same bytes through the normal route cannot land twice
    await rpc().sendRawTransaction(signed, { maxRetries: 3 });
  }
  step('Confirming…');
  registerPendingSwap(signature);

  // Sender does not retry on its own; keep offering it until it lands
  let settled = false;
  if (accepted) {
    (async function () {
      for (let i = 0; i < 15 && !settled; i++) {
        await new Promise(function (r) { setTimeout(r, 2000); });
        if (!settled) toSender().catch(function () {});
      }
    })();
  }
  try {
    await confirmSignature(rpc(), signature, lastValidBlockHeight);
  } catch (e) {
    e.sentSignature = signature;
    throw e;
  } finally {
    settled = true;
  }
  return signature;
}

/// Swap failures are mostly slippage, and the raw program error says nothing
/// useful about that.
/// A swap refused for slippage is one setting away from working, and that
/// setting is at the bottom of a panel most people never open. When that
/// is the reason, put the fix in the message itself — one step up from
/// wherever it is now, never past 3%, and it re-prices immediately so the
/// new tolerance is visible before anything is signed again.
const SLIPPAGE_STEPS = [50, 100, 300];

function offerSlippageFix(e) {
  const m = String((e && e.message) || e || '');
  if (!/0x1771|slippage|SlippageToleranceExceeded/i.test(m)) return;
  const current = swapSlippage === 'auto' ? (swapQuote && swapQuote.slippageBps) || 50 : swapSlippage;
  const next = SLIPPAGE_STEPS.find(function (bps) { return bps > current; });
  if (!next) return;

  const msg = document.getElementById('sw-msg');
  const btn = document.createElement('button');
  btn.className = 'sw-fixbtn';
  btn.type = 'button';
  btn.textContent = 'Allow ' + (next / 100) + '% and re-price';
  btn.onclick = function () {
    setSlippage(next);
    msg.textContent = 'Max slippage is now ' + (next / 100) + '%. Check the new price, then swap.';
    msg.className = 'sw-msg';
  };
  msg.appendChild(document.createElement('br'));
  msg.appendChild(btn);
}

function friendlySwapError(e) {
  const m = String((e && e.message) || e || '');
  if (/reject|denied|cancell?ed/i.test(m)) return 'You cancelled that in your wallet — nothing was swapped.';
  if (/0x1771|slippage|SlippageToleranceExceeded/i.test(m)) {
    return 'The price moved more than your slippage allowed, so the swap was cancelled to protect you. ' +
      'Nothing was taken. Try again, or raise max slippage.';
  }
  if (/insufficient|0x1\b/i.test(m)) {
    // This used to read "not enough balance to cover the swap plus network
    // fees", which names the wrong thing twice: it suggests SOL, and it
    // suggests fees, when the usual cause is simply running out of the
    // token being sold. Say which token, and what is actually there.
    const bal = swapBalances.in;
    const sym = swapPair && swapPair.in ? swapPair.in.symbol : 'that token';
    if (bal !== null && swapInputTokens() > bal) {
      return 'Not enough ' + sym + ' — you have ' + fmtAmount(bal) + '. Nothing was taken.';
    }
    return 'Not enough ' + sym + ', or not enough SOL left for the network fee. Nothing was taken.';
  }
  if (/blockhash|expired|timed out|timeout/i.test(m)) {
    return 'That took too long and expired before it landed. Nothing was swapped — try again.' +
      (swapProtect ? ' If it keeps happening, try with bot protection off.' : '');
  }
  if (/no route/i.test(m)) return 'No route for that pair right now.';
  if (/internal error|unexpected error|unknown/i.test(m)) {
    return 'Your wallet rejected that without saying why. It is usually a stale ' +
      'price — press Try again to get a fresh quote. If it keeps happening, ' +
      'check you have a little SOL for the network fee.';
  }
  return m || 'The swap did not go through.';
}

// ── SOLANA PAY ──
// One payment screen for both bookings and ad slots. Two ways to pay the
// same invoice: the connected wallet, or a QR from a phone that has never
// touched this site. Either way the reference is what identifies it.
var payPoll = null;

function solanaPayUrl(d, label, message) {
  const base = 'solana:' + d.payTo;
  const common = '&reference=' + d.reference +
    '&label=' + encodeURIComponent(label) +
    '&message=' + encodeURIComponent(message);
  return base + '?amount=' + (d.usdc / Math.pow(10, 6)) +
    '&spl-token=' + USDC_MINT + common;
}

function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  if (window._qrLoading) return window._qrLoading;
  window._qrLoading = new Promise(function (resolve, reject) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    // pinned: a QR that encodes a different address is a stolen payment
    s.integrity = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return window._qrLoading;
}

async function drawQr(el, text) {
  try {
    await loadQrLib();
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    el.classList.remove('loading');
    el.innerHTML = qr.createImgTag(4, 0);
  } catch (e) {
    // The QR is a convenience; the wallet button still works without it.
    el.classList.add('loading');
    el.textContent = 'QR unavailable — use the button below';
  }
}

/// kind: 'booking' | 'ad'. onPaid runs once the chain confirms.
function renderPayment(d, kind, title, onPaid) {
  // Measured against the server's clock, so a visitor whose clock is off
  // still sees the hold end when it really ends.
  const holdMs = d.holdUntil ? d.holdUntil - (d.serverNow || Date.now()) : 20 * 60000;
  window._pay = { d: d, kind: kind, onPaid: onPaid, title: title, deadline: Date.now() + holdMs };
  paintPayment();
  bkScrollTo('bk-flow');
  startPayPolling(d.ref, kind, onPaid);
}

function payHoldEnded() {
  const ctx = window._pay;
  return !!ctx && Date.now() >= ctx.deadline;
}

function setPayStatus(cls, text) {
  const s = document.getElementById('pay-status');
  if (!s) return;
  s.className = 'pay-status' + (cls ? ' ' + cls : '');
  document.getElementById('pay-status-text').textContent = text;
  const clock = document.getElementById('pay-clock');
  if (clock && cls) clock.remove();
}

function tickPayClock() {
  const ctx = window._pay;
  const clock = document.getElementById('pay-clock');
  if (!ctx || !clock) return;
  const left = Math.max(0, ctx.deadline - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
  clock.textContent = 'held ' + m + ':' + String(s).padStart(2, '0');
  if (left === 0) endPayHold();
}

// The hold is over: stop anyone paying for it. Keep looking a little longer
// in case money already left a wallet just before the end.
function endPayHold() {
  const ctx = window._pay;
  if (!ctx || ctx.ended) return;
  ctx.ended = true;
  const qr = document.getElementById('pay-qr');
  if (qr) qr.classList.add('ended');
  // someone mid-payment has already sent it; don't tell them not to
  if (ctx.paying) return;
  const btn = document.getElementById('pay-wallet');
  if (btn) { btn.disabled = true; btn.classList.add('ended'); btn.textContent = 'Hold ended'; }
  setPayStatus('ended', 'This hold has ended, so please don\'t pay now. If you already paid, ' +
    'it is still matched to ' + ctx.d.ref + ' on its own.');
}

/// Bookings and the ad slot are paid in USDC only. Priced in dollars, so a
/// dollar stablecoin means the invoice is exactly what lands — no exchange
/// rate to quote, hold or drift.
function paintPayment() {
  const ctx = window._pay;
  const d = ctx.d;
  const flow = document.getElementById('bk-flow');
  const usd = Number(d.totalUsd !== undefined ? d.totalUsd : (d.quote && d.quote.total));
  const amount = (d.usdc / Math.pow(10, 6)).toFixed(2) + ' USDC';
  const url = solanaPayUrl(d, 'solquicks', ctx.title);
  ctx.url = url;

  // Show how the total was reached. Without it a discounted price just
  // looks like the wrong price — which is exactly how it read.
  const q = d.quote;
  let breakdown = '';
  if (q && (q.rushPct || q.discountPct)) {
    breakdown = '<div class="bk-quote">' +
      '<div class="bk-line"><span>' + escapeHtml(ctx.title) + '</span>' +
      '<span class="num">$' + q.base.toLocaleString() + '</span></div>' +
      (q.rushPct ? '<div class="bk-line"><span class="bk-add">Rush booking (+' + q.rushPct + '%)</span>' +
        '<span class="num bk-add">+$' + (Math.round(q.base * q.rushPct) / 100).toFixed(2) + '</span></div>' : '') +
      (q.discountPct ? '<div class="bk-line"><span class="bk-save">Moon Ranger holder (−' + q.discountPct + '%)</span>' +
        '<span class="num bk-save">−$' + (q.base * (1 + q.rushPct / 100) * q.discountPct / 100).toFixed(2) + '</span></div>' : '') +
      '<div class="bk-line total"><span>Total</span><span class="num">$' + usd.toFixed(2) + '</span></div></div>';
  }

  flow.innerHTML = '<div class="bk-flow">' +
    '<button class="bk-back" onclick="backToRateCard()">← All services</button>' +
    '<div class="bk-step">Pay · reference ' + escapeHtml(d.ref) + '</div>' +
    breakdown +
    '<div class="pay-grid">' +
      '<div class="pay-qr loading" id="pay-qr">Making QR…</div>' +
      '<div><div class="pay-amount">' + amount + '</div>' +
      '<div class="pay-usd">$' + usd.toFixed(2) + ' · ' + escapeHtml(ctx.title) + '</div>' +
      '<div class="pay-note">Paid in USDC — what the invoice says is what you send. ' +
      'Scan with any Solana wallet, or pay in this browser.</div>' +
      '<div class="pay-link">' + escapeHtml(d.payTo) + '</div></div>' +
    '</div>' +
    '<div class="pay-status" id="pay-status"><span class="pay-dot"></span><span id="pay-status-text">Waiting for payment…</span>' +
      '<span class="pay-clock" id="pay-clock"></span></div>' +
    '<div class="pay-or">or</div>' +
    '<button class="bk-go" id="pay-wallet" onclick="payWithWallet()">Pay ' + amount + ' with connected wallet</button>' +
    '<div class="bk-msg" id="pay-msg"></div>' +
    '<p class="bk-policy">If you pay and this page closes, the payment is still found — ' +
    'keep your reference <strong>' + escapeHtml(d.ref) + '</strong>.</p>' +
    '</div>';

  drawQr(document.getElementById('pay-qr'), url);
}

// Looks for the payment for the whole hold, then a few minutes more. It used
// to give up after five minutes while still saying "Waiting for payment…".
const PAY_GRACE_MS = 5 * 60000;
var payClock = null;

function startPayPolling(ref, kind, onPaid) {
  stopPayPolling();
  // Buying points has no watch endpoint: it is confirmed by the wallet that
  // paid, never by a stranger scanning for a reference, so there is nothing
  // to poll for.
  if (kind === 'points') return;
  const endpoint = kind === 'ad' ? '/api/banner/watch'
    : kind === 'cart' ? '/api/cart/watch'
    : kind === 'bundle' ? '/api/bundle/watch' : '/api/booking/watch';
  tickPayClock();
  payClock = setInterval(tickPayClock, 1000);
  payPoll = setInterval(async function () {
    const ctx = window._pay;
    if (!ctx || Date.now() > ctx.deadline + PAY_GRACE_MS) { stopPayPolling(); return; }
    try {
      const res = await fetch(POINTS_API + endpoint + '?ref=' + encodeURIComponent(ref));
      const r = await res.json();
      if (r.status === 'paid') {
        stopPayPolling();
        setPayStatus('done', 'Payment received');
        setTimeout(function () { onPaid(r.signature); }, 700);
      } else if (r.status === 'refund') {
        stopPayPolling();
        endPayHold();
        setPayStatus('ended', 'Your payment arrived after the hold ended, and that time had been taken. ' +
          'It is recorded against ' + ref + ' and will be refunded.');
      }
    } catch (e) { /* keep waiting */ }
  }, 2000);
}

function stopPayPolling() {
  if (payPoll) { clearInterval(payPoll); payPoll = null; }
  if (payClock) { clearInterval(payClock); payClock = null; }
}

async function payWithWallet() {
  const ctx = window._pay;
  if (!ctx) return;
  const btn = document.getElementById('pay-wallet');
  const msg = document.getElementById('pay-msg');
  msg.className = 'bk-msg';
  msg.textContent = '';
  if (payHoldEnded()) { endPayHold(); return; }

  if (!Wallet.pubkey) {
    msg.textContent = 'Connect your wallet…';
    try { await connectWallet(); } catch (e) { /* closed the picker */ }
    if (!Wallet.pubkey) {
      msg.className = 'bk-msg bad';
      msg.textContent = 'No wallet connected. You can still scan the QR with your phone.';
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Check your wallet…';
  ctx.paying = true;
  try {
    const sig = await sendUsdc(ctx.d.payTo, ctx.d.usdc, ctx.d.reference);
    btn.textContent = 'Confirming…';
    const endpoint = ctx.kind === 'ad' ? '/api/banner/confirm'
      : ctx.kind === 'bundle' ? '/api/bundle/confirm'
      : ctx.kind === 'points' ? '/api/points/confirm' : '/api/booking/confirm';
    const res = await fetch(POINTS_API + endpoint, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        FoxPoints.token ? { Authorization: 'Bearer ' + FoxPoints.token } : {}),
      body: JSON.stringify({ ref: ctx.d.ref, signature: sig })
    });
    const r = await res.json();
    if (r.refund) {
      stopPayPolling();
      endPayHold();
      setPayStatus('ended', r.error);
      return;
    }
    if (r.error) throw new Error(r.error);
    if (r.pending) {
      // the page's own check got there first and is finishing; it will
      // flip to "Payment received" on its next look
      btn.textContent = 'Payment received — finishing up…';
      return;
    }
    stopPayPolling();
    ctx.onPaid(sig);
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.innerHTML = escapeHtml(friendlyTxError(e)) +
      '<br>Reference <strong>' + escapeHtml(ctx.d.ref) + '</strong>. If the money left your wallet, ' +
      'this page will pick it up on its own — leave it open a moment.';
    btn.disabled = false;
    btn.textContent = 'Try again';
    ctx.paying = false;
    if (payHoldEnded()) { ctx.ended = false; endPayHold(); }
  }
}

// ── ADVERTISING SLOT ──
var adData = null;
var adWeeks = null;

async function startAdBooking() {
  const btn = tabButton('book');
  if (btn && !document.getElementById('panel-book').classList.contains('active')) switchTab('book', btn);
  document.getElementById('bk-list').hidden = true;
  const flow = document.getElementById('bk-flow');
  flow.hidden = false;
  flow.innerHTML = '<div class="bk-flow">Loading rates…</div>';
  bkScrollTo('bk-flow');

  try {
    await siteKnown();
    const res = await fetch(POINTS_API + '/api/banner/rates' + siteParam('?'));
    adData = await res.json();
  } catch (e) {
    flow.innerHTML = '<div class="bk-flow">Could not load advertising rates just now.</div>';
    return;
  }
  adWeeks = adData.rates[0].weeks;
  renderAdForm();
}

function renderAdForm() {
  const flow = document.getElementById('bk-flow');
  const d = adData;
  const base = d.rates[0].price;
  // a shorter run can fit a gap a longer one cannot, so the date follows the length picked
  const picked = d.rates.find(function (r) { return r.weeks === adWeeks; });
  const starts = new Date((picked && picked.startsAt) || d.nextFree)
    .toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  flow.innerHTML = '<div class="bk-flow">' +
    '<button class="bk-back" onclick="backToRateCard()">← All services</button>' +
    '<div class="bk-step">Advertising space · top of every tab</div>' +
    (d.taken ? '<p class="bk-hint">The slot is running someone else\'s campaign right now. ' +
      'Yours would start when theirs ends.</p>' : '') +
    '<p class="bk-blurb">A 3:1 banner above the fold, on every tab of the site. ' +
      'Yours alone for the whole run — no rotation, no one else sharing it. ' +
      'Book it by the week, by the month, or take the year: the longer the run, ' +
      'the less it costs per week, down to a floor at three months.</p>' +
    '<div class="bk-weeks">' + d.rates.map(function (r) {
      const perWeek = r.price / r.weeks;
      const saving = Math.round((1 - perWeek / base) * 100);
      return '<button class="bk-week' + (r.weeks === adWeeks ? ' on' : '') +
        '" onclick="pickWeeks(' + r.weeks + ')">' +
        '<b>$' + r.price.toLocaleString() + '</b><span>' + escapeHtml(r.label || (r.weeks + ' weeks')) + '</span>' +
        (saving > 0 ? '<em>save ' + saving + '%</em>' : '<em>&nbsp;</em>') + '</button>';
    }).join('') + '</div>' +
    '<p class="bk-hint">Runs from <strong>' + escapeHtml(starts) + '</strong>.</p>' +
    '<div class="bk-field"><label for="ad-name">Your name or project</label><input id="ad-name"></div>' +
    '<div class="bk-field"><label for="ad-contact">How do I reach you?</label>' +
    '<input id="ad-contact" placeholder="@handle, email, or Telegram"></div>' +
    '<div id="ad-quote"></div>' +
    '<button class="bk-add" id="ad-add" onclick="submitAd(true)">Add to basket</button>' +
    '<button class="bk-go" id="ad-submit" onclick="submitAd()">Continue to payment</button>' +
    '<div class="bk-msg" id="ad-msg"></div>' +
    '<p class="bk-policy"><strong>Approval.</strong> ' + escapeHtml(d.rules) +
    '<br><strong>Artwork.</strong> You send a name, one headline and a link after paying. ' +
    'Nothing goes live until I have approved it.</p></div>';
}

function pickWeeks(w) { adWeeks = w; renderAdForm(); }

async function submitAd(toBasket) {
  const btn = document.getElementById(toBasket ? 'ad-add' : 'ad-submit');
  const msg = document.getElementById('ad-msg');
  msg.className = 'bk-msg';
  msg.textContent = '';
  const name = (document.getElementById('ad-name').value || '').trim();
  const contact = (document.getElementById('ad-contact').value || '').trim();
  if (!name || !contact) {
    msg.className = 'bk-msg bad';
    msg.textContent = 'I need a name and a way to reach you.';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    const res = await fetch(POINTS_API + '/api/banner/hold', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        FoxPoints.token ? { Authorization: 'Bearer ' + FoxPoints.token } : {}),
      body: JSON.stringify(withSite({ weeks: adWeeks, name: name, contact: contact }))
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    const runs = new Date(d.startsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
      ' – ' + new Date(d.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const label = 'Advertising · ' + runs;
    if (toBasket) {
      cartRememberDetails(name, contact);
      cartAdd({ kind: 'banner', ref: d.ref, total: d.totalUsd, holdUntil: d.holdUntil, label: label });
      backToRateCard();
      return;
    }
    renderPayment(d, 'ad', d.weeks + ' week' + (d.weeks > 1 ? 's' : '') + ' · ' + runs,
      function (sig) { renderAdCreative(d, sig); });
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.textContent = e.message || 'Something went wrong.';
    btn.disabled = false;
    btn.textContent = toBasket ? 'Add to basket' : 'Continue to payment';
  }
}

/// Paid, but not live. The creative is collected here and waits for review.
function renderAdCreative(d, sig) {
  const flow = document.getElementById('bk-flow');
  flow.innerHTML = '<div class="bk-flow">' +
    '<button class="bk-back" onclick="backToRateCard()">← All services</button>' +
    '<div class="bk-step">Paid · reference ' + escapeHtml(d.ref) + '</div>' +
    '<p class="bk-blurb">Now the artwork. I review every banner before it runs — ' +
    'if I turn yours down you get a full refund. ' +
    'Nothing is lost if you leave this page: the slot is paid for and held. ' +
    'Keep the reference above and send the artwork whenever you have it.</p>' +
    '<div class="bk-field"><label for="ad-sponsor">Name shown on the banner</label><input id="ad-sponsor" maxlength="60"></div>' +
    '<div class="bk-field"><label for="ad-headline">Headline</label>' +
    '<input id="ad-headline" maxlength="90" placeholder="One line, about 60 characters">' +
    '<div class="bk-hint">Short and specific beats clever.</div></div>' +
    '<div class="bk-field"><label for="ad-url">Link</label>' +
    '<input id="ad-url" placeholder="https://"></div>' +
    '<div class="bk-field"><label for="ad-image">Image URL (optional)</label>' +
    '<input id="ad-image" placeholder="https://… square works best"></div>' +
    '<button class="bk-go" id="ad-send" onclick="sendAdCreative(\'' + d.ref + '\')">Send for approval</button>' +
    '<div class="bk-msg" id="ad-msg2"></div>' +
    (sig ? '<p class="bk-hint"><a href="https://solscan.io/tx/' + encodeURIComponent(sig) +
      '" target="_blank" rel="noopener noreferrer">View your receipt</a></p>' : '') +
    '</div>';
}

async function sendAdCreative(ref) {
  const btn = document.getElementById('ad-send');
  const msg = document.getElementById('ad-msg2');
  msg.className = 'bk-msg';
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch(POINTS_API + '/api/banner/creative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: ref,
        sponsor: (document.getElementById('ad-sponsor').value || '').trim(),
        headline: (document.getElementById('ad-headline').value || '').trim(),
        url: (document.getElementById('ad-url').value || '').trim(),
        image: (document.getElementById('ad-image').value || '').trim()
      })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    document.getElementById('bk-flow').innerHTML = '<div class="bk-flow bk-done">' +
      '<div class="bk-tick">🪧</div><div class="bk-lead">Sent for approval</div>' +
      '<p class="bk-sub">I\'ll review it and get it live on your start date. ' +
      'If anything needs changing I\'ll message you first.</p>' +
      '<div class="bk-ref">' + escapeHtml(ref) + '</div>' +
      '<button class="bk-go ghost" style="margin-top:14px" onclick="backToRateCard()">Done</button></div>';
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.textContent = e.message || 'Could not send that.';
    btn.disabled = false;
    btn.textContent = 'Send for approval';
  }
}

// ── BOOK THE FOX ──
// Deliberately usable without a wallet: the rate card, the calendar and
// the enquiry form all work signed out. A wallet is only needed to pay,
// and only then does the holder discount apply.
var bkData = null;
var bkPick = { type: null, startsAt: null };

async function loadBooking() {
  const list = document.getElementById('bk-list');
  if (!list) return;
  await siteKnown();
  try {
    const res = await fetch(POINTS_API + '/api/booking/types' + siteParam('?'), authHeaders());
    if (!res.ok) return;
    bkData = await res.json();
    renderRateCard();
  } catch (e) {
    list.innerHTML = '<p class="bk-sub">Could not load the rate card just now.</p>';
  }
}

function authHeaders() {
  return FoxPoints && FoxPoints.token
    ? { headers: { Authorization: 'Bearer ' + FoxPoints.token } }
    : {};
}

function renderRateCard() {
  const list = document.getElementById('bk-list');
  const d = bkData;
  const adCard = '<div class="bk-ad">' +
    '<div class="bk-top"><div class="bk-name">Advertising space</div>' +
    '<div class="bk-price">$300<span style="font-size:0.7rem"> /week</span></div></div>' +
    '<div class="bk-meta">Top of every tab · one advertiser at a time</div>' +
    '<div class="bk-blurb">Your banner at the top of solquicks.com — by the week, by the month, ' +
    'or the whole year. Nobody else shares the spot, and the longer the run the less it costs ' +
    'per week, down to $215 on three months or more.</div>' +
    '<button class="bk-go" onclick="startAdBooking()">Book the space</button></div>';

  const lookup = '<div class="bk-lookup">' +
    '<label for="bk-find">Already booked something?</label>' +
    '<div class="bk-hint">Put your reference in to see it, book a session from a bundle, or finish sending a banner.</div>' +
    '<div class="bk-find-row"><input id="bk-find" placeholder="FOX-XXXXXX or PACK-XXXXX" spellcheck="false">' +
    '<button onclick="findBooking()">Find it</button></div>' +
    '<div class="bk-msg" id="bk-find-msg"></div></div>';

  list.innerHTML = adCard + lookup + d.types.map(function (t) {
    // A type can carry its own wording. The defaults below describe a
    // thing made and delivered, which is wrong for an hour on a call.
    const label = t.cta || (t.mode === 'enquiry' ? 'Ask about a date'
      : t.mode === 'async' ? 'Order this' : 'Pick a time');
    const meta = t.meta || (t.mode === 'enquiry' ? 'In person · agreed before anything is paid'
      : t.mode === 'async' ? 'No calendar needed · made for you'
      : t.minutes + ' minutes · ' + (t.format || 'live'));
    // The worker works out which perk applies and sends the percentage
    // for this wallet, so a collectible holder is not shown a Ranger's
    // discount and charged something else at checkout.
    const off = d.discountPct || 0;
    const yours = t.price * (1 - off / 100);
    const priceHtml = off
      ? '<span class="bk-was">$' + t.price.toLocaleString() + '</span> $' +
        yours.toFixed(2).replace(/\.00$/, '')
      : '$' + t.price.toLocaleString();
    return '<div class="bk-card">' +
      '<div class="bk-top"><div class="bk-name">' + escapeHtml(t.name) + '</div>' +
      '<div class="bk-price">' + priceHtml + '</div></div>' +
      '<div class="bk-meta">' + meta + '</div>' +
      '<div class="bk-blurb">' + escapeHtml(t.blurb) + '</div>' +
      '<ul class="bk-inc">' + t.includes.map(function (i) {
        return '<li>' + escapeHtml(i) + '</li>';
      }).join('') + '</ul>' +
      // Under the list, not in it. A cap rendered as a ticked inclusion
      // reads as something you get rather than something you do not.
      (t.note ? '<p class="bk-note">' + escapeHtml(t.note) + '</p>' : '') +
      '<button class="bk-go' + (t.mode === 'enquiry' ? ' ghost' : '') +
      '" onclick="startBooking(\'' + t.id + '\')">' + label + '</button></div>';
  }).join('') +
    '<p class="bk-policy" style="text-align:center">' +
    escapeHtml(d.policy.rush) + ' ' + escapeHtml(d.policy.holder) +
    (d.discountPct ? ' <strong>You hold a Moon Ranger, so ' + d.discountPct +
      '% is already off every price below.</strong>' : '') + '</p>';
}

/// The flow replaces the rate card in place, but the card the visitor
/// clicked may have been far down the page — leaving them mid-way through a
/// long list with the back button scrolled out of sight. Bring each step's
/// top, and its back button, into view.
/// Somebody who closed the tab, or is coming back days later. The
/// reference is the only thing they were asked to keep, so it is the only
/// thing this asks for.
async function findBooking() {
  const msg = document.getElementById('bk-find-msg');
  const ref = (document.getElementById('bk-find').value || '').trim().toUpperCase();
  msg.className = 'bk-msg';
  if (!ref) { msg.className = 'bk-msg bad'; msg.textContent = 'Put your reference in first.'; return; }
  msg.textContent = 'Looking…';
  try {
    const res = await fetch(POINTS_API + '/api/booking/lookup?ref=' + encodeURIComponent(ref));
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    msg.textContent = '';
    // A reference is just a reference to whoever typed it, so the worker
    // answers with what it found and this picks the right screen.
    if (d.kind === 'bundle') showBundle(d);
    else showFound(d, ref);
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.textContent = e.message || 'Nothing found with that reference.';
  }
}

function showFound(d, ref) {
  const flow = document.getElementById('bk-flow');
  document.getElementById('bk-list').hidden = true;
  flow.hidden = false;

  if (d.kind === 'banner') {
    const b = d.banner;
    const runs = new Date(b.startsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
      ' – ' + new Date(b.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    flow.innerHTML = '<div class="bk-flow">' +
      '<button class="bk-back" onclick="backToRateCard()">← All services</button>' +
      '<div class="bk-step">' + escapeHtml(ref) + ' · advertising</div>' +
      '<p class="bk-hint">' + escapeHtml(runs) + ' · $' + Number(b.total).toLocaleString() +
      ' · ' + escapeHtml(b.status) + (b.approved ? ' · approved' : '') + '</p>' +
      (b.status === 'paid' && !b.hasCreative
        ? '<p class="bk-blurb">Your artwork has not arrived yet — you can send it now.</p>' +
          '<button class="bk-go" onclick="adCreativeFor(\'' + escapeHtml(ref) + '\')">Send the artwork</button>'
        : b.hasCreative
          ? '<p class="bk-blurb">Artwork received. I review every banner before it runs.</p>'
          : '<p class="bk-blurb">This run is not paid for yet.</p>') +
      '</div>';
  } else {
    const b = d.booking;
    flow.innerHTML = '<div class="bk-flow">' +
      '<button class="bk-back" onclick="backToRateCard()">← All services</button>' +
      '<div class="bk-step">' + escapeHtml(ref) + ' · ' + escapeHtml(b.type) + '</div>' +
      '<p class="bk-hint">' + (b.startsAt
        ? new Date(b.startsAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' · '
        : '') + '$' + Number(b.totalUsd).toLocaleString() + ' · ' + escapeHtml(b.status) + '</p>' +
      (d.details ? '<p class="bk-blurb">You sent: ' + escapeHtml(d.details) + '</p>' : '') +
      '</div>';
  }
  bkScrollTo('bk-flow');
}

// ── the basket ──
/// Each line is already held on the server from the moment it was added,
/// so this list is a record of reservations rather than a wish list. It
/// lives in localStorage so that wandering off to look at something else,
/// or reloading, does not lose what has been chosen.
const CART_KEY = 'sq.book.cart';

function cartRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    // A hold that ran out is no longer a reservation, so it is not a line.
    return raw.filter(function (i) { return i && i.ref && (!i.holdUntil || i.holdUntil > Date.now()); });
  } catch (e) { return []; }
}

function cartWrite(items) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(items.slice(0, 12))); } catch (e) {}
  paintCart();
}

function cartAdd(item) {
  const items = cartRead();
  if (items.some(function (i) { return i.ref === item.ref; })) return;
  items.push(item);
  cartWrite(items);
}

function cartRemove(ref) {
  cartWrite(cartRead().filter(function (i) { return i.ref !== ref; }));
}

function cartClear() { cartWrite([]); }

function cartTotal(items) {
  return Math.round((items || cartRead()).reduce(function (sum, i) { return sum + Number(i.total || 0); }, 0) * 100) / 100;
}

/// The bar is always on screen while there is something in the basket, on
/// every step of the booking tab, so checking out is never more than one
/// press away from wherever someone has wandered.
function paintCart() {
  const bar = document.getElementById('bk-cart');
  if (!bar) return;
  const items = cartRead();
  if (!items.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML =
    '<div class="bk-cart-lines">' + items.map(function (i) {
      return '<div class="bk-cart-line"><span>' + escapeHtml(i.label) + '</span>' +
        '<span class="bk-cart-price">$' + Number(i.total).toLocaleString() + '</span>' +
        '<button class="bk-cart-x" title="Remove" onclick="cartDrop(\'' + escapeHtml(i.ref) + '\')">×</button></div>';
    }).join('') + '</div>' +
    '<div class="bk-cart-foot"><span><b>' + items.length + '</b> in your basket · <b>$' +
      cartTotal(items).toLocaleString() + '</b></span>' +
      '<button class="bk-cart-go" onclick="cartCheckout()">Checkout</button></div>';
}

/// Removing a line here only forgets it locally. The hold on the server
/// runs out on its own a few minutes later, which is the same thing that
/// happens when somebody closes the tab.
function cartDrop(ref) {
  cartRemove(ref);
  if (!cartRead().length) backToRateCard();
}

async function cartCheckout() {
  const items = cartRead();
  if (!items.length) return;
  const flow = document.getElementById('bk-flow');
  document.getElementById('bk-list').hidden = true;
  flow.hidden = false;
  flow.innerHTML = '<div class="bk-flow"><button class="bk-back" onclick="backToRateCard()">← All services</button>' +
    '<div class="bk-step">Your basket</div>' +
    '<div class="bk-cart-review">' + items.map(function (i) {
      return '<div class="bk-cart-line"><span>' + escapeHtml(i.label) + '</span>' +
        '<span class="bk-cart-price">$' + Number(i.total).toLocaleString() + '</span></div>';
    }).join('') + '</div>' +
    '<p class="bk-total">Total <b>$' + cartTotal(items).toLocaleString() + '</b></p>' +
    '<div class="bk-field"><label for="cart-name">Your name or project</label><input id="cart-name" autocomplete="organization"></div>' +
    '<div class="bk-field"><label for="cart-contact">How do I reach you?</label><input id="cart-contact" placeholder="@handle, email, or Telegram" autocomplete="email"></div>' +
    '<button class="bk-go" id="cart-go" onclick="cartPay()">Continue to payment</button>' +
    '<div class="bk-msg" id="cart-msg"></div></div>';
  const last = cartLastDetails();
  if (last.name) document.getElementById('cart-name').value = last.name;
  if (last.contact) document.getElementById('cart-contact').value = last.contact;
  bkScrollTo('bk-flow');
}

/// Whoever booked the first line is almost certainly booking the rest, so
/// their details are offered again rather than asked for twice.
function cartLastDetails() {
  try { return JSON.parse(localStorage.getItem('sq.book.who') || '{}') || {}; } catch (e) { return {}; }
}
function cartRememberDetails(name, contact) {
  try { localStorage.setItem('sq.book.who', JSON.stringify({ name: name, contact: contact })); } catch (e) {}
}

async function cartPay() {
  const btn = document.getElementById('cart-go');
  const msg = document.getElementById('cart-msg');
  const name = (document.getElementById('cart-name').value || '').trim();
  const contact = (document.getElementById('cart-contact').value || '').trim();
  msg.className = 'bk-msg';
  msg.textContent = '';
  if (!name || !contact) {
    msg.className = 'bk-msg bad';
    msg.textContent = 'I need a name and a way to reach you.';
    return;
  }
  cartRememberDetails(name, contact);
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    const items = cartRead().map(function (i) { return { kind: i.kind, ref: i.ref }; });
    const res = await fetch(POINTS_API + '/api/cart/checkout', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        FoxPoints.token ? { Authorization: 'Bearer ' + FoxPoints.token } : {}),
      body: JSON.stringify(withSite({ items: items, name: name, contact: contact }))
    });
    const d = await res.json();
    if (d.error) {
      // A line that went while they were deciding is dropped by name,
      // rather than failing the whole basket with nothing to act on.
      if (d.gone && d.ref) {
        cartRemove(d.ref);
        msg.className = 'bk-msg bad';
        msg.textContent = d.error + '. It has been taken out of your basket — the rest is still here.';
        btn.disabled = false;
        btn.textContent = 'Continue to payment';
        cartCheckout();
        return;
      }
      throw new Error(d.error);
    }
    renderPayment(d, 'cart', 'Your basket', function (sig) {
      cartClear();
      showCartDone(d, sig);
    });
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.textContent = e.message || 'Something went wrong. Try again.';
    btn.disabled = false;
    btn.textContent = 'Continue to payment';
  }
}

function showCartDone(d, signature) {
  const flow = document.getElementById('bk-flow');
  // An ad that is paid for but has no artwork never runs, and the single
  // item flow collects it straight after payment. A basket has to offer
  // the same, per ad, or buying one this way would quietly skip it.
  const ads = (d.items || []).filter(function (i) { return i.kind === 'banner'; });
  flow.innerHTML = '<div class="bk-flow"><div class="bk-done">' +
    '<div class="bk-done-tick">✓</div>' +
    '<div class="bk-step">That is all booked</div>' +
    '<p class="bk-hint">Reference <strong>' + escapeHtml(d.ref) + '</strong> — ' + d.items.length +
    ' item' + (d.items.length === 1 ? '' : 's') + ', $' + Number(d.total).toLocaleString() + ' paid. ' +
    'I will be in touch to confirm each one.</p>' +
    (signature ? '<p class="bk-hint">Payment ' + escapeHtml(String(signature).slice(0, 12)) + '…</p>' : '') +
    ads.map(function (a) {
      return '<button class="bk-go" onclick="adCreativeFor(\'' + escapeHtml(a.ref) + '\')">' +
        'Add your banner artwork</button>';
    }).join('') +
    '<button class="bk-go ghost" style="margin-top:10px" onclick="backToRateCard()">Book something else</button>' +
    '</div></div>';
  bkScrollTo('bk-flow');
}

/// The artwork form for one ad run, reachable after a basket as well as
/// after buying the slot on its own.
function adCreativeFor(ref) {
  renderAdCreative({ ref: ref }, null);
}

function bkScrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function backToRateCard() {
  stopPayPolling();
  document.getElementById('bk-flow').hidden = true;
  document.getElementById('bk-list').hidden = false;
  bkPick = { type: null, startsAt: null };
  packPick = null;
  paintCart();          // the basket survives going back; that is the point
  bkScrollTo('bk-list');
}

async function startBooking(typeId) {
  const t = bkData.types.find(function (x) { return x.id === typeId; });
  if (!t) return;
  bkPick = { type: t, startsAt: null };
  document.getElementById('bk-list').hidden = true;
  const flow = document.getElementById('bk-flow');
  flow.hidden = false;

  if (t.mode === 'slot') {
    flow.innerHTML = '<div class="bk-flow"><button class="bk-back" onclick="backToRateCard()">← All services</button>' +
      '<div class="bk-step">' + escapeHtml(t.name) + ' · pick a time</div>' +
      '<div id="bk-slots">Loading times…</div></div>';
    try {
      const res = await fetch(POINTS_API + '/api/booking/slots?type=' + t.id);
      const d = await res.json();
      renderSlots(d.slots || []);
    } catch (e) {
      document.getElementById('bk-slots').textContent = 'Could not load available times.';
    }
    // Only once the times are in. Scrolling while this still read "Loading…"
    // let the browser's scroll anchoring hold the view on whatever sat below,
    // so the list rendering underneath pushed the back button off the top.
    bkScrollTo('bk-flow');
  } else {
    renderBookingForm();
  }
}

function renderSlots(slots) {
  const box = document.getElementById('bk-slots');
  if (!slots.length) {
    box.innerHTML = '<p class="bk-sub">Nothing open in the next month. Get in touch and we\'ll find a time.</p>';
    return;
  }
  // group by day so the list reads like a diary, not a wall of buttons
  const days = [];
  const seen = {};
  for (const s of slots) {
    const key = new Date(s.starts).toDateString();
    if (!seen[key]) { seen[key] = []; days.push({ key: key, when: s.starts, items: seen[key] }); }
    seen[key].push(s);
  }
  box.innerHTML = days.slice(0, 10).map(function (d) {
    return '<div class="bk-day">' + new Date(d.when).toLocaleDateString(undefined,
      { weekday: 'long', day: 'numeric', month: 'long' }) + '</div>' +
      '<div class="bk-slots">' + d.items.map(function (s) {
        return '<button class="bk-slot" data-t="' + s.starts + '" onclick="pickSlot(' + s.starts + ',this)">' +
          new Date(s.starts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) +
          (s.rush ? '<em>rush +50%</em>' : '') + '</button>';
      }).join('') + '</div>';
  }).join('') +
  '<p class="bk-hint" style="margin-top:10px">Times shown in your own timezone.</p>' +
  '<div class="bk-back-foot"><button class="bk-back" onclick="backToRateCard()">← All services</button></div>';
}

function pickSlot(ts, el) {
  bkPick.startsAt = ts;
  document.querySelectorAll('.bk-slot').forEach(function (b) { b.classList.remove('on'); });
  el.classList.add('on');
  renderBookingForm();
}

function renderBookingForm() {
  const t = bkPick.type;
  const flow = document.getElementById('bk-flow');
  const isEnquiry = t.mode === 'enquiry';
  const when = bkPick.startsAt
    ? new Date(bkPick.startsAt).toLocaleString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
    : null;

  flow.innerHTML = '<div class="bk-flow"><div class="bk-back-row">' +
    (t.mode === 'slot'
      ? '<button class="bk-back" onclick="startBooking(\'' + t.id + '\')">← Change time</button>'
      : '') +
    '<button class="bk-back" onclick="backToRateCard()">' + (t.mode === 'slot' ? 'All services' : '← All services') +
    '</button></div>' +
    '<div class="bk-step">' + escapeHtml(t.name) + (when ? ' · ' + escapeHtml(when) : '') + '</div>' +
    '<div class="bk-field"><label for="bk-name">Your name or project</label>' +
    '<input id="bk-name" autocomplete="organization"></div>' +
    '<div class="bk-field"><label for="bk-contact">How do I reach you?</label>' +
    '<input id="bk-contact" placeholder="@handle, email, or Telegram" autocomplete="email">' +
    '<div class="bk-hint">I confirm every booking personally before anything goes in the diary.</div></div>' +
    '<div class="bk-field"><label for="bk-brief">What do you need?</label>' +
    '<textarea id="bk-brief" placeholder="' +
    (isEnquiry ? 'Event, city, dates you have in mind' : 'Topic, guests, links, anything I should know') +
    '"></textarea></div>' +
    '<div id="bk-quote"></div>' +
    (isEnquiry ? '' : '<button class="bk-add" id="bk-add" onclick="submitBooking(true)">Add to basket</button>') +
    '<button class="bk-go" id="bk-submit" onclick="submitBooking()">' +
    (isEnquiry ? 'Send enquiry' : 'Continue to payment') + '</button>' +
    '<div class="bk-msg" id="bk-msg"></div>' +
    '<p class="bk-policy"><strong>Cancellations.</strong> ' + escapeHtml(bkData.policy.cancellation) +
    '<br><strong>Refunds.</strong> ' + escapeHtml(bkData.policy.refunds) +
    (isEnquiry ? '' : '<br><strong>Price.</strong> ' + escapeHtml(bkData.policy.currency)) +
    '</p></div>';
  bkScrollTo('bk-flow');
}

async function submitBooking(toBasket) {
  const btn = document.getElementById(toBasket ? 'bk-add' : 'bk-submit');
  const msg = document.getElementById('bk-msg');
  const t = bkPick.type;
  msg.className = 'bk-msg';
  msg.textContent = '';

  const name = (document.getElementById('bk-name').value || '').trim();
  const contact = (document.getElementById('bk-contact').value || '').trim();
  const brief = (document.getElementById('bk-brief').value || '').trim();
  if (!name || !contact) {
    msg.className = 'bk-msg bad';
    msg.textContent = 'I need a name and a way to reach you.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    const res = await fetch(POINTS_API + '/api/booking/hold', Object.assign({
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        FoxPoints.token ? { Authorization: 'Bearer ' + FoxPoints.token } : {})
    }, { body: JSON.stringify(withSite({ type: t.id, startsAt: bkPick.startsAt, name: name, contact: contact, brief: brief })) }));
    const d = await res.json();
    if (d.error) throw new Error(d.error);

    if (t.mode === 'enquiry') { showBookingDone(d, true); return; }
    if (toBasket) {
      // The hold is already made, which is what puts it in the basket:
      // the slot is reserved from this moment, not from checkout.
      cartRememberDetails(name, contact);
      cartAdd({
        kind: 'booking', ref: d.ref, total: d.quote.total, holdUntil: d.holdUntil,
        label: t.name + (d.startsAt ? ' · ' + new Date(d.startsAt).toLocaleString(undefined,
          { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
      });
      backToRateCard();
      return;
    }
    renderPayment(d, 'booking', t.name, function (sig) { showBookingDone(d, false, sig); });
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.textContent = e.message || 'Something went wrong. Try again.';
    btn.disabled = false;
    btn.textContent = toBasket ? 'Add to basket'
      : t.mode === 'enquiry' ? 'Send enquiry' : 'Continue to payment';
  }
}

function friendlyTxError(e) {
  const m = String((e && e.message) || e || '');
  if (/reject|denied|cancell?ed|User rejected/i.test(m)) return 'You cancelled that in your wallet — nothing was charged.';
  if (/insufficient|0x1\b/i.test(m)) return 'Not enough SOL in that wallet to cover the booking plus network fees.';
  if (/blockhash|expired|timed out|timeout/i.test(m)) return 'That took too long and the transaction expired. Nothing was charged — try again.';
  if (/already used|already/i.test(m)) return m;
  if (/not found yet/i.test(m)) return 'Payment sent, but the network has not caught up. Give it a moment and press try again — you will not be charged twice.';
  return m || 'The payment did not go through.';
}

/// What is still worth asking once the money has moved. It cannot cost a
/// sale at this point, and it saves the same questions being chased
/// through messages afterwards.
const BRIEF_PROMPTS = {
  space: 'Guest handles, the account to co-host from, the topic, and anything to steer clear of.',
  podcast: 'Guest handles, the topic, links I should read first, and anything to steer clear of.',
  stream: 'What we are streaming, which account it runs from, and anything to steer clear of.',
  custom: 'What you want made, any references, and when you need it.',
  consult: 'Your timezone and a few times that suit you, plus what you are building, ' +
    'where you are stuck, and links I should look at before we talk.'
};

function showBookingDone(d, isEnquiry, sig) {
  const flow = document.getElementById('bk-flow');
  // Normally the flow is already on screen by the time anything is paid
  // for, but this is the screen that must never fail to appear.
  flow.hidden = false;
  document.getElementById('bk-list').hidden = true;
  const prompt = BRIEF_PROMPTS[d.type];
  flow.innerHTML = '<div class="bk-flow bk-done">' +
    '<div class="bk-tick">' + (isEnquiry ? '📬' : '🦊') + '</div>' +
    '<div class="bk-lead">' + (isEnquiry ? 'Enquiry sent' : 'Booked') + '</div>' +
    '<p class="bk-sub">' + (isEnquiry
      ? 'I\'ll come back to you to agree the date and venue before anything is paid.'
      : 'Paid and in the diary. I\'ll be in touch to confirm the details.') + '</p>' +
    '<div class="bk-ref">' + escapeHtml(d.ref) + '</div>' +
    '<p class="bk-hint">Keep that reference.' +
    (sig ? ' <a href="https://solscan.io/tx/' + encodeURIComponent(sig) + '" target="_blank" rel="noopener noreferrer">View receipt</a>' : '') +
    '</p>' +
    // The hour is arranged by hand: the next thing needed is when they are
    // free, which the box below asks for. If a scheduling link is ever
    // configured it replaces that, and becomes the only thing standing
    // between paying and having a time.
    (d.calendly
      ? '<a class="bk-go" href="' + escapeHtml(d.calendly) + '" target="_blank" rel="noopener noreferrer" ' +
        'style="display:block;text-align:center;text-decoration:none;margin-top:12px">Pick your hour →</a>'
      : d.type === 'consult'
        ? '<p class="bk-hint">Tell me when you are free below and I\'ll come back with a time.</p>' : '') +
    (isEnquiry || !prompt ? '' :
      '<div class="bk-brief-box">' +
      '<label for="bk-brief-after">One more thing, while you are here</label>' +
      '<div class="bk-hint">' + escapeHtml(prompt) + '</div>' +
      '<textarea id="bk-brief-after" rows="4"></textarea>' +
      '<button class="bk-go" id="bk-brief-send" onclick="sendBrief(\'' + escapeHtml(d.ref) + '\')">Send these details</button>' +
      '<div class="bk-msg" id="bk-brief-msg"></div></div>') +
    '<button class="bk-go ghost" style="margin-top:14px" onclick="backToRateCard()">Book something else</button></div>';
}

// ── BUNDLES ──
// Several of the same session, bought at once and cheaper each. A bundle
// buys credits; a credit is redeemed into an ordinary booking that holds
// its own hour, so a bundle session and a single session are the same
// thing on the calendar.
//
// Two timings, chosen at checkout: lock every time in now, or keep the
// credits and book as you go. Both are the same product behind the scenes.
var bkPacks = null;
var packPick = null;   // { bundle, mode: 'now'|'later', slots: [ts] }

async function loadBundles() {
  const box = document.getElementById('bk-packs');
  if (!box) return;
  try {
    const res = await fetch(POINTS_API + '/api/bundle/types', FoxPoints.token
      ? { headers: { Authorization: 'Bearer ' + FoxPoints.token } } : {});
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    bkPacks = d;
    renderBundles(d);
  } catch (e) {
    // A rate card that will not load must not leave an empty heading
    // sitting there looking like the feature is broken.
    box.innerHTML = '';
    const head = document.getElementById('bk-pack-head');
    if (head) head.hidden = true;
  }
}

function renderBundles(d) {
  const head = document.getElementById('bk-pack-head');
  const box = document.getElementById('bk-packs');
  if (!d.bundles || !d.bundles.length) { if (head) head.hidden = true; box.innerHTML = ''; return; }
  if (head) head.hidden = false;

  box.innerHTML = d.bundles.map(function (b) {
    const yours = b.yours || { total: b.price, perSession: b.perSession };
    const off = Math.round((1 - yours.total / b.fullPrice) * 100);
    return '<div class="bk-pack">' +
      '<div class="bk-pack-top"><div class="bk-pack-name">' + escapeHtml(b.name) + '</div>' +
      '<div class="bk-pack-price">' +
      (yours.total < b.price
        ? '<span class="bk-was">$' + b.price.toLocaleString() + '</span>'
        : '') +
      '$' + money(yours.total) + '</div></div>' +
      '<div class="bk-pack-each">$' + money(yours.perSession) + ' each · ' +
      '<span style="text-decoration:line-through;color:var(--muted)">$' +
      b.fullPrice.toLocaleString() + '</span> bought singly</div>' +
      '<span class="bk-pack-save">Save $' + (b.fullPrice - yours.total).toLocaleString() +
      ' · ' + off + '% off</span>' +
      '<button class="bk-go" onclick="startBundle(\'' + b.id + '\')">Buy ' + b.qty + '</button>' +
      '</div>';
  }).join('') +
    '<p class="bk-policy" style="grid-column:1/-1;text-align:center">' +
    escapeHtml(d.policy.credits) + ' ' + escapeHtml(d.policy.expiry) +
    (d.discountPct ? ' <strong>Your Moon Ranger discount is already in the prices above.</strong>' : '') +
    '</p>';
}

/// Prices are dollars. Whole dollars read as whole dollars; anything with
/// cents keeps both, because "$187.5" is not a price.
function money(n) {
  const v = Number(n) || 0;
  return v % 1 === 0 ? v.toLocaleString() : v.toFixed(2);
}

function startBundle(id) {
  const b = bkPacks && bkPacks.bundles.find(function (x) { return x.id === id; });
  if (!b) return;
  packPick = { bundle: b, mode: null, slots: [] };
  document.getElementById('bk-list').hidden = true;
  const flow = document.getElementById('bk-flow');
  flow.hidden = false;

  const yours = b.yours || { total: b.price, perSession: b.perSession };
  const canSchedule = b.mode === 'slot';

  flow.innerHTML = '<div class="bk-flow">' +
    '<button class="bk-back" onclick="backToRateCard()">← All services</button>' +
    '<div class="bk-step">' + escapeHtml(b.name) + ' · $' + money(yours.total) + '</div>' +
    '<p class="bk-sub">' + b.qty + ' sessions at $' + money(yours.perSession) +
    ' each, instead of $' + b.unitPrice.toLocaleString() + '. ' +
    escapeHtml(bkPacks.policy.expiry) + '</p>' +
    (canSchedule
      ? '<div class="bk-choice">' +
        '<button id="pack-now" onclick="pickPackMode(\'now\')">' +
        '<b>Pick all ' + b.qty + ' times now</b>' +
        '<span>Every session goes in the diary before you pay, and the times are yours. ' +
        'Best if you already know your schedule.</span></button>' +
        '<button id="pack-later" onclick="pickPackMode(\'later\')">' +
        '<b>Buy now, book as you go</b>' +
        '<span>You get ' + b.qty + ' credits and book each session whenever suits, ' +
        'any time in the next ' + b.validDays + ' days.</span></button>' +
        '</div>'
      // Nothing with a calendar to pick, so there is no choice to offer.
      : '<p class="bk-hint">These are made and delivered rather than booked into an hour, ' +
        'so there is nothing to schedule — you get ' + b.qty + ' to use whenever you need them.</p>') +
    '<div id="pack-next"></div></div>';

  if (!canSchedule) pickPackMode('later');
  bkScrollTo('bk-flow');
}

function pickPackMode(mode) {
  if (!packPick) return;
  packPick.mode = mode;
  packPick.slots = [];
  const now = document.getElementById('pack-now');
  const later = document.getElementById('pack-later');
  if (now) now.classList.toggle('on', mode === 'now');
  if (later) later.classList.toggle('on', mode === 'later');
  if (mode === 'now') return packSlots();
  renderPackForm();
}

/// Picking several hours at once. The calendar offers a start every half
/// hour but a session runs a full one, so choosing 10:00 rules out 10:30 —
/// those are greyed out as they are chosen rather than refused at the end,
/// which is the whole reason this is not just the single-slot picker.
async function packSlots() {
  const b = packPick.bundle;
  const box = document.getElementById('pack-next');
  box.innerHTML = '<div id="pack-slot-list">Loading times…</div>';
  try {
    const res = await fetch(POINTS_API + '/api/booking/slots?type=' + b.typeId);
    const d = await res.json();
    packPick.open = d.slots || [];
    renderPackSlots();
  } catch (e) {
    document.getElementById('pack-slot-list').textContent = 'Could not load available times.';
  }
}

function packSlotBlocked(ts) {
  const mins = packPick.bundle.minutes || 60;
  return packPick.slots.some(function (t) { return t !== ts && Math.abs(t - ts) < mins * 60000; });
}

function renderPackSlots() {
  const b = packPick.bundle;
  const box = document.getElementById('pack-next');
  const slots = packPick.open || [];
  if (!slots.length) {
    box.innerHTML = '<p class="bk-sub">Nothing open in the next month. Get in touch and we\'ll find times.</p>';
    return;
  }
  const days = [];
  const seen = {};
  for (const sl of slots) {
    const key = new Date(sl.starts).toDateString();
    if (!seen[key]) { seen[key] = []; days.push({ key: key, when: sl.starts, items: seen[key] }); }
    seen[key].push(sl);
  }
  const left = b.qty - packPick.slots.length;
  box.innerHTML =
    '<div class="bk-step">Pick ' + b.qty + ' times</div>' +
    days.slice(0, 14).map(function (dd) {
      return '<div class="bk-day">' + new Date(dd.when).toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long' }) + '</div>' +
        '<div class="bk-slots">' + dd.items.map(function (sl) {
          const on = packPick.slots.indexOf(sl.starts) >= 0;
          const blocked = !on && (packSlotBlocked(sl.starts) || left === 0);
          return '<button class="bk-slot' + (on ? ' on' : '') + (blocked ? ' taken' : '') + '"' +
            (blocked ? ' disabled' : '') +
            ' onclick="togglePackSlot(' + sl.starts + ')">' +
            new Date(sl.starts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) +
            '</button>';
        }).join('') + '</div>';
    }).join('') +
    '<p class="bk-hint" style="margin-top:10px">Times shown in your own timezone. ' +
    'A session runs ' + (b.minutes || 60) + ' minutes, so picking one greys out the ones it overlaps. ' +
    'No rush fee on a bundle, whichever times you choose.</p>' +
    '<div class="bk-picked"><div class="bk-picked-n">' +
    packPick.slots.length + ' of ' + b.qty + ' picked' +
    (left ? '' : ' — all set') + '</div>' +
    '<button class="bk-go" onclick="renderPackForm()"' + (left ? ' disabled' : '') + '>' +
    (left ? 'Pick ' + left + ' more' : 'Continue') + '</button></div>' +
    '<div class="bk-back-foot"><button class="bk-back" onclick="startBundle(\'' +
    b.id + '\')">← Start again</button></div>';
}

function togglePackSlot(ts) {
  const i = packPick.slots.indexOf(ts);
  if (i >= 0) packPick.slots.splice(i, 1);
  else if (packPick.slots.length < packPick.bundle.qty) packPick.slots.push(ts);
  packPick.slots.sort(function (a, b) { return a - b; });
  renderPackSlots();
}

function renderPackForm() {
  const b = packPick.bundle;
  const yours = b.yours || { total: b.price, perSession: b.perSession };
  const box = document.getElementById('pack-next');
  const when = packPick.slots.map(function (t) {
    return new Date(t).toLocaleString(undefined,
      { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  });

  box.innerHTML =
    (packPick.mode === 'now'
      ? '<div class="bk-step">Your ' + b.qty + ' times</div>' +
        '<ul class="bk-sessions">' + when.map(function (w, i) {
          return '<li><b>' + (i + 1) + '</b>' + escapeHtml(w) + '</li>';
        }).join('') + '</ul>' +
        '<button class="bk-back" onclick="packSlots()">← Change times</button>'
      : '') +
    '<div class="bk-field"><label for="pack-name">Your name or project</label>' +
    '<input id="pack-name" autocomplete="organization"></div>' +
    '<div class="bk-field"><label for="pack-contact">How do I reach you?</label>' +
    '<input id="pack-contact" placeholder="@handle, email, or Telegram" autocomplete="email"></div>' +
    '<div class="bk-field"><label for="pack-brief">What do you need?</label>' +
    '<textarea id="pack-brief" placeholder="Topic, guests, links, anything I should know"></textarea></div>' +
    '<div class="bk-quote"><div class="bk-quote-row"><span>' + b.qty + ' × ' +
    escapeHtml(b.name.replace(/^\d+×\s*/, '')) + '</span><b>$' + b.fullPrice.toLocaleString() + '</b></div>' +
    '<div class="bk-quote-row"><span>Bundle discount</span><b>−$' +
    (b.fullPrice - b.price).toLocaleString() + '</b></div>' +
    (yours.total < b.price
      ? '<div class="bk-quote-row"><span>Moon Ranger discount</span><b>−$' +
        money(b.price - yours.total) + '</b></div>'
      : '') +
    '<div class="bk-quote-row total"><span>Total</span><b>$' + money(yours.total) + '</b></div></div>' +
    '<button class="bk-go" id="pack-submit" onclick="submitBundle()">Continue to payment</button>' +
    '<div class="bk-msg" id="pack-msg"></div>' +
    '<p class="bk-policy"><strong>Credits.</strong> ' + escapeHtml(bkPacks.policy.credits) +
    '<br><strong>Expiry.</strong> ' + escapeHtml(bkPacks.policy.expiry) +
    '<br><strong>Cancellations.</strong> ' + escapeHtml(bkPacks.policy.cancellation) +
    '<br><strong>Price.</strong> ' + escapeHtml(bkPacks.policy.currency) + '</p>';
  bkScrollTo('bk-flow');
}

async function submitBundle() {
  const btn = document.getElementById('pack-submit');
  const msg = document.getElementById('pack-msg');
  const b = packPick.bundle;
  msg.className = 'bk-msg';
  msg.textContent = '';

  const name = (document.getElementById('pack-name').value || '').trim();
  const contact = (document.getElementById('pack-contact').value || '').trim();
  const brief = (document.getElementById('pack-brief').value || '').trim();
  if (!name || !contact) {
    msg.className = 'bk-msg bad';
    msg.textContent = 'I need a name and a way to reach you.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    const res = await fetch(POINTS_API + '/api/bundle/hold', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' },
        FoxPoints.token ? { Authorization: 'Bearer ' + FoxPoints.token } : {}),
      body: JSON.stringify(withSite({
        bundle: b.id, name: name, contact: contact, brief: brief,
        // Left out entirely when the credits are booked later: an empty
        // list and no list mean the same thing to the worker, and sending
        // neither keeps that true.
        slots: packPick.mode === 'now' ? packPick.slots : undefined
      }))
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    renderPayment(d, 'bundle', b.name, function (sig) { showBundleDone(d, sig); });
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.textContent = e.message || 'Something went wrong. Try again.';
    btn.disabled = false;
    btn.textContent = 'Continue to payment';
  }
}

function showBundleDone(d, sig) {
  const flow = document.getElementById('bk-flow');
  flow.hidden = false;
  document.getElementById('bk-list').hidden = true;
  const b = packPick ? packPick.bundle : null;
  flow.innerHTML = '<div class="bk-flow bk-done">' +
    '<div class="bk-tick">🎟️</div>' +
    '<div class="bk-lead">Bundle bought</div>' +
    '<p class="bk-sub">' + (d.bookLater
      ? d.qty + ' credits are yours. Book them whenever suits — keep the reference below, it is ' +
        'the only thing you need.'
      : 'All ' + d.qty + ' sessions are paid for and in the diary. I\'ll be in touch to confirm the details.') +
    '</p>' +
    '<div class="bk-ref">' + escapeHtml(d.ref) + '</div>' +
    '<p class="bk-hint">Keep that reference.' +
    (sig ? ' <a href="https://solscan.io/tx/' + encodeURIComponent(sig) + '" target="_blank" rel="noopener noreferrer">View receipt</a>' : '') +
    '</p>' +
    (d.bookLater
      ? '<button class="bk-go" onclick="findBundle(\'' + escapeHtml(d.ref) + '\')">Book your first session</button>'
      : '') +
    '<button class="bk-go ghost" style="margin-top:14px" onclick="backToRateCard()">Book something else</button></div>';
}

/// A bundle somebody is coming back to. Reached from the same reference box
/// as everything else, because to whoever typed it a reference is just a
/// reference.
async function findBundle(ref) {
  const flow = document.getElementById('bk-flow');
  document.getElementById('bk-list').hidden = true;
  flow.hidden = false;
  flow.innerHTML = '<div class="bk-flow">Loading…</div>';
  try {
    const res = await fetch(POINTS_API + '/api/bundle/lookup?ref=' + encodeURIComponent(ref));
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    showBundle(d);
  } catch (e) {
    flow.innerHTML = '<div class="bk-flow"><button class="bk-back" onclick="backToRateCard()">← All services</button>' +
      '<p class="bk-msg bad">' + escapeHtml(e.message || 'Nothing found with that reference.') + '</p></div>';
  }
}

function showBundle(d) {
  const flow = document.getElementById('bk-flow');
  const c = d.bundle.credits || { qty: d.bundle.qty, used: 0, left: 0 };
  const paid = d.bundle.status === 'paid';
  flow.hidden = false;
  document.getElementById('bk-list').hidden = true;

  const pips = [];
  for (let i = 0; i < c.qty; i++) {
    pips.push('<div class="bk-credit' + (i < c.used ? ' spent' : '') + '">' +
      (i < c.used ? '✓' : i + 1) + '</div>');
  }

  flow.innerHTML = '<div class="bk-flow">' +
    '<button class="bk-back" onclick="backToRateCard()">← All services</button>' +
    '<div class="bk-step">' + escapeHtml(d.typeName) + ' bundle · ' + escapeHtml(d.bundle.ref) + '</div>' +
    (paid
      ? '<p class="bk-sub">' + c.left + ' of ' + c.qty + ' session' + (c.qty === 1 ? '' : 's') +
        ' left to book' + (c.expiresAt
          ? ', until ' + new Date(c.expiresAt).toLocaleDateString(undefined,
              { day: 'numeric', month: 'long', year: 'numeric' })
          : '') + '.</p>'
      : '<p class="bk-msg bad">This bundle is ' + escapeHtml(d.bundle.status) +
        ' — it has not been paid for, so there are no credits on it yet.</p>') +
    '<div class="bk-credits">' + pips.join('') + '</div>' +
    (d.sessions && d.sessions.length
      ? '<div class="bk-step">Booked</div><ul class="bk-sessions">' + d.sessions.map(function (b) {
          return '<li><b>' + escapeHtml(b.ref) + '</b>' +
            (b.startsAt
              ? escapeHtml(new Date(b.startsAt).toLocaleString(undefined,
                  { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))
              : 'no time needed') +
            '<em>' + escapeHtml(b.status) + '</em></li>';
        }).join('') + '</ul>'
      : '') +
    (paid && c.left > 0 && !c.expired
      ? (d.mode === 'slot'
          ? '<button class="bk-go" onclick="redeemPick(\'' + escapeHtml(d.bundle.ref) + '\')">Book a session</button>'
          : '<button class="bk-go" onclick="redeemCreditNow(\'' + escapeHtml(d.bundle.ref) + '\')">Use a credit</button>')
      : '') +
    (c.expired ? '<p class="bk-msg bad">These credits have expired. Get in touch and we will sort something out.</p>' : '') +
    '<div class="bk-msg" id="pack-redeem-msg"></div>' +
    '</div>';
  bkScrollTo('bk-flow');
}

/// Spending one credit: the ordinary single-slot picker, pointed at the
/// bundle instead of at a new payment.
async function redeemPick(ref) {
  const flow = document.getElementById('bk-flow');
  flow.innerHTML = '<div class="bk-flow">' +
    '<button class="bk-back" onclick="findBundle(\'' + escapeHtml(ref) + '\')">← Back to your bundle</button>' +
    '<div class="bk-step">Pick a time</div><div id="redeem-slots">Loading times…</div></div>';
  try {
    const look = await (await fetch(POINTS_API + '/api/bundle/lookup?ref=' + encodeURIComponent(ref))).json();
    const res = await fetch(POINTS_API + '/api/booking/slots?type=' + look.bundle.type);
    const d = await res.json();
    const slots = d.slots || [];
    const box = document.getElementById('redeem-slots');
    if (!slots.length) {
      box.innerHTML = '<p class="bk-sub">Nothing open in the next month. Get in touch and we\'ll find a time.</p>';
      return;
    }
    const days = []; const seen = {};
    for (const sl of slots) {
      const key = new Date(sl.starts).toDateString();
      if (!seen[key]) { seen[key] = []; days.push({ when: sl.starts, items: seen[key] }); }
      seen[key].push(sl);
    }
    box.innerHTML = days.slice(0, 14).map(function (dd) {
      return '<div class="bk-day">' + new Date(dd.when).toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long' }) + '</div>' +
        '<div class="bk-slots">' + dd.items.map(function (sl) {
          return '<button class="bk-slot" onclick="redeemCreditNow(\'' + escapeHtml(ref) + '\',' + sl.starts + ',this)">' +
            new Date(sl.starts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) +
            '</button>';
        }).join('') + '</div>';
    }).join('') +
      // A credit is already paid for, so the rush surcharge has nothing to
      // apply to — worth saying, because every other slot list shows it.
      '<p class="bk-hint" style="margin-top:10px">Times in your own timezone. ' +
      'Already paid for, so no rush fee whichever you pick.</p>' +
      '<div class="bk-msg" id="pack-redeem-msg"></div>';
  } catch (e) {
    const box = document.getElementById('redeem-slots');
    if (box) box.textContent = 'Could not load available times.';
  }
}

async function redeemCreditNow(ref, startsAt, el) {
  const msg = document.getElementById('pack-redeem-msg');
  if (el) { el.disabled = true; el.classList.add('on'); }
  if (msg) { msg.className = 'bk-msg'; msg.textContent = 'Booking…'; }
  try {
    const res = await fetch(POINTS_API + '/api/bundle/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: ref, startsAt: startsAt || undefined })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    showBundleSessionDone(d, ref);
  } catch (e) {
    if (el) { el.disabled = false; el.classList.remove('on'); }
    if (msg) { msg.className = 'bk-msg bad'; msg.textContent = e.message || 'That did not book.'; }
  }
}

function showBundleSessionDone(d, ref) {
  const flow = document.getElementById('bk-flow');
  const left = d.bundle.credits ? d.bundle.credits.left : 0;
  const prompt = BRIEF_PROMPTS[d.booking.type];
  flow.innerHTML = '<div class="bk-flow bk-done">' +
    '<div class="bk-tick">🦊</div>' +
    '<div class="bk-lead">Booked</div>' +
    '<p class="bk-sub">' +
    (d.booking.startsAt
      ? escapeHtml(new Date(d.booking.startsAt).toLocaleString(undefined,
          { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })) +
        ' — in the diary, nothing more to pay.'
      : 'In hand, nothing more to pay.') +
    ' ' + left + ' credit' + (left === 1 ? '' : 's') + ' left on ' + escapeHtml(ref) + '.</p>' +
    '<div class="bk-ref">' + escapeHtml(d.booking.ref) + '</div>' +
    (prompt
      ? '<div class="bk-brief-box">' +
        '<label for="bk-brief-after">One more thing, while you are here</label>' +
        '<div class="bk-hint">' + escapeHtml(prompt) + '</div>' +
        '<textarea id="bk-brief-after" rows="4"></textarea>' +
        '<button class="bk-go" id="bk-brief-send" onclick="sendBrief(\'' + escapeHtml(d.booking.ref) + '\')">Send these details</button>' +
        '<div class="bk-msg" id="bk-brief-msg"></div></div>'
      : '') +
    (left > 0
      ? '<button class="bk-go" style="margin-top:14px" onclick="findBundle(\'' + escapeHtml(ref) + '\')">Book another</button>'
      : '') +
    '<button class="bk-go ghost" style="margin-top:10px" onclick="backToRateCard()">Done</button></div>';
  bkScrollTo('bk-flow');
}

async function sendBrief(ref) {
  const btn = document.getElementById('bk-brief-send');
  const msg = document.getElementById('bk-brief-msg');
  const details = (document.getElementById('bk-brief-after').value || '').trim();
  msg.className = 'bk-msg';
  if (!details) { msg.className = 'bk-msg bad'; msg.textContent = 'Nothing to send yet.'; return; }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch(POINTS_API + '/api/booking/brief', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: ref, details: details })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    msg.className = 'bk-msg good';
    msg.textContent = 'Got it — thank you.';
    btn.textContent = 'Sent ✓';
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.textContent = (e.message || 'That did not send.') + ' Your booking is safe either way.';
    btn.disabled = false;
    btn.textContent = 'Send these details';
  }
}

// ── COLLECTION ANALYTICS ──
// Public: no wallet needed. Snapshots come from the Worker cron, so this
// is a cheap read however many people are looking.
async function loadAnalytics() {
  const wrap = document.getElementById('an-wrap');
  if (!wrap) return;
  try {
    const res = await fetch(POINTS_API + '/api/analytics');
    if (!res.ok) return;
    renderAnalytics(await res.json());
  } catch (e) { /* leave whatever was last rendered */ }
}

function renderAnalytics(a) {
  const wrap = document.getElementById('an-wrap');
  if (!a || (!a.holders && !a.floor)) return;
  wrap.hidden = false;

  if (a.holders) {
    document.getElementById('an-holders').textContent = a.holders.total.toLocaleString();
    document.getElementById('an-supply').textContent = a.holders.supply.toLocaleString();
    document.getElementById('an-avg').textContent = a.holders.avg.toFixed(2);
    document.getElementById('an-stamp').textContent = 'updated ' + ago(a.holders.updatedAt);

    const h = a.holders;
    const wallets = h.whales + h.mid + h.small;
    const pctOf = function (n) { return wallets ? (n / wallets) * 100 : 0; };
    [['an-seg-w', h.whales], ['an-seg-m', h.mid], ['an-seg-s', h.small]].forEach(function (seg) {
      const el = document.getElementById(seg[0]);
      el.style.width = pctOf(seg[1]) + '%';
      // wide enough to clear the bar's rounded end, so a group of one still shows
      el.style.minWidth = seg[1] > 0 ? '10px' : '0';
    });
    document.getElementById('an-legend').innerHTML =
      leg('#F0821E', h.whales, '10+ Rangers') +
      leg('#FFD98A', h.mid, '3–9') +
      leg('#7E6FB0', h.small, '1–2') +
      '<span class="an-leg" style="color:#8E85A6">Top 10 wallets hold ' + h.top10Pct + '%</span>';
  }

  if (a.floor) {
    document.getElementById('an-floor').textContent = a.floor.sol + ' ◎';
    const d = document.getElementById('an-floor-delta');
    const ch = a.floor.change24h;
    if (ch === null || ch === undefined) {
      d.textContent = '24h —';
      d.className = 'an-delta an-flat';
    } else {
      d.textContent = (ch > 0 ? '▲ ' : ch < 0 ? '▼ ' : '') + Math.abs(ch) + '% 24h';
      d.className = 'an-delta ' + (ch > 0 ? 'an-up' : ch < 0 ? 'an-down' : 'an-flat');
    }
    const listed = a.floor.listed, supply = a.holders && a.holders.supply;
    const vol = a.floor.volume7d ? a.floor.volume7d / 1e9 : 0;
    document.getElementById('an-market').innerHTML =
      (listed ? '<strong>' + listed + '</strong> listed for sale' +
        (supply ? ' — ' + Math.round((listed / supply) * 100) + '% of the collection' : '')
        : 'Nothing listed for sale right now') +
      '<br>' + (vol ? '<strong>' + (vol < 10 ? vol.toFixed(2) : Math.round(vol)) + ' ◎</strong> traded in the last 7 days'
        : 'Nothing traded in the last 7 days');
    drawSpark(a.floor);
  }

  const c = a.collection;
  const story = document.getElementById('an-story');
  if (c && c.alive && c.minted >= c.alive) {
    story.hidden = false;
    story.innerHTML = '<strong>' + c.minted + '</strong> minted · <strong>' + c.burned + '</strong> burned · ' +
      '<strong>' + c.alive + '</strong> still here' + (c.named ? ' · <strong>' + c.named + '</strong> named' : '');
  } else {
    story.hidden = true;
  }

  drawHolders(a.holders);
  loadSales();

  const p = a.participation || {};
  const staked = p.rangersStaked || 0;
  const supply = (a.holders && a.holders.supply) || 0;
  document.getElementById('an-part-sub').textContent = 'Taking part' + (supply
    ? ' — ' + staked + ' of ' + supply + ' Rangers staked' +
      (p.shareOfHolders !== null && p.shareOfHolders !== undefined ? ', by ' + p.shareOfHolders + '% of holders' : '')
    : '');
  const list = document.getElementById('an-stakers');
  // Same rule as every other board on the site; see BOARD_OPENS_AT.
  list.innerHTML = (p.top || []).length === 0
    ? '<div class="an-empty">Nobody has locked a Ranger yet. Be first.</div>'
    : (p.top || []).length < BOARD_OPENS_AT
    ? '<div class="an-empty">' + (p.stakingWallets || 0) + ' wallet' + ((p.stakingWallets || 0) === 1 ? '' : 's') +
      ' staking so far. The list opens up as soon as somebody else joins.</div>'
    : p.top.map(function (r, i) {
        return '<div class="an-row"><span class="an-pos">' + (i + 1) + '</span>' +
          '<span class="an-who">' + escapeHtml(shortWallet(r.wallet)) + '</span>' +
          '<span class="an-n">' + r.rangers + '</span></div>';
      }).join('');
}

function leg(color, n, label) {
  return '<span class="an-leg"><span class="an-dot" style="background:' + color + '"></span>' +
    '<strong>' + n + '</strong>&nbsp;' + label + '</span>';
}

/// The line itself, given values in order. Both charts on this page use it.
function sparkPath(svg, vals, stroke) {
  const lo = Math.min.apply(null, vals);
  const hi = Math.max.apply(null, vals);
  const span = hi - lo || 1;
  const W = 300, H = 64, pad = 6;
  const x = function (i) { return (i / (vals.length - 1)) * W; };
  const y = function (v) { return H - pad - ((v - lo) / span) * (H - pad * 2); };
  const line = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
  const id = 'fade-' + svg.id;
  svg.innerHTML =
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#F0821E" stop-opacity="0.35"/>' +
    '<stop offset="100%" stop-color="#F0821E" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#' + id + ')"/>' +
    '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="2" ' +
    'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
    '<circle cx="' + x(vals.length - 1).toFixed(1) + '" cy="' + y(vals[vals.length - 1]).toFixed(1) + '" r="3" fill="' + stroke + '"/>';
  return { lo: lo, hi: hi };
}

/// Holders over time, from snapshots the worker has been keeping all along.
function drawHolders(h) {
  const panel = document.getElementById('an-hold-panel');
  const pts = (h && h.history) || [];
  if (pts.length < 2) { panel.hidden = true; return; }
  panel.hidden = false;
  const vals = pts.map(function (p) { return p.n; });
  const range = sparkPath(document.getElementById('an-hold-spark'), vals, '#9C8BE0');
  document.getElementById('an-hold-title').textContent = pts.length >= 60 ? 'Holders, last 90 days' : 'Holders since tracking began';
  const change = vals[vals.length - 1] - vals[0];
  document.getElementById('an-hold-note').textContent =
    pts.length + ' days recorded · low ' + range.lo + ' · high ' + range.hi + ' · ' +
    (change === 0 ? 'flat over that stretch' : (change > 0 ? '+' : '') + change + ' holders');
}

// A line needs at least two readings. Until then say so plainly rather
// than drawing a flat line that looks like data.
function drawSpark(floor) {
  const svg = document.getElementById('an-spark');
  const note = document.getElementById('an-spark-note');
  const pts = floor.history || [];

  if (pts.length < 2) {
    svg.innerHTML = '';
    svg.style.display = 'none';
    const since = floor.collectingSince
      ? new Date(floor.collectingSince).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
      : 'today';
    note.textContent = 'No history yet — nobody was recording this, so the chart starts from ' +
      since + '. One reading a day from here; a real line in about a week.';
    return;
  }

  svg.style.display = 'block';
  const range = sparkPath(svg, pts.map(function (p) { return p.sol; }), '#FFD98A');
  const lo = range.lo, hi = range.hi;

  document.getElementById('an-spark-title').textContent = pts.length >= 60
    ? 'Floor, last 90 days'
    : 'Floor since tracking began';
  note.textContent = pts.length + ' days recorded · low ' + lo + ' ◎ · high ' + hi + ' ◎' +
    (floor.change7d !== null && floor.change7d !== undefined ? ' · ' + floor.change7d + '% over 7 days' : '');
}

/// How many plushies are left. These two numbers were typed into the page by
/// hand, so the first sale made them wrong; they now come from the shop. If the
/// shop cannot be reached the typed ones stay, which is no worse than before.
var storeLoaded = false;
/// Stock, from the shop that actually holds it.
///
/// The numbers in the markup are a placeholder for the moment before this
/// answers, not a fallback. Leaving them up when the shop cannot be
/// reached tells somebody there are 93 left because that is what was typed
/// into the page — which may be months old, and may be a lie about a
/// product that has sold out.
function storeUnknown() {
  document.getElementById('product-stock').textContent = 'stock unavailable';
  document.getElementById('store-progress').textContent = '—';
  document.getElementById('store-fill').style.width = '0';
}

// ── BUYING FOX POINTS ──
// Paid the same way a booking is: the worker quotes it, the wallet pays in
// USDC, and the worker credits the points only once it has seen the money
// on chain. The page never credits anything.
var ptsPacks = null;

async function loadPointsPacks() {
  const card = document.getElementById('pts-card');
  if (!card) return;
  try {
    const res = await fetch(POINTS_API + '/api/points/packs', FoxPoints.token
      ? { headers: { Authorization: 'Bearer ' + FoxPoints.token } } : {});
    const d = await res.json();
    if (d.error || !d.packs || !d.packs.length) throw new Error(d.error || 'no packs');
    ptsPacks = d;
    renderPointsPacks(d);
    card.hidden = false;
  } catch (e) {
    // An unreachable rate card leaves no empty shell behind.
    card.hidden = true;
  }
}

function renderPointsPacks(d) {
  document.getElementById('pts-packs').innerHTML = d.packs.map(function (p) {
    return '<button class="pts-pack" onclick="buyPoints(' + p.usd + ')">' +
      '<b>' + p.points.toLocaleString() + ' pts</b>' +
      (p.bonusPct ? '<em class="pts-bonus">+' + p.bonusPct + '%</em>' : '') +
      '<span>$' + p.usd + '</span></button>';
  }).join('');
  // Clicking offers to connect, so the prices are not hidden behind a step
  // nobody has taken yet.
  document.getElementById('pts-note').textContent = d.note;
}

async function buyPoints(usd) {
  const msg = document.getElementById('pts-msg');
  msg.className = 'bk-msg';
  msg.textContent = '';
  if (!FoxPoints.token) {
    try { await connectWallet(); } catch (e) { /* closed the picker */ }
    if (!FoxPoints.token) {
      msg.className = 'bk-msg bad';
      msg.textContent = 'Connect a wallet first, so the points have somewhere to go.';
      return;
    }
  }
  msg.textContent = 'Working…';
  try {
    const res = await fetch(POINTS_API + '/api/points/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + FoxPoints.token },
      body: JSON.stringify({ usd: usd })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    msg.textContent = '';
    // The same payment screen bookings and bundles use, so there is one
    // place where money is asked for and one place it can go wrong.
    document.getElementById('bk-flow').hidden = false;
    switchTab('book');
    document.getElementById('bk-list').hidden = true;
    renderPayment(d, 'points', d.points.toLocaleString() + ' Fox Points',
      function (sig) { showPointsDone(d, sig); });
  } catch (e) {
    msg.className = 'bk-msg bad';
    msg.textContent = e.message || 'That did not work. Try again.';
  }
}

function showPointsDone(d, sig) {
  const flow = document.getElementById('bk-flow');
  flow.hidden = false;
  flow.innerHTML = '<div class="bk-flow bk-done">' +
    '<div class="bk-tick">🪙</div>' +
    '<div class="bk-lead">' + d.points.toLocaleString() + ' Fox Points</div>' +
    '<p class="bk-sub">Added to your balance.</p>' +
    '<div class="bk-ref">' + escapeHtml(d.ref) + '</div>' +
    '<p class="bk-hint">Keep that reference.' +
    (sig ? ' <a href="https://solscan.io/tx/' + encodeURIComponent(sig) + '" target="_blank" rel="noopener noreferrer">View receipt</a>' : '') +
    '</p>' +
    '<button class="bk-go ghost" style="margin-top:14px" onclick="switchTab(\'leaderboard\')">See your points</button>' +
    '</div>';
  FoxPoints.refresh();
}

async function loadStore() {
  if (storeLoaded) return;
  try {
    const res = await fetch(POINTS_API + '/api/store');
    const d = await res.json();
    const p = d && d.product;
    if (!p || !p.quantity) { storeUnknown(); return; }
    storeLoaded = true;
    document.getElementById('product-stock').textContent = p.soldOut
      ? 'Sold out' : p.available + ' available';
    document.getElementById('store-progress').textContent = p.sold + ' / ' + p.quantity;
    document.getElementById('store-fill').style.width = Math.min(100, (p.sold / p.quantity) * 100) + '%';
  } catch (e) {
    storeUnknown();
  }
}

/// The artwork is dropped in at img/collectible.png. Until it is there,
/// say so plainly — the Rangers' "art lost" box means something else
/// entirely, and borrowing it would be a lie about a file that is simply
/// not drawn yet.
var collectibleLoaded = false;

function note(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'plushie-note' + (kind ? ' ' + kind : '');
}

/// How many have been minted, and whether this wallet already has one.
/// Everything about the card that is not typed into the page comes from
/// here, so an unconfigured or sold-out mint cannot look mintable.
async function loadCollectible() {
  const card = document.getElementById('collectible-card');
  const button = document.getElementById('collectible-mint');
  // Hidden until the mint is open. A card nobody can buy from is not a
  // teaser, it is an unfinished shop — and the artwork should not be on
  // display before the thing it sells exists.
  if (!mintConfigured()) {
    card.hidden = true;
    document.getElementById('collectible-badge').textContent = 'OPENING SOON';
    document.getElementById('collectible-minted').textContent = 'not open yet';
    button.disabled = true;
    button.textContent = 'Opening soon';
    return;
  }
  card.hidden = false;
  button.disabled = false;
  if (collectibleLoaded && !Wallet.pubkey) return;
  try {
    const url = POINTS_API + '/api/collectible' +
      (Wallet.pubkey ? '?wallet=' + encodeURIComponent(Wallet.pubkey) : '');
    const res = await fetch(url);
    const d = await res.json();
    collectibleLoaded = true;
    paintMintProgress(d.minted || 0, d.cap || 0);
    if (d.holder) {
      button.disabled = true;
      button.textContent = 'You have one ✓';
      note('collectible-note', 'One per wallet, and yours is already in there.', 'ok');
    }
  } catch (e) { /* the card still says what it costs */ }
}

// ── invite ────────────────────────────────────────────────────────────
// Somebody arrives on a shared link before they have a wallet, connects
// one some minutes later, and only then can be tied to whoever sent them.
// The code has to survive that gap, so it is kept here until a wallet
// exists to bind it to.
const INVITE_PENDING_KEY = 'fox_invite_code';
let inviteData = null;

function inviteFromUrl() {
  try {
    const code = new URLSearchParams(location.search).get('r');
    if (!code) return;
    localStorage.setItem(INVITE_PENDING_KEY, code.trim().toUpperCase().slice(0, 8));
    // Taken out of the address bar so it is not carried into anything the
    // visitor shares from here, which would pass on somebody else's code.
    const url = new URL(location.href);
    url.searchParams.delete('r');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch (e) { /* a code is a nicety, never a blocker */ }
}
inviteFromUrl();

function pendingInvite() {
  try { return localStorage.getItem(INVITE_PENDING_KEY) || ''; } catch (e) { return ''; }
}
function clearPendingInvite() {
  try { localStorage.removeItem(INVITE_PENDING_KEY); } catch (e) { /* nothing to clear */ }
}

function inviteLinkFor(code) {
  return location.origin + location.pathname + '?r=' + encodeURIComponent(code);
}

/// Everything this wallet has earned by inviting people, and the box for
/// anyone who arrived with a code of their own. Both cards stay hidden
/// until there is a wallet, because neither means anything without one.
async function loadInvite() {
  const card = document.getElementById('iv-card');
  const enter = document.getElementById('iv-enter-card');
  if (!card) return;
  if (!FoxPoints || !FoxPoints.token) { card.hidden = true; enter.hidden = true; return; }

  const d = await FoxPoints.api('/api/invite');
  if (!d || d.error || !d.code) { card.hidden = true; enter.hidden = true; return; }

  // Arrived on somebody's link. Binding needs a wallet, which only exists
  // now, so this is the first moment it can be done.
  const waiting = pendingInvite();
  if (waiting && !d.invitedBy) {
    const r = await FoxPoints.api('/api/invite/bind', { method: 'POST', body: { code: waiting } });
    clearPendingInvite();
    if (r && r.ok) return loadInvite();
  } else if (waiting && d.invitedBy) {
    clearPendingInvite();
  }

  inviteData = d;
  card.hidden = false;
  document.getElementById('iv-link').value = inviteLinkFor(d.code);
  document.getElementById('iv-lead').innerHTML =
    'Share this and you earn <strong>' + d.sharePct + '% of the swap fee</strong> from every wallet that ' +
    'arrives through it — for as long as they keep swapping. ' +
    (d.sharePct === d.rangerPct
      ? 'That is the Moon Ranger rate.'
      : 'Hold a Moon Ranger and it goes up to ' + d.rangerPct + '%.');

  document.getElementById('iv-stats').innerHTML =
    '<div class="iv-stat"><b>' + d.invited + '</b><span>Invited</span></div>' +
    '<div class="iv-stat"><b>' + d.traded + '</b><span>Swapped</span></div>' +
    '<div class="iv-stat"><b>$' + d.earnedUsd.toFixed(2) + '</b><span>Earned</span></div>';

  // Said plainly, because at this volume the honest number is small and a
  // dashboard that hides that is the thing that loses trust.
  const claim = document.getElementById('iv-claim');
  claim.innerHTML =
    '<button id="iv-claim-btn" onclick="claimInvite()"' + (d.claimable ? '' : ' disabled') + '>' +
    (d.claimable ? 'Claim $' + d.availableUsd.toFixed(2) : '$' + d.availableUsd.toFixed(2) + ' so far') +
    '</button>' +
    '<p class="iv-note">Paid in USDC once you have $' + d.claimMinUsd + '. ' +
    'Nothing is paid for a signup — only for swaps the people you invite actually make.' +
    (d.queuedClaims.length
      ? ' <strong>$' + d.queuedClaims.reduce(function (n, c) { return n + c.usd; }, 0).toFixed(2) +
        ' is queued for payment.</strong>'
      : '') +
    '</p>';

  // Only shown while it can still be used: a code can never be changed.
  enter.hidden = !!d.invitedBy;
  if (!d.invitedBy) {
    document.getElementById('iv-enter-lead').textContent =
      'Someone send you here? Put their code in and you earn ' + d.refereePoints +
      ' Fox Points on your first swap of $' + d.refereeMinUsd + ' or more.';
    if (waiting) document.getElementById('iv-code').value = waiting;
  }
}

async function copyInviteLink() {
  const link = document.getElementById('iv-link').value;
  try {
    await navigator.clipboard.writeText(link);
    note('iv-msg', 'Link copied.', 'ok');
  } catch (e) {
    document.getElementById('iv-link').select();
    note('iv-msg', 'Press copy — the link is selected.', '');
  }
}

async function useInviteCode() {
  const el = document.getElementById('iv-code');
  const code = (el.value || '').trim().toUpperCase();
  if (!code) { note('iv-enter-msg', 'Put a code in first.', 'bad'); return; }
  note('iv-enter-msg', 'Checking…', '');
  const r = await FoxPoints.api('/api/invite/bind', { method: 'POST', body: { code: code } });
  if (!r || r.error) { note('iv-enter-msg', (r && r.error) || 'That did not work.', 'bad'); return; }
  clearPendingInvite();
  note('iv-enter-msg', r.note || 'Code accepted.', 'ok');
  loadInvite();
}

async function claimInvite() {
  const btn = document.getElementById('iv-claim-btn');
  if (btn) btn.disabled = true;
  note('iv-msg', 'Asking…', '');
  const r = await FoxPoints.api('/api/invite/claim', { method: 'POST' });
  if (!r || r.error) {
    note('iv-msg', (r && r.error) || 'Could not claim right now.', 'bad');
    if (btn) btn.disabled = false;
    return;
  }
  note('iv-msg', '$' + Number(r.claimed).toFixed(2) + ' queued — it is paid in USDC by hand, so give it a day or two.', 'ok');
  loadInvite();
}

/// The platforms worth passing on. Content lives in referrals.json so a new
/// one is a data change, not a deploy of the page — and the tab stays out
/// of the menu entirely while there is nothing behind it.
async function loadReferrals() {
  let items = [];
  try {
    const res = await fetch('referrals.json', { cache: 'no-store' });
    const d = await res.json();
    items = Array.isArray(d.items) ? d.items.filter(function (r) { return r && r.name && r.url; }) : [];
  } catch (e) { /* no file, no tab */ }

  // Looked up after the fetch, not before it. A creator who did not put
  // this page on their site has it removed while this is still waiting on
  // the network, and references taken earlier would still point at
  // elements that are no longer in the document.
  const list = document.getElementById('ref-list');
  const tab = document.getElementById('nav-referrals');
  const intro = document.getElementById('ref-intro');
  if (!list || !tab || !intro) return;

  // Nothing to list yet. The tab stays, saying so, rather than vanishing —
  // it is a page that is coming, and the same notice as the other three
  // that are not open yet.
  if (!items.length) {
    tab.hidden = false;
    intro.hidden = true;
    list.innerHTML = soonHtml('Referrals',
      'Platforms I actually use. Some of them give you something for joining ' +
      'through my link, and all of them pay me a referral credit — that is the ' +
      'whole arrangement, said plainly.');
    return;
  }

  tab.hidden = false;
  intro.hidden = false;
  list.innerHTML = items.map(function (r) {
    // rel="sponsored" is what these links are: paid placement, declared to
    // the browser as well as to the reader.
    return '<div class="ref-card">' +
      // A missing or broken logo falls back to the first letter rather than
      // a blank bordered square, which reads as a broken image.
      (r.logo
        ? '<img class="ref-logo" src="' + escapeHtml(r.logo) + '" alt="" loading="lazy" ' +
          'onerror="refLogoMissing(this)"/>'
        : '<div class="ref-logo ref-initial">' + escapeHtml(r.name.trim()[0].toUpperCase()) + '</div>') +
      '<div>' +
        '<div class="ref-head"><span class="ref-name">' + escapeHtml(r.name) + '</span>' +
        (r.tag ? '<span class="ref-tag">' + escapeHtml(r.tag) + '</span>' : '') + '</div>' +
        (r.what ? '<p class="ref-what">' + escapeHtml(r.what) + '</p>' : '') +
        (r.youGet ? '<p class="ref-get">You get: ' + escapeHtml(r.youGet) + '</p>' : '') +
        '<a class="ref-go" href="' + escapeHtml(safeHttps(r.url)) + '" target="_blank" ' +
        'rel="noopener noreferrer sponsored">' + escapeHtml(r.cta || 'Use my link') + ' →</a>' +
      '</div>' +
    '</div>';
  }).join('');
}

function refLogoMissing(img) {
  const tile = document.createElement('div');
  tile.className = 'ref-logo ref-initial';
  const name = img.closest('.ref-card').querySelector('.ref-name');
  tile.textContent = (name.textContent.trim()[0] || '?').toUpperCase();
  img.replaceWith(tile);
}

/// Only ever http(s). A javascript: or data: URL in a data file would run
/// as this page the moment somebody clicked it.
function safeHttps(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '#';
}

/// How far through the 100,000 the mint is. Both numbers come from the
/// worker — the ceiling is the one the candy machine was built with, so
/// this cannot promise a supply the chain will not honour.
function paintMintProgress(minted, cap) {
  const count = document.getElementById('collectible-minted');
  const label = document.getElementById('collectible-progress');
  const fill = document.getElementById('collectible-fill');

  count.textContent = cap
    ? minted.toLocaleString() + ' of ' + cap.toLocaleString()
    : minted.toLocaleString() + ' minted';
  if (!cap) { label.textContent = ''; fill.style.width = '0'; return; }

  const pct = Math.min(100, (minted / cap) * 100);
  // The exact count is already beside the price. This says how far along
  // the run is without ever rounding a fraction of a percent up to one.
  label.textContent = minted === 0 ? 'none yet'
    : pct >= 1 ? Math.round(pct) + '%'
    : pct >= 0.1 ? pct.toFixed(1) + '%'
    : 'under 0.1%';
  fill.style.width = pct + '%';
  // A real fraction of a percent draws as nothing, so anything above zero
  // keeps a visible stripe. The numbers beside it are never rounded up.
  fill.classList.toggle('started', minted > 0);
}

/// Mints one collectible. The asset keypair is generated here and signs
/// here: it exists only to name the account, is never stored, and is of no
/// use to anyone afterwards — the wallet is the owner from the first block.
/// The 0.1 SOL goes from the buyer to the treasury inside the same
/// instruction, so nothing of ours ever holds it.
async function mintCollectible() {
  const button = document.getElementById('collectible-mint');
  if (!mintConfigured()) return;
  if (!Wallet.active) { note('collectible-note', 'Connect a wallet first.', 'bad'); return; }

  const { Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = w3();
  const was = button.textContent;
  button.disabled = true;
  button.textContent = 'Minting…';
  note('collectible-note', 'Approve it in your wallet.', '');

  const asset = Keypair.generate();
  try {
    const ix = await collectibleMintIx({
      candyMachine: MINT.candyMachine,
      candyGuard: MINT.candyGuard,
      collection: MINT.collection,
      treasury: MINT.treasury,
      minter: Wallet.pubkey,
      asset: asset.publicKey.toBase58(),
      mintLimitId: MINT.mintLimitId
    });
    const latest = await rpc().getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: new PublicKey(Wallet.pubkey),
      recentBlockhash: latest.blockhash,
      // A mint through the guards costs more than the default allowance.
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }), ix]
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([asset]);

    let binary = '';
    for (const b of tx.serialize()) binary += String.fromCharCode(b);
    const signature = await sendVersionedTx(btoa(binary), latest.lastValidBlockHeight);

    // A confirmed signature is not proof of a collectible: a guard can
    // refuse a mint inside a transaction that still succeeds. Ask the
    // chain whether the asset is actually there.
    const created = await rpc().getAccountInfo(asset.publicKey);
    if (!created) throw new Error('The mint was refused — nothing was created and nothing was charged beyond the fee.');

    note('collectible-note', 'Minted. It is yours for good.', 'ok');
    button.textContent = 'You have one ✓';

    // Points are granted by the worker after it checks the chain itself,
    // so a made-up signature earns nothing.
    try {
      const res = await fetch(POINTS_API + '/api/collectible/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: Wallet.pubkey, signature: signature, asset: asset.publicKey.toBase58() })
      });
      const d = await res.json();
      if (d && d.points) note('collectible-note', 'Minted, and ' + d.points + ' Fox Points are yours.', 'ok');
    } catch (e) { /* the collectible is minted either way */ }

    collectibleLoaded = false;
    loadCollectible();
    if (FoxPoints.token) FoxPoints.refresh();
  } catch (e) {
    button.disabled = false;
    button.textContent = was;
    note('collectible-note', mintError(e), 'bad');
  }
}

/// Guard refusals come back as raw program errors. Say what happened.
function mintError(e) {
  const text = String((e && e.message) || e);
  if (/0x178c|MintLimit|allowed mints/i.test(text)) return 'This wallet already has one.';
  if (/insufficient|0x1\b/i.test(text)) return 'Not enough SOL — you need 0.1 plus a little for fees.';
  if (/User rejected|rejected the request|declined/i.test(text)) return 'Cancelled.';
  return text;
}

/// What Rangers have actually changed hands for. Quiet if the marketplace
/// has nothing to say, rather than an empty box with an error in it.
async function loadSales() {
  const panel = document.getElementById('an-sales-panel');
  try {
    const res = await fetch(POINTS_API + '/api/collection/sales');
    const d = await res.json();
    const sales = (d && d.sales) || [];
    if (!sales.length) { panel.hidden = true; return; }
    document.getElementById('an-sales').innerHTML = sales.map(function (s) {
      return '<div class="an-sale">' +
        '<span class="an-sale-name">' + escapeHtml(s.name || shortWallet(s.mint)) + '</span>' +
        '<span class="an-sale-price">' + s.sol + ' ◎</span>' +
        '<span class="an-sale-when">' + escapeHtml(ago(s.ts)) + '</span></div>';
    }).join('');
    panel.hidden = false;
  } catch (e) {
    panel.hidden = true;
  }
}

// ── EXPLORE THE COLLECTION ──
// Every living Ranger, its traits, and how rare each one is. Fetched once per
// visit; the worker caches the heavy read for everyone else.
var collection = null;
var traitFilters = {};
var exploreShown = 24;

async function loadCollection() {
  if (collection) return;
  try {
    const res = await fetch(POINTS_API + '/api/collection');
    const d = await res.json();
    if (!d || !d.rangers || !d.rangers.length) return;
    collection = d;
    collection.rangers.sort(function (a, b) { return a.rank - b.rank; });
    renderTraitFilters();
    renderExplore();
    document.getElementById('an-explore-panel').hidden = false;
  } catch (e) {
    // the rest of the page works without this, but a silent failure once hid
    // a real bug here, so leave something to find
    console.warn('collection did not load:', e && e.message);
  }
}

function renderTraitFilters() {
  // a trait where almost every Ranger has its own value (the rarity rank the
  // metadata carries) is not something anyone can filter by
  const types = Object.keys(collection.traits).sort().filter(function (t) {
    return Object.keys(collection.traits[t]).length <= 40;
  });
  document.getElementById('an-filters').innerHTML = types.map(function (type) {
    const values = Object.keys(collection.traits[type]).sort(function (a, b) {
      return collection.traits[type][b] - collection.traits[type][a];
    });
    return '<select data-trait="' + escapeHtml(type) + '" onchange="setTraitFilter(this)">' +
      '<option value="">' + escapeHtml(type) + ' — any</option>' +
      values.map(function (v) {
        return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + ' (' + collection.traits[type][v] + ')</option>';
      }).join('') + '</select>';
  }).join('');
}

function setTraitFilter(sel) {
  const type = sel.dataset.trait;
  if (sel.value) traitFilters[type] = sel.value;
  else delete traitFilters[type];
  exploreShown = 24;
  renderExplore();
}

function clearTraitFilters() {
  traitFilters = {};
  exploreShown = 24;
  document.querySelectorAll('#an-filters select').forEach(function (s) { s.value = ''; });
  document.getElementById('an-detail').hidden = true;
  renderExplore();
}

function matchingRangers() {
  const types = Object.keys(traitFilters);
  return collection.rangers.filter(function (r) {
    return types.every(function (t) { return r.traits[t] === traitFilters[t]; });
  });
}

function renderExplore() {
  const matches = matchingRangers();
  const shown = matches.slice(0, exploreShown);
  document.getElementById('an-explore-count').textContent = matches.length === collection.rangers.length
    ? 'All ' + matches.length + ' Rangers, rarest first'
    : matches.length + ' of ' + collection.rangers.length + ' match';
  document.getElementById('an-explore-grid').innerHTML = shown.map(function (r) {
    const chain = [r.image, r.imageAlt, POINTS_API + '/api/img?mint=' + encodeURIComponent(r.mint)].filter(Boolean);
    return '<div class="an-rgr" data-mint="' + escapeHtml(r.mint) + '" onclick="showRanger(this.dataset.mint)">' +
      '<img src="' + escapeHtml(chain[0] || '') + '" alt="" loading="lazy" ' +
      'data-fallbacks="' + escapeHtml(JSON.stringify(chain.slice(1))) + '" onerror="anImgFallback(this)">' +
      '<div class="an-rgr-name">' + escapeHtml(r.name || 'Unnamed') + '</div>' +
      '<div class="an-rgr-rank">rank ' + r.rank + '</div></div>';
  }).join('') || '<div class="an-empty">No Ranger has all of those traits.</div>';
  document.getElementById('an-explore-more').hidden = matches.length <= exploreShown;
}

/// The grid's own fallback: the picker's version swaps in a Ranger glyph sized
/// for that card, which is the wrong shape here.
function anImgFallback(img) {
  let left = [];
  try { left = JSON.parse(img.getAttribute('data-fallbacks') || '[]'); } catch (e) {}
  if (left.length) {
    img.setAttribute('data-fallbacks', JSON.stringify(left.slice(1)));
    img.src = left[0];
    return;
  }
  // one Ranger's artwork was lost before the migration and cannot be fetched
  // from anywhere; an empty square looks like a bug, so say what it is
  const box = document.createElement('div');
  box.className = 'an-rgr-missing';
  box.textContent = 'art lost';
  if (img.parentNode) img.parentNode.replaceChild(box, img);
}

function showMoreRangers() {
  exploreShown += 24;
  renderExplore();
}

/// One Ranger, with how many others share each of its traits — which is what
/// rarity actually means, rather than a number on its own.
function showRanger(mint) {
  const r = collection.rangers.find(function (x) { return x.mint === mint; });
  if (!r) return;
  document.querySelectorAll('.an-rgr').forEach(function (el) { el.classList.toggle('on', el.dataset.mint === mint); });
  const total = collection.total;
  const rows = Object.keys(r.traits).sort().map(function (type) {
    const value = r.traits[type];
    const n = (collection.traits[type] || {})[value] || 0;
    const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
    return '<div class="an-trait"><span class="an-trait-key">' + escapeHtml(type) + '</span>' +
      '<span class="an-trait-val">' + escapeHtml(value) + ' <small>' + n + ' of ' + total + ' · ' + pct + '%</small></span></div>';
  }).join('');
  const box = document.getElementById('an-detail');
  box.hidden = false;
  box.innerHTML = '<div class="an-detail-top"><span class="an-detail-name">' + escapeHtml(r.name || 'Unnamed') + '</span>' +
    '<span class="an-detail-rank">rarity rank ' + r.rank + ' of ' + total + '</span></div>' + rows +
    '<a href="https://magiceden.io/item-details/' + encodeURIComponent(r.mint) + '" target="_blank" rel="noopener noreferrer">View on Magic Eden</a>';
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function lookupWallet() {
  const el = document.getElementById('an-addr');
  const out = document.getElementById('an-result');
  const who = (el.value || '').trim();
  if (!who) { out.textContent = ''; return; }
  out.textContent = 'Looking…';
  try {
    const res = await fetch(POINTS_API + '/api/analytics/wallet?address=' + encodeURIComponent(who));
    const r = await res.json();
    if (r.error) { out.textContent = r.error; return; }
    if (!r.holds) {
      out.innerHTML = 'That wallet holds <strong>no</strong> Moon Rangers.';
      return;
    }
    out.innerHTML = 'Holds <strong>' + r.holds + '</strong> Ranger' + (r.holds === 1 ? '' : 's') +
      ' · ranked <strong>#' + r.rank + '</strong> of ' + r.ofHolders + ' holders' +
      (r.staked ? ' · <strong>' + r.staked + '</strong> staked' : ' · none staked');
  } catch (e) {
    out.textContent = 'Could not reach the collection data just now.';
  }
}

function ago(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

// ── QUARTERLY MISSIONS ──
// Entries come from ranger-days: one Ranger locked one day = one entry,
// multiplied by how many consecutive quarters you have finished. Everyone
// who finishes gets a guaranteed share; entries only decide the big prizes.
async function loadMission() {
  const card = document.getElementById('mission-card');
  if (!card) return;
  // with no live mission to show, the teaser explains what is coming
  const teaser = function (on) { document.getElementById('moon-teaser').hidden = !on; };
  if (!FoxPoints.token || !FoxPoints.server) { card.hidden = true; teaser(true); return; }
  const r = await FoxPoints.api('/api/mission');
  if (!r || !r.standing) { card.hidden = true; teaser(true); return; }
  renderMission(r);
}

function renderMission(r) {
  const s = r.standing;
  const card = document.getElementById('mission-card');
  card.hidden = false;
  document.getElementById('moon-teaser').hidden = true;

  document.getElementById('mission-name').textContent = s.label + ' Mission';
  const upcoming = s.status === 'upcoming';
  document.getElementById('mission-left').textContent = upcoming
    ? 'opens ' + missionDate(s.starts)
    : (s.daysLeft > 0 ? s.daysLeft + ' day' + (s.daysLeft === 1 ? '' : 's') + ' left' : 'closing');

  document.getElementById('mission-prize').textContent = s.prize
    ? s.prize
    : 'Finish the quarter with a Ranger locked and you are guaranteed points and discount codes. Entries also go into the draw for the headline prizes.';

  document.getElementById('mission-tickets').textContent = s.tickets.toLocaleString();
  document.getElementById('mission-mult').textContent = s.multiplier + '×';
  document.getElementById('mission-days').textContent = s.missionDays;

  // how far through the quarter we are
  const span = s.ends - s.starts;
  const done = Math.min(1, Math.max(0, (Date.now() - s.starts) / span));
  document.getElementById('mission-bar-fill').style.width = (done * 100).toFixed(1) + '%';
  document.getElementById('mission-bar').hidden = upcoming;

  const bits = [];
  bits.push('<strong>' + s.rangers + '</strong> Ranger' + (s.rangers === 1 ? '' : 's') + ' locked');
  if (s.streak > 0) bits.push('<strong>' + s.streak + '</strong> quarter streak');
  if (r.field && r.field.rangers) bits.push('<strong>' + r.field.rangers + '</strong> Rangers staked site-wide');
  // One entry per Ranger per day, so spell the arithmetic out rather than
  // leaving a big number to be read as a duration.
  const sum = s.rangers > 0
    ? '<strong>' + s.rangers + '</strong> Ranger' + (s.rangers === 1 ? '' : 's') + ' \u00d7 <strong>' +
      s.missionDays + '</strong> days' + (s.multiplier > 1 ? ' \u00d7 <strong>' + s.multiplier + '\u00d7</strong> streak' : '') +
      ' = <strong>' + s.projectedTickets.toLocaleString() + '</strong> entries if you stay locked the whole quarter.'
    : '';
  let tail;
  if (upcoming) {
    tail = s.rangers === 0
      ? '<br>Entries start counting on ' + missionDate(s.starts) + '. One entry per Ranger, per day locked.'
      : '<br>' + sum + ' Counting starts ' + missionDate(s.starts) + ' \u2014 nothing to do until then.';
  } else {
    tail = s.rangers === 0
      ? '<br>Lock a Ranger above to start earning entries.'
      : '<br>' + sum;
  }
  document.getElementById('mission-foot').innerHTML = bits.join(' &nbsp;·&nbsp; ') + tail;

  const wrap = document.getElementById('mission-rewards');
  const rewards = r.rewards || [];
  wrap.innerHTML = rewards.length === 0 ? '' : rewards.map(function (w) {
    const what = w.kind === 'points'
      ? w.amount.toLocaleString() + ' Fox Points'
      : (w.detail || w.kind);
    return '<div class="mission-reward">' +
      '<div><div class="mission-reward-what">' + escapeHtml(what) + '</div>' +
      '<div class="mission-reward-when">' + escapeHtml(w.mission_id) + '</div></div>' +
      '<button class="mission-claim" onclick="claimReward(' + w.id + ')"' +
      (w.claimed ? ' disabled>Claimed' : '>Claim') + '</button></div>';
  }).join('');
}

function missionDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function claimReward(id) {
  const r = await FoxPoints.api('/api/mission/claim', { method: 'POST', body: { id: id } });
  if (!r || r.error) { alert(r && r.error ? r.error : 'Could not claim that yet.'); return; }
  if (r.player) FoxPoints.server = r.player;
  FoxPoints.render();
  renderLeaderboard();
  loadMission();
}

async function claimStakePoints() {
  if (FoxPoints.token && FoxPoints.server) {
    const r = await FoxPoints.api('/api/claim', { method: 'POST' });
    if (r && r.player) FoxPoints.server = r.player;
    if (r && r.awarded === 0) alert('Nothing to claim yet — points accrue at 100 per day, per Ranger.');
    FoxPoints.render(); renderStaking(); renderLeaderboard();
    return;
  }
  const s = loadStake();
  const pending = stakeAccrued(s);
  if (pending <= 0) { alert('Nothing to claim yet — points accrue at 100 per day, per Ranger.'); return; }
  s.banked = 0;
  s.since = Date.now();
  saveStake(s);
  FoxPoints.awardCustom('stake', pending);
  renderStaking();
  renderLeaderboard();
}

function renderStaking() {
  const card = document.getElementById('moon-stake-card');
  const connectBtn = document.getElementById('moon-connect-btn');
  const sub = document.getElementById('moon-sub');
  if (!card) return;

  if (!Wallet.pubkey) {
    card.hidden = true;
    if (connectBtn) connectBtn.hidden = false;
    if (sub) sub.innerHTML = 'Connect your wallet and stake your Moon Rangers — <strong>100 Fox Points a day, for every Ranger you stake</strong>.';
    return;
  }

  if (connectBtn) connectBtn.hidden = true;
  card.hidden = false;

  let s = loadStake();
  if (FoxPoints.token && FoxPoints.server && FoxPoints.server.stake) {
    const ss = FoxPoints.server.stake;
    s = { staked: ss.staked, since: ss.since, count: ss.count, banked: 0, _serverAccrued: ss.accrued };
  }
  const status = document.getElementById('moon-stake-status');
  const earned = document.getElementById('moon-stake-earned');
  const btn = document.getElementById('moon-stake-btn');
  const claimWrap = document.getElementById('moon-claim-wrap');
  const pending = (s._serverAccrued !== undefined) ? s._serverAccrued : stakeAccrued(s);

  // wallet line doubles as the ownership-verification readout
  if (sub) {
    if (rangerCount === -2) {
      sub.innerHTML = 'Connected as <strong>' + Wallet.short() + '</strong>';
    } else if (rangerCount === null) {
      sub.innerHTML = 'Checking <strong>' + Wallet.short() + '</strong> for Moon Rangers…';
    } else if (rangerCount === -1) {
      sub.innerHTML = 'Connected as <strong>' + Wallet.short() + '</strong> — couldn\'t verify right now.';
    } else if (rangerCount === 0) {
      sub.innerHTML = 'No Moon Ranger in <strong>' + Wallet.short() + '</strong>. Staking is for holders.';
    } else {
      sub.innerHTML = '<strong>' + rangerCount + ' Moon Ranger' + (rangerCount > 1 ? 's' : '') +
        '</strong> verified in ' + Wallet.short() + ' ✓';
    }
  }

  // block staking until a Ranger is confirmed (an active stake stays visible)
  if (!s.staked) {
    const allowed = rangerCount > 0 || rangerCount === -2;
    btn.disabled = !allowed;
    btn.style.opacity = allowed ? '' : '0.5';
    btn.style.cursor = allowed ? '' : 'not-allowed';
  } else {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
  }

  const rateEl = document.getElementById('moon-stake-rate');

  if (s.staked) {
    const days = (Date.now() - s.since) / DAY_MS;
    status.textContent = s.count + ' Ranger' + (s.count > 1 ? 's' : '') + ' staked · ' +
      (days < 1 ? Math.floor(days * 24) + 'h' : days.toFixed(1) + ' days');
    earned.textContent = pending.toLocaleString();
    if (rateEl) rateEl.textContent = 'points earned · ' + stakeRate(s).toLocaleString() + ' / day';
    btn.textContent = picked.size > 0 ? ('Stake ' + picked.size + ' more') : 'Unstake all';
    claimWrap.hidden = pending <= 0;
  } else {
    if (rateEl) {
      rateEl.textContent = rangerCount > 0
        ? 'would earn ' + (STAKE_RATE_PER_DAY * rangerCount).toLocaleString() + ' / day'
        : '100 / day, per Ranger';
    }
    status.textContent = rangerCount > 0 ? 'Ready to stake' :
      (rangerCount === null ? 'Checking wallet…' : 'Not staked yet');

    earned.textContent = '0';
    btn.textContent = picked.size > 1 ? ('Stake ' + picked.size + ' Rangers') : 'Stake Moon Ranger';
    claimWrap.hidden = true;
  }
}
setInterval(function() {
  if (Wallet.pubkey && document.getElementById('panel-moon').classList.contains('active')) renderStaking();
}, 30000);

// ── LEADERBOARD ──
// Real rankings from the points API, with the curated roster in
// leaderboard.json merged in for anyone not yet signed in.
let lbRoster = null;

async function loadRoster() {
  if (lbRoster) return lbRoster;
  try {
    const res = await fetch('leaderboard.json', { cache: 'no-store' });
    const data = await res.json();
    lbRoster = Array.isArray(data.players) ? data.players : [];
  } catch (e) { lbRoster = []; }
  return lbRoster;
}

function shortWallet(w) {
  return w ? w.slice(0, 4) + '\u2026' + w.slice(-4) : '';
}

async function renderLeaderboard() {
  const el = document.getElementById('lb-table');
  if (!el) return;

  let server = [];
  try {
    const res = await fetch(POINTS_API + '/api/leaderboard', { cache: 'no-store' });
    const data = await res.json();
    server = (data && data.players) ? data.players : [];
  } catch (e) { server = []; }

  const roster = await loadRoster();
  const mine = Wallet.pubkey;

  const rows = server.map(function (p) {
    return { name: shortWallet(p.wallet), wallet: p.wallet, points: p.points, me: mine === p.wallet };
  });

  // curated names for wallets that haven't signed in
  roster.forEach(function (p) {
    if (p.wallet && rows.some(function (r) { return r.wallet === p.wallet; })) return;
    rows.push({ name: p.name, wallet: p.wallet || '', points: p.points || 0, me: false });
  });

  // Only ever add a row for the viewer if the server list does not already
  // contain them — otherwise a connected wallet showed up twice.
  const alreadyListed = rows.some(function (r) { return r.me; });
  if (!alreadyListed && (FoxPoints.server || rows.length === 0)) {
    rows.push({
      name: mine ? shortWallet(mine) : 'You',
      wallet: mine || '',
      points: FoxPoints.total(),
      me: true
    });
  }

  rows.sort(function (a, b) { return b.points - a.points; });

  // This used to need three, written when both entries on it were the
  // owner's own wallets. That is no longer true: two different people
  // earning is a race, and hiding it tells the second one their points did
  // not count.
  const RACE_NEEDS = BOARD_OPENS_AT;
  const others = rows.filter(function (r) { return !r.me; }).length;
  if (rows.length && rows.length < RACE_NEEDS) {
    el.innerHTML = '<div class="lb-log-empty">' +
      (others === 0
        ? 'Be the first fox on the board — connect a wallet and start earning.'
        : others + ' fox' + (others === 1 ? '' : 'es') + ' earning so far. ' +
          'The board opens up as soon as somebody else joins.') +
      '</div>';
    return;
  }

  const medals = ['\ud83e\udd47', '\ud83e\udd48', '\ud83e\udd49'];
  el.innerHTML = rows.map(function (r, i) {
    return '<div class="lb-table-row' + (r.me ? ' me' : '') + '">' +
      '<div class="lb-rank">' + (medals[i] || '#' + (i + 1)) + '</div>' +
      '<div class="lb-who"><div class="lb-who-name">' + escapeHtml(r.name) + (r.me ? ' \u2190 you' : '') + '</div>' +
      (r.wallet && r.name !== shortWallet(r.wallet)
        ? '<div class="lb-who-wallet">' + escapeHtml(shortWallet(r.wallet)) + '</div>' : '') +
      '</div><div class="lb-score">' + r.points.toLocaleString() + '</div></div>';
  }).join('');

  if (!rows.length) {
    el.innerHTML = '<div class="lb-log-empty">Be the first fox on the board \u2014 connect a wallet and start earning.</div>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

renderLeaderboard();

  
// A direct link to #moon restores that tab near the top of this script,
// long before POINTS_API is initialised — so the first analytics load has
// to happen down here, once everything exists.
if (document.getElementById('panel-moon').classList.contains('active')) {
  loadCollection();
  loadAnalytics();
  if (!analyticsTimer) analyticsTimer = setInterval(loadAnalytics, 300000);
}
if (document.getElementById('panel-book').classList.contains('active')) { loadBooking(); loadBundles(); }
if (document.getElementById('panel-swap').classList.contains('active')) loadSwap();
if (document.getElementById('panel-store').classList.contains('active')) { loadStore(); loadCollectible(); loadPointsPacks(); }
// Runs whatever tab is open: it is what decides whether Referrals is in
// the menu at all.
loadReferrals();

// Lets the entry module write this module's mutable state: a module namespace
// is read-only from outside, so the live bindings on window need a door opened
// deliberately from in here.
export function __set(name, value) {
  switch (name) {
    case 'BOARD_OPENS_AT': BOARD_OPENS_AT = value; return;
    case 'SWAP_SIGN_TIMEOUT_MS': SWAP_SIGN_TIMEOUT_MS = value; return;
    case 'bkData': bkData = value; return;
    case 'bkPacks': bkPacks = value; return;
    case 'collectibleLoaded': collectibleLoaded = value; return;
    case 'collection': collection = value; return;
    case 'picked': picked = value; return;
    case 'rangerList': rangerList = value; return;
    case 'stakedAt': stakedAt = value; return;
    case 'stakedMints': stakedMints = value; return;
    case 'storeLoaded': storeLoaded = value; return;
    case 'swapBalances': swapBalances = value; return;
    case 'swapPair': swapPair = value; return;
    case 'swapPrices': swapPrices = value; return;
    case 'swapProtect': swapProtect = value; return;
    case 'swapQuote': swapQuote = value; return;
    case 'swapSlippage': swapSlippage = value; return;
    case 'swapTokens': swapTokens = value; return;
    default: throw new Error('not settable from outside: ' + name);
  }
}

export {
  BOARD_OPENS_AT,
  FoxPoints,
  LAUNCHPAD,
  MINT,
  Privy,
  SENDER_TIP_ACCOUNTS,
  SOON_TABS,
  SWAP_SIGN_TIMEOUT_MS,
  TOKEN_PROGRAM,
  Wallet,
  adCreativeFor,
  ago,
  anImgFallback,
  backToRateCard,
  bkData,
  bkPacks,
  burnSelected,
  buyPoints,
  cartCheckout,
  cartClear,
  cartDrop,
  cartPay,
  chooseToken,
  clShow,
  claimDaily,
  claimInvite,
  claimReward,
  claimStakePoints,
  clearTraitFilters,
  closeEmpty,
  closeMenu,
  closeTokenPicker,
  collectibleLoaded,
  collectibleMintIx,
  collection,
  connectWallet,
  copyInviteLink,
  defi,
  doDefi,
  doSwap,
  findBooking,
  findBundle,
  flipSwap,
  goSlide,
  loadBundles,
  loadCollectible,
  loadDefiBalances,
  loadDefiRate,
  loadInvite,
  loadPointsPacks,
  loadReferrals,
  loadStore,
  loadSwapLeaderboard,
  lookupWallet,
  mintCollectible,
  money,
  note,
  offerSlippageFix,
  openMenu,
  openSwapReceipt,
  openTokenPicker,
  packSlots,
  paintDefiPosition,
  paintMintProgress,
  paintPair,
  payWithWallet,
  pickPackMode,
  pickSlot,
  pickWeeks,
  picked,
  quoteSwap,
  rangerList,
  redeemCreditNow,
  redeemPick,
  refLogoMissing,
  refreshSwapBalance,
  renderLeaderboard,
  renderPackForm,
  renderPicker,
  resetCleanup,
  rgImgFallback,
  rpc,
  scanCleanup,
  selectGroup,
  sendAdCreative,
  sendBrief,
  setDefiSide,
  setSlippage,
  setSwapPct,
  setSwapProtect,
  setSwapSpeed,
  setTraitFilter,
  shareSwapLink,
  showBookingDone,
  showCartDone,
  showMoreRangers,
  showRanger,
  signOnlyFor,
  signOnlyIsRisky,
  soonHtml,
  stakedAt,
  stakedMints,
  startAdBooking,
  startBooking,
  startBundle,
  storeLoaded,
  submitAd,
  submitBooking,
  submitBundle,
  swapBalances,
  swapPair,
  swapPrices,
  swapProtect,
  swapQuote,
  swapSlippage,
  swapTokens,
  switchTab,
  systemTransferIx,
  tabButton,
  toggleBurn,
  toggleFavourite,
  toggleMenu,
  togglePackSlot,
  togglePick,
  toggleSelectAll,
  toggleStake,
  toggleSwapHistory,
  toggleSwapUnit,
  toggleWorthless,
  unwrapSol,
  usdcUnits,
  useInviteCode,
  useRecentPair,
  walletAccountsChanged,
  walletChipClick
};
