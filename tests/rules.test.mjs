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
  // Gilly declared nothing for 9 Nov, so her 3 goals from 2 Nov carried over.
  assert.deepEqual(missed.sort(), ['Dija 2026-11-02 0/0', 'Gilly 2026-11-02 0/3', 'Gilly 2026-11-09 0/3', 'Rad 2026-11-02 1/2', 'Rad 2026-11-09 0/3']);
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

await test('joining mid-week: 24 hours to set goals for that first week', async () => {
  await setNow('2026-11-18T02:00:00Z'); // Wed 18 Nov, 1 pm in Melbourne
  const late = await newUser('late@example.com');
  const s = await call(late, 'join_group', { p_code: 'NEWCODE1', p_nickname: 'Late', p_timezone: 'Australia/Melbourne' });
  assert.equal(s.locked, false);
  assert.equal(s.grace, true);
  assert.equal(new Date(s.edit_until).toISOString(), '2026-11-19T02:00:00.000Z');
  const w = await call(late, 'save_goals', { p_week: '2026-11-16', p_goals: [{ activity: 'Gym', category: 'physical', target: 3 }] });
  assert.equal(w.editable, true);
  await call(late, 'log_activity', { p_goal_id: w.goals[0].id, p_duration: 40, p_photo_path: `${late}/a.jpg` });
  // Members who were already in before the lock get no such window.
  assert.equal((await call(khov, 'get_state')).locked, true);
  await fails(call(khov, 'save_goals', { p_week: '2026-11-16', p_goals: [{ activity: 'Walk', category: 'physical', target: 3 }] }), /locked on Monday/);
  // A week they joined part-way through is not treated as a missed week.
  await setNow('2026-11-19T03:30:00Z');
  assert.equal((await call(late, 'get_state')).locked, true);
  await fails(call(late, 'save_goals', { p_week: '2026-11-16', p_goals: [{ activity: 'Gym', category: 'physical', target: 4 }] }), /locked on Monday/);
  // The Executive can switch the window off.
  const later = await newUser('later@example.com');
  await call(khov, 'update_settings', { p_patch: { first_week_grace: false } });
  const s2 = await call(later, 'join_group', { p_code: 'NEWCODE1', p_nickname: 'Later', p_timezone: 'Australia/Melbourne' });
  assert.equal(s2.locked, true);
  await fails(call(later, 'save_goals', { p_week: '2026-11-16', p_goals: [{ activity: 'Gym', category: 'physical', target: 3 }] }), /locked on Monday/);
  await call(khov, 'update_settings', { p_patch: { first_week_grace: true } });
  await setNow('2026-11-23T02:00:00Z');
  assert.equal((await call(khov, 'get_kitty')).misses.some((m) => m.nickname === 'Late' || m.nickname === 'Later'), false);
});

await test('leave: annual before it starts, sick from today, never backdated', async () => {
  await setNow('2026-11-23T02:00:00Z'); // Mon 23 Nov, 1 pm in Melbourne
  await fails(call(rad, 'request_leave', { p_kind: 'annual', p_start: '2026-11-23', p_end: '2026-11-29' }), /tomorrow or later/);
  await fails(call(rad, 'request_leave', { p_kind: 'sick', p_start: '2026-11-22', p_end: '2026-11-25' }), /backdated/);
  await fails(call(rad, 'request_leave', { p_kind: 'sick', p_start: '2026-11-25', p_end: '2026-11-24' }), /before the first day/);
  // Three days of sick leave is under the 4 days needed, so the week still counts.
  let l = await call(rad, 'request_leave', { p_kind: 'sick', p_start: '2026-11-23', p_end: '2026-11-25', p_note: 'Flu' });
  assert.equal(l.this_week.days, 3);
  assert.equal(l.this_week.on_leave, false);
  assert.equal(l.leaves[0].status, 'approved');
  await fails(call(rad, 'request_leave', { p_kind: 'sick', p_start: '2026-11-25', p_end: '2026-11-27' }), /already have leave/);
  // Ending it today, then taking the rest of the week, makes it a leave week.
  l = await call(rad, 'cancel_leave', { p_id: l.leaves[0].id });
  assert.equal(l.leaves[0].end_date, '2026-11-23');
  l = await call(rad, 'request_leave', { p_kind: 'sick', p_start: '2026-11-24', p_end: '2026-11-29' });
  assert.equal(l.this_week.days, 7);
  assert.equal(l.this_week.on_leave, true);
  assert.equal((await call(khov, 'get_group')).members.find((x) => x.nickname === 'Rad').on_leave, true);
  // Annual leave next week, requested ahead, is approved on the spot.
  const g = await call(gilly, 'request_leave', { p_kind: 'annual', p_start: '2026-11-30', p_end: '2026-12-06', p_note: 'Bali' });
  assert.equal(g.next_week.on_leave, true);
  assert.equal(g.leaves[0].status, 'approved');
  // Someone on leave can save a week with no goals and no reason.
  const w = await call(gilly, 'save_goals', { p_week: '2026-11-30', p_goals: [] });
  assert.equal(w.on_leave, true);
  // An upcoming leave can be cancelled outright.
  const gone = await call(gilly, 'cancel_leave', { p_id: g.leaves[0].id });
  assert.equal(gone.leaves.length, 0);
  await call(gilly, 'request_leave', { p_kind: 'annual', p_start: '2026-11-30', p_end: '2026-12-06' });
});

