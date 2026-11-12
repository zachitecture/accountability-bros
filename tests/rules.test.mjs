// Checks the database rules by running the real schema.sql in a local Postgres.
// Run with: npm run test:rules
import assert from 'node:assert/strict';
import { createDb } from './harness.mjs';

const { db, asUser, call, newUser, setNow } = await createDb();
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}
async function fails(promise, pattern) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, `expected an error matching ${pattern}`);
  assert.match(err.message, pattern);
}

// Melbourne is UTC+11 in November. Monday 2 Nov and Monday 9 Nov 2026.
const MON_2_NOV_10AM = '2026-11-01T23:00:00Z';
const MON_9_NOV_10AM = '2026-11-08T23:00:00Z';
const MON_9_NOV_1159PM = '2026-11-09T12:59:30Z';
const TUE_10_NOV_1201AM = '2026-11-09T13:00:01Z'; // still Monday 1pm in London
const TUE_10_NOV_614PM = '2026-11-10T07:14:00Z';
const MON_16_NOV_10AM = '2026-11-15T23:00:00Z';

await setNow(MON_2_NOV_10AM);
const khov = await newUser('khov@example.com');
const gilly = await newUser('gilly@example.com');
const dija = await newUser('dija@example.com');
const rad = await newUser('rad@example.com');
const stranger = await newUser('stranger@example.com');
let joinCode;

await test('tables cannot be read or written directly', async () => {
  for (const t of ['profiles', 'goals', 'logs', 'ledger', 'settings', 'week_notes', 'week_rulings']) {
    await fails(asUser(khov, `select * from public.${t}`), /permission denied/);
  }
  await fails(asUser(khov, `insert into public.logs (user_id) values ('${khov}')`), /permission denied/);
});

await test('signed-out visitors cannot call anything', async () => {
  await fails(call(null, 'get_state', {}, 'anon'), /permission denied/);
  await fails(call(null, 'get_group', {}, 'anon'), /permission denied/);
});

await test('helper functions cannot be called from outside', async () => {
  await fails(call(khov, 'streak', { p_user: khov }), /permission denied/);
  await fails(call(khov, 'me'), /permission denied/);
});

await test('someone who has not joined sees nothing', async () => {
  const s = await call(stranger, 'get_state');
  assert.equal(s.member, false);
  assert.equal(s.first, true);
  await fails(call(stranger, 'get_group'), /not joined/);
  await fails(call(stranger, 'get_kitty'), /not joined/);
});

await test('first member joins without a code and becomes admin', async () => {
  const s = await call(khov, 'join_group', { p_code: '', p_nickname: 'Khov', p_timezone: 'Australia/Melbourne' });
  assert.equal(s.member, true);
  assert.equal(s.me.is_admin, true);
  assert.equal(s.me.can_manage_kitty, true);
  assert.equal(s.week_start, '2026-11-02');
  joinCode = (await call(khov, 'get_admin_settings')).join_code;
  assert.ok(joinCode.length >= 6);
});

await test('everyone after that needs the join code', async () => {
  await fails(call(gilly, 'join_group', { p_code: 'WRONG', p_nickname: 'Gilly', p_timezone: 'Australia/Melbourne' }), /join code/);
  await fails(call(gilly, 'join_group', { p_code: joinCode, p_nickname: 'khov', p_timezone: 'Australia/Melbourne' }), /already has that name/);
  const s = await call(gilly, 'join_group', { p_code: joinCode.toLowerCase(), p_nickname: 'Gilly', p_timezone: 'Australia/Melbourne' });
  assert.equal(s.me.is_admin, false);
  await call(dija, 'join_group', { p_code: joinCode, p_nickname: 'Dija', p_timezone: 'Europe/London' });
  await call(rad, 'join_group', { p_code: joinCode, p_nickname: 'Rad', p_timezone: 'Not/AZone' });
  const members = await call(khov, 'list_members');
  assert.equal(members.length, 4);
  assert.equal(members.find((m) => m.nickname === 'Rad').timezone, 'Australia/Melbourne');
  assert.equal(members.find((m) => m.nickname === 'Dija').email, 'dija@example.com');
});

await test('only admins manage members and rules', async () => {
  await fails(call(gilly, 'list_members'), /Executive/);
  await fails(call(gilly, 'update_settings', { p_patch: { forfeit_per_member: 0 } }), /Executive/);
  await fails(call(gilly, 'get_admin_settings'), /Executive/);
  await call(khov, 'update_member', { p_user: gilly, p_patch: { is_admin: true, can_manage_kitty: true, title: 'President', sort_order: 1 } });
  await call(khov, 'update_member', { p_user: dija, p_patch: { can_manage_kitty: true, title: 'Treasurer' } });
  await fails(call(khov, 'update_member', { p_user: khov, p_patch: { is_admin: false } }), /own admin/);
  const s = await call(gilly, 'get_state');
  assert.equal(s.me.is_admin, true);
  assert.equal(s.me.title, 'President');
});

