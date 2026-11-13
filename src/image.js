// Photo handling: shrink what the camera gives us, and draw the stamped image.
import { fmtDuration, fmtStamp } from './format.js';

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
// An optional selfie is inset over the top-left of the photo.
export async function makeStamp(photoBlob, log, selfieBlob = null) {
  const W = 1080;
  const H = 1440;
  const c = stampColours();
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
  pill(ctx, String(log.group_name || 'Accountability Bros').toUpperCase(), 36, 36, { bg: hexA(c.BAND, 0.55), fg: '#FFFFFF', font: `700 20px ${BODY}`, padX: 14, height: 40 });
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
  ctx.fillStyle = hexA(c.BAND, 0.6);
  ctx.fillRect(0, top, W, BAR);

  ctx.textAlign = 'right';
  ctx.font = `700 172px ${DISPLAY}`;
  ctx.fillStyle = c.POP;
  ctx.fillText(tally, W - 48, H - 54);
  const leftMax = W - 48 - ctx.measureText(tally).width - 48 - 36;

  ctx.textAlign = 'left';
  ctx.font = `700 62px ${DISPLAY}`;
  ctx.fillStyle = strong;
  ctx.fillText(fitText(ctx, log.nickname, leftMax), 48, top + 86);
  activityLine(48, top + 144, 40, leftMax, strong, soft);
  ctx.font = `500 28px ${BODY}`;
  ctx.fillStyle = quiet;
  ctx.fillText(fitText(ctx, when, leftMax), 48, top + 194);

  return toJpeg(canvas, 0.9);
}
