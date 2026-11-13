import React from 'react';
import { rpc } from '../api.js';
import { fmtDate } from '../format.js';
import { ErrorNote, Head, Icon, Loading, useLoad } from '../ui.jsx';

export default function Group({ state }) {
  const load = useLoad(() => rpc('get_group'), []);
  const members = load.data?.members || [];

  return (
    <main className="screen">
      <Head
        eyebrow={`Week of ${fmtDate(state.week_start)}`}
        title="The group"
        side={<div className="small soft">Ends Sun<br />11:59 pm</div>}
      />
      {load.loading && !load.data ? <Loading /> : null}
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>

      {load.data ? (
        <div className="stack">
          <div className="cols">
            <span className="grow">Member</span>
            <span style={{ width: 96, textAlign: 'right' }}>Done</span>
            <span style={{ width: 48, textAlign: 'right' }}>Streak</span>
          </div>
          {members.map((m) => {
            const pct = m.total > 0 ? Math.min(100, Math.round((m.done / m.total) * 100)) : 0;
            return (
              <a key={m.id} href={`#/member/${m.id}`} className={`card member${m.is_me ? ' selected' : ''}`} aria-label={`${m.nickname}: ${m.done} of ${m.total} done, ${m.streak} week streak`}>
                <span className="stack grow" style={{ gap: 3 }}>
                  <span className="row wrap" style={{ gap: 8 }}>
                    <span className="name" style={{ fontSize: 15 }}>{m.nickname}</span>
                    {m.is_me ? <span className="badge you">You</span> : null}
                    {m.on_leave ? <span className="badge quiet">On leave</span> : null}
                    {m.flags > 0 ? <span className="badge flag">{m.flags} flagged</span> : null}
                  </span>
                  {m.title ? <span className="tiny muted">{m.title}</span> : null}
                  {m.total === 0 && !m.on_leave ? <span className="tiny muted">Nothing declared</span> : null}
                </span>
                <span className="done-col">
                  <span>{m.done} / {m.total}</span>
                  <span className="track" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                </span>
                <span className="streak-col">
                  <span className={`streak-num${m.streak === 0 ? ' zero' : ''}`}>{m.streak}</span>
                  <span className="tiny soft">wk</span>
                </span>
              </a>
            );
          })}
          {members.length === 1 ? <div className="notice">You are the only one here so far. Share the join code from the More tab.</div> : null}
        </div>
      ) : null}

      <div className="small muted center">A streak is weeks in a row with every goal met.</div>
      <a className="btn primary push" href="#/log"><Icon name="plus" color="var(--accent-ink)" width={2.6} />Log activity</a>
    </main>
  );
}