let khovGym;
await test('week of 2 Nov: goals and a completed week', async () => {
  const w = await call(khov, 'save_goals', { p_week: '2026-11-02', p_goals: [{ activity: 'Gym', category: 'physical', target: 1 }], p_reason: 'Easing back in' });
  assert.equal(w.goals.length, 1);
  assert.equal(w.reason, 'Easing back in');
  khovGym = w.goals[0].id;
  const log = await call(khov, 'log_activity', { p_goal_id: khovGym, p_duration: 45, p_photo_path: `${khov}/a.jpg` });
  assert.equal(log.done, 1);
  assert.equal(log.total, 1);
  const r = await call(rad, 'save_goals', { p_week: '2026-11-02', p_goals: [{ activity: 'Gym', category: 'physical', target: 2 }], p_reason: 'Injury' });
  await call(rad, 'log_activity', { p_goal_id: r.goals[0].id, p_duration: 40, p_photo_path: `${rad}/a.jpg` });
  await call(gilly, 'save_goals', { p_week: '2026-11-02', p_goals: [{ activity: 'Run', category: 'physical', target: 3 }] });
});

await test('under the minimum needs a reason', async () => {
  await fails(call(gilly, 'save_goals', { p_week: '2026-11-09', p_goals: [{ activity: 'Run', category: 'physical', target: 2 }] }), /under the minimum of 3/);
  await fails(call(gilly, 'save_goals', { p_week: '2026-11-10', p_goals: [] }), /Monday/);
  await fails(call(gilly, 'save_goals', { p_week: '2026-11-23', p_goals: [{ activity: 'Run', category: 'physical', target: 3 }] }), /this week or next week/);
});

let goals;
await test('week of 9 Nov: declare 7 before the Monday lock', async () => {
  await setNow(MON_9_NOV_10AM);
  const s = await call(khov, 'get_state');
  assert.equal(s.week_start, '2026-11-09');
  assert.equal(s.locked, false);
  const w = await call(khov, 'save_goals', {
    p_week: '2026-11-09',
    p_goals: [
      { activity: 'Gym', category: 'physical', target: 4 },
      { activity: 'Soccer training', category: 'physical', target: 2 },
      { activity: 'Run', category: 'physical', target: 1 },
    ],
  });
  goals = Object.fromEntries(w.goals.map((g) => [g.activity, g.id]));
  assert.equal(w.editable, true);
  assert.equal(w.history.at(-1).declared, 1);
  assert.equal(w.history.at(-1).done, 1);
  await setNow(MON_9_NOV_1159PM);
  const w2 = await call(khov, 'save_goals', {
    p_week: '2026-11-09',
    p_goals: w.goals.map((g) => ({ id: g.id, activity: g.activity, category: g.category, target: g.target })),
  });
  assert.equal(w2.goals.length, 3);
});

await test('goals lock when Monday ends, in each member\'s own time zone', async () => {
  await setNow(TUE_10_NOV_1201AM);
  assert.equal((await call(khov, 'get_state')).locked, true);
  await fails(call(khov, 'save_goals', { p_week: '2026-11-09', p_goals: [{ activity: 'Walk', category: 'physical', target: 3 }] }), /locked on Monday/);
  // Next week is still open.
  const next = await call(khov, 'save_goals', { p_week: '2026-11-16', p_goals: [{ activity: 'Gym', category: 'physical', target: 3 }] });
  assert.equal(next.editable, true);
  // It is still Monday afternoon in London, so Dija can still declare.
  assert.equal((await call(dija, 'get_state')).locked, false);
  const d = await call(dija, 'save_goals', { p_week: '2026-11-09', p_goals: [{ activity: 'Swim', category: 'physical', target: 3 }] });
  assert.equal(d.goals.length, 1);
  // The Executive can still fix another member's goals after the lock, not their own.
  await fails(call(rad, 'save_goals', { p_week: '2026-11-09', p_goals: [], p_user: khov }), /Executive/);
  const fixed = await call(gilly, 'save_goals', { p_week: '2026-11-09', p_goals: [{ activity: 'Gym', category: 'physical', target: 3 }], p_user: rad });
  assert.equal(fixed.nickname, 'Rad');
});

