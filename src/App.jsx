import React, { useCallback, useEffect, useState } from 'react';
import { configured, rpc, supabase } from './api.js';
import { ErrorNote, Head, Icon, Loading, useRoute } from './ui.jsx';
import { Auth, Join, NewPassword } from './screens/Auth.jsx';
import Log from './screens/Log.jsx';
import Goals from './screens/Goals.jsx';
import Group from './screens/Group.jsx';
import Member from './screens/Member.jsx';
import Kitty from './screens/Kitty.jsx';
import More from './screens/More.jsx';

const TABS = [
  ['log', 'Log', 'log'],
  ['goals', 'Goals', 'goals'],
  ['group', 'Group', 'group'],
  ['kitty', 'Kitty', 'kitty'],
  ['more', 'More', 'more'],
];

function Shell({ children, tabs, active }) {
  return (
    <div className={`app${tabs ? ' with-tabs' : ''}`}>
      {children}
      {tabs ? (
        <div className="tabbar">
          <nav aria-label="Main">
            {TABS.map(([path, label, icon]) => (
              <a key={path} className="tab" href={`#/${path}`} aria-current={active === path ? 'page' : undefined}>
                <Icon name={icon} size={22} width={2} />
                <span>{label}</span>
              </a>
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined while we check
  const [state, setState] = useState(null);
  const [stateError, setStateError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const route = useRoute();

  useEffect(() => {
    if (!configured) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id || null;
  const refresh = useCallback(async () => {
    try {
      setState(await rpc('get_state'));
      setStateError('');
    } catch (e) {
      setStateError(e.message);
    }
  }, []);

  useEffect(() => {
    setState(null);
    setStateError('');
    if (userId) refresh();
  }, [userId, refresh]);

  if (!configured) {
    return (
      <Shell>
        <main className="screen">
          <Head eyebrow="Accountability Bros" title="Not connected yet" />
          <p className="soft">The app has not been pointed at its database. Add the Supabase URL and publishable key, then rebuild.</p>
        </main>
      </Shell>
    );
  }
  if (session === undefined) return <Shell><Loading /></Shell>;
  if (recovery && session) return <Shell><NewPassword onDone={() => setRecovery(false)} /></Shell>;
  if (!session) return <Shell><Auth /></Shell>;
  if (stateError) {
    return (
      <Shell>
        <main className="screen">
          <Head eyebrow="Accountability Bros" title="Something went wrong" />
          <ErrorNote onRetry={refresh}>{stateError}</ErrorNote>
          <button type="button" className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </main>
      </Shell>
    );
  }
  if (!state) return <Shell><Loading /></Shell>;
  if (!state.member) return <Shell><Join state={state} email={session.user.email} onJoined={setState} /></Shell>;

  const [page, a, b] = route;
  let screen;
  if (page === 'goals') screen = <Goals key={`${a || 'me'}-${b || ''}`} state={state} userId={a} week={b} />;
  else if (page === 'group') screen = <Group state={state} />;
  else if (page === 'member' && a) screen = <Member key={a} state={state} userId={a} />;
  else if (page === 'kitty') screen = <Kitty state={state} />;
  else if (page === 'more') screen = <More state={state} email={session.user.email} onState={setState} refresh={refresh} />;
  else screen = <Log state={state} refresh={refresh} />;

  return <Shell tabs active={page === 'member' ? 'group' : page}>{screen}</Shell>;
}
