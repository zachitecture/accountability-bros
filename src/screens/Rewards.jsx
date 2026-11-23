import React, { useEffect, useState } from 'react';
import { rpc } from '../api.js';
import { makeStamp } from '../image.js';
import { fmtDate, fmtDuration } from '../format.js';
import { BADGE_INFO, BARS, FRAMES, TIERS, UNLOCKS, emblemURL } from '../rank.js';
import { ErrorNote, Head, Icon, Loading, RankIcon, avatarBlob, useLoad } from '../ui.jsx';

// A stand-in photo for the stamp preview.
function previewPhoto() {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1440;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1080, 1440);
  g.addColorStop(0, '#5b4a3f');
  g.addColorStop(0.55, '#8a6b4f');
  g.addColorStop(1, '#1e2428');
  x.fillStyle = g;
  x.fillRect(0, 0, 1080, 1440);
  x.filter = 'blur(40px)';
  for (const [cx, cy, r, col] of [[220, 260, 120, '#f4d9a8'], [820, 180, 90, '#fff1d6'], [640, 520, 160, '#c98b55'], [900, 980, 220, '#3b3029']]) {
    x.globalAlpha = 0.55; x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.85));
}

function Lock({ rank }) {
  return (
    <span className="pick-lock">
      <Icon name="lock" size={12} width={2.4} />
      <RankIcon rank={rank} size={14} />{TIERS[rank].name}
    </span>
  );
}

