import React, { useState } from 'react';
import { friendly, rpc, supabase } from '../api.js';
import { ErrorNote, Head } from '../ui.jsx';

export function Auth() {
  const [mode, setMode] = useState('in'); // in | up
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNote('');
    if (mode === 'up' && password.length < 8) { setError('Use a password with at least 8 characters.'); return; }
    setBusy(true);
    try {
      if (mode === 'in') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password });
        if (err) throw err;
        if (!data.session) setNote('Account created. Check your email for a confirmation link, then sign in.');
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    setError('');
    setNote('');
    if (!email.trim()) { setError('Type your email first, then tap the reset link again.'); return; }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (err) setError(friendly(err));
    else setNote('If that email has an account, a reset link is on its way.');
  }

  return (
    <main className="screen">
      <Head eyebrow="Accountability Bros" title={mode === 'in' ? 'Sign in' : 'Create your account'} />
      <div className="seg" role="group" aria-label="Sign in or create an account">
        <button type="button" aria-pressed={mode === 'in'} onClick={() => { setMode('in'); setError(''); setNote(''); }}>Sign in</button>
        <button type="button" aria-pressed={mode === 'up'} onClick={() => { setMode('up'); setError(''); setNote(''); }}>New here</button>
      </div>
      <form className="stack-lg" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === 'up' ? <div className="tiny muted">At least 8 characters.</div> : null}
        </div>
        <ErrorNote>{error}</ErrorNote>
        {note ? <div className="notice good" role="status">{note}</div> : null}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
        {mode === 'in' ? <button type="button" className="link-btn center" onClick={forgot}>Forgot your password?</button> : null}
      </form>
    </main>
  );
}

export function Join({ state, email, onJoined }) {
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      onJoined(await rpc('join_group', { p_code: code, p_nickname: nickname, p_timezone: timezone }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (state.paused) {
    return (
      <main className="screen">
        <Head eyebrow="Accountability Bros" title="Membership paused" />
        <p className="soft">Your membership is paused. Talk to the Executive about coming back.</p>
        <button type="button" className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </main>
    );
  }

  return (
    <main className="screen">
      <Head eyebrow="Accountability Bros" title={state.first ? 'Set up the group' : 'Join the group'} />
      <p className="soft">
        {state.first
          ? 'You are the first one in, so you become the admin. You can hand out the join code from the More tab.'
          : 'Enter the join code from the group chat and the name the bros know you by.'}
      </p>
      <form className="stack-lg" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="nickname">Your name in the group</label>
          <input id="nickname" className="input" maxLength={20} required autoComplete="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </div>
        {state.first ? null : (
          <div className="field">
            <label className="label" htmlFor="code">Join code</label>
            <input id="code" className="input" required autoCapitalize="characters" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'One moment…' : state.first ? 'Create the group' : 'Join'}</button>
      </form>
      <div className="small muted center">Signed in as {email}</div>
      <button type="button" className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </main>
  );
}

export function NewPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (password.length < 8) { setError('Use a password with at least 8 characters.'); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(friendly(err));
    else onDone();
  }

  return (
    <main className="screen">
      <Head eyebrow="Accountability Bros" title="Choose a new password" />
      <form className="stack-lg" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="new-password">New password</label>
          <input id="new-password" className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </main>
  );
}