await test('leave: sick leave over a week needs the Executive for the extra days', async () => {
  const l = await call(dija, 'request_leave', { p_kind: 'sick', p_start: '2026-11-23', p_end: '2026-12-13', p_note: 'Broken ankle' });
  assert.equal(l.leaves[0].status, 'pending');
  assert.equal(l.leaves[0].approved_until, '2026-11-29'); // the first 7 days stand
  assert.equal(l.this_week.on_leave, true);
  assert.equal(l.next_week.on_leave, false);
  await fails(call(rad, 'decide_leave', { p_id: l.leaves[0].id, p_approve: true }), /Executive/);
  const pending = (await call(khov, 'get_leave')).pending;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].nickname, 'Dija');
  await call(khov, 'decide_leave', { p_id: l.leaves[0].id, p_approve: true });
  const after = await call(dija, 'get_leave');
  assert.equal(after.leaves[0].status, 'approved');
  assert.equal(after.next_week.on_leave, true);
  await fails(call(khov, 'decide_leave', { p_id: l.leaves[0].id, p_approve: false }), /already been decided/);
  // The Executive cannot decide their own leave.
  const mine = await call(khov, 'request_leave', { p_kind: 'sick', p_start: '2026-12-14', p_end: '2026-12-31' });
  await fails(call(khov, 'decide_leave', { p_id: mine.leaves[0].id, p_approve: true }), /your own leave/);
  await call(gilly, 'decide_leave', { p_id: mine.leaves[0].id, p_approve: false });
  const declined = await call(khov, 'get_leave');
  assert.equal(declined.leaves[0].status, 'declined');
  assert.equal(declined.leaves[0].approved_until, '2026-12-20');
});

await test('leave weeks: no forfeit, streak kept, and fewer Eligible Members', async () => {
  await setNow('2026-11-30T02:00:00Z'); // the Monday after
  const k = await call(khov, 'get_kitty');
  const missed = k.misses.filter((x) => x.week_start === '2026-11-23').map((x) => x.nickname).sort();
  assert.equal(missed.includes('Rad'), false); // on leave
  assert.equal(missed.includes('Dija'), false); // on leave
  assert.equal(missed.includes('Khov'), true); // declared nothing, not on leave
  // 6 active eligible members, 2 on leave that week: the forfeit is 2.50 x 4.
  const row = k.misses.find((x) => x.week_start === '2026-11-23' && x.nickname === 'Khov');
  assert.equal(row.amount, 10);
  await fails(call(khov, 'issue_forfeit', { p_user: rad, p_week: '2026-11-23' }), /on leave that week/);
  const k2 = await call(gilly, 'issue_forfeit', { p_user: khov, p_week: '2026-11-23' });
  assert.equal(k2.entries.find((e) => e.nickname === 'Khov' && e.week_start === '2026-11-23').amount, 10);
  // The Executive can change how many days make a leave week.
  await fails(call(khov, 'update_settings', { p_patch: { leave_min_days: 0 } }), /between 1 and 7/);
  await call(khov, 'update_settings', { p_patch: { leave_min_days: 7 } });
  assert.equal((await call(dija, 'get_week', { p_week: '2026-11-23' })).on_leave, true);
  await call(khov, 'update_settings', { p_patch: { leave_min_days: 4 } });
});

