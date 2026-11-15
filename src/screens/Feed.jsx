import React, { useEffect, useRef, useState } from 'react';
import { proofUrl, rpc } from '../api.js';
import { fmtDayTime, fmtDuration } from '../format.js';
import { ErrorNote, Icon, Loading } from '../ui.jsx';

const REACTIONS = [['like', '👍', 'Like'], ['love', '❤️', 'Love'], ['hmm', '🤨', 'Questionable']];

// The proof photo, loaded only once it is about to scroll into view. Tap for full size.
function FeedPhoto({ path, label }) {
  const ref = useRef(null);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const fetchIt = () => proofUrl(path).then((u) => { if (live) setUrl(u); }).catch(() => { if (live) setFailed(true); });
    if (!('IntersectionObserver' in window)) { fetchIt(); return () => { live = false; }; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fetchIt(); }
    }, { rootMargin: '400px' });
    io.observe(ref.current);
    return () => { live = false; io.disconnect(); };
  }, [path]);
  return (
    <>
      <button ref={ref} type="button" className="feed-photo" onClick={() => url && setOpen(true)} aria-label={`Open proof photo: ${label}`}>
        {url ? <img src={url} alt="" /> : <Icon name="camera" size={28} color={failed ? 'var(--warn)' : 'var(--text-2)'} width={1.8} />}
      </button>
      {open ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-label={label}>
          <img src={url} alt={label} />
          <button type="button" className="btn" style={{ maxWidth: 240 }} onClick={() => setOpen(false)} autoFocus>Close</button>
        </div>
      ) : null}
    </>
  );
}

function Item({ item, state, onReactions }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const r = item.reactions;
  const label = `${item.nickname}, ${item.activity}, ${fmtDayTime(item.logged_at, state.me.timezone)}`;

  async function react(kind) {
    setError('');
    setBusy(true);
    try {
      onReactions(item.id, await rpc('react_to_log', { p_log_id: item.id, p_kind: r.mine === kind ? null : kind }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const who = REACTIONS.filter(([k]) => r[k].length).map(([k, emoji]) => `${emoji} ${r[k].join(', ')}`).join('  ·  ');
  return (
    <article className="card stack feed-item">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <a href={`#/member/${item.user_id}`} className="stack" style={{ gap: 3, textDecoration: 'none', color: 'var(--text)' }}>
          <span className="row wrap" style={{ gap: 8 }}>
            <span className="name" style={{ fontSize: 15 }}>{item.nickname}</span>
            {item.is_me ? <span className="badge you">You</span> : null}
          </span>
          <span className="sub">{fmtDayTime(item.logged_at, state.me.timezone)}</span>
        </a>
        <span className="amount" aria-label={`${item.done} of ${item.total} this week`}>{item.done} / {item.total}</span>
      </div>
      <div className="name" style={{ fontSize: 15 }}>{item.activity} · {fmtDuration(item.duration_min)}</div>
      {item.flag_short || item.flag_same_day ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {item.flag_short ? <span className="badge flag">Under {state.settings.min_physical_minutes} min</span> : null}
          {item.flag_same_day ? <span className="badge flag">Second that day</span> : null}
        </div>
      ) : null}
      <FeedPhoto path={item.photo_path} label={label} />
      <div className="reacts" role="group" aria-label={item.is_me ? 'Reactions' : 'React'}>
        {REACTIONS.map(([k, emoji, name]) => (
          <button key={k} type="button" className="react" aria-pressed={r.mine === k} aria-label={`${name}, ${r[k].length}`}
            disabled={item.is_me || busy} onClick={() => react(k)}>
            <span aria-hidden="true">{emoji}</span><span className="n">{r[k].length}</span>
          </button>
        ))}
      </div>
      {who ? <div className="tiny muted">{who}</div> : null}
      <ErrorNote>{error}</ErrorNote>
    </article>
  );
}

// Everyone's activities, newest first, with reactions.
export default function Feed({ state }) {
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load(before) {
    setError('');
    setBusy(true);
    try {
      const res = await rpc('get_feed', { p_before: before || null, p_limit: 15 });
      setItems((cur) => (before && cur ? [...cur, ...res.items] : res.items));
      setMore(res.more);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(null); }, []);

  const onReactions = (id, reactions) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, reactions } : i)));

  return (
    <div className="stack">
      {items === null && busy ? <Loading /> : null}
      <ErrorNote onRetry={() => load(null)}>{error}</ErrorNote>
      {items && items.length === 0 ? <div className="card sub">Nothing logged yet. The first activity shows up here.</div> : null}
      {(items || []).map((i) => <Item key={i.id} item={i} state={state} onReactions={onReactions} />)}
      {items && more ? <button type="button" className="btn" disabled={busy} onClick={() => load(items[items.length - 1].logged_at)}>{busy ? 'Loading…' : 'Show older'}</button> : null}
      {items && items.length ? <button type="button" className="link-btn center" disabled={busy} onClick={() => load(null)}>Refresh</button> : null}
    </div>
  );
}