let firstLog;
await test('logging: server time, tally, and the photo must be your own', async () => {
  await setNow(TUE_10_NOV_614PM);
  await fails(call(khov, 'log_activity', { p_goal_id: goals.Gym, p_duration: 52, p_photo_path: `${rad}/x.jpg` }), /proof photo/);
  await fails(call(khov, 'log_activity', { p_goal_id: goals.Gym, p_duration: 0, p_photo_path: `${khov}/b.jpg` }), /minutes/);
  await fails(call(rad, 'log_activity', { p_goal_id: goals.Gym, p_duration: 52, p_photo_path: `${rad}/b.jpg` }), /not found/);
  await fails(call(khov, 'log_activity', { p_goal_id: khovGym, p_duration: 52, p_photo_path: `${khov}/b.jpg` }), /not from this week/);
  firstLog = await call(khov, 'log_activity', { p_goal_id: goals.Gym, p_duration: 52, p_photo_path: `${khov}/b.jpg` });
  assert.equal(firstLog.done, 1);
  assert.equal(firstLog.total, 7);
  assert.equal(firstLog.flag_short, false);
  assert.equal(firstLog.flag_same_day, false);
  assert.equal(new Date(firstLog.logged_at).toISOString(), '2026-11-10T07:14:00.000Z');
  await fails(call(khov, 'log_activity', { p_goal_id: goals.Run, p_duration: 30, p_photo_path: `${khov}/b.jpg` }), /already been used/);
});

await test('short sessions and same-day repeats are flagged, extras are refused', async () => {
  const short = await call(khov, 'log_activity', { p_goal_id: goals.Gym, p_duration: 25, p_photo_path: `${khov}/c.jpg` });
  assert.equal(short.flag_short, true);
  assert.equal(short.flag_same_day, true);
  const run = await call(khov, 'log_activity', { p_goal_id: goals.Run, p_duration: 26, p_photo_path: `${khov}/d.jpg` });
  assert.equal(run.flag_short, false);
  assert.equal(run.done, 3);
  await fails(call(khov, 'log_activity', { p_goal_id: goals.Run, p_duration: 30, p_photo_path: `${khov}/e.jpg` }), /already done all 1/);
  const g = await call(rad, 'get_group');
  const row = g.members.find((m) => m.nickname === 'Khov');
  assert.equal(row.done, 3);
  assert.equal(row.total, 7);
  assert.equal(row.flags, 1);
  assert.equal(g.members[0].nickname, 'Gilly'); // list position 1
});

await test('a goal with activity logged cannot be removed or cut below what is done', async () => {
  await fails(call(gilly, 'save_goals', { p_week: '2026-11-09', p_goals: [{ id: goals.Gym, activity: 'Gym', category: 'physical', target: 1 }], p_user: khov }), /cannot go below/);
  await fails(call(gilly, 'save_goals', { p_week: '2026-11-09', p_goals: [{ activity: 'Walk', category: 'physical', target: 7 }], p_user: khov }), /cannot be removed/);
  const w = await call(khov, 'get_week');
  assert.equal(w.goals.length, 3);
});

await test('undo: 15 minutes for yourself, then only another admin', async () => {
  const m = await call(rad, 'get_member', { p_user: khov });
  assert.equal(m.logs.length, 3);
  assert.equal(m.logs[0].can_undo, false); // Rad is not an admin
  await fails(call(rad, 'undo_log', { p_log_id: firstLog.id }), /Executive/);
  await setNow('2026-11-10T07:30:00Z');
  await fails(call(khov, 'undo_log', { p_log_id: firstLog.id }), /15 minutes/);
  await setNow('2026-11-10T07:20:00Z');
  await call(khov, 'undo_log', { p_log_id: firstLog.id });
  assert.equal((await call(khov, 'get_week')).goals[0].done, 1);
  const again = await call(khov, 'log_activity', { p_goal_id: goals.Gym, p_duration: 52, p_photo_path: `${khov}/f.jpg` });
  await setNow('2026-11-11T07:20:00Z');
  await call(gilly, 'undo_log', { p_log_id: again.id });
  assert.equal((await call(khov, 'get_week')).goals[0].done, 1);
});

await test('streaks count complete weeks and skip excused ones', async () => {
  const g = await call(khov, 'get_group');
  assert.equal(g.members.find((m) => m.nickname === 'Khov').streak, 1);
  assert.equal(g.members.find((m) => m.nickname === 'Rad').streak, 0);
  for (const [goal, n] of [[goals.Gym, 3], [goals['Soccer training'], 2]]) {
    for (let i = 0; i < n; i += 1) {
      await setNow(`2026-11-1${2 + i}T07:00:00Z`);
      await call(khov, 'log_activity', { p_goal_id: goal, p_duration: 60, p_photo_path: `${khov}/s-${goal}-${i}.jpg` });
    }
  }
  const after = await call(khov, 'get_group');
  const me = after.members.find((m) => m.nickname === 'Khov');
  assert.equal(me.done, 7);
  assert.equal(me.streak, 2);
});