const forfeitOf = async (uid, week) => (await call(khov, 'get_kitty')).entries.find((e) => e.kind === 'forfeit' && e.week_start === week && e.user_id === uid);
const late = (await call(khov, 'list_members')).find((m) => m.nickname === 'Late').id;
const later = (await call(khov, 'list_members')).find((m) => m.nickname === 'Later').id;
let khovLog;

await test('private notes: only the member who logged the session sees them', async () => {
  // Now Mon 30 Nov. Khov's goals carried over from the week before.
  const w = await call(khov, 'get_week');
  assert.equal(w.carried, true);
  const gym = w.goals.find((g) => g.category === 'physical');
  const l = await call(khov, 'log_activity', { p_goal_id: gym.id, p_duration: 50, p_photo_path: `${khov}/n.jpg`, p_note: 'Felt strong, new PB on squat' });
  khovLog = l.id;
  assert.equal((await call(khov, 'get_member', { p_user: khov })).logs[0].note, 'Felt strong, new PB on squat');
  assert.equal((await call(gilly, 'get_member', { p_user: khov })).logs[0].note, '');
  assert.equal('note' in l, false); // not sent back for the stamp
});

await test('leaderboard: most hours of physical activity', async () => {
  const week = await call(rad, 'get_leaderboard', { p_period: 'week' });
  assert.equal(week.members[0].nickname, 'Khov');
  assert.equal(week.members[0].minutes, 50);
  assert.equal(week.members[0].rank, 1);
  assert.equal(week.members.length, 6);
  const all = await call(rad, 'get_leaderboard', { p_period: 'all' });
  const k = all.members.find((m) => m.nickname === 'Khov');
  assert.ok(k.minutes > 50 && k.sessions > 1);
  await fails(call(rad, 'get_leaderboard', { p_period: 'year' }), /Unknown period/);
});

await test('disputes: own forfeit, Ombudsman advice first, upheld so fee and forfeit are waived', async () => {
  await call(khov, 'update_member', { p_user: dija, p_patch: { is_ombudsman: true, title: 'Ombudsman' } });
  await call(khov, 'update_member', { p_user: rad, p_patch: { is_attorney: true, title: 'Attorney-General' } });
  const f = await forfeitOf(khov, '2026-11-23');
  let d = await call(khov, 'save_dispute', { p_id: null, p_kind: 'forfeit', p_ref: f.id, p_standing: 'affected', p_seconder: null,
    p_grounds: 'I was on annual leave but forgot to log it before it started.', p_evidence: 'Flight booking', p_evidence_paths: [`${khov}/ev.jpg`] });
  assert.equal(d.status, 'draft');
  assert.equal(d.subject_label, 'Forfeit, week of 23 Nov · Khov · $10');
  await fails(call(khov, 'save_dispute', { p_id: d.id, p_standing: 'affected', p_grounds: 'x', p_evidence: '', p_evidence_paths: [`${rad}/x.jpg`] }), /your own uploads/);
  await fails(call(gilly, 'get_dispute', { p_id: d.id }), /not found/); // drafts are private
  d = await call(khov, 'ask_ombudsman', { p_id: d.id });
  assert.equal(d.status, 'advice');
  await fails(call(gilly, 'get_dispute', { p_id: d.id }), /not found/);
  assert.equal((await call(dija, 'list_disputes')).disputes[0].needs_me, 'Give advice');
  await fails(call(gilly, 'give_advice', { p_id: d.id, p_note: 'Go for it' }), /Only the Ombudsman/);
  d = await call(dija, 'give_advice', { p_id: d.id, p_note: 'Worth lodging. Attach the booking.' });
  assert.equal(d.status, 'draft');
  assert.equal((await call(khov, 'get_dispute', { p_id: d.id })).advice, 'Worth lodging. Attach the booking.');
  const before = (await call(khov, 'get_kitty')).owed;
  d = await call(khov, 'lodge_dispute', { p_id: d.id });
  assert.equal(d.status, 'open');
  assert.equal(d.fee_status, 'owed');
  assert.equal((await call(khov, 'get_kitty')).owed, before + 15);
  // Everyone can see a lodged dispute, but not the private advice.
  const seen = await call(rad, 'get_dispute', { p_id: d.id });
  assert.equal(seen.advice, '');
  await fails(call(khov, 'decide_dispute', { p_id: d.id, p_uphold: true, p_note: 'Mine' }), /part of this dispute/);
  await fails(call(dija, 'decide_dispute', { p_id: d.id, p_uphold: true, p_note: 'Yes' }), /Only the Executive/);
  await call(dija, 'add_findings', { p_id: d.id, p_note: 'Booking checks out. Recommend upholding.' });
  d = await call(gilly, 'decide_dispute', { p_id: d.id, p_uphold: true, p_note: 'Upheld on the Ombudsman\'s findings.' });
  assert.equal(d.status, 'upheld');
  assert.equal(d.fee_status, 'waived');
  assert.equal((await forfeitOf(khov, '2026-11-23')).status, 'waived');
  assert.equal((await call(khov, 'get_kitty')).owed, before - 10);
  await fails(call(dija, 'set_paid', { p_id: f.id, p_paid: true }), /waived/);
});

