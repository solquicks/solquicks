# Putting bookings on your calendar

Every booking that gets paid for is written to your Google Calendar. Because
Calendly reads that same calendar to check for conflicts, a session sold on
solquicks.com takes itself out of your Calendly availability — no integration
between the two, just one calendar with two writers.

Nothing here is required. Without it, bookings work exactly as before and simply
never appear on a calendar. `/api/health` reports `calendar: "off"` so the
difference between "not set up" and "broken" is visible.

## Why a service account and not "Sign in with Google"

A service account is a robot with its own email address. You share your calendar
with it the same way you would share it with a colleague.

The alternative — OAuth — would mean clicking through a consent screen, storing
a refresh token, and re-authorising when Google decides the token is stale. A
service account has none of that. There is nothing to re-authorise and nothing
that expires.

## What you need to do

**1. Make a Google Cloud project**

Go to [console.cloud.google.com](https://console.cloud.google.com). Create a
project — call it anything, `solquicks-calendar` is fine.

**2. Turn on the Calendar API**

In that project: **APIs & Services → Library → search "Google Calendar API" →
Enable**. Skipping this is the most common mistake, and it fails later with a
message about the API not being enabled for the project.

**3. Create the service account**

**APIs & Services → Credentials → Create credentials → Service account.**
Name it, click through the optional steps, and create it.

**4. Download its key**

Click the service account → **Keys → Add key → Create new key → JSON**. A file
downloads. It contains a private key — treat it like a password, and do not put
it in the repo.

Two things out of that file:

- `client_email` — looks like `something@your-project.iam.gserviceaccount.com`
- `private_key` — a long block whose first line reads `-----BEGIN … KEY-----`

**5. Share your calendar with it**

This is the step that is easy to miss, and without it everything else is
correct and nothing works.

In Google Calendar: hover your calendar in the left sidebar → **⋮ → Settings and
sharing → Share with specific people or groups → Add people**. Paste the
`client_email` from step 4. Set the permission to **"Make changes to events"** —
not "See all event details", which is read-only.

**6. Find your calendar's ID**

Same settings page, under **Integrate calendar**. For your main calendar it is
usually just your Gmail address.

**7. Set the three settings**

From the `worker/` directory, run each of these. Each one prompts for the value,
so nothing is typed into your shell history:

```bash
cd worker && npx wrangler secret put GCAL_CLIENT_EMAIL
```

```bash
cd worker && npx wrangler secret put GCAL_PRIVATE_KEY
```

```bash
cd worker && npx wrangler secret put GCAL_CALENDAR_ID
```

For `GCAL_PRIVATE_KEY`, paste the **whole** key, including the
`-----BEGIN … KEY-----` and `-----END … KEY-----` lines top and bottom. (Those
are written with a gap here on purpose: CI refuses to let this repository
contain the real header text, and it is a public repository, so that is the
right call. In your file they appear in full.) The code accepts the newlines
either as real line breaks or as the literal `\n` they are stored as inside the
JSON file — both work.

**8. Deploy and check it**

```bash
cd worker && npx wrangler deploy
```

Then, with your admin token:

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" https://solquicks-points.solquicks-45c.workers.dev/api/admin/calendar/test
```

That proves the whole chain in one call, and says which part failed if one did:

| `step` | What is wrong |
|---|---|
| `settings` | one of the three values is unset — it names which |
| `auth` | the key did not parse, or the Calendar API is not enabled |
| `calendar` | the calendar is not shared with the service account, or the ID is wrong |
| — (`ok: true`) | working; it echoes the calendar's name and timezone |

**9. Tell Calendly to respect it**

In Calendly: **Account → Calendar connections.** Connect the same Google
account, and make sure that calendar is ticked under **"Check for conflicts"**.
That is the part that actually blocks the time — Calendly will not offer an hour
it can see something else in.

## What the events look like

- **A booked session** — an hour (or whatever the session runs) at the time that
  was chosen, titled with the service and the customer's name. The description
  carries the reference, their contact, and whether it came out of a bundle.
- **An MC or speaking booking** — an **all-day event spanning 2 days**, because
  an appearance owns the days it is on rather than an hour of them. The
  description says the cap out loud.
- **A bundle session** — identical to a single booking, plus a line naming the
  bundle it was redeemed from.

Events are keyed by the booking's reference, so a payment that gets settled
twice — by the page, the wallet, and the sweep all noticing it — updates one
event instead of creating three.

## When something goes wrong

A calendar write **never** fails a payment. If Google is slow or misconfigured,
the booking is still paid for and still in the database; it just is not on the
calendar yet. The failure is written to `error_log` under `calendar.sync`, and
the Telegram alert for a bundle redemption says so explicitly.

To find them:

```bash
cd worker && npx wrangler d1 execute solquicks-points --remote --command "SELECT ts, route, message FROM error_log WHERE route LIKE 'calendar%' ORDER BY ts DESC LIMIT 20"
```

Fixing the cause and re-settling is not needed — re-running
`/api/admin/calendar/test` confirms the connection, and the next booking will
sync. Past bookings that missed their window have to be added by hand, which is
the deliberate trade: a missing calendar entry is a minute's work, a refused
payment is a lost sale.
