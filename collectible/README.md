# solquicks Collectible

A soulbound Metaplex Core asset, minted by the buyer for 0.1 SOL. Non-transferable
for good: the collection carries a `PermanentFreezeDelegate` with no authority, so
nobody — including us — can ever thaw it, move it or burn it.

Revenue goes straight from the buyer to the Seeker treasury through the Candy
Machine's `solPayment` guard. Nothing here ever holds it.

## Files

| File | What it is |
|---|---|
| `config.json` | Everything you would want to change: price, supply, names |
| `upload.mjs` | Puts the artwork and both metadata files on Arweave via Turbo |
| `setup.mjs` | Creates the collection and the Candy Machine on chain |
| `authority.json` | Local keypair, gitignored. Holds rent only, never revenue |
| `uploaded.json` | Arweave URLs, written by `upload.mjs` |
| `cache.<cluster>.json` | On-chain addresses, written by `setup.mjs` |

## Running it

```
npm install
cp <your art> art/collectible.png
node upload.mjs
node setup.mjs --cluster devnet     # rehearsal
node setup.mjs --cluster mainnet    # the real thing
```

`setup.mjs` creates `authority.json` on first run and tells you how much SOL to
send it. On devnet it airdrops to itself.

The addresses `setup.mjs` prints go into `worker/wrangler.toml` as
`COLLECTIBLE_COLLECTION`, `COLLECTIBLE_CANDY_MACHINE` and `COLLECTIBLE_CANDY_GUARD`,
and into the `MINT` block at the top of the store code in `index.html`.

## Devnet is not a rehearsal

Devnet and mainnet run **different builds** of the Core Candy Machine program
(943KB against 548KB, deployed a year apart). The devnet build rejects the very
setup mainnet accepts — hidden settings there fail with a panic deep inside the
program. Rehearsing on devnet would have proved nothing and, worse, would have
suggested the design was wrong.

The faithful rehearsal is a local validator running mainnet's own programs:

```
solana-test-validator --reset --quiet \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J \
  --clone-upgradeable-program CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ \
  --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d &
node --test test/rehearse.mjs
```

That mints as a stranger would and checks the things that cannot be undone
later: the price reaches the treasury, each one is numbered, it belongs to the
collection, it cannot be transferred, nobody can thaw it, and one wallet gets
one.

## No bot tax, on purpose

A `botTax` guard turns a *rejected* mint into a **successful** transaction that
quietly pockets the tax and creates nothing. The rehearsal caught it letting a
second mint past the per-wallet limit without an error. There is nothing to
snipe in an open edition at 0.1 SOL a go, so refusals should simply fail and
say why.

## The mint instruction in the browser

`index.html` encodes the Candy Guard mint by hand — bundling Metaplex's SDK
would mean several hundred kilobytes and loosening the page's script policy.
`make-fixture.mjs` writes `test/browser/mint-ix.fixture.json` from the real SDK,
and the browser test rebuilds the same instruction in the page and demands
identical bytes. Regenerate the fixture if Metaplex ever changes the layout:

```
node make-fixture.mjs
```
