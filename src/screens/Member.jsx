import React, { useState } from 'react';
import { rpc } from '../api.js';
import { addDays, fmtDate, fmtDayTime, fmtDuration, plural } from '../format.js';
import { ErrorNote, Head, Icon, Loading, ProofThumb, useLoad } from '../ui.jsx';

export default function Member({ state, userId }) {
  const [week, setWeek] = useState(null); // null = that member's current week
  const load = useLoad(() => rpc('get_member', { p_user: userId, p_week: week }), [userId, week]);
  const [error, setError] = useState('');
  const d = load.data;

  async function undo(log) {
    const mine = d.is_me;
    if (!window.confirm(mine ? 'Undo this entry?' : `Remove this entry from ${d.nickname}'s record?`)) return;
    setError('');
    try {
      await rpc('undo_log', { p_log_id: log.id });
      load.reload();
    } catch (e) {
      setError(e.message);
    }
  }

  const done = d ? d.goals.reduce((n, g) => n + g.done, 0) : 0;
  const total = d ? d.goals.reduce((n, g) => n + g.target, 0) : 0;
  const isCurrent = d ? d.week_start === d.current_week : true;

  return (
    <main className="screen">
      <a className="back" href="#/group"><Icon name="back" size={18} width={2.4} />The group</a>
      {load.loading && !d ? <Loading /> : null}
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>

      {d ? (
        <>
          <Head
            eyebrow={d.title || 'Member'}
            title={d.nickname}
            side={<><div className="big-num">{d.streak}</div><div className="tiny muted">week streak</div></>}
          />

          <div className="row between">
            <button type="button" className="icon-btn" aria-label="Previous week" onClick={() => setWeek(addDays(d.week_start, -7))}><Icon name="back" size={18} width={2.4} /></button>
            <div className="center">
              <div className="name" style={{ fontSize: 15 }}>Week of {fmtDate(d.week_start)}</div>
              <div className="small muted">{done} of {total} done{d.on_leave ? ' · on leave' : ''}{d.excused ? ' · excused' : ''}</div>
            </div>
            <button type="button" className="icon-btn" aria-label="Next week" disabled={isCurrent} onClick={() => setWeek(addDays(d.week_start, 7))}><Icon name="next" size={18} width={2.4} /></button>
          </div>

          <div className="stack">
            <div className="label">Goals</div>
            {d.goals.length === 0 ? <div className="card sub">Nothing declared for this week.</div> : null}
            {d.goals.map((g) => (
              <div key={g.id} className="card row between">
                <span className="name" style={{ fontSize: 15 }}>{g.activity}</span>
                <span className="row" style={{ gap: 10 }}>
                  <span className="pips" role="img" aria-label={`${g.done} of ${g.target} done`}>
                    {Array.from({ length: g.target }, (_, i) => <span key={i} className={`pip${i < g.done ? ' on' : ''}`} />)}
                  </span>
                  <span className="small soft" style={{ width: 40, textAlign: 'right' }}>{g.done} / {g.target}</span>
                </span>
              </div>
            ))}
            {d.reason ? <div className="card"><div className="label">Reason for a lighter week</div><div className="small soft">{d.reason}</div></div> : null}
            {state.me.is_admin && !d.is_me ? <a className="btn" href={`#/goals/${userId}/${d.week_start}`}>Change {d.nickname}'s goals</a> : null}
            {!d.is_me && d.goals.length > 0 ? <a className="link-btn" style={{ alignSelf: 'flex-start' }} href={`#/dispute/new/goals/${userId}:${d.week_start}`}>Dispute these goals</a> : null}
          </div>

          <div className="stack">
            <div className="label">Proof this week</div>
            {d.logs.length === 0 ? <div className="card sub">Nothing logged yet.</div> : null}
            <ErrorNote>{error}</ErrorNote>
            {d.logs.map((l) => (
              <div key={l.id} className="card row" style={{ padding: 12, alignItems: 'flex-start' }}>
                <ProofThumb path={l.photo_path} label={`${d.nickname}, ${l.activity}, ${fmtDayTime(l.logged_at, d.timezone)}`} />
                <div className="stack grow" style={{ gap: 4 }}>
                  <div className="name" style={{ fontSize: 15 }}>{l.activity} · {fmtDuration(l.duration_min)}</div>
                  <div className="sub">{fmtDayTime(l.logged_at, d.timezone)}</div>
                  {l.note ? <div className="small soft note-text">{l.note}<span className="tiny muted"> · only you see this</span></div> : null}
                  <div className="row wrap" style={{ gap: 6 }}>
                    {l.flag_short ? <span className="badge flag">Under {state.settings.min_physical_minutes} min</span> : null}
                    {l.flag_same_day ? <span className="badge flag">Second that day</span> : null}
                  </div>
                  <div className="row" style={{ gap: 16 }}>
                    {l.can_undo ? <button type="button" className="link-btn" onClick={() => undo(l)}>{d.is_me ? 'Undo' : 'Remove entry'}</button> : null}
                    {d.is_me || new Date(state.now).getTime() - new Date(l.logged_at).getTime() > state.settings.dispute_days * 86400000 ? null : <a className="link-btn" href={`#/dispute/new/log/${l.id}`}>Dispute</a>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="stack">
            <div className="label">Recent weeks</div>
            <div className="card stack">
              {[...d.history].reverse().map((h) => (
                <div key={h.week_start} className="row between small">
                  <span className="soft">Week of {fmtDate(h.week_start, false)}</span>
                  <span>{h.declared === 0 ? 'Nothing declared' : `${h.done} of ${plural(h.declared, 'goal')}`}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
