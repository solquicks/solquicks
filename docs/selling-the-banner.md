# Selling the banner slot

The strip at the top of solquicks.com. Sold by hand for now — the point is to
find out what it's worth before building an auction around it.

## Booking one

Edit `banner.json`, commit, push. Live in about a minute.

```json
"active": {
  "sponsor": "Their Name",
  "headline": "One short line, ~60 characters",
  "url": "https://wherever-it-should-link",
  "image": "https://their-logo.png",
  "emoji": "⚡",
  "until": "2026-09-30"
}
```

`until` is the safety net: the slot reverts to your own promos the day after,
so a finished campaign can never quietly keep running. `image` is optional —
without it the `emoji` is used. Everything except `until` shows immediately.

## When nothing is booked

The slot rotates through `house` — your plushie and Moon Rangers — and shows
"This spot is for hire". It is never empty, because an empty ad slot reads as
"nobody wants to advertise here".

Add more house promos by appending to the `house` array. They rotate daily.

## Ground rules worth keeping

- **Paid placements are labelled "Sponsored"** and use `rel="sponsored"`.
  That is both the honest thing and what search engines expect of paid links.
- **You approve the creative before it goes live.** You are publishing it under
  your name to an audience that trusts you; a scam in your banner costs more
  than the slot earns. Decide in advance what you will not run — token
  presales, unaudited protocols, anything you would not personally vouch for.
- **Take payment before it goes up.** No escrow exists here; it is a handshake.

## What to learn before automating

Track: who asked, what they paid, whether they came back. Build the auction
only once you are turning people away — an auction discovers a price when
demand exceeds supply, and does nothing at all when one advertiser wants the
slot. See the roadmap for the full argument.
