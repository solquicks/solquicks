#!/usr/bin/env bash
# Builds vendor/privy.js, the Privy login SDK that launch.html loads when a
# creator has no wallet of their own.
#
# Why a committed bundle and not a <script> tag: Privy ships @privy-io/js-sdk-core
# on npm only — there is no CDN build — and this site has no build step, so the
# bundle is produced here and checked in. Nothing on the deploy path runs npm.
#
# Why pinned: this file ends up holding somebody's keys. It changes when we
# change it, never because an upstream release landed overnight.
set -euo pipefail

VERSION=0.77.0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm init -y >/dev/null
npm install --silent "@privy-io/js-sdk-core@$VERSION" esbuild

cat > entry.mjs <<'JS'
export {default as Privy, LocalStorage, getUserEmbeddedSolanaWallet} from '@privy-io/js-sdk-core';
JS

npx esbuild entry.mjs \
  --bundle --format=iife --global-name=PrivySDK \
  --minify --target=es2020 \
  --outfile="$ROOT/vendor/privy.js"

printf '%s\n' "built vendor/privy.js from @privy-io/js-sdk-core@$VERSION"
wc -c < "$ROOT/vendor/privy.js" | awk '{printf "  %.0f KB\n", $1/1024}'