export default function Rewards({ state }) {
  const load = useLoad(() => rpc('get_rewards'), []);
  const d = load.data;
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const styleKey = d ? JSON.stringify(d.style) : '';
  useEffect(() => {
    if (!d) return undefined;
    let live = true;
    (async () => {
      const blob = await makeStamp(await previewPhoto(), {
        nickname: state.me.nickname, activity: 'Gym', duration_min: 65, logged_at: state.now || new Date().toISOString(),
        timezone: state.me.timezone, done: 5, total: 7, group_name: state.settings.group_name, style: d.style,
      }, null, await avatarBlob(state.me.avatar_path));
      if (live) setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    })().catch(() => {});
    return () => { live = false; };
  }, [styleKey]);

  async function choose(args) {
    setError('');
    setBusy(true);
    try {
      load.setData(await rpc('set_style', args));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!d) {
    return (
      <main className="screen">
        <a className="back" href="#/more"><Icon name="back" size={18} width={2.4} />More</a>
        <Head eyebrow="Rewards" title="Your rank" />
        {load.loading ? <Loading /> : null}
        <ErrorNote onRetry={load.reload}>{load.error}</ErrorNote>
      </main>
    );
  }

  const tier = TIERS[d.rank];
  const next = TIERS[d.rank + 1];
  const pct = next ? Math.max(0, Math.min(100, Math.round(((d.total_min - tier.hours * 60) / ((next.hours - tier.hours) * 60)) * 100))) : 100;
  const earned = d.badges.filter((b) => b.earned);
  const tags = [['rank', `Rank (${tier.name})`], ['none', 'Nothing'], ...earned.map((b) => [b.key, b.label])];

  return (
    <main className="screen">
      <a className="back" href="#/more"><Icon name="back" size={18} width={2.4} />More</a>
      <Head eyebrow={`Rewards · Season ${d.season}`} title="Your rank" />

      <div className="card row" style={{ gap: 14, alignItems: 'center' }}>
        <img src={emblemURL(d.rank, 160)} width={76} height={76} alt="" />
        <div className="stack grow" style={{ gap: 4 }}>
          <div className="total-num">{tier.name}</div>
          <div className="small soft">{fmtDuration(d.total_min) || '0 h'} this season{d.carried_min > 0 ? `, ${fmtDuration(d.carried_min)} kept from last season` : ''}</div>
          <div className="track" style={{ width: '100%' }} aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
          <div className="small">{next ? <><b>{fmtDuration(next.hours * 60 - d.total_min)} to {next.name}</b></> : <b>Top rank</b>}</div>
          <div className="tiny muted">Season {d.season} ends {fmtDate(d.season_end)}.</div>
        </div>
      </div>

      <div className="stack">
        <div className="label">Your stamp</div>
        {preview ? <img className="stamp-img" src={preview} alt={`Preview of your stamp: ${tier.name}, ${BARS.find((b) => b.key === d.style.bar)?.name} bar`} /> : <Loading />}
      </div>

      <ErrorNote>{error}</ErrorNote>

      <div className="stack">
        <div className="label">Bar colour</div>
        <div className="pick-grid">
          {BARS.map((b) => {
            const locked = b.rank > d.peak;
            const on = d.style.bar === b.key;
            return (
              <button key={b.key} type="button" className={`pick${on ? ' on' : ''}`} aria-pressed={on} disabled={locked || busy}
                aria-label={`${b.name} bar${locked ? `, unlocks at ${TIERS[b.rank].name}` : ''}`} onClick={() => choose({ p_bar: b.key })}>
                <span className="pick-chip" style={{ background: b.color }} />
                <span className="pick-name">{b.name}</span>
                {locked ? <Lock rank={b.rank} /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="stack">
        <div className="label">Frame</div>
        <div className="pick-grid">
          {FRAMES.map((f) => {
            const locked = f.rank > d.peak;
            const on = d.style.frame === f.key;
            return (
              <button key={f.key} type="button" className={`pick${on ? ' on' : ''}`} aria-pressed={on} disabled={locked || busy}
                aria-label={`${f.name} frame${locked ? `, unlocks at ${TIERS[f.rank].name}` : ''}`} onClick={() => choose({ p_frame: f.key })}>
                <span className={`pick-chip frame-${f.key}`} />
                <span className="pick-name">{f.name}</span>
                {locked ? <Lock rank={f.rank} /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="stack">
        <div className="label">Beside your name on stamps</div>
        <div className="chips">
          {tags.map(([k, label]) => (
            <button key={k} type="button" className={`chip${d.style.tag === k ? ' on' : ''}`} aria-pressed={d.style.tag === k} disabled={busy} onClick={() => choose({ p_tag: k })}>{label}</button>
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="label">The ranks</div>
        <div className="card" style={{ padding: '4px 14px' }}>
          {TIERS.map((t, i) => {
            const toGo = t.hours * 60 - d.total_min;
            let status;
            if (i < d.rank) status = <Icon name="check" size={16} color="var(--accent)" width={2.8} />;
            else if (i === d.rank) status = <span className="small gold" style={{ fontWeight: 700 }}>You</span>;
            else status = <span className="tiny muted">{i <= d.peak ? 'Unlocked · ' : ''}{fmtDuration(toGo)} to go</span>;
            return (
              <div key={t.name} className={`ladder-row${i > d.rank ? ' ahead' : ''}`}>
                <img src={emblemURL(i, 72)} width={34} height={34} alt="" />
                <div className="stack grow" style={{ gap: 2 }}>
                  <span className="name" style={{ fontSize: 14 }}>{t.name} <span className="tiny muted">· {t.hours ? `${t.hours} h` : 'start'}</span></span>
                  <span className="tiny muted">{UNLOCKS[i]}</span>
                </div>
                {status}
              </div>
            );
          })}
        </div>
      </div>

      <div className="stack">
        <div className="label">Badges · {earned.length} of {d.badges.length}</div>
        {d.badges.map((b) => (
          <div key={b.key} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span className={`badge ${b.earned ? 'gold-badge' : 'quiet dashed'}`}>{b.label}</span>
            <span className="small soft grow">{BADGE_INFO[b.key]}{!b.earned && b.progress ? <span className="tiny muted"> {b.progress}.</span> : null}</span>
          </div>
        ))}
      </div>

      <div className="small muted">
        Hours are physical sessions, extras included, counted from {fmtDate(d.rewards_start)}. Each session counts for up to 3 hours.
        Seasons last {d.season_weeks} weeks. A new season starts you with {d.keep_pct}% of your hours (up to {d.keep_max} h),
        and anything you have unlocked stays unlocked. Badges are yours for good.
      </div>
    </main>
  );
}
