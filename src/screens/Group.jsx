import React, { useState } from 'react';
import { rpc } from '../api.js';
import { fmtDate, fmtDuration, plural } from '../format.js';
import { ErrorNote, Head, Icon, Loading, useLoad } from '../ui.jsx';

const PERIODS = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']];

// Most hours of physical activity. Lifestyle and recovery goals do not count here.
function Leaderboard() {
  const [period, setPeriod] = useState('week');
  const load = useLoad(() => rpc('get_leaderboard', { p_period: period }), [period]);
  const rows = load.data?.members || [];
  const top = Math.max(1, ...rows.map((r) => r.minutes));
  return (
    <div className="stack">
      <div className="chips" role="group" aria-label="Period">
        {PERIODS.map(([k, label]) => (
          <button key={k} type="button" className={`chip${period === k ? ' on' : ''}`} aria-pressed={period === k} onClick={() => setPeriod(k)}>{label}</button>
        ))}
      </div>
      {load.loading && !load.data ? <Loading /> : null}
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>
      {load.data ? (
        <>
          <div className="cols">
            <span style={{ width: 28 }}>#</span>
            <span className="grow">Member</span>
            <span style={{ width: 110, textAlign: 'right' }}>Hours</span>
          </div>
          {rows.map((r) => (
            <a key={r.id} href={`#/member/${r.id}`} className={`card member${r.is_me ? ' selected' : ''}`}
              aria-label={`Number ${r.rank}, ${r.nickname}: ${fmtDuration(r.minutes)} over ${plural(r.sessions, 'session')}`}>
              <span className={`rank${r.rank === 1 && r.minutes > 0 ? ' first' : ''}`}>{r.rank}</span>
              <span className="stack grow" style={{ gap: 3 }}>
                <span className="row wrap" style={{ gap: 8 }}>
                  <span className="name" style={{ fontSize: 15 }}>{r.nickname}</span>
                  {r.is_me ? <span className="badge you">You</span> : null}
                </span>
                <span className="tiny muted">{plural(r.sessions, 'session')}</span>
              </span>
              <span className="done-col" style={{ width: 110 }}>
                <span>{r.minutes > 0 ? fmtDuration(r.minutes) : '0 h'}</span>
                <span className="track" aria-hidden="true" style={{ width: 110 }}><i style={{ width: `${Math.round((r.minutes / top) * 100)}%` }} /></span>
              </span>
            </a>
          ))}
          <div className="small muted center">Hours of physical sessions logged{period === 'week' ? ' this week' : period === 'month' ? ' this calendar month' : ''}.</div>
        </>
      ) : null}
    </div>
  );
}

export default function Group({ state }) {
  const [view, setView] = useState('week');
  const load = useLoad(() => rpc('get_group'), []);
  const members = load.data?.members || [];

  return (
    <main className="screen">
      <Head
        eyebrow={`Week of ${fmtDate(state.week_start)}`}
        title="The group"
        side={<div className="small soft">Ends Sun<br />11:59 pm</div>}
      />
      <div className="seg" role="group" aria-label="What to show">
        <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Tallies</button>
        <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}>Leaderboard</button>
      </div>

      {view === 'board' ? <Leaderboard /> : null}
      {view === 'week' && load.loading && !load.data ? <Loading /> : null}
      {view === 'week' ? <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote> : null}

      {view === 'week' && load.data ? (
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

      {view === 'week' ? <div className="small muted center">A streak is weeks in a row with every goal met.</div> : null}
      <a className="btn primary push" href="#/log"><Icon name="plus" color="var(--accent-ink)" width={2.6} />Log activity</a>
    </main>
  );
}
