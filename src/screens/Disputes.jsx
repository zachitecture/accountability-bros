import React, { useEffect, useRef, useState } from 'react';
import { rpc, uploadProof } from '../api.js';
import { compressPhoto } from '../image.js';
import { fmtDayTime, money } from '../format.js';
import { ErrorNote, Head, Icon, Loading, ProofThumb, go, useLoad } from '../ui.jsx';

const STATUS = {
  draft: 'Draft',
  advice: 'With the Ombudsman',
  seconding: 'Waiting for a seconder',
  open: 'Open',
  upheld: 'Upheld',
  dismissed: 'Dismissed',
  withdrawn: 'Withdrawn',
};

const KIND = { forfeit: 'A forfeit or fee', log: 'A session', goals: 'Goals', other: 'Something else' };

function StatusBadge({ status }) {
  return <span className={`status ${status}`}>{STATUS[status]}</span>;
}

function Row({ d, tz }) {
  const who = d.is_mine ? 'You' : d.lodger_name;
  const when = d.lodged_at ? `lodged ${fmtDayTime(d.lodged_at, tz)}` : 'not lodged yet';
  return (
    <a href={`#/dispute/${d.id}`} className="card stack" style={{ textDecoration: 'none', color: 'var(--text)' }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <span className="name" style={{ fontSize: 15 }}>{d.subject_label || d.grounds || KIND[d.kind]}</span>
        <StatusBadge status={d.status} />
      </div>
      <span className="sub">{who}, {when}</span>
      {d.needs_me ? <span className="small gold" style={{ fontWeight: 700 }}>{d.needs_me}</span> : null}
    </a>
  );
}

// ---- #/disputes: everything lodged (public), plus your own drafts
export function Disputes({ state }) {
  const load = useLoad(() => rpc('list_disputes'), []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = load.data?.disputes || [];
  const tz = state.me.timezone;
  const needs = list.filter((d) => d.needs_me);
  const drafts = list.filter((d) => !d.needs_me && d.is_mine && (d.status === 'draft' || d.status === 'advice'));
  const open = list.filter((d) => !d.needs_me && (d.status === 'seconding' || d.status === 'open'));
  const closed = list.filter((d) => !d.needs_me && ['upheld', 'dismissed', 'withdrawn'].includes(d.status));

  async function startOther() {
    setError('');
    setBusy(true);
    try {
      const d = await rpc('save_dispute', { p_id: null, p_kind: 'other', p_ref: null, p_standing: 'affected', p_seconder: null, p_grounds: '', p_evidence: '', p_evidence_paths: [] });
      go(`dispute/${d.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const section = (label, rows) => (rows.length ? (
    <div className="stack">
      <div className="label">{label}</div>
      {rows.map((d) => <Row key={d.id} d={d} tz={tz} />)}
    </div>
  ) : null);

  return (
    <main className="screen">
      <a className="back" href="#/kitty"><Icon name="back" size={18} width={2.4} />The Kitty</a>
      <Head eyebrow="Clause 13" title="Disputes" />
      {load.loading && !load.data ? <Loading /> : null}
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>
      {load.data ? (
        <>
          <div className="card stack small soft">
            <div>Lodge within {load.data.days} days of the forfeit, session or goals you are disputing. Lodging costs {money(load.data.fee)}, which is waived if the dispute is upheld.</div>
            <div>You can send a draft to the Ombudsman for advice first, at no cost. Once lodged, the Ombudsman looks into it and the Executive decides.</div>
            <div>To dispute a forfeit, a session or someone's goals, tap Dispute next to it in the Kitty or on that member's record.</div>
          </div>
          {section('Needs you', needs)}
          {section('Your drafts', drafts)}
          {section('Open', open)}
          {section('Closed', closed)}
          {list.length === 0 ? <div className="card sub">No disputes yet.</div> : null}
          <ErrorNote>{error}</ErrorNote>
          <button type="button" className="btn dashed" disabled={busy} onClick={startOther}><Icon name="plus" size={16} width={2.6} />Dispute something else</button>
        </>
      ) : null}
    </main>
  );
}

// ---- #/dispute/new/<kind>/<ref>: open (or pick up) a draft, then show it
export function DisputeNew({ kind, ref }) {
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    rpc('save_dispute', { p_id: null, p_kind: kind, p_ref: ref, p_standing: 'affected', p_seconder: null, p_grounds: '', p_evidence: '', p_evidence_paths: [] })
      .then((d) => { if (live) window.location.replace(`#/dispute/${d.id}`); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [kind, ref]);
  return (
    <main className="screen">
      <a className="back" href="#/disputes"><Icon name="back" size={18} width={2.4} />Disputes</a>
      <Head eyebrow="Notice of Dispute" title="Starting a dispute" />
      {error ? <ErrorNote>{error}</ErrorNote> : <Loading />}
    </main>
  );
}

function Draft({ d, state, onSaved }) {
  const canAffected = d.kind === 'other' || d.subject_user === state.me.id;
  const [standing, setStanding] = useState(d.standing === 'affected' && !canAffected ? 'seconded' : d.standing);
  const [seconder, setSeconder] = useState(d.seconder || '');
  const [grounds, setGrounds] = useState(d.grounds);
  const [evidence, setEvidence] = useState(d.evidence);
  const [paths, setPaths] = useState(d.evidence_paths || []);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const fee = money(d.fee);

  const payload = () => ({
    p_id: d.id, p_kind: d.kind, p_ref: null, p_standing: standing,
    p_seconder: standing === 'seconded' && seconder ? seconder : null,
    p_grounds: grounds, p_evidence: evidence, p_evidence_paths: paths,
  });

  async function run(label, fn) {
    setError('');
    setSaved(false);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  const save = () => run('Saving…', async () => { onSaved(await rpc('save_dispute', payload())); setSaved(true); });
  const ask = () => run('Sending…', async () => {
    await rpc('save_dispute', payload());
    onSaved(await rpc('ask_ombudsman', { p_id: d.id }));
  });
  const lodge = () => {
    const text = standing === 'seconded'
      ? `Lodge this dispute? It goes to ${d.seconders.find((s) => s.id === seconder)?.nickname || 'your seconder'} to second first. The ${fee} fee is added once it is seconded, and waived if the dispute is upheld.`
      : `Lodge this dispute? A ${fee} fee is added to the Kitty now. It is waived if the dispute is upheld, and not refunded if it is dismissed or withdrawn.`;
    if (!window.confirm(text)) return;
    run('Lodging…', async () => {
      await rpc('save_dispute', payload());
      onSaved(await rpc('lodge_dispute', { p_id: d.id }));
    });
  };
  const remove = () => {
    if (!window.confirm('Delete this draft?')) return;
    run('Deleting…', async () => { await rpc('delete_dispute', { p_id: d.id }); go('disputes'); });
  };

  async function addPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    run('Uploading…', async () => {
      const blob = await compressPhoto(file);
      const path = await uploadProof(state.me.id, blob);
      setPaths((p) => [...p, path]);
    });
  }

  return (
    <div className="stack-lg">
      {d.seconder_declined ? <div className="notice error" role="status">{d.seconder_declined} declined to second this. Choose someone else, or change your standing.</div> : null}
      {d.advice ? (
        <div className="card stack">
          <div className="label">Advice from {d.advice_name || 'the Ombudsman'} (only you see this)</div>
          <div className="small note-text">{d.advice}</div>
        </div>
      ) : null}

      <fieldset className="stack plain">
        <legend className="label">1. Your standing</legend>
        {canAffected ? (
          <label className="check"><input type="radio" name="standing" checked={standing === 'affected'} onChange={() => setStanding('affected')} />I'm directly affected</label>
        ) : null}
        <label className="check"><input type="radio" name="standing" checked={standing === 'seconded'} onChange={() => setStanding('seconded')} />Another member seconds me</label>
        {standing === 'seconded' ? (
          <div className="field">
            <label className="label" htmlFor="seconder">Seconded by</label>
            <select id="seconder" className="select" value={seconder} onChange={(e) => setSeconder(e.target.value)}>
              <option value="">Choose an Eligible Member</option>
              {d.seconders.map((s) => <option key={s.id} value={s.id}>{s.nickname}</option>)}
            </select>
            <div className="tiny muted">They get asked in the app to second it before it is lodged.</div>
          </div>
        ) : null}
        {state.me.is_attorney ? (
          <label className="check"><input type="radio" name="standing" checked={standing === 'attorney'} onChange={() => setStanding('attorney')} />Attorney-General: no seconder needed</label>
        ) : null}
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="grounds">2. Grounds of dispute</label>
        <textarea id="grounds" className="textarea" maxLength={2000} placeholder="What is wrong, and what should happen instead" value={grounds} onChange={(e) => setGrounds(e.target.value)} />
        <div className="tiny muted">Unseconded grumbling does not constitute a dispute.</div>
      </div>

      <div className="field">
        <label className="label" htmlFor="evidence">3. Evidence</label>
        <textarea id="evidence" className="textarea" style={{ minHeight: 64 }} maxLength={2000} placeholder="Watch data, timestamps, witnesses" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        <input ref={fileRef} className="sr" type="file" accept="image/*" onChange={addPhoto} aria-label="Add an evidence photo" tabIndex={-1} />
        {paths.length ? (
          <div className="row wrap" style={{ gap: 8 }}>
            {paths.map((p) => (
              <span key={p} className="stack center" style={{ gap: 2 }}>
                <ProofThumb path={p} label="Evidence photo" />
                <button type="button" className="link-btn tiny" onClick={() => setPaths((x) => x.filter((y) => y !== p))}>Remove</button>
              </span>
            ))}
          </div>
        ) : null}
        {paths.length < 3 ? (
          <button type="button" className="btn dashed" onClick={() => fileRef.current.click()}><Icon name="camera" size={18} width={2} />Add a screenshot or photo</button>
        ) : null}
      </div>

      <div className={`small ${d.past_deadline ? 'warn' : 'soft'}`}>
        {d.deadline
          ? (d.past_deadline ? `The ${state.settings.dispute_days}-day window to lodge closed ${fmtDayTime(d.deadline, state.me.timezone)}.` : `Lodge by ${fmtDayTime(d.deadline, state.me.timezone)}.`)
          : `Lodge within ${state.settings.dispute_days} days of what you are disputing.`}
      </div>

      <ErrorNote>{error}</ErrorNote>
      {saved ? <div className="notice good" role="status">Draft saved. Only you can see it.</div> : null}
      <div className="stack">
        {d.can_ask ? <button type="button" className="btn" disabled={Boolean(busy)} onClick={ask}>Ask the Ombudsman first (no fee)</button> : null}
        <button type="button" className="btn primary" disabled={Boolean(busy) || d.past_deadline} onClick={lodge}>{busy || `Lodge dispute · ${fee}`}</button>
        <button type="button" className="btn" disabled={Boolean(busy)} onClick={save}>Save draft</button>
        <button type="button" className="link-btn center" disabled={Boolean(busy)} onClick={remove}>Delete draft</button>
      </div>
    </div>
  );
}

function NoteAction({ label, initial = '', placeholder, buttons }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = `note-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="card stack">
      <label className="label" htmlFor={id}>{label}</label>
      <textarea id={id} className="textarea" maxLength={2000} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <ErrorNote>{error}</ErrorNote>
      <div className="actions">
        {buttons.map(([name, fn, confirmText, cls]) => (
          <button key={name} type="button" className={`btn small-btn ${cls || ''}`} disabled={busy} onClick={async () => {
            if (confirmText && !window.confirm(confirmText)) return;
            setError('');
            setBusy(true);
            try { await fn(text); } catch (e) { setError(e.message); } finally { setBusy(false); }
          }}>{name}</button>
        ))}
      </div>
    </div>
  );
}

// ---- #/dispute/<id>
export function Dispute({ state, id }) {
  const load = useLoad(() => rpc('get_dispute', { p_id: id }), [id]);
  const [error, setError] = useState('');
  const d = load.data;
  const tz = state.me.timezone;

  async function act(fn, args, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError('');
    try {
      load.setData(await rpc(fn, args));
    } catch (e) {
      setError(e.message);
    }
  }

  let upholdText = 'Uphold this dispute? The fee is waived.';
  if (d && d.kind === 'forfeit') upholdText += ' The disputed Kitty entry is waived too.';
  if (d && d.kind === 'log') upholdText += ` ${d.subject_name}'s session is removed from the record.`;
  if (d && d.kind === 'goals') upholdText += ` Then change ${d.subject_name}'s goals from their record.`;

  return (
    <main className="screen">
      <a className="back" href="#/disputes"><Icon name="back" size={18} width={2.4} />Disputes</a>
      {load.loading && !d ? <Loading /> : null}
      <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>
      {d ? (
        <>
          <Head eyebrow="Notice of Dispute · Clause 13" title={STATUS[d.status]} />

          <div className="card row" style={{ alignItems: 'flex-start' }}>
            {d.log_photo ? <ProofThumb path={d.log_photo} label={d.subject_label} /> : null}
            <div className="stack grow" style={{ gap: 4 }}>
              <span className="label">Disputing</span>
              <span className="name" style={{ fontSize: 15 }}>{d.subject_label || KIND[d.kind]}</span>
              <span className="sub">By {d.is_mine ? 'you' : d.lodger_name}{d.lodged_at ? `, lodged ${fmtDayTime(d.lodged_at, tz)}` : ''}</span>
              {d.subject_user && d.subject_user !== state.me.id ? <a className="small" href={`#/member/${d.subject_user}`}>{d.subject_name}'s record</a> : null}
            </div>
          </div>

          {d.can_edit ? <Draft key={`${d.id}-${d.status}-${d.advice_at || ''}-${d.seconder_declined}`} d={d} state={state} onSaved={load.setData} /> : (
            <>
              {d.status === 'advice' && d.is_mine ? <div className="notice" role="status">With the Ombudsman for advice. Their advice will show here, then you can lodge it or drop it.</div> : null}
              {d.status === 'seconding' ? <div className="notice" role="status">Waiting for {d.seconder_name} to second it. The fee is added once it is seconded.</div> : null}

              <div className="card stack">
                <div className="label">Standing</div>
                <div className="small">{d.standing === 'affected' ? 'Directly affected' : d.standing === 'attorney' ? 'Lodged by the Attorney-General, no seconder needed' : `Seconded by ${d.seconder_name || 'a member'}${d.seconded_at ? `, ${fmtDayTime(d.seconded_at, tz)}` : ''}`}</div>
                <div className="label">Grounds</div>
                <div className="small note-text">{d.grounds}</div>
                {d.evidence || d.evidence_paths.length ? <div className="label">Evidence</div> : null}
                {d.evidence ? <div className="small note-text">{d.evidence}</div> : null}
                {d.evidence_paths.length ? <div className="row wrap" style={{ gap: 8 }}>{d.evidence_paths.map((p) => <ProofThumb key={p} path={p} label="Evidence photo" />)}</div> : null}
              </div>

              {d.advice && (d.is_mine || d.can_advise) ? (
                <div className="card stack"><div className="label">Ombudsman's advice (private)</div><div className="small note-text">{d.advice}</div></div>
              ) : null}

              <div className="timeline">
                {d.findings ? <div><div className="label">Ombudsman's findings · {d.findings_name}</div><div className="small note-text">{d.findings}</div></div> : null}
                {d.decided_at ? <div><div className="label">{d.status === 'upheld' ? 'Upheld' : 'Dismissed'} by {d.decided_name}, {fmtDayTime(d.decided_at, tz)}</div><div className="small note-text">{d.decision}</div></div> : null}
                {d.fee_status ? <div><div className="label">Fee</div><div className="small">{money(d.fee)} {d.fee_status === 'waived' ? 'waived' : d.fee_status === 'paid' ? 'paid' : 'owed'}</div></div> : null}
              </div>

              <ErrorNote>{error}</ErrorNote>

              {d.can_advise ? (
                <NoteAction label="Your advice (only the member who asked sees it)" placeholder="Is it worth lodging? What evidence would help?"
                  buttons={[['Send advice', (t) => act('give_advice', { p_id: d.id, p_note: t })]]} />
              ) : null}
              {d.can_second ? (
                <div className="actions">
                  <button type="button" className="btn small-btn" onClick={() => act('second_dispute', { p_id: d.id, p_accept: true }, `Second ${d.lodger_name}'s dispute? It is lodged and the ${money(d.fee)} fee goes to ${d.lodger_name}.`)}>Second this dispute</button>
                  <button type="button" className="btn small-btn" onClick={() => act('second_dispute', { p_id: d.id, p_accept: false }, 'Decline to second it?')}>Decline</button>
                </div>
              ) : null}
              {d.can_find ? (
                <NoteAction label="Your findings and recommendation" initial={d.findings} placeholder="What you found, and what you recommend the Executive decides"
                  buttons={[['Save findings', (t) => act('add_findings', { p_id: d.id, p_note: t })]]} />
              ) : null}
              {d.can_decide ? (
                <NoteAction label="Decision (reason)" placeholder="Why the Executive decided this way"
                  buttons={[
                    ['Uphold', (t) => act('decide_dispute', { p_id: d.id, p_uphold: true, p_note: t }), upholdText],
                    ['Dismiss', (t) => act('decide_dispute', { p_id: d.id, p_uphold: false, p_note: t }), 'Dismiss this dispute? The fee stands.', 'danger'],
                  ]} />
              ) : null}
              {d.status === 'open' && !d.can_decide && state.me.is_admin ? <div className="tiny muted">You are part of this dispute, so another member of the Executive decides it.</div> : null}
              {d.can_withdraw ? (
                <button type="button" className="link-btn center" onClick={() => act('withdraw_dispute', { p_id: d.id }, d.status === 'open' ? `Withdraw this dispute? The ${money(d.fee)} fee is not refunded.` : 'Withdraw this dispute?')}>Withdraw dispute</button>
              ) : null}
              {d.can_delete ? (
                <button type="button" className="link-btn center" onClick={async () => {
                  if (!window.confirm('Delete this draft?')) return;
                  try { await rpc('delete_dispute', { p_id: d.id }); go('disputes'); } catch (e) { setError(e.message); }
                }}>Delete draft</button>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
