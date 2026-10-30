// solquicks.com — the entry point.
//
// Imports the base and every feature module, then publishes the page's public
// surface. It exists so no feature has to import from another: app.js is the
// base and features import FROM it, never the other way round.
//
// That direction matters. When app.js imported a feature back, the feature was
// evaluated first and reached for constants app.js had not defined yet —
// "Cannot access 'DEVNET_MODE' before initialization", a circular import doing
// exactly what circular imports do.

import * as app from './app.js';
import * as flip from './flip.js';

const api = Object.assign({}, app, flip);

// ── THE PAGE'S PUBLIC SURFACE ──────────────────────────────────────────
// This script is a module, so everything above is private to it. Two kinds
// of caller still need names: the page's own onclick attributes, which can
// only see globals, and the browser tests, which drive the page by calling
// into it. Everything NOT listed here is now genuinely private, which is
// the point of the exercise.
//
// The list is generated from the attributes in the page and the names the
// tests use, so it describes what is actually depended on rather than what
// somebody remembered to add.
Object.assign(window, {
  FoxPoints: api.FoxPoints,
  LAUNCHPAD: api.LAUNCHPAD,
  MINT: api.MINT,
  Privy: api.Privy,
  SENDER_TIP_ACCOUNTS: api.SENDER_TIP_ACCOUNTS,
  SOON_TABS: api.SOON_TABS,
  TOKEN_PROGRAM: api.TOKEN_PROGRAM,
  Wallet: api.Wallet,
  adCreativeFor: api.adCreativeFor,
  ago: api.ago,
  anImgFallback: api.anImgFallback,
  backToRateCard: api.backToRateCard,
  burnSelected: api.burnSelected,
  buyPoints: api.buyPoints,
  cartCheckout: api.cartCheckout,
  cartClear: api.cartClear,
  cartDrop: api.cartDrop,
  cartPay: api.cartPay,
  cfFlip: api.cfFlip,
  cfPick: api.cfPick,
  cfSetWager: api.cfSetWager,
  chooseToken: api.chooseToken,
  clShow: api.clShow,
  claimDaily: api.claimDaily,
  claimGamePoints: api.claimGamePoints,
  claimInvite: api.claimInvite,
  claimReward: api.claimReward,
  claimStakePoints: api.claimStakePoints,
  clearTraitFilters: api.clearTraitFilters,
  closeEmpty: api.closeEmpty,
  closeMenu: api.closeMenu,
  closeTokenPicker: api.closeTokenPicker,
  collectibleMintIx: api.collectibleMintIx,
  connectWallet: api.connectWallet,
  copyInviteLink: api.copyInviteLink,
  defi: api.defi,
  doDefi: api.doDefi,
  doSwap: api.doSwap,
  findBooking: api.findBooking,
  findBundle: api.findBundle,
  flipSwap: api.flipSwap,
  goSlide: api.goSlide,
  loadBundles: api.loadBundles,
  loadCollectible: api.loadCollectible,
  loadDefiBalances: api.loadDefiBalances,
  loadDefiRate: api.loadDefiRate,
  loadInvite: api.loadInvite,
  loadGamePoints: api.loadGamePoints,
  loadPointsPacks: api.loadPointsPacks,
  loadReferrals: api.loadReferrals,
  loadStore: api.loadStore,
  loadSwapLeaderboard: api.loadSwapLeaderboard,
  lookupWallet: api.lookupWallet,
  mintCollectible: api.mintCollectible,
  money: api.money,
  note: api.note,
  offerSlippageFix: api.offerSlippageFix,
  openMenu: api.openMenu,
  openSwapReceipt: api.openSwapReceipt,
  openTokenPicker: api.openTokenPicker,
  packSlots: api.packSlots,
  paintDefiPosition: api.paintDefiPosition,
  paintMintProgress: api.paintMintProgress,
  paintPair: api.paintPair,
  payWithWallet: api.payWithWallet,
  pickPackMode: api.pickPackMode,
  pickSlot: api.pickSlot,
  pickWeeks: api.pickWeeks,
  quoteSwap: api.quoteSwap,
  redeemCreditNow: api.redeemCreditNow,
  redeemPick: api.redeemPick,
  refLogoMissing: api.refLogoMissing,
  refreshSwapBalance: api.refreshSwapBalance,
  renderLeaderboard: api.renderLeaderboard,
  renderPackForm: api.renderPackForm,
  renderPicker: api.renderPicker,
  resetCleanup: api.resetCleanup,
  rgImgFallback: api.rgImgFallback,
  rpc: api.rpc,
  scanCleanup: api.scanCleanup,
  selectGroup: api.selectGroup,
  sendAdCreative: api.sendAdCreative,
  sendBrief: api.sendBrief,
  setDefiSide: api.setDefiSide,
  setSlippage: api.setSlippage,
  setSwapPct: api.setSwapPct,
  setSwapProtect: api.setSwapProtect,
  setSwapSpeed: api.setSwapSpeed,
  setTraitFilter: api.setTraitFilter,
  shareSwapLink: api.shareSwapLink,
  showBookingDone: api.showBookingDone,
  showCartDone: api.showCartDone,
  showMoreRangers: api.showMoreRangers,
  showRanger: api.showRanger,
  signOnlyFor: api.signOnlyFor,
  signOnlyIsRisky: api.signOnlyIsRisky,
  soonHtml: api.soonHtml,
  startAdBooking: api.startAdBooking,
  startBooking: api.startBooking,
  startBundle: api.startBundle,
  submitAd: api.submitAd,
  submitBooking: api.submitBooking,
  submitBundle: api.submitBundle,
  switchTab: api.switchTab,
  systemTransferIx: api.systemTransferIx,
  tabButton: api.tabButton,
  toggleBurn: api.toggleBurn,
  toggleFavourite: api.toggleFavourite,
  toggleMenu: api.toggleMenu,
  togglePackSlot: api.togglePackSlot,
  togglePick: api.togglePick,
  toggleSelectAll: api.toggleSelectAll,
  toggleStake: api.toggleStake,
  toggleSwapHistory: api.toggleSwapHistory,
  toggleSwapUnit: api.toggleSwapUnit,
  toggleWorthless: api.toggleWorthless,
  unwrapSol: api.unwrapSol,
  usdcUnits: api.usdcUnits,
  useInviteCode: api.useInviteCode,
  useRecentPair: api.useRecentPair,
  walletAccountsChanged: api.walletAccountsChanged,
  walletChipClick: api.walletChipClick
});

