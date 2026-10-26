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

## Later the same day: zod (GHSA-mrhx-c7xc-m3w5) — no reachable fix

Two more alerts appeared after the fixes above were pushed, again the same
advisory twice because the same tree exists in both directories.

*"Zod can exhaust memory while validating oversized constrained
collections"* — CWE-770, CVSS `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`. Note
what that vector does and does not say: availability only, with no
confidentiality or integrity impact. It is a memory-exhaustion denial of
service.

GitHub rates it **high** and gives the vulnerable range as `< 4.6.6`, with no
separate 3.x range. Both trees resolve **zod 3.25.76**, which is the last
stable 3.x release — everything published after it on that line is a canary.
So the only version that satisfies the advisory is zod 4, a major bump.

### Why a plain override is worse than the bug

Six packages depend on zod across the tree, and five of them exclude 4.x:

| dependent | declares |
|---|---|
| `abitype` (peer) | `^3 >=3.22.0` |
| `x402`, `x402-fetch` | `^3.24.2` |
| `@coinbase/cdp-sdk` | `^3.25.76` |
| `@reown/appkit-wallet` | `3.22.4` (exact) |
| `porto` | `^4.1.5` |

Only `porto` is already on the 4.x line, and its copy — 4.6.5 here, 4.6.2 in
`program/migration` — is genuinely one patch bump from safe. So an override
scoped to that one subtree looked like the answer:

```json
"porto": { "zod": "^4.6.7" }
```

It is not. npm applies the inner constraint globally rather than only inside
`porto`, and `npm ls zod --all` then reports the whole tree invalid:

```
zod@3.22.4  invalid: "^4.6.7" from node_modules/@reown/appkit-wallet
zod@3.25.76 invalid: "^4.6.7" from node_modules/abitype,
            "^4.6.7" from node_modules/@coinbase/cdp-sdk, ...
```

That would drag `abitype`, `viem`, `x402` and `@coinbase/cdp-sdk` onto a major
they do not support, to close a DoS hole. Reverted.

### Exposure

The same as the rest of this file, and it matters more here because this
advisory is availability-only. Both directories are one-shot CLI scripts, run
by hand, on the owner's machine, against the owner's own files. Neither serves
traffic and neither accepts untrusted input, so there is nobody to exhaust the
memory of but the person running the script. Nothing imports `zod` directly;
it arrives through `@ardrive/turbo-sdk`'s x402 payment support, which these
uploads do not use — they are funded with SOL and AR.

These two belong with bigint-buffer and elliptic: `no_bandwidth`, no fix to
apply. **They are still open** — dismissing an alert is a write to GitHub and
this session was not permitted to make it, so the dismissal is the owner's to
do, on the Dependabot page, with this file as the reason. A dismissed alert
re-opens on its own if a 3.x patch is ever published, so nothing here depends
on anyone remembering to check later.
