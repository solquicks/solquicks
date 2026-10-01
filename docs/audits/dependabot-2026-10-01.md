# Dependabot alerts — 2026-10-01

Five open alerts, reviewed one by one. One produced a change; four have no
published fix and were dismissed with this file as the reason. Written down
because "we dismissed it" is worthless without why, and because the right
answer changes the moment any of these ships a patch.

| # | sev | package | where | outcome |
|---|---|---|---|---|
| 56 | high | bigint-buffer | `collectible/package-lock.json` | dismissed — no fix exists |
| 10 | high | bigint-buffer | `program/migration/package-lock.json` | dismissed — no fix exists |
| 57 | low | elliptic | `collectible/package-lock.json` | dismissed — no fix exists |
| 11 | low | elliptic | `program/migration/package-lock.json` | dismissed — no fix exists |
| 1 | low | rand | `program/Cargo.lock` | left open — blocked upstream |

## bigint-buffer — GHSA-3gc7-fjrx-p6mg (high)

Buffer overflow in `toBigIntLE()`. The advisory's own stated impact is that
"attackers can exploit this to crash the application" — a crash, not code
execution.

**No published fix.** `bigint-buffer@1.1.5` is the latest release on npm and is
itself inside the advisory range (`<= 1.1.5`). Nor is there a version path that
removes it:

```
bigint-buffer <- @solana/buffer-layout-utils 0.3.0 (latest)
              <- @solana/spl-token 0.4.15 (latest)
              <- @ardrive/turbo-sdk
              <- (root)
```

Every link in that chain is already at its newest version, and each still
declares the next.

**The fork is not a fix.** `@trufflesuite/bigint-buffer@1.1.10` is the version
usually suggested here. Its `dist/node.js` is identical to the original for
`toBigIntLE` and `toBigIntBE` — same `converter.toBigInt(buf, …)` call into the
same native addon. The only difference is that it loads that addon with
`node-gyp-build` instead of `bindings`. Overriding to it would change which
package name the alert points at and nothing about the overflow. Rejected:
substituting a fork of an unmaintained package into a tree that handles
Arweave uploader keys is a worse trade than a DoS in code we do not run.

**Not reached here.** No script in either directory imports `bigint-buffer`,
`@solana/buffer-layout-utils` or `@solana/spl-token`. Checked across every
`.mjs` in both. It arrives only through turbo-sdk's SPL-token payment path, and
uploads from both directories are funded with SOL and AR.

**Not exposed.** Both directories are one-shot CLI scripts run on the repo
owner's own machine against the owner's own files. Neither serves traffic,
takes network input, or is part of solquicks.com. There is no attacker and no
service to deny.

## elliptic — GHSA-848j-6mx2-7j84 (low)

"Uses a cryptographic primitive with a risky implementation."

**No published fix.** `elliptic@6.6.1` is the latest release and is inside the
advisory range (`<= 6.6.1`). Both projects already pin `elliptic: ^6.6.1` in
their `overrides`, which is as high as it goes.

**Not reached here.** It comes in three ways, all of them turbo-sdk's
non-Solana chain support: `@cosmjs/crypto`, `@dha-team/arbundles`'s
`secp256k1`, and `@ethersproject/signing-key`. No script imports `ethers`,
`@cosmjs` or `elliptic`. Same exposure note as above.

## rand — GHSA-cq8v-f236-94qc (low) — left open

"Rand is unsound with a custom logger using `rand::rng()`." It needs all of:
the `log` and `thread_rng` features enabled, and a custom `log` implementation
that itself calls `rand::rng()`. An on-chain program installs no logger.

A fix exists — 0.8.6 — but cargo cannot reach it:

```
rand 0.7.3 <- libsecp256k1 0.6.0        (declares rand = "0.7")
           <- solana-secp256k1-recover 2.2.1
           <- solana-program 2.3.0
           <- ephemeral-rollups-sdk 0.17.3 (latest)
           <- moon-draw
```

`libsecp256k1 0.6.0` declares `rand = "0.7"`, a range that cannot resolve to
0.8.6 however it is asked. Unblocking it needs `ephemeral-rollups-sdk` to move
to `solana-program` 3.x. 0.17.3 is the newest published and still pins 2.3.0.

Left open deliberately, as the reminder to retry after an SDK release.

**What did change:** two things held `solana-program 2.3.0` in the tree — that
SDK and our own `spl-associated-token-account` dev-dependency. Moving the
latter from 7.0 to 8.0 dropped one of the two paths and removed eleven unused
crates with it: `spl-token-2022`, the three confidential-transfer crates,
`spl-transfer-hook-interface`, `spl-tlv-account-resolution`,
`spl-type-length-value`, `spl-program-error` and friends. It does not close
the alert, but it is less code in the build either way. 20/20 tests pass.

## When to revisit

- `@solana/spl-token` dropping `@solana/buffer-layout-utils`, or
  `bigint-buffer` publishing above 1.1.5 → alerts 56 and 10 become real fixes.
- `elliptic` publishing above 6.6.1 → alerts 57 and 11.
- `ephemeral-rollups-sdk` moving to `solana-program` 3.x → alert 1.

A dismissed alert re-opens on its own if a patched version is published, so
none of this depends on remembering to look.
