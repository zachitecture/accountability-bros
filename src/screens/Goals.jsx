import React, { useEffect, useRef, useState } from 'react';
import { rpc } from '../api.js';
import { CATEGORY_LABEL, addDays, fmtDate, fmtDayTime, plural } from '../format.js';
import { ErrorNote, Head, Icon, Loading, useLoad } from '../ui.jsx';

const QUICK = [
  ['Gym', 'physical'], ['Run', 'physical'], ['Soccer training', 'physical'], ['Swim', 'physical'], ['Ride', 'physical'],
  ['Walk', 'physical'], ['Reading', 'lifestyle'], ['Meditation', 'lifestyle'], ['Stretching', 'recovery'],
];

const HINT = {
  physical: (min) => `Physical, over ${min} min each`,
  lifestyle: () => 'Lifestyle, a goal you set',
  recovery: () => 'Recovery, counted on its own',
};

function History({ history, total }) {
  const cols = [...history.map((h) => ({ n: h.declared, label: String(h.declared) })), { n: total, label: 'Now', now: true }];
  const max = Math.max(1, ...cols.map((c) => c.n));
  const text = `Goals declared over the last four weeks: ${history.map((h) => h.declared).join(', ')}. This week: ${total}.`;
  return (
    <div className="bars" role="img" aria-label={text}>
      {cols.map((c, i) => (
        <div key={i} className={`bar-col${c.now ? ' now' : ''}`}>
          <div className={`bar${c.now ? ' now' : ''}`} style={{ height: Math.round((c.n / max) * 42) }} />
          <div>{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function compare(history, total) {
  const past = history.map((h) => h.declared).filter((n) => n > 0);
  if (past.length === 0) return 'First week on record';
  const avg = past.reduce((a, b) => a + b, 0) / past.length;
  const shown = Math.round(avg * 10) / 10;
  if (total < avg * 0.75) return `Lighter than your recent weeks (average ${shown})`;
  if (total > avg * 1.25) return `Heavier than your recent weeks (average ${shown})`;
  return 'In line with your recent weeks';
}

// userId + week are only passed when an admin edits another member's goals.
export default function Goals({ state, userId, week: fixedWeek }) {
  const forOther = Boolean(userId && userId !== state.me.id);
  const [which, setWhich] = useState(state.locked ? 'next' : 'this');
  const week = fixedWeek || (which === 'this' ? state.week_start : addDays(state.week_start, 7));
  const load = useLoad(() => rpc('get_week', { p_week: week, p_user: forOther ? userId : null }), [week, userId]);
  const [rows, setRows] = useState([]);
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const nextKey = useRef(1);
  const data = load.data;

  useEffect(() => {
    if (!data) return;
    setRows(data.goals.map((g) => ({ ...g, key: g.id })));
    setReason(data.reason || '');
    setShowReason(Boolean(data.reason));
    setError('');
  }, [data]);

  const min = state.settings.min_goals;
  const minMinutes = state.settings.min_physical_minutes;
  const total = rows.reduce((n, r) => n + r.target, 0);
  const canEdit = Boolean(data) && (data.editable || forOther);
  const needsReason = !forOther && total < min && !(data && data.on_leave);

  function patch(key, change) {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }
  function add(activity = '', category = 'physical') {
    setSaved(false);
    setRows((rs) => [...rs, { key: `new-${nextKey.current++}`, activity, category, target: 1, done: 0 }]);
  }
  function remove(key) {
    setSaved(false);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  async function copyLastWeek() {
    setError('');
    try {
      const prev = await rpc('get_week', { p_week: addDays(week, -7), p_user: forOther ? userId : null });
      if (prev.goals.length === 0) { setError('There were no goals in the week before.'); return; }
      setRows(prev.goals.map((g) => ({ key: `new-${nextKey.current++}`, activity: g.activity, category: g.category, target: g.target, done: 0 })));
    } catch (e) {
      setError(e.message);
    }
  }

  async function save() {
    setError('');
    if (rows.some((r) => !r.activity.trim())) { setError('Give each goal a name.'); return; }
    if (needsReason && !reason.trim()) { setShowReason(true); setError(`That is under the minimum of ${min}. Add a reason for the lighter week.`); return; }
    setBusy(true);
    try {
      const res = await rpc('save_goals', {
        p_week: week,
        p_goals: rows.map((r) => ({ id: r.id || null, activity: r.activity.trim(), category: r.category, target: r.target })),
        p_reason: reason,
        p_user: forOther ? userId : null,
      });
      load.setData(res);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  let lockText = `Locks ${fmtDate(week)} at 11:59 pm`;
  if (week === state.week_start) {
    if (state.locked) lockText = 'Locked since Monday 11:59 pm';
    else if (state.grace) lockText = `You joined mid-week, so you can set this week's goals until ${fmtDayTime(state.edit_until, state.me.timezone)}`;
    else lockText = 'Locks Monday at 11:59 pm';
  }

  return (
    <main className="screen">
      {forOther ? <a className="back" href={`#/member/${userId}`}><Icon name="back" size={18} width={2.4} />Back</a> : null}
      <Head eyebrow={`Week of ${fmtDate(week)}`} title={forOther && data ? `${data.nickname}'s goals` : 'Declare your week'} />

      {fixedWeek ? null : (
        <div className="seg" role="group" aria-label="Which week">
          <button type="button" aria-pressed={which === 'this'} onClick={() => { setWhich('this'); setSaved(false); }}>This week</button>
          <button type="button" aria-pressed={which === 'next'} onClick={() => { setWhich('next'); setSaved(false); }}>Next week</button>
        </div>
      )}

      {load.loading && !data ? <Loading /> : null}
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>

      {data ? (
        <>
          <div className="row small soft" style={{ gap: 8 }}>
            <Icon name={canEdit && !forOther ? 'clock' : 'lock'} size={16} />
            <span>{forOther ? 'Changing this as the Executive. It applies even after the lock.' : lockText}</span>
          </div>

          {canEdit ? (
            <>
              <div className="stack">
                <div className="row between">
                  <div className="label">{forOther ? 'Goals' : 'Your goals'}</div>
                  <div className="small muted">Minimum {min}</div>
                </div>
                {rows.map((r) => (
                  <div key={r.key} className="card goal-edit">
                    <div className="row">
                      <div className="field grow">
                        <label className="sr" htmlFor={`name-${r.key}`}>Goal name</label>
                        <input id={`name-${r.key}`} className="input" placeholder="Activity, e.g. Gym" maxLength={40} value={r.activity}
                          onChange={(e) => patch(r.key, { activity: e.target.value })} />
                      </div>
                      <button type="button" className="icon-btn" aria-label={`Remove ${r.activity || 'this goal'}`} disabled={r.done > 0} onClick={() => remove(r.key)}>
                        <Icon name="trash" size={18} />
                      </button>
                    </div>
                    <div className="row between">
                      <div className="field grow">
                        <label className="sr" htmlFor={`type-${r.key}`}>Type</label>
                        <select id={`type-${r.key}`} className="select" value={r.category} onChange={(e) => patch(r.key, { category: e.target.value })}>
                          {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div className="stepper">
                        <button type="button" className="icon-btn" aria-label={`One fewer ${r.activity || 'of this goal'}`} disabled={r.target <= Math.max(1, r.done)} onClick={() => patch(r.key, { target: r.target - 1 })}>
                          <Icon name="minus" size={18} width={2.6} />
                        </button>
                        <span className="count" aria-label={`${r.target} times`}>{r.target}</span>
                        <button type="button" className="icon-btn" aria-label={`One more ${r.activity || 'of this goal'}`} disabled={r.target >= 14} onClick={() => patch(r.key, { target: r.target + 1 })}>
                          <Icon name="plus" size={18} width={2.6} />
                        </button>
                      </div>
                    </div>
                    <div className="tiny muted">{HINT[r.category](minMinutes)}{r.done > 0 ? ` · ${r.done} already logged` : ''}</div>
                  </div>
                ))}
                <button type="button" className="btn dashed" onClick={() => add()}>
                  <Icon name="plus" size={16} width={2.6} />Add a goal
                </button>
              </div>

              <div className="stack">
                <div className="label">Quick add</div>
                <div className="chips">
                  {QUICK.filter(([a]) => !rows.some((r) => r.activity.trim().toLowerCase() === a.toLowerCase())).map(([a, c]) => (
                    <button key={a} type="button" className="chip" onClick={() => add(a, c)}>{a}</button>
                  ))}
                </div>
                {rows.length === 0 ? <button type="button" className="btn" onClick={copyLastWeek}>Use last week's goals</button> : null}
              </div>
            </>
          ) : (
            <div className="stack">
              <div className="label">Goals</div>
              {rows.length === 0 ? <div className="card sub">Nothing was declared for this week.</div> : null}
              {rows.map((r) => (
                <div key={r.key} className="card row between">
                  <div className="stack" style={{ gap: 3 }}>
                    <span className="name">{r.activity}</span>
                    <span className="sub">{HINT[r.category](minMinutes)}</span>
                  </div>
                  <span className="amount">{r.done} / {r.target}</span>
                </div>
              ))}
            </div>
          )}

          {data.on_leave ? (
            <div className="notice good" role="status">
              {forOther ? `${data.nickname} is` : 'You are'} on leave for this week ({data.leave_days} of 7 days). Goals are optional and no forfeit applies.
            </div>
          ) : null}

          <div className="card row between" style={{ alignItems: 'flex-end' }}>
            <div className="stack" style={{ gap: 6 }}>
              <div className="total-num">{plural(total, 'goal')}</div>
              <div className="small soft">{compare(data.history, total)}</div>
            </div>
            <History history={data.history} total={total} />
          </div>

          {canEdit ? (
            <>
              {showReason || needsReason ? (
                <div className="field">
                  <label className="label" htmlFor="reason">Reason for a lighter week</label>
                  <textarea id="reason" className="textarea" maxLength={280} placeholder="Recovery, injury, tapering or another real commitment" value={reason}
                    onChange={(e) => { setReason(e.target.value); setSaved(false); }} />
                  <div className="tiny muted">The group can see this. Sandbagging can be challenged.</div>
                </div>
              ) : (
                <button type="button" className="btn" onClick={() => setShowReason(true)}>Lighter week? Add a reason</button>
              )}
              <ErrorNote>{error}</ErrorNote>
              {saved ? <div className="notice good" role="status">Saved. {forOther ? '' : 'You can keep changing these until the lock.'}</div> : null}
              <div className="stack push">
                <button type="button" className="btn primary" onClick={save} disabled={busy}>
                  <Icon name="lock" color="var(--accent-ink)" width={2.4} />
                  {busy ? 'Saving…' : `Save ${plural(total, 'goal')}`}
                </button>
                {forOther ? null : <div className="small muted center">After the lock, swaps need the Executive.</div>}
              </div>
            </>
          ) : (
            <>
              {data.reason ? <div className="card"><div className="label">Reason for a lighter week</div><div className="small soft">{data.reason}</div></div> : null}
              <div className="small muted center">After the lock, swaps need the Executive.</div>
            </>
          )}
          {forOther ? null : <a className="btn" href="#/leave">Sick, injured or away? Take leave</a>}
        </>
      ) : null}
    </main>
  );
}
