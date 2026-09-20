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
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Read from the files that will actually be used, so this rehearses the real
// thing rather than a copy of it that can drift.
const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const uploaded = JSON.parse(fs.readFileSync(new URL('../uploaded.json', import.meta.url), 'utf8'));
const TREASURY = publicKey(config.treasury);
const PRICE = config.priceSol;

const umi = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine());
const authority = generateSigner(umi);
umi.use(keypairIdentity(authority));
await umi.rpc.airdrop(authority.publicKey, sol(100));

const collection = generateSigner(umi);
await createCollection(umi, {
  collection: collection,
  name: config.collectionName,
  uri: uploaded.collection,
  plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }]
}).sendAndConfirm(umi);

const candyMachine = generateSigner(umi);
await (await create(umi, {
  candyMachine: candyMachine,
  collection: collection.publicKey,
  collectionUpdateAuthority: umi.identity,
  itemsAvailable: config.itemsAvailable,
  isMutable: false,
  configLineSettings: none(),
  hiddenSettings: some({
    name: config.assetName + ' #$ID$',
    uri: uploaded.asset,
    hash: new Uint8Array(32)
  }),
  guards: {
    solPayment: some({ lamports: sol(PRICE), destination: TREASURY }),
    mintLimit: some({ id: 1, limit: config.mintLimitPerWallet })
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
  assert.equal(a.name, config.assetName + ' #0');
});

test('it points at the metadata that was actually published', async function () {
  const a = await fetchAsset(umi, asset.publicKey);
  assert.equal(a.uri, uploaded.asset);
  const res = await fetch(uploaded.asset.replace('arweave.net', 'vilenarios.com'));
  const meta = await res.json();
  assert.equal(meta.name, config.assetName);
  assert.equal(meta.description, config.description);
  assert.equal(meta.attributes.length, config.attributes.length);
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
