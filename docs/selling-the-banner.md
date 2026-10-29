# Selling the banner slot

The strip at the top of solquicks.com. The point for now is to find out what
it's worth before building an auction around it.

## Price

**$250 / week.** Change it whenever — the point is having a number to quote
when someone asks on stream.

## Booking one

Bookings made on the site (Book tab -> Advertising space) fill the slot on
their own. `banner.json` `active` is the manual override for a slot sold by
hand, off the site: edit it, commit, push. Live in about a minute.

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

`image` fills a wide 3:1 hero, so ask for artwork around 1200x400. Without one
the emoji is used on a gradient.

`until` is the safety net: the day after, the slot goes back to advertising
itself, so a finished campaign can never quietly keep running. `image` is
optional — without it the `emoji` is used. Everything except `until` shows immediately.

## When nothing is booked

The slot stays empty of ads until someone pays. There are no house promos:
`house` in `banner.json` is an empty list and stays that way. Instead the
unsold slot advertises itself — it is tagged "Available", reads "Your
advertising space here" and "Book this space", and clicking it opens the
Advertising space card on the Book tab.

Nothing goes in the slot just to fill it. It shows a paid ad, or it shows
that it is for sale.

## Ground rules worth keeping

- **$250 / week**, as above.
- **Paid placements are labelled "Sponsored"** and use `rel="sponsored"`.
  That is both the honest thing and what search engines expect of paid links.
- **quicks approves every ad before it goes live.** You are publishing it under
  your name to an audience that trusts you; a scam in your banner costs more
  than the slot earns. Decide in advance what you will not run — token
  presales, unaudited protocols, anything you would not personally vouch for.
- **Payment comes first.** Nothing goes up until it is paid. No escrow
  exists here; it is a handshake.

## What to learn before automating

Track: who asked, what they paid, whether they came back. Build the auction
only once you are turning people away — an auction discovers a price when
demand exceeds supply, and does nothing at all when one advertiser wants the
slot. See the roadmap for the full argument.

## What a booking delivered

Views and clicks are counted per booking, privately — no cookies, no IPs, no
third-party tracker. Only paid bookings are counted, so nothing but a sponsor's
own ad adds to their numbers.

```bash
# everything, newest first
curl "https://solquicks-points.solquicks-45c.workers.dev/api/banner/stats"

# one sponsor, day by day
curl "https://solquicks-points.solquicks-45c.workers.dev/api/banner/stats?slot=ad:their-name"
```

Send the sponsor their figure at the end of a booking. It is also your own
evidence when pricing the next one — and the thing that decides whether $250
is too low.
