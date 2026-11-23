// Ranks, stamp styles and badges. The rules live in the database (rank_index,
// bar_unlock, frame_unlock, badges_of); this file only describes how they look.

export const TIERS = [
  { name: 'Iron', hours: 0, hi: '#B4BAC0', lo: '#4B5056', tally: '#FFFFFF', ring: '#B4BAC0', mark: 'c1' },
  { name: 'Bronze', hours: 10, hi: '#E9AE78', lo: '#7E4A22', tally: '#E8A971', ring: '#B9773F', mark: 'c2' },
  { name: 'Silver', hours: 25, hi: '#F4F6F8', lo: '#8D96A0', tally: '#E6EAEE', ring: '#A9B1BA', mark: 'c3' },
  { name: 'Gold', hours: 50, hi: '#F9DC7E', lo: '#B5862A', tally: '#F2CF6B', ring: '#D4A93F', mark: 'star' },
  { name: 'Platinum', hours: 80, hi: '#D4F5F0', lo: '#4F9C95', tally: '#BFEDE6', ring: '#5FAFA7', mark: 'star2' },
  { name: 'Diamond', hours: 120, hi: '#D8E8FF', lo: '#4D7FE0', tally: '#BCD6FF', ring: '#5B8DEB', mark: 'gem' },
  { name: 'Champion', hours: 200, hi: '#FFE38C', lo: '#D9482E', tally: 'grad', ring: '#E8743A', mark: 'crown' },
];

// Best to worst: Midnight, Royal, Slate, Ocean, Forest. The better the colour, the higher the rank.
export const BARS = [
  { key: 'forest', name: 'Forest', color: '#1F3326', alpha: 0.6, rank: 0 },
  { key: 'ocean', name: 'Ocean', color: '#0E3A40', alpha: 0.6, rank: 1 },
  { key: 'slate', name: 'Slate', color: '#1C2B44', alpha: 0.6, rank: 2 },
  { key: 'royal', name: 'Royal', color: '#272052', alpha: 0.62, rank: 3 },
  { key: 'midnight', name: 'Midnight', color: '#0D0F10', alpha: 0.72, rank: 4 },
];

export const FRAMES = [
  { key: 'none', name: 'None', rank: 0 },
  { key: 'corners', name: 'Corner marks', rank: 2 },
  { key: 'keyline', name: 'Keyline', rank: 4 },
  { key: 'ice', name: 'Ice', rank: 5 },
  { key: 'champion', name: 'Champion', rank: 6 },
];

export const UNLOCKS = [
  'Forest bar',
  'Ocean bar',
  'Slate bar and corner marks',
  'Royal bar, and a line in your rank colour along the bar',
  'Midnight bar and the keyline frame',
  'Ice frame',
  'Champion frame and a gold-to-orange tally',
];

export const BADGE_INFO = {
  five_week: 'Log 5 sessions in one week.',
  seven_week: 'Log 7 sessions in one week.',
  ten_week: 'Log 10 sessions in one week.',
  big_week: 'Log 8 hours of physical sessions in one week.',
  raised: 'Declare more goals than the week before, and finish every one.',
  extra_mile: 'Log 5 extras on top of your goals.',
  streak4: 'Every goal met, 4 weeks in a row.',
  streak8: 'Every goal met, 8 weeks in a row.',
  streak12: 'Every goal met, 12 weeks in a row.',
  done10: '10 completed weeks in total.',
  done25: '25 completed weeks in total.',
  done50: '50 completed weeks in total.',
};

export const barOf = (key) => BARS.find((b) => b.key === key) || BARS[0];

// ---- the rank emblem: a metal shield with a mark that grows with the rank
function shield(ctx, cx, cy, s) {
  const w = s * 0.84;
  const h = s;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy - h / 2 + h * 0.16);
  ctx.lineTo(cx + w / 2, cy + h * 0.06);
  ctx.quadraticCurveTo(cx + w / 2, cy + h * 0.36, cx, cy + h / 2);
  ctx.quadraticCurveTo(cx - w / 2, cy + h * 0.36, cx - w / 2, cy + h * 0.06);
  ctx.lineTo(cx - w / 2, cy - h / 2 + h * 0.16);
  ctx.closePath();
}
function star(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
}
export function drawEmblem(ctx, rank, cx, cy, s) {
  const t = TIERS[rank] || TIERS[0];
  ctx.save();
  shield(ctx, cx, cy, s);
  const g = ctx.createLinearGradient(cx, cy - s / 2, cx, cy + s / 2);
  g.addColorStop(0, t.hi);
  g.addColorStop(1, t.lo);
  ctx.fillStyle = g;
  ctx.fill();
  shield(ctx, cx, cy + s * 0.01, s * 0.76);
  ctx.fillStyle = t.lo;
  ctx.fill();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = t.hi;
  ctx.strokeStyle = t.hi;
  ctx.lineWidth = s * 0.075;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const chev = (y) => { ctx.beginPath(); ctx.moveTo(cx - s * 0.2, y + s * 0.07); ctx.lineTo(cx, y - s * 0.05); ctx.lineTo(cx + s * 0.2, y + s * 0.07); ctx.stroke(); };
  if (t.mark === 'c1') chev(cy);
  if (t.mark === 'c2') { chev(cy - s * 0.09); chev(cy + s * 0.09); }
  if (t.mark === 'c3') { chev(cy - s * 0.16); chev(cy); chev(cy + s * 0.16); }
  if (t.mark === 'star') star(ctx, cx, cy + s * 0.02, s * 0.22);
  if (t.mark === 'star2') { star(ctx, cx - s * 0.12, cy + s * 0.03, s * 0.14); star(ctx, cx + s * 0.12, cy + s * 0.03, s * 0.14); }
  if (t.mark === 'gem') {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.2, cy - s * 0.06); ctx.lineTo(cx - s * 0.1, cy - s * 0.17); ctx.lineTo(cx + s * 0.1, cy - s * 0.17);
    ctx.lineTo(cx + s * 0.2, cy - s * 0.06); ctx.lineTo(cx, cy + s * 0.2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = t.lo;
    ctx.lineWidth = s * 0.025;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.2, cy - s * 0.06); ctx.lineTo(cx + s * 0.2, cy - s * 0.06);
    ctx.moveTo(cx - s * 0.06, cy - s * 0.06); ctx.lineTo(cx, cy + s * 0.2); ctx.lineTo(cx + s * 0.06, cy - s * 0.06);
    ctx.stroke();
  }
  if (t.mark === 'crown') {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.22, cy + s * 0.12); ctx.lineTo(cx - s * 0.22, cy - s * 0.1); ctx.lineTo(cx - s * 0.11, cy);
    ctx.lineTo(cx, cy - s * 0.16); ctx.lineTo(cx + s * 0.11, cy); ctx.lineTo(cx + s * 0.22, cy - s * 0.1);
    ctx.lineTo(cx + s * 0.22, cy + s * 0.12); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

const cache = new Map();
export function emblemURL(rank, size = 64) {
  const key = `${rank}-${size}`;
  if (!cache.has(key)) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    drawEmblem(c.getContext('2d'), rank, size / 2, size / 2, size * 0.92);
    cache.set(key, c.toDataURL());
  }
  return cache.get(key);
}
