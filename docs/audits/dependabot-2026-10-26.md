# Dependabot alerts — 2026-10-26

Six open alerts: three distinct advisories, each appearing twice because the
same dependency tree exists in `collectible/` and `program/migration/`.

**All six are fixed.** Unlike the October batch, every one of these had a
published patch, so this needed no judgement call — just an override and a
lockfile update.

| # | sev | package | advisory | was | now |
|---|---|---|---|---|---|
| high | follow-redirects | [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c) | 1.16.0 | **1.16.2** |
| high | follow-redirects | [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8) | 1.16.0 | **1.16.2** |
| medium | hono | [GHSA-5r4p-p66f-jhc7](https://github.com/advisories/GHSA-5r4p-p66f-jhc7) | 4.13.7/4.13.8 | **4.13.14** |

## follow-redirects — two advisories, one patch

*"sensitiveHeaders regex escaping can expose credential headers"* and
*"array-form headers bypass cross-origin credential stripping."* Both are
credential leakage across a redirect, both fixed in **1.16.1**.

It arrives four levels down, through Turbo's Cosmos support:

```
follow-redirects 1.16.0 <- axios 1.20.0
                        <- @cosmjs/tendermint-rpc 0.33.1
                        <- @cosmjs/stargate 0.33.1
                        <- @ardrive/turbo-sdk 1.44.1
```

## hono — static path decoded twice

*"serveStatic decodes the request path a second time, leading to bypass of
middleware on static paths."* Fixed in **4.13.11**.

Five levels down, through Turbo's x402 payment support:

```
hono 4.13.8 <- porto 0.2.35 <- @wagmi/connectors 6.2.0
            <- wagmi 2.19.5 <- x402 1.2.0 <- x402-fetch 1.2.0
            <- @ardrive/turbo-sdk 1.44.1
```

## What was done

Two entries added to the `overrides` block each project already keeps, and the
lockfiles regenerated. Both resolved above the patch line — 1.16.2 and 4.13.14
rather than the minimum 1.16.1 and 4.13.11.

```json
"follow-redirects": "^1.16.1",
"hono": "^4.13.11"
```

Nothing but `package.json` and `package-lock.json` changed in either directory.
Every script in both still parses, and `@ardrive/turbo-sdk` — the package all
of this hangs off — still imports cleanly against the new tree.

## Exposure, for the record

Both directories are one-shot CLI scripts run on the owner's own machine
against the owner's own files. Neither serves traffic, neither takes network
input, and neither is part of solquicks.com. Nothing here imports `axios`,
`hono`, `@cosmjs` or `x402` directly: they arrive only through turbo-sdk, and
uploads from both directories are funded with SOL and AR rather than through
the Cosmos or x402 paths.

So the practical risk was low — but the fixes existed and cost nothing, which
is a different situation from the October batch.

## Still open, and still unfixable

`npm audit` reports 42 findings in each directory. That is a much broader net
than Dependabot's, and the ones it keeps flagging are the same as last time:

- **bigint-buffer** (GHSA-3gc7-fjrx-p6mg) — no release above 1.1.5 exists
- **elliptic** (GHSA-848j-6mx2-7j84) — no release above 6.6.1 exists

Both are reasoned through in
[dependabot-2026-10-01.md](dependabot-2026-10-01.md); nothing has changed.
A dismissed alert re-opens by itself if a patched version is ever published,
so neither depends on anybody remembering to look.
