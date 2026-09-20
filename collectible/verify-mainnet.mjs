import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import { mplCore, fetchCollection } from '@metaplex-foundation/mpl-core';
import { mplCandyMachine, fetchCandyMachine, fetchCandyGuard } from '@metaplex-foundation/mpl-core-candy-machine';

const cache = JSON.parse(fs.readFileSync('./cache.mainnet.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const umi = createUmi('https://api.mainnet-beta.solana.com').use(mplCore()).use(mplCandyMachine());

const col = await fetchCollection(umi, publicKey(cache.collection));
const freeze = col.permanentFreezeDelegate;
console.log('COLLECTION');
console.log('  name          :', col.name, col.name === config.collectionName ? '✓' : '✗ expected ' + config.collectionName);
console.log('  uri           :', col.uri.slice(0, 46) + '…');
console.log('  frozen        :', freeze && freeze.frozen, freeze && freeze.frozen ? '✓' : '✗');
console.log('  thaw authority:', freeze && freeze.authority.type,
  freeze && freeze.authority.type === 'None' ? '✓ nobody can ever thaw it' : '✗ SOMEONE CAN THAW IT');

const cm = await fetchCandyMachine(umi, publicKey(cache.candyMachine));
const hidden = cm.data.hiddenSettings.__option === 'Some' ? cm.data.hiddenSettings.value : null;
console.log('\nCANDY MACHINE');
console.log('  items         :', Number(cm.data.itemsAvailable), Number(cm.data.itemsAvailable) === config.itemsAvailable ? '✓' : '✗');
console.log('  redeemed      :', Number(cm.itemsRedeemed));
console.log('  name template :', hidden && hidden.name, hidden && hidden.name === config.assetName + ' #$ID$' ? '✓' : '✗');
console.log('  asset uri     :', hidden && hidden.uri.slice(0, 46) + '…');
console.log('  collection    :', cm.collectionMint, cm.collectionMint === cache.collection ? '✓' : '✗');

const guard = await fetchCandyGuard(umi, publicKey(cache.candyGuard));
const pay = guard.guards.solPayment.__option === 'Some' ? guard.guards.solPayment.value : null;
const limit = guard.guards.mintLimit.__option === 'Some' ? guard.guards.mintLimit.value : null;
console.log('\nGUARDS');
console.log('  price         :', pay && Number(pay.lamports.basisPoints) / 1e9, 'SOL',
  pay && Number(pay.lamports.basisPoints) / 1e9 === config.priceSol ? '✓' : '✗');
console.log('  paid to       :', pay && pay.destination, pay && pay.destination === config.treasury ? '✓ the Sanctum wallet' : '✗ WRONG DESTINATION');
console.log('  per wallet    :', limit && limit.limit, limit && limit.limit === config.mintLimitPerWallet ? '✓' : '✗');
console.log('  bot tax       :', guard.guards.botTax.__option === 'None' ? 'none ✓' : 'SET ✗');
