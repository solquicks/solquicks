import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, keypairIdentity, publicKey, sol, some, none } from '@metaplex-foundation/umi';
import { mplCore, createCollection, fetchAsset, updateV1 } from '@metaplex-foundation/mpl-core';
import { create, mplCandyMachine, mintV1, fetchCandyMachine, updateCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';

const umi = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine());
const auth = generateSigner(umi); umi.use(keypairIdentity(auth));
await umi.rpc.airdrop(auth.publicKey, sol(50));
const TREAS = publicKey('FndhEjYMXMhihnoUfZbgm7mTWgCpcwoT3NikTABLV37m');

const collection = generateSigner(umi);
await createCollection(umi, { collection, name: 'solquicks soulbound', uri: 'https://arweave.net/c',
  plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }] }).sendAndConfirm(umi);

const cmS = generateSigner(umi);
await (await create(umi, { candyMachine: cmS, collection: collection.publicKey, collectionUpdateAuthority: umi.identity,
  itemsAvailable: 100000, isMutable: false, configLineSettings: none(),
  hiddenSettings: some({ name: 'solquicks soulbound #$ID$', uri: 'https://arweave.net/a', hash: new Uint8Array(32) }),
  guards: { solPayment: some({ lamports: sol(0.1), destination: TREAS }), mintLimit: some({ id: 1, limit: 1 }) }
})).sendAndConfirm(umi);
const guard = (await fetchCandyMachine(umi, cmS.publicKey)).mintAuthority;

async function mintOne(label) {
  const b = generateSigner(umi); await umi.rpc.airdrop(b.publicKey, sol(1));
  const bu = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine()).use(keypairIdentity(b));
  const a = generateSigner(bu);
  await mintV1(bu, { candyMachine: cmS.publicKey, candyGuard: guard, asset: a, collection: collection.publicKey,
    mintArgs: { solPayment: some({ destination: TREAS }), mintLimit: some({ id: 1 }) }
  }).prepend(setComputeUnitLimit(bu, { units: 400000 })).sendAndConfirm(bu);
  const f = await fetchAsset(umi, a.publicKey);
  console.log(label, '→ "' + f.name + '"');
  return a.publicKey;
}

const first = await mintOne('mint before any change ');

// 1 · can the template be changed for future mints, after one has been minted?
try {
  const cm = await fetchCandyMachine(umi, cmS.publicKey);
  await updateCandyMachine(umi, {
    candyMachine: cmS.publicKey,
    data: { ...cm.data, hiddenSettings: some({ name: 'quicks #$ID$', uri: 'https://arweave.net/a', hash: new Uint8Array(32) }) }
  }).sendAndConfirm(umi);
  console.log('\nrenaming future mints: ALLOWED');
} catch (e) {
  console.log('\nrenaming future mints: REFUSED —', (e.message || '').slice(0, 110));
}
await mintOne('mint after the change  ');

// 2 · can an asset already minted be renamed?
try {
  await updateV1(umi, { asset: first, collection: collection.publicKey, newName: 'quicks #0', newUri: 'https://arweave.net/a' }).sendAndConfirm(umi);
  console.log('\nrenaming an existing one: ALLOWED →', (await fetchAsset(umi, first)).name);
} catch (e) {
  const logs = (e.transactionLogs || []).filter(l => /Error|Reject|Immutable/.test(l));
  console.log('\nrenaming an existing one: REFUSED —', logs.join(' | ').slice(0, 160) || (e.message || '').slice(0, 120));
}