await test('disputes: someone else\'s session needs a seconder; dismissed means the fee stands', async () => {
  await fails(call(khov, 'save_dispute', { p_id: null, p_kind: 'log', p_ref: khovLog, p_standing: 'affected', p_seconder: null, p_grounds: '', p_evidence: '' }), /your own session/);
  let d = await call(gilly, 'save_dispute', { p_id: null, p_kind: 'log', p_ref: khovLog, p_standing: 'affected', p_seconder: null,
    p_grounds: 'That photo is from last week, the same shirt and the same rack.', p_evidence: '' });
  assert.match(d.subject_label, /^Khov: Gym, 50 min, Mon 30 Nov/);
  await fails(call(gilly, 'lodge_dispute', { p_id: d.id }), /another member has to second it/);
  await fails(call(gilly, 'save_dispute', { p_id: d.id, p_standing: 'seconded', p_seconder: khov, p_grounds: d.grounds, p_evidence: '' }), /cannot second/);
  d = await call(gilly, 'save_dispute', { p_id: d.id, p_standing: 'seconded', p_seconder: late, p_grounds: d.grounds, p_evidence: '' });
  d = await call(gilly, 'lodge_dispute', { p_id: d.id });
  assert.equal(d.status, 'seconding');
  assert.equal(d.fee_status, null); // no fee until it is seconded
  await fails(call(later, 'second_dispute', { p_id: d.id, p_accept: true }), /not waiting for you/);
  d = await call(late, 'second_dispute', { p_id: d.id, p_accept: false });
  assert.equal(d.status, 'draft');
  assert.equal(d.seconder_declined, 'Late');
  await call(gilly, 'save_dispute', { p_id: d.id, p_standing: 'seconded', p_seconder: later, p_grounds: d.grounds, p_evidence: '' });
  await call(gilly, 'lodge_dispute', { p_id: d.id });
  d = await call(later, 'second_dispute', { p_id: d.id, p_accept: true });
  assert.equal(d.status, 'open');
  assert.equal(d.fee_status, 'owed');
  // Khov is the subject and Gilly lodged it, so neither member of the Executive can decide it here.
  await fails(call(khov, 'decide_dispute', { p_id: d.id, p_uphold: false, p_note: 'No' }), /part of this dispute/);
  await fails(call(gilly, 'decide_dispute', { p_id: d.id, p_uphold: false, p_note: 'No' }), /part of this dispute/);
  await call(khov, 'update_member', { p_user: late, p_patch: { is_admin: true } });
  await fails(call(late, 'decide_dispute', { p_id: d.id, p_uphold: false, p_note: '' }), /short reason/);
  d = await call(late, 'decide_dispute', { p_id: d.id, p_uphold: false, p_note: 'Photo metadata shows today.' });
  assert.equal(d.status, 'dismissed');
  assert.equal(d.fee_status, 'owed');
  assert.equal((await call(khov, 'get_member', { p_user: khov })).logs.length, 1); // the session stands
  await call(khov, 'update_member', { p_user: late, p_patch: { is_admin: false } });
});

