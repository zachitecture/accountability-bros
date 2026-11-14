# Accountability Bros

A small web app for the Accountability Bros group chat. Members declare their goals on Monday, log each
session with a photo, and share a stamped image (name, activity, minutes, server time, tally) back to the
chat. The app keeps everyone's records, streaks and the Kitty ledger.

The chat stays the home. The app is a link you add to your phone's home screen.

## What version 1 does

| Screen | What it does |
| --- | --- |
| Log | Pick a goal, enter the time, take a photo, add a private note, get the stamped image, share it |
| Goals | Last week's goals carry over automatically; change them until Monday 11:59 pm; take leave |
| Group | Everyone's tally and streak, and a leaderboard of physical hours; tap a member for their record |
| Kitty | What is in the Kitty, what is owed, forfeits and fees; disputes (Clause 13) |
| More | Your name; for admins, the member list, the rules, and long sick leave to approve |

Leave: annual leave is requested before it starts, sick or injury leave can start today, and neither can be
backdated. Sick leave over 7 days needs an admin to approve the extra days. A week with at least 4 days of
leave (adjustable in the rules) carries no forfeit and does not break a streak.

Disputes: lodge within 7 days for a $15 fee (both adjustable in the rules), waived if upheld. A draft can go to
the Ombudsman for advice first. Members not directly affected need a seconder, except the Attorney-General.
The Ombudsman inquires and the Executive decides; nobody decides a dispute they are part of.

Not in yet: the Terms of Reference page, notifications, watch data.

## The rules the database enforces

These live in `supabase/schema.sql`, not in the app, so they cannot be bypassed from a phone.

- Time comes from the server. A member's week and Monday lock follow their own time zone.
- Goals for a week lock when Monday ends. After that only an admin can change another member's goals.
- Someone who joins after the Monday lock has 24 hours to set goals for that first week. An admin can switch this off in More > Rules.
- A week under the minimum number of goals needs a written reason.
- Each log needs a photo in the member's own folder. A photo cannot be reused.
- A Physical session at or under the minimum minutes is flagged. A second log of the same goal on the same day is flagged. Flags are shown to the group; people decide what to do about them.
- A log can be undone by its owner for 15 minutes. After that only another admin can remove it.
- Forfeit = forfeit per member × number of Eligible Members. Kitty managers issue forfeits, excuse weeks and mark payments, but never for their own entries.
- Nobody can read or write a table directly. The app can only call the functions in the schema, and each one checks who is calling.

The numbers (minimum goals, minimum minutes, forfeit per member, days to pay, join code) are settings an
admin changes in the More tab.

## Setting it up

1. **Supabase.** Create a project. Open the SQL editor, paste all of `supabase/schema.sql`, run it.
2. **Sign-in setting.** In Authentication, open the Email provider settings and turn **Confirm email** off.
   Supabase's built-in email only sends to the project owner, so confirmation emails would block everyone else.
3. **Connect the app.** Copy `.env.example` to `.env.production` and fill in the project URL and the
   publishable key.
4. **Host it.** Any static host works. Build command `npm run build`, output folder `dist`.
5. **First account.** The first person to create an account becomes the admin and needs no join code.
   Everyone after that needs the join code shown in More > Rules.

## Working on it

```
npm install
npm run dev          # needs .env.local with the two Supabase values
npm run test:rules   # runs schema.sql in a local Postgres and checks every rule
npm run test:app     # builds the app and drives it in a browser against a local stand-in for Supabase
```

The tests never touch the real Supabase project. `tests/fake-supabase.mjs` is a small local server that
runs the real `schema.sql` in an in-process Postgres (PGlite) and answers the same calls Supabase would.

## Layout

```
supabase/schema.sql   tables, rules and functions (paste into Supabase)
src/screens/          one file per screen
src/image.js          photo shrinking and the stamped image
src/api.js            the only place that talks to Supabase
tests/                rule checks and the browser run-through
```