// Mutable state needs a live binding, not a copy: a test that sets
// swapPair must change the one this module reads, and a value this module
// reassigns must be the one a test sees afterwards. A plain copy would
// silently give each side its own.
// Each of these reads and writes the module's own binding, through the module
// namespace. Written as a bare name it would resolve to the global instead —
// which is this very property — and the getter would call itself until the
// stack ran out. That is exactly what it did.
Object.defineProperty(window, 'BOARD_OPENS_AT', { get: () => app.BOARD_OPENS_AT, set: (v) => { app.__set('BOARD_OPENS_AT', v); }, configurable: true });
Object.defineProperty(window, 'SWAP_SIGN_TIMEOUT_MS', { get: () => app.SWAP_SIGN_TIMEOUT_MS, set: (v) => { app.__set('SWAP_SIGN_TIMEOUT_MS', v); }, configurable: true });
Object.defineProperty(window, 'bkData', { get: () => app.bkData, set: (v) => { app.__set('bkData', v); }, configurable: true });
Object.defineProperty(window, 'bkPacks', { get: () => app.bkPacks, set: (v) => { app.__set('bkPacks', v); }, configurable: true });
Object.defineProperty(window, 'collectibleLoaded', { get: () => app.collectibleLoaded, set: (v) => { app.__set('collectibleLoaded', v); }, configurable: true });
Object.defineProperty(window, 'collection', { get: () => app.collection, set: (v) => { app.__set('collection', v); }, configurable: true });
Object.defineProperty(window, 'picked', { get: () => app.picked, set: (v) => { app.__set('picked', v); }, configurable: true });
Object.defineProperty(window, 'rangerList', { get: () => app.rangerList, set: (v) => { app.__set('rangerList', v); }, configurable: true });
Object.defineProperty(window, 'stakedAt', { get: () => app.stakedAt, set: (v) => { app.__set('stakedAt', v); }, configurable: true });
Object.defineProperty(window, 'stakedMints', { get: () => app.stakedMints, set: (v) => { app.__set('stakedMints', v); }, configurable: true });
Object.defineProperty(window, 'storeLoaded', { get: () => app.storeLoaded, set: (v) => { app.__set('storeLoaded', v); }, configurable: true });
Object.defineProperty(window, 'swapBalances', { get: () => app.swapBalances, set: (v) => { app.__set('swapBalances', v); }, configurable: true });
Object.defineProperty(window, 'swapPair', { get: () => app.swapPair, set: (v) => { app.__set('swapPair', v); }, configurable: true });
Object.defineProperty(window, 'swapPrices', { get: () => app.swapPrices, set: (v) => { app.__set('swapPrices', v); }, configurable: true });
Object.defineProperty(window, 'swapProtect', { get: () => app.swapProtect, set: (v) => { app.__set('swapProtect', v); }, configurable: true });
Object.defineProperty(window, 'swapQuote', { get: () => app.swapQuote, set: (v) => { app.__set('swapQuote', v); }, configurable: true });
Object.defineProperty(window, 'swapSlippage', { get: () => app.swapSlippage, set: (v) => { app.__set('swapSlippage', v); }, configurable: true });
Object.defineProperty(window, 'swapTokens', { get: () => app.swapTokens, set: (v) => { app.__set('swapTokens', v); }, configurable: true });
