import React, { useState } from 'react';
import { rpc } from '../api.js';
import { fmtDate, money } from '../format.js';
import { ErrorNote, Head, Icon, Loading, useLoad } from '../ui.jsx';

const KIND = { forfeit: 'Forfeit', fee: 'Fee', other: 'Other' };

function describe(e) {
  const base = e.kind === 'forfeit' ? `Forfeit, week of ${fmtDate(e.week_start, false)}` : (e.note || KIND[e.kind]);
  return e.kind === 'forfeit' && e.note ? `${base} · ${e.note}` : base;
}

export default function Kitty({ state }) {
  const windowMs = state.settings.dispute_days * 86400000;
  const load = useLoad(() => rpc('get_kitty'), []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ user: '', kind: 'fee', amount: '', note: '' });
  const k = load.data;

  async function act(fn, args, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return false;
    setError('');
    setBusy(true);
    try {
      load.setData(await rpc(fn, args));
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addEntry(e) {
    e.preventDefault();
    const ok = await act('add_entry', { p_user: form.user, p_kind: form.kind, p_amount: Number(form.amount), p_note: form.note });
    if (ok) { setAdding(false); setForm({ user: '', kind: 'fee', amount: '', note: '' }); }
  }

  return (
    <main className="screen">
      <Head eyebrow="Held by the Treasurer" title="The Kitty" side={<a className="small" href="#/disputes">Disputes</a>} />
      {load.loading && !k ? <Loading /> : null}
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>

      {k ? (
        <>
          <div className="card stack-lg">
            <div className="kitty-totals">
              <div className="stack" style={{ gap: 6 }}>
                <div className="small soft">In the Kitty</div>
                <div className="kitty-num gold">{money(k.in_kitty)}</div>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <div className="small soft">Still owed</div>
                <div className={`kitty-num${k.owed > 0 ? ' warn' : ''}`}>{money(k.owed)}</div>
              </div>
            </div>
            <div className="rule-line">Forfeit for a missed week: {money(k.forfeit_per_member)} × {k.eligible_count} eligible members = {money(k.forfeit_amount)}. Members on leave that week are not counted.</div>
          </div>

          <ErrorNote>{error}</ErrorNote>

          {k.can_manage && k.misses.length > 0 ? (
            <div className="stack">
              <div className="label">Finished weeks to decide</div>
              {k.misses.map((m) => (
                <div key={`${m.user_id}-${m.week_start}`} className="card stack">
                  <div className="row between">
                    <div className="stack" style={{ gap: 3 }}>
                      <span className="name" style={{ fontSize: 15 }}>{m.nickname}</span>
                      <span className="sub">Week of {fmtDate(m.week_start, false)} · {m.total === 0 ? 'nothing declared' : `${m.done} of ${m.total} done`}</span>
                    </div>
                    <a className="small" href={`#/member/${m.user_id}`}>View</a>
                  </div>
                  <div className="actions">
                    <button type="button" className="btn small-btn" disabled={busy}
                      onClick={() => act('issue_forfeit', { p_user: m.user_id, p_week: m.week_start }, `Issue a ${money(m.amount ?? k.forfeit_amount)} forfeit to ${m.nickname}?`)}>
                      Issue {money(m.amount ?? k.forfeit_amount)} forfeit
                    </button>
                    <button type="button" className="btn small-btn" disabled={busy || m.is_mine}
                      onClick={() => act('excuse_week', { p_user: m.user_id, p_week: m.week_start, p_note: '' }, `Excuse ${m.nickname} for that week? No forfeit, and their streak is not broken.`)}>
                      Excuse
                    </button>
                  </div>
                  {m.is_mine ? <div className="tiny muted">Another Kitty manager has to excuse your own week.</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="stack">
            <div className="label">Forfeits and fees</div>
            {k.entries.length === 0 ? <div className="card sub">Nothing in the ledger yet.</div> : null}
            {k.entries.map((e) => (
              <div key={e.id} className={`card stack${e.status === 'owed' ? ' owed' : ''}${e.status === 'waived' ? ' waived' : ''}`}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <div className="stack" style={{ gap: 3 }}>
                    <span className="name" style={{ fontSize: 15 }}>{e.nickname}</span>
                    <span className="sub">{describe(e)}</span>
                  </div>
                  <span className="amount">{money(e.amount)}</span>
                </div>
                {e.status === 'waived' ? (
                  <div className="row small soft" style={{ gap: 6 }}>
                    <Icon name="check" size={14} color="var(--accent)" width={2.8} />Waived after a dispute{e.paid_at ? '. It was already paid, so refund it.' : ''}
                  </div>
                ) : e.status === 'owed' ? (
                  <div className="row small warn" style={{ gap: 6, fontWeight: 600 }}>
                    <Icon name="clock" size={16} color="var(--warn)" />Owed{e.due_date ? `, due ${fmtDate(e.due_date, false)}` : ''}
                  </div>
                ) : (
                  <div className="row small soft" style={{ gap: 6 }}>
                    <Icon name="check" size={14} color="var(--accent)" width={2.800} />Paid {e.paid_at ? fmtDate(e.paid_at.slice(0, 10), false) : ''}
                  </div>
                )}
                {e.dispute_id
                  ? <a className="link-btn" style={{ alignSelf: 'flex-start' }} href={`#/dispute/${e.dispute_id}`}>See the dispute</a>
                  : e.status !== 'waived' && !/^Dispute/.test(e.note) && new Date(state.now).getTime() - new Date(e.created_at).getTime() < windowMs ? <a className="link-btn" style={{ alignSelf: 'flex-start' }} href={`#/dispute/new/forfeit/${e.id}`}>Dispute</a> : null}
                {k.can_manage && e.status !== 'waived' ? (
                  e.is_mine ? <div className="tiny muted">Another Kitty manager has to mark your own entry.</div> : (
                    <div className="actions">
                      {e.status === 'owed'
                        ? <button type="button" className="btn small-btn" disabled={busy} onClick={() => act('set_paid', { p_id: e.id, p_paid: true })}>Mark paid</button>
                        : <button type="button" className="btn small-btn" disabled={busy} onClick={() => act('set_paid', { p_id: e.id, p_paid: false })}>Mark unpaid</button>}
                      <button type="button" className="btn small-btn danger" disabled={busy} onClick={() => act('delete_entry', { p_id: e.id }, `Delete this ${money(e.amount)} entry for ${e.nickname}?`)}>Delete</button>
                    </div>
                  )
                ) : null}
              </div>
            ))}
          </div>

          {k.can_manage ? (
            adding ? (
              <form className="card stack-lg" onSubmit={addEntry}>
                <div className="name">Add an entry</div>
                <div className="field">
                  <label className="label" htmlFor="entry-user">Member</label>
                  <select id="entry-user" className="select" required value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })}>
                    <option value="">Choose a member</option>
                    {k.members.map((m) => <option key={m.id} value={m.id}>{m.nickname}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="entry-kind">Type</label>
                  <select id="entry-kind" className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                    <option value="fee">Fee</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="entry-amount">Amount ($)</label>
                  <input id="entry-amount" className="input" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9.]/g, '') })} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="entry-note">What it is for</label>
                  <input id="entry-note" className="input" maxLength={140} required value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </div>
                <button type="submit" className="btn primary" disabled={busy}>Add entry</button>
                <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
              </form>
            ) : (
              <button type="button" className="btn dashed" onClick={() => setAdding(true)}><Icon name="plus" size={16} width={2.6} />Add a fee or other entry</button>
            )
          ) : null}

          <div className="small muted center">Payments go through Beem. The Kitty managers mark them paid here.</div>
        </>
      ) : null}
    </main>
  );
}
