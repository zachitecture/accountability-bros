import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rpc, uploadProof } from '../api.js';
import { compressPhoto, makeStamp } from '../image.js';
import { fmtDate, fmtDayTime } from '../format.js';
import { ErrorNote, Head, Icon, Loading, Tick, useLoad } from '../ui.jsx';

function canShareFiles() {
  try {
    const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' });
    return Boolean(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'activity';
}

export default function Log({ state }) {
  const week = useLoad(() => rpc('get_week'), []);
  const [goalId, setGoalId] = useState(null);
  const [minutes, setMinutes] = useState('');
  const [photo, setPhoto] = useState(null); // { blob, url }
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { log, blob, url, fileName }
  const fileRef = useRef(null);
  const shareable = useMemo(canShareFiles, []);

  const goals = week.data?.goals || [];
  const done = goals.reduce((n, g) => n + g.done, 0);
  const total = goals.reduce((n, g) => n + g.target, 0);
  const open = goals.filter((g) => g.done < g.target);
  const selected = open.find((g) => g.id === goalId) || open[0] || null;
  const minMinutes = state.settings.min_physical_minutes;
  const mins = Number(minutes);
  const short = selected && selected.category === 'physical' && minutes !== '' && mins <= minMinutes;

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  async function pickPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy('Preparing photo…');
    try {
      const blob = await compressPhoto(file);
      setPhoto({ blob, url: URL.createObjectURL(blob), at: new Date().toISOString() });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function stampIt() {
    setError('');
    if (!selected) return;
    if (!Number.isInteger(mins) || mins < 1) { setError('Enter how many minutes it took.'); return; }
    if (!photo) { setError('Add a proof photo first.'); return; }
    try {
      setBusy('Uploading photo…');
      const path = await uploadProof(state.me.id, photo.blob);
      setBusy('Logging…');
      const log = await rpc('log_activity', { p_goal_id: selected.id, p_duration: mins, p_photo_path: path });
      setBusy('Stamping…');
      const blob = await makeStamp(photo.blob, log);
      setResult({ log, blob, url: URL.createObjectURL(blob), fileName: `${slug(log.nickname)}-${slug(log.activity)}-${log.done}-of-${log.total}.jpg` });
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  function save() {
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function share() {
    const file = new File([result.blob], result.fileName, { type: 'image/jpeg' });
    if (!shareable) { save(); return; }
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err && err.name !== 'AbortError') save();
    }
  }

  function reset() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setPhoto(null);
    setMinutes('');
    setGoalId(null);
    setError('');
    week.reload();
  }

  async function undo() {
    setError('');
    setBusy('Undoing…');
    try {
      await rpc('undo_log', { p_log_id: result.log.id });
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  // ---- after logging: the stamp, ready to share
  if (result) {
    const { log } = result;
    const left = log.total - log.done;
    return (
      <main className="screen">
        <Head eyebrow={left === 0 ? 'Week complete' : `${left} to go this week`} title="Your stamp" side={<div className="big-num">{log.done} / {log.total}</div>} />
        <img className="stamp-img" src={result.url} alt={`${log.nickname}, ${log.activity}, ${log.duration_min} minutes, ${log.done} of ${log.total}`} />
        <div className="stack">
          <Tick>Saved to your record</Tick>
          <Tick>Time set by the app: {fmtDayTime(log.logged_at, log.timezone)}</Tick>
          {log.flag_short
            ? <Tick warn>{log.duration_min} minutes is not over the {log.min_physical_minutes} minute minimum, so it is flagged for the group</Tick>
            : log.category === 'physical' ? <Tick>{log.duration_min} minutes, over the {log.min_physical_minutes} minute minimum</Tick> : null}
          {log.flag_same_day ? <Tick warn>Second {log.activity} logged today, so it is flagged for the group</Tick> : null}
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="stack push">
          <button type="button" className="btn primary" onClick={share}>
            <Icon name="share" color="var(--accent-ink)" width={2.4} />
            {shareable ? 'Share to the chat' : 'Save the image'}
          </button>
          {shareable ? <div className="small muted center">Your phone's share menu opens. Pick Messenger, then the group.</div> : <div className="small muted center">Then send it to the group chat from your photos.</div>}
          <button type="button" className="btn" onClick={reset}>{left === 0 ? 'Done' : 'Log another'}</button>
          <button type="button" className="link-btn center" onClick={undo} disabled={Boolean(busy)}>{busy || 'Made a mistake? Undo this entry'}</button>
        </div>
      </main>
    );
  }

  const head = (
    <Head
      eyebrow={`Week of ${fmtDate(state.week_start)}`}
      title="Log activity"
      side={total > 0 ? <><div className="big-num">{done} / {total}</div><div className="tiny muted">done so far</div></> : null}
    />
  );

  if (week.loading && !week.data) return <main className="screen">{head}<Loading /></main>;
  if (week.error) return <main className="screen">{head}<ErrorNote onRetry={week.reload}>{week.error}</ErrorNote></main>;

  if (goals.length === 0) {
    return (
      <main className="screen">
        {head}
        <div className="card stack">
          <div className="name">No goals declared this week</div>
          <div className="sub">
            {state.locked
              ? 'This week locked on Monday night with nothing declared. You can set next week\'s goals now.'
              : 'Declare what you are aiming for this week, then come back here to log it.'}
          </div>
        </div>
        <a className="btn primary" href="#/goals">{state.locked ? 'Set next week\'s goals' : 'Declare this week'}</a>
      </main>
    );
  }

  if (open.length === 0) {
    return (
      <main className="screen">
        {head}
        <div className="card selected row">
          <Icon name="circleCheck" size={40} color="var(--accent)" width={2} />
          <div className="stack" style={{ gap: 3 }}>
            <div className="name">Every goal met</div>
            <div className="sub">All {total} done for the week of {fmtDate(state.week_start, false)}.</div>
          </div>
        </div>
        <a className="btn" href="#/group">See the group</a>
      </main>
    );
  }

  return (
    <main className="screen">
      {head}

      <div className="stack">
        <div className="label">Which one did you do?</div>
        {goals.map((g) => {
          const isDone = g.done >= g.target;
          const isSel = selected && selected.id === g.id;
          return (
            <button key={g.id} type="button" className={`card card-btn${isSel ? ' selected' : ''}`} aria-pressed={Boolean(isSel)} disabled={isDone} onClick={() => setGoalId(g.id)}>
              <span className="stack" style={{ gap: 3 }}>
                <span className="name">{g.activity}</span>
                <span className="sub">{isDone ? `All ${g.target} done` : `${g.done} of ${g.target} done`}</span>
              </span>
              <Icon name={isSel || isDone ? 'circleCheck' : 'circle'} size={24} color={isSel ? 'var(--accent)' : 'var(--dim)'} />
            </button>
          );
        })}
      </div>

      <div className="stack">
        <label className="label" htmlFor="minutes">How long?</label>
        <div className="row">
          <input id="minutes" className="input num" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={minutes}
            onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ''))} />
          <span className="soft" style={{ fontSize: 16 }}>minutes</span>
        </div>
        {selected.category === 'physical' && minutes !== '' ? (
          short
            ? <div className="row small warn" style={{ gap: 8 }}><Icon name="flag" size={16} color="var(--warn)" />Not over the {minMinutes} minute minimum. It will be flagged.</div>
            : <div className="row small gold" style={{ gap: 8 }}><Icon name="check" size={16} color="var(--accent)" width={2.6} />Over the {minMinutes} minute minimum for Physical</div>
        ) : null}
      </div>

      <div className="stack">
        <div className="label">Proof photo</div>
        <input ref={fileRef} className="sr" type="file" accept="image/*" capture="environment" onChange={pickPhoto} aria-label="Take a proof photo" tabIndex={-1} />
        {photo ? (
          <div className="card photo-pick" style={{ padding: 12 }}>
            <img className="thumb" src={photo.url} alt="Your proof photo" />
            <div className="stack grow" style={{ gap: 3 }}>
              <span className="name" style={{ fontSize: 15 }}>Photo added</span>
              <span className="sub">The time on the stamp comes from the app when you log.</span>
            </div>
            <button type="button" className="btn small-btn" onClick={() => fileRef.current.click()}>Retake</button>
          </div>
        ) : (
          <button type="button" className="btn dashed" style={{ minHeight: 72 }} onClick={() => fileRef.current.click()}>
            <Icon name="camera" size={22} width={1.800} />
            Take photo
          </button>
        )}
      </div>

      <ErrorNote>{error}</ErrorNote>

      <button type="button" className="btn primary push" onClick={stampIt} disabled={Boolean(busy)}>
        {busy || <>Stamp it <Icon name="arrow" color="var(--accent-ink)" width={2.6} /></>}
      </button>
    </main>
  );
}
