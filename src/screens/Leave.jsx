import React, { useEffect, useState } from 'react';
import { rpc } from '../api.js';
import { addDays, fmtDate, plural } from '../format.js';
import { ErrorNote, Head, Icon, Loading, useLoad } from '../ui.jsx';

const KIND = { annual: 'Annual leave', sick: 'Sick or injury leave' };

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return addDays(dateStr, -((d.getUTCDay() + 6) % 7));
}
function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
}

// Which weeks a stretch of leave touches, and how many days of each it covers.
function weeksCovered(start, lastCounted) {
  const out = [];
  for (let w = mondayOf(start); w <= lastCounted && out.length < 60; w = addDays(w, 7)) {
    const from = start > w ? start : w;
    const sunday = addDays(w, 6);
    const to = lastCounted < sunday ? lastCounted : sunday;
    out.push({ week: w, days: daysBetween(from, to) + 1 });
  }
  return out;
}

function range(a, b) {
  return a === b ? fmtDate(a) : `${fmtDate(a)} to ${fmtDate(b)}`;
}

function statusText(l) {
  if (l.status === 'pending') return `First 7 days approved (to ${fmtDate(l.approved_until, false)}). The rest is waiting on the Executive.`;
  if (l.status === 'declined') return `Extra days declined. Counts up to ${fmtDate(l.approved_until, false)}.`;
  return 'Approved';
}

export default function Leave() {
  const load = useLoad(() => rpc('get_leave'), []);
  const d = load.data;
  const [kind, setKind] = useState('sick');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const today = d ? d.today : '';
  const earliest = today ? (kind === 'annual' ? addDays(today, 1) : today) : '';

  // Start the form on the earliest day allowed for the chosen type.
  useEffect(() => {
    if (!earliest) return;
    setStart((s) => (!s || s < earliest ? earliest : s));
    setEnd((e) => (!e || e < earliest ? earliest : e));
  }, [earliest]);

  const valid = Boolean(start && end && end >= start && start >= earliest);
  const length = valid ? daysBetween(start, end) + 1 : 0;
  const long = kind === 'sick' && length > 7;
  const weeks = valid ? weeksCovered(start, long ? addDays(start, 6) : end) : [];

  async function submit(e) {
    e.preventDefault();
    setError('');
    setDone('');
    if (!valid) { setError('Pick the first and last day.'); return; }
    setBusy(true);
    try {
      load.setData(await rpc('request_leave', { p_kind: kind, p_start: start, p_end: end, p_note: note }));
      setDone(long ? 'Leave recorded. The first 7 days are approved and the Executive has been asked about the rest.' : 'Leave recorded and approved.');
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(l) {
    const text = l.state === 'upcoming' ? 'Cancel this leave?' : 'End this leave today?';
    if (!window.confirm(text)) return;
    setError('');
    setDone('');
    try {
      load.setData(await rpc('cancel_leave', { p_id: l.id }));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="screen">
      <a className="back" href="#/goals"><Icon name="back" size={18} width={2.4} />Goals</a>
      <Head eyebrow="Sick, injured or away" title="Leave" />
      {load.loading && !d ? <Loading /> : null}
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>

      {d ? (
        <>
          {d.this_week.on_leave ? <div className="notice good" role="status">You are on leave this week. Goals are optional and no forfeit applies.</div> : null}
          {d.next_week.on_leave ? <div className="notice good" role="status">You are on leave next week. Goals are optional and no forfeit applies.</div> : null}

          <form className="card stack-lg" onSubmit={submit}>
            <div className="name">Take leave</div>
            <div className="seg" role="group" aria-label="Type of leave">
              <button type="button" aria-pressed={kind === 'sick'} onClick={() => { setKind('sick'); setDone(''); }}>Sick or injury</button>
              <button type="button" aria-pressed={kind === 'annual'} onClick={() => { setKind('annual'); setDone(''); }}>Annual</button>
            </div>
            <div className="small soft">
              {kind === 'sick'
                ? 'Can start today or later, never in the past. Up to 7 days is approved automatically. Longer needs the Executive to approve the extra days.'
                : 'Has to be requested before it starts, so the first day is tomorrow at the earliest. It cannot be refused.'}
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="field grow">
                <label className="label" htmlFor="leave-start">First day</label>
                <input id="leave-start" className="input" type="date" required min={earliest} value={start}
                  onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); setDone(''); }} />
              </div>
              <div className="field grow">
                <label className="label" htmlFor="leave-end">Last day</label>
                <input id="leave-end" className="input" type="date" required min={start || earliest} value={end}
                  onChange={(e) => { setEnd(e.target.value); setDone(''); }} />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="leave-note">Note (optional)</label>
              <input id="leave-note" className="input" maxLength={280} placeholder={kind === 'sick' ? 'e.g. Flu, rolled ankle' : 'e.g. Away in Bali'} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {valid && !done ? (
              <div className="stack" style={{ gap: 6 }}>
                <div className="label">{plural(length, 'day')} of leave. What it means for each week:</div>
                {weeks.map((w) => (
                  <div key={w.week} className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <Icon name={w.days >= d.min_days ? 'check' : 'minus'} size={16} color={w.days >= d.min_days ? 'var(--accent)' : 'var(--muted)'} width={2.6} />
                    <span>
                      Week of {fmtDate(w.week)}: {plural(w.days, 'day')}. {w.days >= d.min_days ? 'A leave week: no goals needed and no forfeit.' : `Still a normal week (leave needs to cover ${d.min_days} days).`}
                    </span>
                  </div>
                ))}
                {long ? <div className="small soft">Only the first 7 days are counted above. The rest counts once the Executive approves it.</div> : null}
              </div>
            ) : null}

            <ErrorNote>{error}</ErrorNote>
            {done ? <div className="notice good" role="status">{done}</div> : null}
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Take leave'}</button>
          </form>

          <div className="stack">
            <div className="label">Your leave</div>
            {d.leaves.length === 0 ? <div className="card sub">No leave on record.</div> : null}
            {d.leaves.map((l) => (
              <div key={l.id} className="card stack">
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div className="stack" style={{ gap: 3 }}>
                    <span className="name" style={{ fontSize: 15 }}>{KIND[l.kind]}</span>
                    <span className="sub">{range(l.start_date, l.end_date)}</span>
                  </div>
                  <span className="badge quiet">{l.state === 'past' ? 'Finished' : l.state === 'current' ? 'Now' : 'Upcoming'}</span>
                </div>
                <div className="small soft">{statusText(l)}{l.note ? ` · ${l.note}` : ''}</div>
                {l.state !== 'past' ? (
                  <div className="actions">
                    <button type="button" className="btn small-btn" onClick={() => cancel(l)}>{l.state === 'upcoming' ? 'Cancel leave' : 'End leave today'}</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="small muted center">
            A week is a leave week when leave covers at least {d.min_days} of its 7 days. Leave weeks carry no forfeit and do not break your streak. Leave cannot be backdated.
          </div>
        </>
      ) : null}
    </main>
  );
}
