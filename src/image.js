// Photo handling: shrink what the camera gives us, and draw the stamped image.
import { fmtDuration, fmtStamp } from './format.js';
import { TIERS, barOf, drawEmblem } from './rank.js';

// The stamp's colours are the --stamp-* values in styles.css, so the whole
// palette lives in one place.
function stampColours() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    BAND: v('--stamp-band', '#1F3326'), // the see-through bar and the group-name pill
    POP: v('--stamp-pop', '#FFFFFF'), // the tally
    FLAG: v('--stamp-flag', '#C9431F'), // only for flagged sessions
  };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a photo.')); };
    img.src = url;
  });
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The photo could not be saved.'))), 'image/jpeg', quality);
  });
}

// Phone cameras produce 3-12 MB files. Storage is the one free limit we could
// hit, so every photo is reduced to about 1440px on its long side first.
export async function compressPhoto(file, maxSide = 1440) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return toJpeg(canvas, 0.8);
}

// Mirror a photo left to right. Phones show a selfie mirrored while you take it but
// usually save it the other way round, so selfies are mirrored back to match what you saw.
export async function mirrorPhoto(blob) {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  return toJpeg(canvas, 0.9);
}

// Profile pictures: cut to a square from the middle of the photo, 512px across.
export async function squarePhoto(file, side = 512) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  drawCover(canvas.getContext('2d'), img, 0, 0, side, side);
  return toJpeg(canvas, 0.85);
}

function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function pill(ctx, text, x, y, { bg, fg, font, padX = 20, height = 52, alignRight = false }) {
  ctx.font = font;
  const w = ctx.measureText(text).width + padX * 2;
  const left = alignRight ? x - w : x;
  ctx.fillStyle = bg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, y, w, height, 14);
  else ctx.rect(left, y, w, height);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y + height / 2 + 2);
  return w;
}

function roundedPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function hexA(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Build the image that goes to the chat. The photo fills a 3:4 frame (the shape a
// phone takes in portrait) and the details sit on a see-through bar at the bottom.
// Reading order by size: tally, name, activity, duration, date and time, group name.
// An optional selfie is inset over the top-left of the photo, and the member's profile
// picture (if they have one) sits in a circle beside their name. An extra session shows
// EXTRA where the tally goes, because it does not count toward the week.
// log.style (from the server) carries the member's rank and chosen bar, frame and name tag.
export async function makeStamp(photoBlob, log, selfieBlob = null, avatarBlob = null) {
  const W = 1080;
  const H = 1440;
  const c = stampColours();
  const st = log.style || null;
  const tier = st ? (TIERS[st.rank] || TIERS[0]) : null;
  const bar = st ? barOf(st.bar) : { color: c.BAND, alpha: 0.6 };
  const DISPLAY = '"Space Grotesk", "Inter", system-ui, sans-serif';
  const BODY = '"Inter", system-ui, sans-serif';
  try {
    await Promise.all([
      document.fonts.load('700 96px "Space Grotesk"'),
      document.fonts.load('700 30px "Inter"'),
      document.fonts.load('600 30px "Inter"'),
      document.fonts.load('500 30px "Inter"'),
      document.fonts.load('400 30px "Inter"'),
    ]);
  } catch { /* fall back to system fonts */ }

  const img = await loadImage(photoBlob);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  drawCover(ctx, img, 0, 0, W, H);

  // Group name: the quietest thing on the image.
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  pill(ctx, String(log.group_name || 'Accountability Bros').toUpperCase(), 36, 36, { bg: hexA(bar.color, 0.55), fg: '#FFFFFF', font: `700 20px ${BODY}`, padX: 14, height: 40 });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  if (selfieBlob) {
    const selfie = await loadImage(selfieBlob);
    const x = 36; const y = 94; const w = 290; const h = 386; const r = 32; const edge = 6;
    roundedPath(ctx, x - edge, y - edge, w + edge * 2, h + edge * 2, r + edge);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.save();
    roundedPath(ctx, x, y, w, h, r);
    ctx.clip();
    drawCover(ctx, selfie, x, y, w, h);
    ctx.restore();
  }

  let flagY = 36;
  if (log.flag_short) {
    pill(ctx, `Under the ${log.min_physical_minutes} min minimum`, W - 36, flagY, { bg: c.FLAG, fg: '#FFFFFF', font: `700 26px ${BODY}`, alignRight: true });
    flagY += 64;
  }
  if (log.flag_same_day) {
    pill(ctx, 'Second of the same today', W - 36, flagY, { bg: c.FLAG, fg: '#FFFFFF', font: `700 26px ${BODY}`, alignRight: true });
  }

  const tally = `${log.done}/${log.total}`;
  const duration = fmtDuration(log.duration_min);
  const when = fmtStamp(log.logged_at, log.timezone);
  ctx.textBaseline = 'alphabetic';

  // Draw "Activity · duration" with the activity heavier than the duration.
  function activityLine(x, y, startSize, maxWidth, strong, soft) {
    const tail = ` · ${duration}`;
    // Shrink a little before cutting a long activity name short.
    let size = startSize;
    let tailW = 0;
    for (;;) {
      ctx.font = `400 ${size}px ${BODY}`;
      tailW = ctx.measureText(tail).width;
      ctx.font = `700 ${size}px ${BODY}`;
      if (ctx.measureText(log.activity).width + tailW <= maxWidth || size <= startSize - 10) break;
      size -= 2;
    }
    const head = fitText(ctx, log.activity, Math.max(80, maxWidth - tailW));
    ctx.fillStyle = strong;
    ctx.fillText(head, x, y);
    const headW = ctx.measureText(head).width;
    ctx.font = `400 ${size}px ${BODY}`;
    ctx.fillStyle = soft;
    ctx.fillText(tail, x + headW, y);
    return headW + tailW;
  }

  const BAR = 236;
  const top = H - BAR;
  const strong = '#FFFFFF';
  const soft = 'rgba(255, 255, 255, 0.88)';
  const quiet = 'rgba(255, 255, 255, 0.74)';
  ctx.fillStyle = hexA(bar.color, bar.alpha);
  ctx.fillRect(0, top, W, BAR);
  // Gold and above: a line in the rank's colours along the top of the bar.
  if (st && st.rank >= 3) {
    const lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, tier.hi);
    lg.addColorStop(1, tier.lo);
    ctx.fillStyle = lg;
    ctx.fillRect(0, top, W, 6);
  }

  // The tally is drawn in the rank's colour (white at Iron).
  ctx.textAlign = 'right';
  if (tier && tier.tally === 'grad') {
    const tg = ctx.createLinearGradient(0, H - 190, 0, H - 54);
    tg.addColorStop(0, '#FFE38C');
    tg.addColorStop(1, '#F08A3C');
    ctx.fillStyle = tg;
  } else {
    ctx.fillStyle = tier ? tier.tally : c.POP;
  }
  let tallyW;
  if (log.extra) {
    ctx.font = `700 92px ${DISPLAY}`;
    ctx.fillText('EXTRA', W - 48, H - 86);
    tallyW = ctx.measureText('EXTRA').width;
  } else {
    ctx.font = `700 172px ${DISPLAY}`;
    ctx.fillText(tally, W - 48, H - 54);
    tallyW = ctx.measureText(tally).width;
  }

  let x = 48;
  if (avatarBlob) {
    try {
      const face = await loadImage(avatarBlob);
      const d = 148; const ay = top + (BAR - d) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + d / 2, ay + d / 2, d / 2 + (st && st.rank > 0 ? 7 : 4), 0, Math.PI * 2);
      if (st && st.rank > 0) {
        const rg = ctx.createLinearGradient(0, ay, 0, ay + d);
        rg.addColorStop(0, tier.hi);
        rg.addColorStop(1, tier.lo);
        ctx.fillStyle = rg;
      } else {
        ctx.fillStyle = '#FFFFFF';
      }
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + d / 2, ay + d / 2, d / 2, 0, Math.PI * 2);
      ctx.clip();
      drawCover(ctx, face, x, ay, d, d);
      ctx.restore();
      x += d + 30;
    } catch { /* no picture, then */ }
  }
  const leftMax = W - 48 - tallyW - 44 - x;

  ctx.textAlign = 'left';
  ctx.font = `700 62px ${DISPLAY}`;
  ctx.fillStyle = strong;
  const name = fitText(ctx, log.nickname, leftMax);
  ctx.fillText(name, x, top + 86);
  const nameW = ctx.measureText(name).width;

  // Beside the name: the rank badge, a chosen badge, or nothing. Left off if there is no room.
  if (st && st.tag !== 'none') {
    const isRank = st.tag === 'rank';
    const label = isRank ? tier.name.toUpperCase() : String(st.tag_label || '').toUpperCase();
    ctx.font = `700 24px ${BODY}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    const pw = ctx.measureText(label).width + (isRank ? 74 : 36);
    const px = x + nameW + 18;
    if (label && px + pw <= x + leftMax) {
      const py = top + 40;
      const ph = 52;
      roundedPath(ctx, px, py, pw, ph, 26);
      ctx.fillStyle = isRank ? 'rgba(0, 0, 0, 0.38)' : '#E2C26E';
      ctx.fill();
      if (isRank) drawEmblem(ctx, st.rank, px + 28, py + ph / 2, 40);
      ctx.fillStyle = isRank ? (tier.tally === 'grad' ? '#FFD27A' : tier.hi) : '#18211B';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px + (isRank ? 54 : 18), py + ph / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  activityLine(x, top + 144, 40, leftMax, strong, soft);
  ctx.font = `500 28px ${BODY}`;
  ctx.fillStyle = quiet;
  ctx.fillText(fitText(ctx, when, leftMax), x, top + 194);

  // Frames, drawn last so they sit over everything.
  const frame = st ? st.frame : 'none';
  if (frame === 'corners') {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    const m = 30; const L = 110; const b = top - 30;
    for (const [px, py, sx, sy] of [[m, m + 64, 1, 1], [W - m, m, -1, 1], [m, b, 1, -1], [W - m, b, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(px, py + sy * L); ctx.lineTo(px, py); ctx.lineTo(px + sx * L, py); ctx.stroke();
    }
  } else if (frame === 'keyline') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 5;
    roundedPath(ctx, 22, 22, W - 44, H - 44, 28);
    ctx.stroke();
  } else if (frame === 'ice') {
    const ig = ctx.createLinearGradient(0, 0, W, H);
    ig.addColorStop(0, '#EAF3FF'); ig.addColorStop(0.5, '#7FA9F2'); ig.addColorStop(1, '#EAF3FF');
    ctx.strokeStyle = ig;
    ctx.lineWidth = 12;
    roundedPath(ctx, 6, 6, W - 12, H - 12, 30);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(220, 235, 255, 0.8)';
    roundedPath(ctx, 28, 28, W - 56, H - 56, 22);
    ctx.stroke();
  } else if (frame === 'champion') {
    const cg = ctx.createLinearGradient(0, 0, W, H);
    cg.addColorStop(0, '#FFE38C'); cg.addColorStop(0.5, '#F08A3C'); cg.addColorStop(1, '#FFE38C');
    ctx.strokeStyle = cg;
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 214, 130, 0.85)';
    ctx.strokeRect(32, 32, W - 64, H - 64);
  }

  return toJpeg(canvas, 0.9);
}
