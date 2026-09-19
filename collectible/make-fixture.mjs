// Writes the exact bytes the Metaplex SDK produces for one mint, with fixed
// stand-in addresses. The browser test replays the same inputs through the
// hand-written encoder in index.html and demands an identical instruction.
// That is what keeps a hand-rolled encoder honest without shipping the SDK.
import fs from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey, some, createNoopSigner } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplCandyMachine, mintV1 } from '@metaplex-foundation/mpl-core-candy-machine';

const FIXED = {
  candyMachine: '11111111111111111111111111111112',
  candyGuard: '11111111111111111111111111111113',
  collection: '11111111111111111111111111111114',
  treasury: 'uPMPPQ3tEXWbAVaESSbERMHG9Yb2VvAq3XU6R5J8LUc',
  minter: 'Bo8yaStvEdcxhD8CJFzCBV1FLeZvyyMXHBT5oE8WGWNR',
  asset: 'BrwFr2TpgNfRcWvbteYJKeEDDcftcmEjHks1qERpMSVi',
  mintLimitId: 1
};

const umi = createUmi('http://127.0.0.1:8899').use(mplCore()).use(mplCandyMachine());
umi.use(keypairIdentity({
  publicKey: publicKey(FIXED.minter),
  secretKey: new Uint8Array(64),
  signMessage: async function (m) { return m; },
  signTransaction: async function (t) { return t; },
  signAllTransactions: async function (t) { return t; }
}));

const ix = mintV1(umi, {
  candyMachine: publicKey(FIXED.candyMachine),
  candyGuard: publicKey(FIXED.candyGuard),
  asset: createNoopSigner(publicKey(FIXED.asset)),
  collection: publicKey(FIXED.collection),
  mintArgs: {
    solPayment: some({ destination: publicKey(FIXED.treasury) }),
    mintLimit: some({ id: FIXED.mintLimitId })
  }
}).items[0].instruction;

const fixture = {
  input: FIXED,
  programId: ix.programId,
  data: Buffer.from(ix.data).toString('hex'),
  keys: ix.keys.map(function (k) {
    return { pubkey: k.pubkey, isSigner: k.isSigner, isWritable: k.isWritable };
  })
};
fs.writeFileSync('../test/browser/mint-ix.fixture.json', JSON.stringify(fixture, null, 2) + '\n');
console.log('wrote test/browser/mint-ix.fixture.json with', fixture.keys.length, 'accounts');
