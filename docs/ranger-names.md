# Moon Rangers — the naming problem

Investigated 2026-09-09. Started as "fix two Rangers with blank names", ended
somewhere else: the two blanks are probably unrecoverable, and a different
defect turned up that is fixable.

Everything below was checked against mainnet, the mint transactions, Magic
Eden's cache, IPFS and the local generator output. Nothing here is inferred from
memory.

## How a Ranger's name is supposed to work

All 219 were minted in Feb 2023 through LaunchMyNFT with an **empty on-chain
name** — `CreateMetadataAccountV3` carried `name: ""` and a URI like
`…/290.json`. The real name lived in the JSON. The 2026 Arweave migration is
what wrote names on-chain for the first time.

For the 195 Rangers the trait-swap store never touched, three things agree
exactly:

> mint-transaction file number == design number in the generator output == current name

Verified on a sample of 10, then across all 195. There is no shuffle: file 290
is design 290 is "Ranger #290".

## The 24 swapped Rangers are NOT broken

Their names disagree with their mint-transaction file number — e.g. the NFT
minted from file 46 is now called "Ranger #320". That looks like corruption and
it is not.

Comparing each one's current traits against both candidate designs:

| current traits closer to… | count |
|---|---|
| the design of its **assigned name** | 20 |
| the design of its **mint-tx file number** | 0 |
| tie | 2 |

Typically 1–3 traits differ from the assigned name's design versus 4–7 from the
file number's. The trait-swap store genuinely reassigned identity, and the
assigned names are correct. **Do not "fix" these.** An earlier pass through this
data concluded all 24 were wrong; acting on that would have renamed 24 Rangers
incorrectly.

## What IS broken

### ~~Two Rangers share a name with another Ranger~~ — fixed 2026-09-10

| Was | Mint | Now |
|---|---|---|
| Ranger #320 | `GGTjnPNLjjxEtYhshdumaKUrTH99LUVZUFCzsitS5VMz` | **Ranger #46** |
| Ranger #64 | `FAR6wZhvAkxByadvkvrpCZ6zeRyLkPNT7WpVrkEhALGm` | **Ranger #205** |

The swap store had handed out names that were already taken. In both pairs the
Ranger it never touched matches its generator design exactly — zero traits
apart — so that one is the real #320 / #64 and kept its name untouched. The
swapped one took back its own pre-swap identity, which was still free.

Applied through `fix-names.html`, signed by the update authority. Verified after
the fact by re-reading all 219 metadata accounts: **217 distinct names, zero
duplicates**, #320 and #64 each on exactly one mint, and creators, royalty and
the verified collection intact on both.

### Two Rangers have no name at all

| Mint | File | Owner | State |
|---|---|---|---|
| `oVPyKLZbvJGQAZWZ7U3bNF4thFT2cRZoNYMtH86YT4F` | 290 | `78UTfQcwRxYCw3sNU6aPbUp1e4PSCDFVB51jqBTXxE6J` | JSON fine, traits intact, `name: ""` |
| `GVJWmz3N8jPVu6AFHPe7LvQSY7tnKizK4m7j9BJkjMY2` | 236 | `FRanc6ubzomvXhThbqYDfm9A3XZPA2vEBxBou54zAr98` | JSON 404s entirely |

Both were trait-swapped, so their pre-swap file number is not their identity —
the same reasoning that says the other 24 are correctly named says #290 and #236
are the wrong answer for these two.

## Why the real names can't be recovered

Every source that would know has gone:

- **Original IPFS metadata** — `bafybeibz5tlotae4nu5fh57eiy37yxi5voivfahq74ron3ithfsqiwkasa`.
  Gateways answer *"no providers found for the CID"*. Unpinned, gone. (ipfs.io
  and w3s.link now refuse direct fetches entirely; storry.tv and ipfs.cyou give
  the real answer.)
- **The swap store's Arweave JSON** for `GVJWmz3N…` — 404 on arweave.net and on
  every AR.IO gateway tried.
- **The swap store itself** — retired, and nothing in the Moon Rangers folder
  records which mint became which Ranger.
- **Magic Eden's cache** reports `Ranger #260` for `GVJWmz3N…`. Not usable: its
  cached traits are 7 apart from design #260 (and 7 from #236), and #260 is
  already held by `FAtTsLTgEGwi9uYwmJx8o5SQ7d2UKizBB7MX9W4UK6m3`, which was
  never swapped. It looks like another colliding assignment, not the truth.
- **Trait matching** — finding the closest design to a Ranger's current traits
  recovers the known-correct name for only **13 of 22** swapped Rangers. Too
  unreliable to name a lifetime NFT with.

## Options

For the two blanks, in order of how much they respect the evidence:

1. **Ask the two owners.** They are the last source: a screenshot, a listing, a
   Discord post. Both wallets are known and both Rangers are in circulation.
2. **Ask whoever ran the trait-swap store** whether any records survive.
3. **Restore the pre-swap identity** — `#290` and `#236`, both currently free.
   Defensible, and it is genuinely their mint identity, but it discards the swap
   the owner paid for.
4. **Leave them blank** until something better turns up. Nothing is broken by
   waiting: both display their art and traits fine, and staking, points and the
   site treat them like any other Ranger.

**No name should be invented.** Two of these NFTs already lost their identity to
a tool that wrote a name it had no right to; guessing would repeat that.
