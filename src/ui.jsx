import React, { useCallback, useEffect, useRef, useState } from 'react';
import { proofUrl } from './api.js';

// ---- tiny hash router: #/log, #/goals, #/group, #/member/<id>, #/kitty, #/more
const KNOWN = ['log', 'goals', 'group', 'member', 'kitty', 'more'];
function parseHash() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return KNOWN.includes(parts[0]) ? parts : ['log'];
}
export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
export function go(path) { window.location.hash = `#/${path}`; }

// ---- load something from the server, with loading and error states
export function useLoad(fn, deps) {
  const [s, setS] = useState({ data: null, error: '', loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    const mine = ++seq.current;
    setS((p) => ({ ...p, loading: true, error: '' }));
    try {
      const data = await fn();
      if (mine === seq.current) setS({ data, error: '', loading: false });
    } catch (e) {
      if (mine === seq.current) setS({ data: null, error: e.message, loading: false });
    }
  }, deps);
  useEffect(() => { run(); }, [run]);
  const setData = useCallback((data) => { seq.current += 1; setS({ data, error: '', loading: false }); }, []);
  return { ...s, reload: run, setData };
}

export function Loading() {
  return <div className="loading" role="status"><div className="spinner" /><span className="sr">Loading</span></div>;
}

export function ErrorNote({ children, onRetry }) {
  if (!children) return null;
  return (
    <div className="notice error" role="alert">
      {children}
      {onRetry ? <div><button type="button" className="link-btn" onClick={onRetry}>Try again</button></div> : null}
    </div>
  );
}

export function Head({ eyebrow, title, side }) {
  return (
    <header className="head">
      <div className="head-main">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="title">{title}</h1>
      </div>
      {side ? <div className="head-side">{side}</div> : null}
    </header>
  );
}

const paths = {
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  minus: <path d="M6 12h12" />,
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  arrow: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  share: <><path d="M12 15V4" /><path d="M7.5 8.5L12 4l4.5 4.5" /><path d="M5 13v6h14v-6" /></>,
  clock: <><circle cx="12" cy="12" r="9.5" /><path d="M12 7v5.5l3.5 2" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  trash: <><path d="M5 7h14" /><path d="M9 7V4h6v3" /><path d="M7 7l1 13h8l1-13" /></>,
  circleCheck: <><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></>,
  circle: <circle cx="12" cy="12" r="10" />,
  log: <><circle cx="12" cy="12" r="9.5" /><path d="M12 8v8" /><path d="M8 12h8" /></>,
  goals: <><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  group: <><circle cx="9" cy="9" r="3.5" /><path d="M2.5 19.5c.6-3.4 3.2-5.5 6.5-5.5s5.900 2.100 6.500 5.500" /><path d="M16 5.800a3.500 3.500 0 0 1 0 6.400" /><path d="M18.500 14.500c1.700.8 2.800 2.500 3.100 5" /></>,
  kitty: <><ellipse cx="12" cy="7" rx="7.500" ry="3" /><path d="M4.500 7v5c0 1.700 3.400 3 7.500 3s7.500-1.300 7.500-3V7" /><path d="M4.500 12v5c0 1.700 3.400 3 7.500 3s7.500-1.300 7.500-3v-5" /></>,
  more: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  flag: <><path d="M6 21V4" /><path d="M6 4h11l-2 4 2 4H6" /></>,
};

export function Icon({ name, size = 20, color = 'currentColor', width = 2.2 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function Tick({ children, warn }) {
  return (
    <div className="tick-row">
      <Icon name={warn ? 'flag' : 'check'} size={18} color={warn ? 'var(--warn)' : 'var(--accent)'} width={2.6} />
      <span>{children}</span>
    </div>
  );
}

// A proof photo from private storage. Tap to see it full size.
export function ProofThumb({ path, label }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    proofUrl(path).then((u) => { if (live) setUrl(u); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [path]);
  return (
    <>
      <button type="button" className="thumb" onClick={() => url && setOpen(true)} aria-label={`Open proof photo: ${label}`}>
        {url ? <img src={url} alt="" /> : <Icon name="camera" size={22} color={failed ? 'var(--warn)' : 'var(--text-2)'} width={1.800} />}
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
