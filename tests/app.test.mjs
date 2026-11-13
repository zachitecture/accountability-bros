// Runs the built app in a real browser against the local stand-in for Supabase.
// Run with: npm run test:app   (screenshots land in tests/out)
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeSupabase } from './fake-supabase.mjs';
import { lit } from './harness.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const SCALE = Number(process.env.SHOT_SCALE || 1);
const APP = 'http://127.0.0.1:4173';

const MON_10AM = '2026-11-08T23:00:00Z'; // Mon 9 Nov 10:00 am in Melbourne
const TUE_614PM = '2026-11-10T07:14:00Z'; // Tue 10 Nov 6:14 pm in Melbourne

const fake = await startFakeSupabase(54321);
await fake.setNow(MON_10AM);

execSync('npx vite build', { cwd: root, stdio: 'pipe', env: { ...process.env, VITE_SUPABASE_URL: fake.url, VITE_SUPABASE_KEY: 'test-key' } });
const preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1', '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
let previewExit = null;
preview.on('exit', (code) => { previewExit = code; });
const stopPreview = () => { try { process.kill(-preview.pid); } catch { /* already gone */ } };
for (let i = 0; ; i += 1) {
  if (previewExit !== null) throw new Error('the preview server could not start (is port 4173 already in use?)');
  try { if ((await fetch(APP)).ok) break; } catch { /* not up yet */ }
  if (i > 100) { stopPreview(); throw new Error('the preview server did not start'); }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
const problems = [];
let step = 0;
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SCALE, timezoneId: 'Australia/Melbourne', locale: 'en-AU' });
  const page = await ctx.newPage();
  // THEME_CSS=<file> previews a different palette without changing the app.
  if (process.env.THEME_CSS) {
    const css = readFileSync(process.env.THEME_CSS, 'utf8');
    await ctx.addInitScript((text) => {
      const add = () => { const el = document.createElement('style'); el.textContent = text; document.head.appendChild(el); };
      if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
    }, css);
  }
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-9]/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return page;
}
async function shot(page, name) {
  step += 1;
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${String(step).padStart(2, '0')}-${name}.png`), fullPage: true });
}
const ok = (name) => console.log(`  ok  ${name}`);

// ---- seed data: the other 13 members, a month of history, and the ledger
const OTHERS = [
  // nickname, title, zone, joined, list position, goal, [declared, done] for 12 Oct, 19 Oct, 26 Oct, 2 Nov, then this week
  ['Gilly', 'President', 'Australia/Melbourne', '2026-10-01', 1, 'Gym', [[5, 5], [5, 5], [5, 5], [5, 5]], [5, 2]],
  ['Kip', '', 'Australia/Melbourne', '2026-10-01', 3, 'Run', [[4, 4], [4, 4], [4, 4], [4, 4]], [4, 1]],
  ['Baylen', '', 'Australia/Melbourne', '2026-10-01', 4, 'Gym', [[4, 4], [4, 4], [4, 4], [4, 4]], [4, 2]],
  ['Ojas', '', 'Australia/Melbourne', '2026-10-01', 5, 'Gym', [[3, 3], [3, 3], [3, 3], [3, 3]], [3, 1]],
  ['Dija', 'Treasurer', 'Europe/London', '2026-11-08', 6, 'Swim', [], [3, 0]],
  ['Vlad', 'Attorney General', 'Australia/Melbourne', '2026-10-01', 7, 'Gym', [[3, 3], [3, 3], [3, 3], [3, 3]], [3, 2]],
  ['Manny', 'Ombudsman', 'Australia/Melbourne', '2026-10-01', 8, 'Treadmill intervals', [[5, 0], [5, 5], [5, 5], [5, 5]], [5, 1]],
  ['Izak', '', 'Australia/Melbourne', '2026-10-01', 9, 'Gym', [[6, 6], [6, 6], [6, 3], [6, 6]], [6, 2]],
  ['Sauce', 'Opposition Leader', 'Australia/Melbourne', '2026-10-01', 10, 'Gym', [[4, 4], [4, 4], [4, 4], [4, 4]], [4, 1]],
  ['Dakey', '', 'Australia/Melbourne', '2026-10-01', 11, 'Run', [[3, 3], [3, 3], [3, 3], [3, 1]], [3, 0]],
  ['Joel', '', 'Australia/Melbourne', '2026-10-01', 12, 'Gym', [[3, 3], [3, 2], [3, 3], [3, 3]], [3, 1]],
  ['Rad', '', 'Australia/Melbourne', '2026-10-01', 13, 'Gym', [[4, 4], [4, 4], [4, 4], [4, 2]], [4, 1]],
  ['Slim', '', 'Australia/Melbourne', '2026-10-01', 14, 'Gym', [[5, 5], [5, 5], [5, 5], [5, 5]], [5, 2]],
];
const WEEKS = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];
const ids = {};

async function seedWeek(uid, week, activity, declared, done, when) {
  const g = await fake.db.query(`insert into public.goals (user_id, week_start, activity, category, target) values (${lit(uid)}, ${lit(week)}, ${lit(activity)}, 'physical', ${declared}) returning id`);
  for (let i = 0; i < done; i += 1) {
    await fake.db.exec(`insert into public.logs (user_id, goal_id, week_start, local_day, duration_min, photo_path, logged_at)
      values (${lit(uid)}, ${lit(g.rows[0].id)}, ${lit(week)}, ${lit(week)}::date + ${i % 7}, ${40 + i * 3}, ${lit(`${uid}/seed-${week}-${i}.jpg`)}, ${lit(when || `${week}T08:00:00Z`)}::timestamptz + interval '${i} hours')`);
  }
  return g.rows[0].id;
}

async function seed(khov) {
  await fake.db.exec(`update public.profiles set title = 'Vice President', sort_order = 2, joined_at = '2026-10-01' where id = ${lit(khov)}`);
  for (const [i, n] of [7, 7, 6, 7].entries()) await seedWeek(khov, WEEKS[i], 'Gym', n, n);
  for (const [nick, title, tz, joined, order, activity, past, cur] of OTHERS) {
    const uid = await fake.newUser(`${nick.toLowerCase()}@example.com`);
    ids[nick] = uid;
    await fake.db.exec(`insert into public.profiles (id, nickname, title, timezone, sort_order, joined_at, is_admin, can_manage_kitty)
      values (${lit(uid)}, ${lit(nick)}, ${lit(title)}, ${lit(tz)}, ${order}, ${lit(joined)}, ${nick === 'Gilly'}, ${nick === 'Gilly' || nick === 'Dija'})`);
    for (const [w, [declared, done]] of past.entries()) await seedWeek(uid, WEEKS[w], activity, declared, done);
    await seedWeek(uid, '2026-11-09', activity, cur[0], cur[1], '2026-11-08T21:00:00Z');
  }
  await fake.db.exec(`
    insert into public.week_rulings (user_id, week_start, note) values (${lit(ids.Manny)}, '2026-10-12', 'Annual leave');
    insert into public.ledger (user_id, kind, week_start, amount, status, due_date, created_at) values (${lit(ids.Rad)}, 'forfeit', '2026-11-02', 70, 'owed', '2026-11-18', '2026-11-08T00:00:00Z');
    insert into public.ledger (user_id, kind, week_start, amount, status, paid_at, created_at) values (${lit(ids.Izak)}, 'forfeit', '2026-10-26', 70, 'paid', '2026-11-05T00:00:00Z', '2026-11-02T00:00:00Z');
    insert into public.ledger (user_id, kind, amount, note, status, paid_at, created_at) values (${lit(ids.Izak)}, 'fee', 15, 'Dispute handling fee', 'paid', '2026-11-05T00:00:00Z', '2026-11-03T00:00:00Z');
    insert into public.ledger (user_id, kind, week_start, amount, status, paid_at, created_at) values (${lit(ids.Joel)}, 'forfeit', '2026-10-19', 70, 'paid', '2026-10-28T00:00:00Z', '2026-10-26T00:00:00Z');
  `);
}

try {
  // A test photo, drawn in the browser.
  const scratch = await newPage();
  await scratch.goto(APP);
  const dataUrl = await scratch.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1500; c.height = 2000;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1500, 2000);
    g.addColorStop(0, '#5b6c7d'); g.addColorStop(1, '#27313b');
    x.fillStyle = g; x.fillRect(0, 0, 1500, 2000);
    x.fillStyle = '#d9dee4'; x.font = 'bold 110px sans-serif'; x.textAlign = 'center';
    x.fillText('TEST PHOTO', 750, 900);
    x.font = '60px sans-serif'; x.fillText('(a gym selfie goes here)', 750, 1010);
    return c.toDataURL('image/jpeg', 0.9);
  });
  const photoPath = join(out, 'test-photo.jpg');
  writeFileSync(photoPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const selfieUrl = await scratch.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 1200;
    const x = c.getContext('2d');
    x.fillStyle = '#8a6f5c'; x.fillRect(0, 0, 900, 1200);
    x.fillStyle = '#e8c9a8'; x.beginPath(); x.arc(450, 520, 250, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2b2b2b'; x.beginPath(); x.arc(360, 470, 26, 0, Math.PI * 2); x.arc(540, 470, 26, 0, Math.PI * 2); x.fill();
    x.lineWidth = 22; x.strokeStyle = '#2b2b2b'; x.lineCap = 'round'; x.beginPath(); x.arc(450, 560, 110, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    x.fillStyle = '#fff'; x.font = 'bold 70px sans-serif'; x.textAlign = 'center'; x.fillText('TEST SELFIE', 450, 1020);
    return c.toDataURL('image/jpeg', 0.9);
  });
  const selfiePath = join(out, 'test-selfie.jpg');
  writeFileSync(selfiePath, Buffer.from(selfieUrl.split(',')[1], 'base64'));
  await scratch.context().close();

  // ---- Khov creates the first account and sets up the group
  const page = await newPage();
  await page.goto(APP);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await shot(page, 'sign-in');
  await page.getByRole('button', { name: 'New here' }).click();
  await page.getByLabel('Email').fill('khov@example.com');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('at least 8 characters').first().waitFor();
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Set up the group' }).waitFor();
  await page.getByLabel('Your name in the group').fill('Khov');
  await page.getByRole('button', { name: 'Create the group' }).click();
  await page.getByText('No goals declared this week').waitFor();
  ok('first account creates the group and lands on Log');

  const khov = (await fake.db.query(`select id from public.profiles where nickname = 'Khov'`)).rows[0].id;
  await seed(khov);

  // ---- Monday: declare the week
  await page.getByRole('link', { name: 'Declare this week' }).click();
  await page.getByRole('heading', { name: 'Declare your week' }).waitFor();
  await page.getByText('Locks Monday at 11:59 pm').waitFor();
  await page.getByRole('button', { name: 'Gym', exact: true }).click();
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'One more Gym' }).click();
  await page.getByRole('button', { name: 'Soccer training', exact: true }).click();
  await page.getByRole('button', { name: 'One more Soccer training' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByText('7 goals', { exact: true }).waitFor();
  await page.getByText('In line with your recent weeks').waitFor();
  await page.getByRole('button', { name: 'Save 7 goals' }).click();
  await page.getByText('Saved.').waitFor();
  await shot(page, 'declare');
  ok('declare 4 gym, 2 soccer training, 1 run on Monday');

  // Under the minimum without a reason is refused.
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByText('Locks Mon 16 Nov at 11:59 pm').waitFor();
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await page.getByRole('button', { name: 'Save 1 goal' }).click();
  await page.getByText('under the minimum of 3').waitFor();
  ok('a week under the minimum asks for a reason');

  // Two sessions already logged earlier in the week (Monday), straight into the database.
  const gs = (await fake.db.query(`select id, activity from public.goals where user_id = ${lit(khov)} and week_start = '2026-11-09'`)).rows;
  const gid = Object.fromEntries(gs.map((g) => [g.activity, g.id]));
  await fake.db.exec(`
    insert into public.logs (user_id, goal_id, week_start, local_day, duration_min, photo_path, logged_at) values
      (${lit(khov)}, ${lit(gid.Gym)}, '2026-11-09', '2026-11-09', 61, ${lit(`${khov}/seed-a.jpg`)}, '2026-11-09T07:30:00Z'),
      (${lit(khov)}, ${lit(gid['Soccer training'])}, '2026-11-09', '2026-11-09', 90, ${lit(`${khov}/seed-b.jpg`)}, '2026-11-09T09:00:00Z');
  `);

  // ---- Tuesday 6:14 pm: goals are locked, log a gym session
  await fake.setNow(TUE_614PM);
  await page.goto(`${APP}/#/goals`);
  await page.reload();
  await page.getByRole('button', { name: 'This week' }).click();
  await page.getByText('Locked since Monday 11:59 pm').waitFor();
  assert.equal(await page.getByRole('button', { name: /Save/ }).count(), 0);
  await shot(page, 'goals-locked');
  ok('after Monday the week is read-only');

  await page.getByRole('link', { name: 'Log' }).click();
  await page.getByRole('heading', { name: 'Log activity' }).waitFor();
  await page.getByText('2 / 7').waitFor();
  await page.getByRole('button', { name: /Stamp it/ }).click();
  await page.getByText('Enter how long it took.').waitFor();
  await page.getByLabel('Minutes').fill('52');
  await page.getByText('Over the 25 minute minimum for Physical').waitFor();
  await page.getByRole('button', { name: /Stamp it/ }).click();
  await page.getByText('Add a proof photo first.').waitFor();
  await page.setInputFiles('input[aria-label="Take a proof photo"]', photoPath);
  await page.getByText('Photo added').waitFor();
  await page.setInputFiles('input[aria-label="Take a selfie"]', selfiePath);
  await page.getByText('Selfie added').waitFor();
  await shot(page, 'log');
  await page.getByRole('button', { name: /Stamp it/ }).click();
  await page.getByRole('heading', { name: 'Your stamp' }).waitFor();
  await page.getByText('3 / 7').waitFor();
  await page.getByText('Time set by the app: Tue 10 Nov, 6:14 pm').waitFor();
  const size = await page.locator('img.stamp-img').evaluate(async (img) => { await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
  assert.deepEqual(size, [1080, 1350]);
  const stampUrl = await page.locator('img.stamp-img').getAttribute('src');
  const stampB64 = await page.evaluate(async (u) => {
    const buf = await (await fetch(u)).arrayBuffer();
    let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }, stampUrl);
  writeFileSync(join(out, 'stamp.jpg'), Buffer.from(stampB64, 'base64'));
  await shot(page, 'stamp');
  const stored = [...fake.files.values()][0];
  assert.ok(stored.length > 5000 && stored.length < 600000, `stored photo is ${stored.length} bytes`);
  assert.equal(stored.subarray(0, 2).toString('hex'), 'ffd8');
  ok(`log + stamp: 1080x1350 image, server time, tally 3/7, stored photo ${Math.round(stored.length / 1024)} KB`);

  // A short second gym session the same day gets both flags.
  await page.getByRole('button', { name: 'Log another' }).click();
  await page.getByLabel('Hours').fill('0');
  await page.getByLabel('Minutes').fill('20');
  await page.getByText('Not over the 25 minute minimum').waitFor();
  await page.setInputFiles('input[aria-label="Take a proof photo"]', photoPath);
  await page.getByText('Photo added').waitFor();
  await page.getByRole('button', { name: /Stamp it/ }).click();
  await page.getByText('is not over the 25 minute minimum').waitFor();
  await page.getByText('Second Gym logged today').waitFor();
  await shot(page, 'stamp-flagged');
  await page.getByRole('button', { name: /Undo this entry/ }).click();
  await page.getByRole('heading', { name: 'Log activity' }).waitFor();
  await page.getByText('3 / 7').waitFor();
  ok('a short repeat is flagged, and undo removes it');

  // Hours and minutes: 1:30 is stored as 90 minutes and shown as "1 h 30 min".
  await page.getByRole('button', { name: /^Run/ }).click();
  await page.getByLabel('Hours').fill('01');
  await page.getByLabel('Minutes').fill('30');
  await page.getByText('1 h 30 min', { exact: true }).waitFor();
  await page.setInputFiles('input[aria-label="Take a proof photo"]', photoPath);
  await page.getByText('Photo added').waitFor();
  await page.getByRole('button', { name: /Stamp it/ }).click();
  await page.getByRole('heading', { name: 'Your stamp' }).waitFor();
  assert.match(await page.locator('img.stamp-img').getAttribute('alt'), /Run, 1 h 30 min, 4 of 7/);
  const longest = (await fake.db.query(`select max(duration_min) as m from public.logs where user_id = ${lit(khov)} and week_start = '2026-11-09'`)).rows[0].m;
  assert.equal(longest, 90);
  await shot(page, 'stamp-hours');
  await page.getByRole('button', { name: /Undo this entry/ }).click();
  await page.getByRole('heading', { name: 'Log activity' }).waitFor();
  await page.getByText('3 / 7').waitFor();
  ok('hours and minutes: 01:30 logs 90 minutes');

  // ---- the group and a member's record
  await page.getByRole('link', { name: 'Group' }).click();
  await page.getByRole('heading', { name: 'The group' }).waitFor();
  await page.getByText('Opposition Leader').waitFor();
  assert.equal(await page.locator('a.member').count(), 14);
  const mine = page.locator('a.member.selected');
  assert.match(await mine.innerText(), /Khov[\s\S]*3 \/ 7[\s\S]*4/);
  assert.match(await page.locator('a.member', { hasText: 'Manny' }).innerText(), /1 \/ 5[\s\S]*3/);
  assert.match(await page.locator('a.member', { hasText: 'Rad' }).innerText(), /1 \/ 4[\s\S]*0/);
  await shot(page, 'group');
  ok('group lists all 14 with tallies and streaks');

  await mine.click();
  await page.getByRole('heading', { name: 'Khov' }).waitFor();
  await page.getByText('Gym · 52 min').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.thumb img').length >= 1);
  await shot(page, 'member');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByText('Week of Mon 2 Nov').waitFor();
  await page.getByText('7 of 7 done').waitFor();
  ok('member record shows proof photos and past weeks');

  // ---- the Kitty
  await page.getByRole('link', { name: 'Kitty' }).click();
  await page.getByRole('heading', { name: 'The Kitty' }).waitFor();
  await page.getByText('$5 × 14 eligible members = $70').waitFor();
  await page.getByText('Finished weeks to decide').waitFor();
  assert.equal(await page.locator('.kitty-num').first().innerText(), '$155');
  assert.equal(await page.locator('.kitty-num').nth(1).innerText(), '$70');
  await shot(page, 'kitty');
  await page.locator('.card.owed', { hasText: 'Rad' }).getByRole('button', { name: 'Mark paid' }).click();
  await page.waitForFunction(() => document.querySelector('.kitty-num').textContent === '$225');
  await page.locator('.card', { hasText: 'Dakey' }).getByRole('button', { name: /Issue \$70 forfeit/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.kitty-num')[1].textContent === '$70');
  await page.locator('.card.owed', { hasText: 'Dakey' }).waitFor();
  ok('Kitty: totals, mark paid, issue a forfeit');

  // ---- More: profile, members, rules
  await page.getByRole('link', { name: 'More' }).click();
  await page.getByText('Members', { exact: true }).waitFor();
  const code = await page.getByLabel('Join code (give this to new members)').inputValue();
  assert.ok(code.length >= 6);
  await shot(page, 'more');
  await page.locator('.card', { hasText: 'sauce@example.com' }).getByRole('button').first().click();
  await page.getByLabel('Office (shown under the name)').fill('Leader of the Opposition');
  await page.getByRole('button', { name: 'Save Sauce' }).click();
  await page.getByText('Leader of the Opposition').waitFor();
  assert.equal(await page.getByLabel('New members can set goals for the week they join').isChecked(), true);
  ok('admin can edit a member');

  // Still signed in after a reload, then sign out and back in.
  await page.reload();
  await page.getByRole('heading', { name: 'More' }).waitFor();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.getByLabel('Email').fill('khov@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.getByText('do not match').waitFor();
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.getByRole('heading', { name: 'More' }).waitFor();
  ok('sign out and back in');

  // ---- a new member needs the join code and gets no admin powers
  const p2 = await newPage();
  await p2.goto(APP);
  await p2.getByRole('button', { name: 'New here' }).click();
  await p2.getByLabel('Email').fill('newbie@example.com');
  await p2.getByLabel('Password').fill('another-pass');
  await p2.getByRole('button', { name: 'Create account' }).click();
  await p2.getByRole('heading', { name: 'Join the group' }).waitFor();
  await p2.getByLabel('Your name in the group').fill('Newbie');
  await p2.getByLabel('Join code').fill('NOPE1234');
  await p2.getByRole('button', { name: 'Join', exact: true }).click();
  await p2.getByText('That join code is not right.').waitFor();
  await shot(p2, 'join-wrong-code');
  await p2.getByLabel('Join code').fill(code);
  await p2.getByRole('button', { name: 'Join', exact: true }).click();
  await p2.getByText('No goals declared this week').waitFor();
  // Joined on Tuesday, after the lock: gets 24 hours to set this first week.
  await p2.getByText('You joined part-way through the week').waitFor();
  await p2.getByRole('link', { name: 'Declare this week' }).click();
  await p2.getByText('You joined mid-week, so you can set this week\'s goals until Wed 11 Nov, 6:14 pm').waitFor();
  await p2.getByRole('button', { name: 'Gym', exact: true }).click();
  for (let i = 0; i < 2; i += 1) await p2.getByRole('button', { name: 'One more Gym' }).click();
  await p2.getByRole('button', { name: 'Save 3 goals' }).click();
  await p2.getByText('Saved.').waitFor();
  await shot(p2, 'mid-week-joiner-goals');
  await p2.getByRole('link', { name: 'Log' }).click();
  await p2.getByText('0 of 3 done').waitFor();
  await p2.getByRole('link', { name: 'Kitty' }).click();
  await p2.getByRole('heading', { name: 'The Kitty' }).waitFor();
  await p2.getByText('Forfeits and fees').waitFor();
  assert.equal(await p2.getByRole('button', { name: 'Mark paid' }).count(), 0);
  assert.equal(await p2.getByText('Finished weeks to decide').count(), 0);
  await p2.getByRole('link', { name: 'More' }).click();
  await p2.getByRole('heading', { name: 'More' }).waitFor();
  assert.equal(await p2.getByText('Rules', { exact: true }).count(), 0);
  await p2.getByRole('link', { name: 'Group' }).click();
  await p2.locator('a.member', { hasText: 'Khov' }).click();
  await p2.getByText('Gym · 52 min').waitFor();
  assert.equal(await p2.getByRole('button', { name: /Undo|Remove entry/ }).count(), 0);
  ok('new member: join code enforced, no admin or Kitty controls');

  assert.deepEqual(problems, []);
  console.log('\nAll app checks passed.');
} catch (e) {
  console.log(`\nFAIL: ${e.message}`);
  if (problems.length) console.log(problems.join('\n'));
  process.exitCode = 1;
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (const [i, p] of pages.entries()) await p.screenshot({ path: join(out, `failure-${i}.png`), fullPage: true });
  } catch { /* ignore */ }
} finally {
  await browser.close();
  stopPreview();
  await fake.close();
  process.exit(process.exitCode || 0);
}
