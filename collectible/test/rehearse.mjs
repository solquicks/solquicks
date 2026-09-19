// Rehearses the whole collectible against a local validator running the real
// mainnet programs, so nothing is discovered for the first time with real SOL.
//
// Devnet is no use here: it runs a different, newer build of the Candy Machine
// program than mainnet does, and that build rejects the same setup mainnet
// accepts. Cloning mainnet is the only faithful rehearsal.
//
//   solana-test-validator --reset --quiet \
//     --url https://api.mainnet-beta.solana.com \
//     --clone-upgradeable-program CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J \
//     --clone-upgradeable-program CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ \
//     --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d &
//   node test/rehearse.mjs
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  generateSigner, keypairIdentity, publicKey, sol, some, none
} from '@metaplex-foundation/umi';
import { mplCore, createCollection, fetchAsset, transferV1 } from '@metaplex-foundation/mpl-core';
import { create, mplCandyMachine, mintV1, fetchCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TREASURY = publicKey('uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc');
const PRICE = 0.1;

const umi = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine());
const authority = generateSigner(umi);
umi.use(keypairIdentity(authority));
await umi.rpc.airdrop(authority.publicKey, sol(100));

const collection = generateSigner(umi);
await createCollection(umi, {
  collection: collection,
  name: 'solquicks Collectibles',
  uri: 'https://example.com/collection.json',
  plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }]
}).sendAndConfirm(umi);

const candyMachine = generateSigner(umi);
await (await create(umi, {
  candyMachine: candyMachine,
  collection: collection.publicKey,
  collectionUpdateAuthority: umi.identity,
  itemsAvailable: 100000,
  isMutable: false,
  configLineSettings: none(),
  hiddenSettings: some({
    name: 'solquicks Collectible #$ID$',
    uri: 'https://example.com/asset.json',
    hash: new Uint8Array(32)
  }),
  guards: {
    solPayment: some({ lamports: sol(PRICE), destination: TREASURY }),
    mintLimit: some({ id: 1, limit: 1 })
  }
})).sendAndConfirm(umi);

const cm = await fetchCandyMachine(umi, candyMachine.publicKey);
const candyGuard = cm.mintAuthority;

// A buyer who has never touched any of this.
const buyer = generateSigner(umi);
await umi.rpc.airdrop(buyer.publicKey, sol(5));
const buyerUmi = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine()).use(keypairIdentity(buyer));

const asset = generateSigner(buyerUmi);
const treasuryBefore = await umi.rpc.getBalance(TREASURY);

await mintV1(buyerUmi, {
  candyMachine: candyMachine.publicKey,
  candyGuard: candyGuard,
  asset: asset,
  collection: collection.publicKey,
  mintArgs: {
    solPayment: some({ destination: TREASURY }),
    mintLimit: some({ id: 1 })
  }
}).prepend(setComputeUnitLimit(buyerUmi, { units: 400000 })).sendAndConfirm(buyerUmi);

test('the buyer owns the asset', async function () {
  const a = await fetchAsset(umi, asset.publicKey);
  assert.equal(a.owner, buyer.publicKey);
});

test('each collectible is numbered', async function () {
  const a = await fetchAsset(umi, asset.publicKey);
  // $ID$ is replaced with the mint index, so the first is #0.
  assert.match(a.name, /^solquicks Collectible #\d+$/);
  assert.ok(!a.name.includes('$ID$'), 'the template was left unsubstituted: ' + a.name);
});

test('it belongs to the collection', async function () {
  const a = await fetchAsset(umi, asset.publicKey);
  assert.equal(a.updateAuthority.type, 'Collection');
  assert.equal(a.updateAuthority.address, collection.publicKey);
});

test('the price went to the treasury, not to us', async function () {
  const after = await umi.rpc.getBalance(TREASURY);
  const paid = Number(after.basisPoints - treasuryBefore.basisPoints) / 1e9;
  assert.equal(paid, PRICE);
});

test('it is soulbound: the owner cannot transfer it', async function () {
  const someoneElse = generateSigner(umi);
  await assert.rejects(
    transferV1(buyerUmi, {
      asset: asset.publicKey,
      collection: collection.publicKey,
      newOwner: someoneElse.publicKey
    }).sendAndConfirm(buyerUmi),
    function (e) { return /InvalidAuthority|frozen|custom program error/i.test(String(e)); }
  );
  const a = await fetchAsset(umi, asset.publicKey);
  assert.equal(a.owner, buyer.publicKey, 'it moved — it is not soulbound');
});

test('nobody can thaw it, including us', async function () {
  // Minted assets carry the collection's permanent freeze, and its authority
  // is None: no key anywhere can flip it back. That is what makes this
  // soulbound for good rather than soulbound until we change our minds.
  const a = await fetchAsset(umi, asset.publicKey);
  assert.ok(a.permanentFreezeDelegate, 'no permanent freeze on the asset');
  assert.equal(a.permanentFreezeDelegate.frozen, true);
  assert.equal(a.permanentFreezeDelegate.authority.type, 'None');
});

test('one per wallet, and the refusal is a real failure', async function () {
  const second = generateSigner(buyerUmi);
  await assert.rejects(
    mintV1(buyerUmi, {
      candyMachine: candyMachine.publicKey,
      candyGuard: candyGuard,
      asset: second,
      collection: collection.publicKey,
      mintArgs: { solPayment: some({ destination: TREASURY }), mintLimit: some({ id: 1 }) }
    }).prepend(setComputeUnitLimit(buyerUmi, { units: 400000 })).sendAndConfirm(buyerUmi)
  );
  // With a bot tax configured this would have *succeeded* while creating
  // nothing, so check the asset really is absent either way.
  const account = await umi.rpc.getAccount(second.publicKey);
  assert.equal(account.exists, false, 'a second collectible was created');
});

test('a different wallet can still mint', async function () {
  const other = generateSigner(umi);
  await umi.rpc.airdrop(other.publicKey, sol(5));
  const otherUmi = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine()).use(keypairIdentity(other));
  const a2 = generateSigner(otherUmi);
  await mintV1(otherUmi, {
    candyMachine: candyMachine.publicKey,
    candyGuard: candyGuard,
    asset: a2,
    collection: collection.publicKey,
    mintArgs: { solPayment: some({ destination: TREASURY }), mintLimit: some({ id: 1 }) }
  }).prepend(setComputeUnitLimit(otherUmi, { units: 400000 })).sendAndConfirm(otherUmi);
  const fetched = await fetchAsset(umi, a2.publicKey);
  assert.equal(fetched.owner, other.publicKey);
});