await test('the Kitty: misses, forfeits and who may mark them paid', async () => {
  await setNow(MON_16_NOV_10AM);
  await fails(call(rad, 'issue_forfeit', { p_user: gilly, p_week: '2026-11-09' }), /Kitty managers/);
  const k = await call(gilly, 'get_kitty');
  assert.equal(k.can_manage, true);
  assert.equal(k.eligible_count, 4);
  assert.equal(k.forfeit_amount, 20);
  const missed = k.misses.map((m) => `${m.nickname} ${m.week_start} ${m.done}/${m.total}`);
  // Dija is in London, where it is still Sunday: her week of 9 Nov has not finished, so only 2 Nov shows.
  assert.deepEqual(missed.sort(), ['Dija 2026-11-02 0/0', 'Gilly 2026-11-02 0/3', 'Gilly 2026-11-09 0/0', 'Rad 2026-11-02 1/2', 'Rad 2026-11-09 0/3']);
  assert.equal((await call(rad, 'get_kitty')).misses.length, 0);
  await fails(call(gilly, 'issue_forfeit', { p_user: rad, p_week: '2026-11-16' }), /not finished/);
  const k2 = await call(gilly, 'issue_forfeit', { p_user: rad, p_week: '2026-11-09' });
  assert.equal(k2.owed, 20);
  assert.equal(k2.entries[0].due_date, '2026-11-26');
  await fails(call(gilly, 'issue_forfeit', { p_user: rad, p_week: '2026-11-09' }), /already exists/);
  await call(khov, 'issue_forfeit', { p_user: gilly, p_week: '2026-11-02' });
  const mine = (await call(gilly, 'get_kitty')).entries.find((e) => e.nickname === 'Gilly');
  await fails(call(gilly, 'set_paid', { p_id: mine.id, p_paid: true }), /Another Kitty manager/);
  await fails(call(gilly, 'delete_entry', { p_id: mine.id }), /Another Kitty manager/);
  await fails(call(rad, 'set_paid', { p_id: mine.id, p_paid: true }), /Kitty managers/);
  const k3 = await call(dija, 'set_paid', { p_id: mine.id, p_paid: true });
  assert.equal(k3.in_kitty, 20);
  assert.equal(k3.owed, 20);
  await fails(call(gilly, 'excuse_week', { p_user: gilly, p_week: '2026-11-09' }), /Another Kitty manager/);
  const k4 = await call(khov, 'excuse_week', { p_user: rad, p_week: '2026-11-02', p_note: 'Injured' });
  assert.equal(k4.misses.some((m) => m.nickname === 'Rad' && m.week_start === '2026-11-02'), false);
  const k5 = await call(khov, 'add_entry', { p_user: rad, p_kind: 'fee', p_amount: 15, p_note: 'Dispute handling fee' });
  assert.equal(k5.owed, 35);
});

await test('rules are settings the Executive can change', async () => {
  const s = await call(khov, 'update_settings', { p_patch: { min_physical_minutes: 30, forfeit_per_member: 2.5, join_code: 'newcode1' } });
  assert.equal(s.min_physical_minutes, 30);
  assert.equal(s.join_code, 'NEWCODE1');
  assert.equal((await call(khov, 'get_kitty')).forfeit_amount, 10);
  await fails(call(khov, 'update_settings', { p_patch: { join_code: 'abc' } }), /6 to 24/);
  await fails(call(stranger, 'join_group', { p_code: joinCode, p_nickname: 'Sneaky', p_timezone: 'UTC' }), /join code/);
});

await test('a paused member is locked out and leaves the group list', async () => {
  await call(khov, 'update_member', { p_user: rad, p_patch: { active: false } });
  assert.equal((await call(rad, 'get_state')).paused, true);
  await fails(call(rad, 'get_group'), /paused/);
  assert.equal((await call(khov, 'get_group')).members.length, 3);
  await call(khov, 'update_member', { p_user: rad, p_patch: { active: true } });
});

await test('photo storage: own folder only, members only', async () => {
  await asUser(khov, `insert into storage.objects (bucket_id, name) values ('proof', '${khov}/z.jpg')`);
  await fails(asUser(khov, `insert into storage.objects (bucket_id, name) values ('proof', '${rad}/z.jpg')`), /row-level security/);
  await fails(asUser(stranger, `insert into storage.objects (bucket_id, name) values ('proof', '${stranger}/z.jpg')`), /row-level security/);
  assert.equal((await asUser(rad, `select name from storage.objects where bucket_id = 'proof'`)).length, 1);
  assert.equal((await asUser(stranger, `select name from storage.objects where bucket_id = 'proof'`)).length, 0);
});

await test('schema.sql can be run a second time without harm', async () => {
  const { readFileSync } = await import('node:fs');
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  assert.equal((await call(khov, 'get_group')).members.length, 4);
  await fails(call(khov, 'streak', { p_user: khov }), /permission denied/);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}.`);