await test('disputes: the Attorney-General needs no seconder; withdrawing keeps the fee', async () => {
  let d = await call(rad, 'save_dispute', { p_id: null, p_kind: 'goals', p_ref: `${gilly}:2026-11-30`, p_standing: 'attorney', p_seconder: null,
    p_grounds: 'Three goals is sandbagging for the President.', p_evidence: '' });
  assert.equal(d.subject_label, 'Gilly\'s goals, week of 30 Nov (3 declared)');
  await fails(call(khov, 'save_dispute', { p_id: null, p_kind: 'goals', p_ref: `${gilly}:2026-11-30`, p_standing: 'attorney', p_seconder: null, p_grounds: '', p_evidence: '' }), /Attorney-General/);
  d = await call(rad, 'lodge_dispute', { p_id: d.id });
  assert.equal(d.status, 'open');
  d = await call(rad, 'withdraw_dispute', { p_id: d.id });
  assert.equal(d.status, 'withdrawn');
  assert.equal(d.fee_status, 'owed');
  const list = (await call(late, 'list_disputes')).disputes;
  assert.equal(list.length, 3); // lodged ones are public
});

await test('disputes: 7 days to lodge', async () => {
  await setNow('2026-12-08T02:00:00Z'); // Tue 8 Dec
  const old = (await call(khov, 'get_kitty')).entries.find((e) => e.kind === 'forfeit' && e.nickname === 'Rad');
  let d = await call(rad, 'save_dispute', { p_id: null, p_kind: 'forfeit', p_ref: old.id, p_standing: 'affected', p_seconder: null,
    p_grounds: 'I did all my sessions that week.', p_evidence: '' });
  assert.equal(d.past_deadline, true);
  await fails(call(rad, 'lodge_dispute', { p_id: d.id }), /within 7 days/);
  await call(rad, 'delete_dispute', { p_id: d.id });
  await fails(call(rad, 'get_dispute', { p_id: d.id }), /not found/);
});

await test('goals carry over to the next week until they are changed', async () => {
  const lastWeek = (await call(khov, 'get_week', { p_week: '2026-11-30' })).goals.map((g) => `${g.activity} ${g.target}`);
  const w = await call(khov, 'get_week');
  assert.equal(w.week_start, '2026-12-07');
  assert.equal(w.carried, true);
  assert.deepEqual(w.goals.map((g) => `${g.activity} ${g.target}`), lastWeek);
  // Changing next week's goals early means nothing is carried into it.
  const n = await call(khov, 'save_goals', { p_week: '2026-12-14', p_goals: [{ activity: 'Run', category: 'physical', target: 4 }] });
  assert.equal(n.carried, false);
  await setNow('2026-12-14T23:00:00Z'); // Tue 15 Dec
  assert.deepEqual((await call(khov, 'get_week')).goals.map((g) => `${g.activity} ${g.target}`), ['Run 4']);
  await setNow('2026-12-21T23:00:00Z'); // Tue 22 Dec
  const c = await call(khov, 'get_week');
  assert.equal(c.carried, true);
  assert.deepEqual(c.goals.map((g) => `${g.activity} ${g.target}`), ['Run 4']);
  // A paused member gets nothing carried.
  await call(khov, 'update_member', { p_user: later, p_patch: { active: false } });
  await setNow('2026-12-28T23:00:00Z');
  await call(khov, 'get_group');
  await call(khov, 'update_member', { p_user: later, p_patch: { active: true } });
  assert.equal((await call(later, 'get_week', { p_week: '2026-12-28' })).goals.length, 0);
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
  assert.equal((await call(khov, 'get_group')).members.length, 6);
  await fails(call(khov, 'streak', { p_user: khov }), /permission denied/);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', with failures above' : ''}.`);
