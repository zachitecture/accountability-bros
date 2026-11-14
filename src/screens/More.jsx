import React, { useEffect, useState } from 'react';
import { rpc, supabase } from '../api.js';
import { fmtDate } from '../format.js';
import { ErrorNote, Head, Loading, useLoad } from '../ui.jsx';

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

function MemberEditor({ m, onSaved }) {
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

function Members({ refresh }) {
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
            <span className="stack" style={{ gap: 3 }}>
              <span className="name" style={{ fontSize: 15 }}>{m.nickname}{m.active ? '' : ' (paused)'}</span>
              <span className="tiny muted">{[m.title, m.is_admin ? 'Admin' : '', m.can_manage_kitty ? 'Kitty' : '', m.is_ombudsman ? 'Ombudsman' : '', m.is_attorney ? 'Attorney-General' : '', m.eligible ? '' : 'Not eligible'].filter(Boolean).join(' · ') || 'Member'}</span>
              <span className="tiny muted">{m.email}</span>
            </span>
            <span className="small gold">{openId === m.id ? 'Close' : 'Edit'}</span>
          </button>
          {openId === m.id ? <MemberEditor m={m} onSaved={(list) => { load.setData(list); setOpenId(null); refresh(); }} /> : null}
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
  if (pending.length === 0) return null;

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
      <div className="label">Leave waiting for the Executive</div>
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
      <Profile state={state} email={email} onState={onState} />
      <a className="btn" href="#/leave">Sick, injured or away? Take leave</a>
      <a className="btn" href="#/disputes">Disputes</a>
      {state.me.is_admin ? (
        <>
          <LeaveApprovals />
          <Members refresh={refresh} />
          <Rules refresh={refresh} />
        </>
      ) : null}
      <button type="button" className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </main>
  );
}
