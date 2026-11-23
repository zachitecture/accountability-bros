import React, { useMemo, useState } from 'react';
import { proofUrl, rpc } from '../api.js';
import { makeStamp } from '../image.js';
import { addDays, fmtDate, fmtDayTime, fmtDuration, plural } from '../format.js';
import { Avatar, ErrorNote, Head, Icon, Loading, ProofThumb, RankIcon, avatarBlob, useLoad } from '../ui.jsx';
import { TIERS } from '../rank.js';

function canShareFiles() {
  try {
    const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' });
    return Boolean(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'activity';

export default function Member({ state, userId }) {
  const shareable = useMemo(canShareFiles, []);
  const [stamp, setStamp] = useState(null); // { blob, url, fileName, alt } for a stamp made again from a past entry
  const [stamping, setStamping] = useState('');

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

  // Make the stamp again from the stored proof photo, so a session that never got
  // sent to the chat can still be shared. The tally is what it was at that session.
  async function restamp(log, index) {
    setError('');
    setStamping(log.id);
    try {
      const photo = await (await fetch(await proofUrl(log.photo_path))).blob();
      const info = {
        ...log, nickname: d.nickname, timezone: d.timezone, style: d.style,
        // The tally as it stood after this session (extras never count toward it).
        done: d.logs.slice(0, index + 1).filter((x) => !x.extra).length,
        total: d.goals.reduce((n, g) => n + g.target, 0),
        group_name: state.settings.group_name, min_physical_minutes: state.settings.min_physical_minutes,
      };
      const blob = await makeStamp(photo, info, null, await avatarBlob(d.avatar_path));
      const what = log.extra ? 'extra' : `${info.done}-of-${info.total}`;
      setStamp({
        blob, url: URL.createObjectURL(blob),
        fileName: `${slug(d.nickname)}-${slug(log.activity)}-${what}.jpg`,
        alt: `${d.nickname}, ${log.activity}, ${fmtDuration(log.duration_min)}, ${log.extra ? 'extra' : `${info.done} of ${info.total}`}`,
      });
    } catch (e) {
      setError(`The stamp could not be made. ${e.message}`);
    } finally {
      setStamping('');
    }
  }
  function saveStamp() {
    const a = document.createElement('a');
    a.href = stamp.url;
    a.download = stamp.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  async function shareStamp() {
    if (!shareable) { saveStamp(); return; }
    try {
      await navigator.share({ files: [new File([stamp.blob], stamp.fileName, { type: 'image/jpeg' })] });
    } catch (err) {
      if (err && err.name !== 'AbortError') saveStamp();
    }
  }
  function closeStamp() {
    URL.revokeObjectURL(stamp.url);
    setStamp(null);
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
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <Avatar path={d.avatar_path} name={d.nickname} size={64} rank={d.rank} />
            <div className="grow">
              <Head
                eyebrow={<>{d.title ? `${d.title} · ` : ''}<RankIcon rank={d.rank} size={14} /> {(TIERS[d.rank] || TIERS[0]).name}</>}
                title={d.nickname}
                side={<><div className="big-num">{d.streak}</div><div className="tiny muted">week streak</div></>}
              />
            </div>
          </div>

          {d.badges && d.badges.length ? (
            <div className="row wrap" style={{ gap: 6 }} aria-label="Badges">
              {d.badges.map((b) => <span key={b.key} className="badge gold-badge">{b.label}</span>)}
            </div>
          ) : null}
          {d.is_me ? <a className="link-btn" style={{ alignSelf: 'flex-start' }} href="#/rewards">Your rank, badges and stamp style</a> : null}

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
            {d.logs.map((l, index) => (
              <div key={l.id} className="card row" style={{ padding: 12, alignItems: 'flex-start' }}>
                <ProofThumb path={l.photo_path} label={`${d.nickname}, ${l.activity}, ${fmtDayTime(l.logged_at, d.timezone)}`} />
                <div className="stack grow" style={{ gap: 4 }}>
                  <div className="name" style={{ fontSize: 15 }}>{l.activity} · {fmtDuration(l.duration_min)}</div>
                  <div className="sub">{fmtDayTime(l.logged_at, d.timezone)}</div>
                  {l.note ? <div className="small soft note-text">{l.note}<span className="tiny muted"> · only you see this</span></div> : null}
                  <div className="row wrap" style={{ gap: 6 }}>
                    {l.extra ? <span className="badge extra">Extra</span> : null}
                    {l.flag_short ? <span className="badge flag">Under {state.settings.min_physical_minutes} min</span> : null}
                    {l.flag_same_day ? <span className="badge flag">Second that day</span> : null}
                  </div>
                  <div className="row wrap" style={{ gap: 16 }}>
                    {d.is_me ? <button type="button" className="link-btn" disabled={Boolean(stamping)} onClick={() => restamp(l, index)}>{stamping === l.id ? 'Making stamp…' : 'Share stamp'}</button> : null}
                    {l.can_undo ? <button type="button" className="link-btn" onClick={() => undo(l)}>{d.is_me ? 'Undo' : 'Remove entry'}</button> : null}
                    {d.is_me || new Date(state.now).getTime() - new Date(l.logged_at).getTime() > state.settings.dispute_days * 86400000 ? null : <a className="link-btn" href={`#/dispute/new/log/${l.id}`}>Dispute</a>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {stamp ? (
            <div className="overlay" role="dialog" aria-modal="true" aria-label="Your stamp">
              <img className="stamp-img" src={stamp.url} alt={stamp.alt} />
              <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
                <button type="button" className="btn primary" onClick={shareStamp} autoFocus>
                  <Icon name="share" color="var(--accent-ink)" width={2.4} />{shareable ? 'Share to the chat' : 'Save the image'}
                </button>
                <button type="button" className="btn" onClick={closeStamp}>Close</button>
              </div>
            </div>
          ) : null}

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
