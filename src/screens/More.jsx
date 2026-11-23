import React, { useEffect, useRef, useState } from 'react';
import { rpc, supabase, uploadProof } from '../api.js';
import { squarePhoto } from '../image.js';
import { fmtDate } from '../format.js';
import { Avatar, ErrorNote, Head, Loading, useLoad } from '../ui.jsx';

// An admin setting another member's profile picture.
function MemberPicture({ m, meId, onSaved }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function run(label, fn) {
    setError('');
    setBusy(label);
    try { onSaved(await fn()); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  function pick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    run('Uploading…', async () => {
      const path = await uploadProof(meId, await squarePhoto(file));
      return rpc('set_member_avatar', { p_user: m.id, p_path: path });
    });
  }
  return (
    <div className="stack">
      <div className="row" style={{ gap: 12 }}>
        <Avatar path={m.avatar_path} name={m.nickname} size={56} />
        <div className="actions">
          <input ref={fileRef} className="sr" type="file" accept="image/*" onChange={pick} aria-label={`Choose a profile picture for ${m.nickname}`} tabIndex={-1} />
          <button type="button" className="btn small-btn" disabled={Boolean(busy)} onClick={() => fileRef.current.click()}>{busy || (m.avatar_path ? 'Change picture' : 'Add a picture')}</button>
          {m.avatar_path ? <button type="button" className="btn small-btn" disabled={Boolean(busy)} onClick={() => run('Removing…', () => rpc('set_member_avatar', { p_user: m.id, p_path: null }))}>Remove</button> : null}
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

// Profile picture: shown in the group, the feed and on your stamps.
function ProfilePicture({ state, onState }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const has = Boolean(state.me.avatar_path);

  async function pick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy('Uploading…');
    try {
      const blob = await squarePhoto(file);
      const path = await uploadProof(state.me.id, blob);
      onState(await rpc('set_avatar', { p_path: path }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }
  async function remove() {
    setError('');
    setBusy('Removing…');
    try {
      onState(await rpc('set_avatar', { p_path: null }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ gap: 14 }}>
        <Avatar path={state.me.avatar_path} name={state.me.nickname} size={72} />
        <div className="stack grow" style={{ gap: 6 }}>
          <span className="label">Profile picture</span>
          <span className="small soft">Shown in the group, the feed and on your stamps. The middle of the photo is used.</span>
        </div>
      </div>
      <input ref={fileRef} className="sr" type="file" accept="image/*" onChange={pick} aria-label="Choose a profile picture" tabIndex={-1} />
      <div className="actions">
        <button type="button" className="btn small-btn" disabled={Boolean(busy)} onClick={() => fileRef.current.click()}>{busy || (has ? 'Change picture' : 'Add a picture')}</button>
        {has ? <button type="button" className="btn small-btn" disabled={Boolean(busy)} onClick={remove}>Remove</button> : null}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function Profile({ state, email, onState }) {
  const [nickname, setNickname] = useState(state.me.nickname);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    try {
      onState(await rpc('update_my_profile', { p_nickname: nickname }));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="card stack-lg" onSubmit={save}>
      <div className="name">You</div>
      <ProfilePicture state={state} onState={onState} />
      <div className="field">
        <label className="label" htmlFor="my-name">Name in the group</label>
        <input id="my-name" className="input" maxLength={20} required value={nickname} onChange={(e) => { setNickname(e.target.value); setSaved(false); }} />
      </div>
      <div className="small soft">{email}</div>
      <div className="small soft">Time zone: {state.me.timezone}. Your week and the Monday lock follow this. Ask an admin if it needs changing.</div>
      <ErrorNote>{error}</ErrorNote>
      {saved ? <div className="notice good" role="status">Saved.</div> : null}
      <button type="submit" className="btn" disabled={nickname.trim() === state.me.nickname}>Save name</button>
    </form>
  );
}

function MemberEditor({ m, meId, onSaved, onPicture }) {
  const [f, setF] = useState({
    nickname: m.nickname, title: m.title, sort_order: m.sort_order ?? '', timezone: m.timezone,
    eligible: m.eligible, can_manage_kitty: m.can_manage_kitty, is_admin: m.is_admin, active: m.active,
    is_ombudsman: Boolean(m.is_ombudsman), is_attorney: Boolean(m.is_attorney),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onSaved(await rpc('update_member', { p_user: m.id, p_patch: { ...f, sort_order: String(f.sort_order) } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const id = (k) => `${k}-${m.id}`;
  return (
    <form className="stack-lg" onSubmit={save} style={{ paddingTop: 12 }}>
      <MemberPicture m={m} meId={meId} onSaved={onPicture} />
      <div className="field"><label className="label" htmlFor={id('nick')}>Name</label><input id={id('nick')} className="input" maxLength={20} value={f.nickname} onChange={set('nickname')} /></div>
      <div className="field"><label className="label" htmlFor={id('title')}>Office (shown under the name)</label><input id={id('title')} className="input" maxLength={30} placeholder="e.g. Treasurer" value={f.title} onChange={set('title')} /></div>
      <div className="field"><label className="label" htmlFor={id('order')}>Position in the group list</label><input id={id('order')} className="input" inputMode="numeric" placeholder="1 is the top" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value.replace(/[^0-9]/g, '') })} /></div>
      <div className="field"><label className="label" htmlFor={id('tz')}>Time zone</label><input id={id('tz')} className="input" value={f.timezone} onChange={set('timezone')} /><div className="tiny muted">For example Australia/Melbourne or Europe/London.</div></div>
      <label className="check"><input type="checkbox" checked={f.eligible} onChange={set('eligible')} />Eligible Member (counts toward the forfeit amount)</label>
      <label className="check"><input type="checkbox" checked={f.can_manage_kitty} onChange={set('can_manage_kitty')} />Kitty manager (can issue forfeits and mark paid)</label>
      <label className="check"><input type="checkbox" checked={f.is_admin} onChange={set('is_admin')} />Admin (Executive: members, rules, fixing goals, deciding disputes)</label>
      <label className="check"><input type="checkbox" checked={f.is_ombudsman} onChange={set('is_ombudsman')} />Ombudsman (advises on and looks into disputes)</label>
      <label className="check"><input type="checkbox" checked={f.is_attorney} onChange={set('is_attorney')} />Attorney-General (can lodge a dispute without a seconder)</label>
      <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} />Active (untick to pause their membership)</label>
      <ErrorNote>{error}</ErrorNote>
      <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : `Save ${m.nickname}`}</button>
    </form>
  );
}

function Members({ refresh, meId }) {
  const load = useLoad(() => rpc('list_members'), []);
  const [openId, setOpenId] = useState(null);
  if (load.loading && !load.data) return <Loading />;
  return (
    <div className="stack">
      <div className="label">Members</div>
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>
      {(load.data || []).map((m) => (
        <div key={m.id} className="card">
          <button type="button" className="row between" style={{ width: '100%', border: 0, background: 'transparent', padding: 0, minHeight: 44, textAlign: 'left' }}
            aria-expanded={openId === m.id} onClick={() => setOpenId(openId === m.id ? null : m.id)}>
            <Avatar path={m.avatar_path} name={m.nickname} size={40} />
            <span className="stack grow" style={{ gap: 3, marginLeft: 12 }}>
              <span className="name" style={{ fontSize: 15 }}>{m.nickname}{m.active ? '' : ' (paused)'}</span>
              <span className="tiny muted">{[m.title, m.is_admin ? 'Admin' : '', m.can_manage_kitty ? 'Kitty' : '', m.is_ombudsman ? 'Ombudsman' : '', m.is_attorney ? 'Attorney-General' : '', m.eligible ? '' : 'Not eligible'].filter(Boolean).join(' · ') || 'Member'}</span>
              <span className="tiny muted">{m.email}</span>
            </span>
            <span className="small gold">{openId === m.id ? 'Close' : 'Edit'}</span>
          </button>
          {openId === m.id ? <MemberEditor m={m} meId={meId} onSaved={(list) => { load.setData(list); setOpenId(null); refresh(); }} onPicture={(list) => { load.setData(list); refresh(); }} /> : null}
        </div>
      ))}
    </div>
  );
}

function Rules({ refresh }) {
  const load = useLoad(() => rpc('get_admin_settings'), []);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (load.data) setF(load.data); }, [load.data]);
  if (!f) return load.error ? <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote> : <Loading />;
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };

  async function save(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const s = await rpc('update_settings', { p_patch: {
        group_name: f.group_name, min_goals: Number(f.min_goals), min_physical_minutes: Number(f.min_physical_minutes),
        forfeit_per_member: Number(f.forfeit_per_member), forfeit_due_days: Number(f.forfeit_due_days), join_code: f.join_code,
        first_week_grace: Boolean(f.first_week_grace), leave_min_days: Number(f.leave_min_days),
        dispute_fee: Number(f.dispute_fee), dispute_days: Number(f.dispute_days),
        season_keep_pct: Number(f.season_keep_pct), season_keep_max: Number(f.season_keep_max),
      } });
      load.setData(s);
      setSaved(true);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack-lg" onSubmit={save}>
      <div className="name">Rules</div>
      <div className="small soft">These follow the Terms of Reference. Change them here when the Terms change.</div>
      <div className="field"><label className="label" htmlFor="r-code">Join code (give this to new members)</label><input id="r-code" className="input" autoCapitalize="characters" value={f.join_code} onChange={set('join_code')} /></div>
      <div className="field"><label className="label" htmlFor="r-min">Minimum goals each week</label><input id="r-min" className="input" inputMode="numeric" value={f.min_goals} onChange={set('min_goals')} /></div>
      <div className="field"><label className="label" htmlFor="r-mins">Physical sessions must be over (minutes)</label><input id="r-mins" className="input" inputMode="numeric" value={f.min_physical_minutes} onChange={set('min_physical_minutes')} /></div>
      <div className="field"><label className="label" htmlFor="r-forfeit">Forfeit per Eligible Member ($)</label><input id="r-forfeit" className="input" inputMode="decimal" value={f.forfeit_per_member} onChange={set('forfeit_per_member')} /></div>
      <div className="field"><label className="label" htmlFor="r-days">Days to pay</label><input id="r-days" className="input" inputMode="numeric" value={f.forfeit_due_days} onChange={set('forfeit_due_days')} /></div>
      <div className="field"><label className="label" htmlFor="r-leave">Days of leave needed for a week to count as a leave week (1 to 7)</label><input id="r-leave" className="input" inputMode="numeric" value={f.leave_min_days ?? ''} onChange={set('leave_min_days')} /></div>
      <div className="field"><label className="label" htmlFor="r-dfee">Dispute handling fee ($)</label><input id="r-dfee" className="input" inputMode="decimal" value={f.dispute_fee ?? ''} onChange={set('dispute_fee')} /></div>
      <div className="field"><label className="label" htmlFor="r-keep">Share of hours kept into a new season (%)</label><input id="r-keep" className="input" inputMode="numeric" value={f.season_keep_pct ?? ''} onChange={set('season_keep_pct')} /></div>
      <div className="field"><label className="label" htmlFor="r-keepmax">Most hours kept into a new season</label><input id="r-keepmax" className="input" inputMode="numeric" value={f.season_keep_max ?? ''} onChange={set('season_keep_max')} /></div>
      <div className="field"><label className="label" htmlFor="r-ddays">Days to lodge a dispute</label><input id="r-ddays" className="input" inputMode="numeric" value={f.dispute_days ?? ''} onChange={set('dispute_days')} /></div>
      <label className="check">
        <input type="checkbox" checked={Boolean(f.first_week_grace)} onChange={(e) => { setF({ ...f, first_week_grace: e.target.checked }); setSaved(false); }} />
        New members can set goals for the week they join (for 24 hours after joining)
      </label>
      <div className="field"><label className="label" htmlFor="r-name">Group name (printed on the stamp)</label><input id="r-name" className="input" maxLength={40} value={f.group_name} onChange={set('group_name')} /></div>
      <ErrorNote>{error}</ErrorNote>
      {saved ? <div className="notice good" role="status">Rules saved.</div> : null}
      <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</button>
    </form>
  );
}

// Sick leave longer than a week: the Executive approves or declines the extra days.
function LeaveApprovals() {
  const load = useLoad(() => rpc('get_leave'), []);
  const [error, setError] = useState('');
  const pending = (load.data && load.data.pending) || [];
  const all = (load.data && load.data.all) || [];
  if (!load.data) return null;

  async function decide(l, approve) {
    if (!window.confirm(`${approve ? 'Approve' : 'Decline'} the extra days of ${l.nickname}'s sick leave?`)) return;
    setError('');
    try {
      await rpc('decide_leave', { p_id: l.id, p_approve: approve });
      load.reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="stack">
      <div className="label">Members' leave</div>
      {all.length === 0 ? <div className="card sub">No one has leave now, coming up, or in the last 4 weeks.</div> : null}
      {all.map((l) => (
        <div key={l.id} className="card stack">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 3 }}>
              <span className="name" style={{ fontSize: 15 }}>{l.nickname} · {l.kind === 'annual' ? 'Annual leave' : 'Sick or injury leave'}</span>
              <span className="sub">{l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} to ${fmtDate(l.end_date)}`}</span>
            </div>
            <span className="badge quiet">{l.state === 'past' ? 'Finished' : l.state === 'current' ? 'Now' : 'Upcoming'}</span>
          </div>
          <div className="small soft">
            {l.status === 'pending' ? `First 7 days approved (to ${fmtDate(l.approved_until, false)}). The rest is waiting on the Executive.`
              : l.status === 'declined' ? `Extra days declined. Counts up to ${fmtDate(l.approved_until, false)}.` : 'Approved'}
            {l.note ? ` · ${l.note}` : ''}
          </div>
        </div>
      ))}
      {pending.length ? <div className="label">Leave waiting for the Executive</div> : null}
      <ErrorNote>{error}</ErrorNote>
      {pending.map((l) => (
        <div key={l.id} className="card stack">
          <div className="name" style={{ fontSize: 15 }}>{l.nickname}: sick or injury leave</div>
          <div className="sub">{fmtDate(l.start_date)} to {fmtDate(l.end_date)}. Approved so far up to {fmtDate(l.approved_until, false)}.{l.note ? ` Note: ${l.note}` : ''}</div>
          {l.is_mine ? <div className="tiny muted">The other member of the Executive has to decide your own leave.</div> : (
            <div className="actions">
              <button type="button" className="btn small-btn" onClick={() => decide(l, true)}>Approve the rest</button>
              <button type="button" className="btn small-btn danger" onClick={() => decide(l, false)}>Decline the rest</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function More({ state, email, onState, refresh }) {
  return (
    <main className="screen">
      <Head eyebrow={state.settings.group_name} title="More" />
      <a className="btn primary" href="#/rewards">Rank, badges and stamp style</a>
      <Profile state={state} email={email} onState={onState} />
      <a className="btn" href="#/leave">Sick, injured or away? Take leave</a>
      <a className="btn" href="#/disputes">Disputes</a>
      {state.me.is_admin ? (
        <>
          <LeaveApprovals />
          <Members refresh={refresh} meId={state.me.id} />
          <Rules refresh={refresh} />
        </>
      ) : null}
      <button type="button" className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </main>
  );
}
