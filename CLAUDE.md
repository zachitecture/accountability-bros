# Accountability Bros: guide for contributors (and their AI assistants)

A free web app for a 14-member Messenger group chat that keeps each other accountable on weekly
exercise goals. **The chat stays the home.** Members log a session in the app, the app stamps their
photo (name, activity, duration, server time, tally X/Y) and they share that image to the chat. The app
keeps the records: goals, tallies, streaks, ranks, the Kitty (forfeits), leave and disputes, and
enforces the group's Terms of Reference.

Owner: Khov (repo `zachitecture/accountability-bros`). The group is non-technical, so anything a
member sees should be plain and friendly.

## This is live. Read before changing anything

- **`main` is the live app.** Cloudflare Workers Builds deploys every push to `main` in about a minute,
  to the 14 members' phones. Work on a branch and open a pull request; don't push straight to `main`.
- **`supabase/schema.sql` is the whole backend.** Pushing it changes nothing by itself: an owner pastes
  the file into the Supabase SQL Editor and runs it. So it must always be **safe to run again** on the
  live database: `create table if not exists`, `alter table ... add column if not exists`,
  `create or replace function`. Never drop or rewrite tables or member data. Say in the PR when the
  script needs re-running.
- **Never test against the live database.** Use `npm run dev:local` and the tests (below). They run the
  real `schema.sql` in a local Postgres and never touch Supabase.
- **No secrets in the repo.** It is public. Only the Supabase *publishable* key belongs here
  (`.env.production`). Never commit the secret key (`sb_secret_…` / service_role), passwords, or member data.

## Commands

```
npm install
npx playwright install chromium   # once, for the browser test (install playwright first: npm i -g playwright)
npm run dev:local     # the app at http://localhost:5173 against a local stand-in database; resets on stop
npm run test:rules    # runs schema.sql in a local Postgres (PGlite) and checks every rule
npm run test:app      # builds the app and drives it in a real browser; screenshots in tests/out
npm run build         # what Cloudflare runs
```

Run both test suites before opening a PR. Every new rule gets a check in `tests/rules.test.mjs`;
every new screen or flow gets a step in `tests/app.test.mjs`.

## How it fits together

- **Front end:** Vite + React 18, no router library (hash routes in `src/ui.jsx`: `#/log`, `#/goals`,
  `#/group`, `#/member/<id>`, `#/kitty`, `#/disputes`, `#/rewards`, `#/more`...). Plain CSS with colour
  tokens in `:root` in `src/styles.css`. Fonts are self-hosted (Inter, Space Grotesk).
- **Back end:** Supabase (Postgres, auth by email and password, a private storage bucket `proof`).
- **Security model:** every table has row level security on with **no policies**, and direct access is
  revoked. The app can only call `security definer` functions in `schema.sql`; each one starts with
  `public.me()` (who is calling) and checks permissions itself. New API functions go in the `api` list
  in the permissions block at the end of `schema.sql`; internal helpers go in `internal`, so they can't
  be called from outside.
- **Time:** always `public.app_now()`, never the phone's clock. A member's week (Monday to Sunday) and
  the Monday 11:59 pm goal lock follow their own time zone.

## Where things live

| Area | Database (`supabase/schema.sql`) | App |
| --- | --- | --- |
| Goals, lock, carry-over | `save_goals`, `get_week`, `edit_until`, `roll_goals` | `screens/Goals.jsx` |
| Logging, extras, stamp | `log_activity`, `log_extra`, `undo_log` | `screens/Log.jsx`, `image.js` (`makeStamp`, `compressPhoto`) |
| Group, feed, leaderboard | `get_group`, `get_feed`, `react_to_log`, `get_leaderboard` | `screens/Group.jsx`, `screens/Feed.jsx` |
| Ranks, seasons, badges, stamp style | `rank_state`, `badges_of`, `stamp_style`, `set_style` | `rank.js`, `screens/Rewards.jsx` |
| Kitty (forfeits, fees) | `get_kitty`, `issue_forfeit`, `set_paid` | `screens/Kitty.jsx` |
| Disputes (Clause 13) | `save_dispute` ... `decide_dispute` | `screens/Disputes.jsx` |
| Leave (Clause 9) | `request_leave`, `decide_leave` | `screens/Leave.jsx` |
| Members, roles, rules | `update_member`, `update_settings` | `screens/More.jsx` |

Tests: `tests/harness.mjs` (local Postgres), `tests/fake-supabase.mjs` (local stand-in for the Supabase
APIs), `tests/stubs.sql` (the bits of Supabase the schema expects).

## Limits to keep in mind (Supabase free plan)

1 GB photo storage, 500 MB database, 5 GB a month of downloads (photos viewed in the app count).
Photos are shrunk to 1440 px on the long side at JPEG quality 0.8 before upload (`compressPhoto` in
`src/image.js`); profile pictures are 512 px squares. At ~70 photos a week, storage lasts roughly
10 to 11 months.

## Good first jobs

- **Smaller photos:** try 1080 px and/or WebP in `compressPhoto`, compare file sizes and how they look
  on an iPhone screen, and report the numbers. (PNG is much bigger for photos; JPEG or WebP is right.)
- **Thumbnails for the feed and lists**, to cut downloads.
- **Clearing old photos** after N months while keeping the session records.

## Writing for members

Plain words, sentence case, no jargon. Buttons say what they do ("Log something extra", "Take leave").
Orange (`--warn`) is only for something wrong (owed money, flags); everything else uses the greens.
