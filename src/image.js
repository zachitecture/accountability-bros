// Photo handling: shrink what the camera gives us, and draw the stamped image.
import { fmtDuration, fmtStamp } from './format.js';

// The stamp keeps a dark band so it stands out on any photo in the chat.
// Its colours are the --stamp-* values in styles.css, so the whole palette
// lives in one place.
function stampColours() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    BAND: v('--stamp-band', '#1F3326'),
    POP: v('--stamp-pop', '#F6F5F0'), // tally and top rule
    TEXT: v('--stamp-text', '#F6F5F0'),
    TEXT_2: v('--stamp-text-2', '#CBD5C7'),
    MUTED: v('--stamp-muted', '#A5B2A1'),
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

// Build the image that goes to the chat: the photo with a band underneath
// carrying who, what, how long, when (server time) and the tally.
// An optional selfie is inset over the top-left of the photo.
export async function makeStamp(photoBlob, log, selfieBlob = null, layout = 'band') {
  if (layout !== 'band') return makeOverlayStamp(photoBlob, log, selfieBlob, layout);
  const W = 1080;
  const H = 1350;
  const BAND_H = 310;
  const { BAND, POP, TEXT, TEXT_2, MUTED, FLAG } = stampColours();
  try {
    await Promise.all([
      document.fonts.load('700 96px "Space Grotesk"'),
      document.fonts.load('700 30px "Inter"'),
      document.fonts.load('500 34px "Inter"'),
    ]);
  } catch { /* fall back to system fonts */ }
  const img = await loadImage(photoBlob);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const photoH = H - BAND_H;

  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, W, H);
  drawCover(ctx, img, 0, 0, W, photoH);

  if (selfieBlob) {
    const selfie = await loadImage(selfieBlob);
    const x = 40; const y = 112; const w = 300; const h = 400; const r = 34; const edge = 8;
    roundedPath(ctx, x - edge, y - edge, w + edge * 2, h + edge * 2, r + edge);
    ctx.fillStyle = BAND;
    ctx.fill();
    ctx.save();
    roundedPath(ctx, x, y, w, h, r);
    ctx.clip();
    drawCover(ctx, selfie, x, y, w, h);
    ctx.restore();
  }

  // Group name, top left. Any flags, top right.
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  pill(ctx, String(log.group_name || 'Accountability Bros').toUpperCase(), 40, 40, { bg: BAND, fg: TEXT, font: '700 26px "Inter", system-ui, sans-serif' });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  let flagY = 40;
  if (log.flag_short) {
    pill(ctx, `Under the ${log.min_physical_minutes} min minimum`, W - 40, flagY, { bg: FLAG, fg: TEXT, font: '700 26px "Inter", system-ui, sans-serif', alignRight: true });
    flagY += 64;
  }
  if (log.flag_same_day) {
    pill(ctx, 'Second of the same today', W - 40, flagY, { bg: FLAG, fg: TEXT, font: '700 26px "Inter", system-ui, sans-serif', alignRight: true });
  }

  // The band.
  ctx.fillStyle = BAND;
  ctx.fillRect(0, photoH, W, BAND_H);
  ctx.fillStyle = POP;
  ctx.fillRect(0, photoH, W, 8);

  const tally = `${log.done}/${log.total}`;
  ctx.font = '700 176px "Space Grotesk", "Inter", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = POP;
  ctx.fillText(tally, W - 52, H - 62);
  const tallyW = ctx.measureText(tally).width;
  const leftMax = W - 52 - tallyW - 52 - 40;

  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.font = '700 30px "Inter", system-ui, sans-serif';
  ctx.fillStyle = TEXT_2;
  ctx.fillText(fitText(ctx, `${log.nickname} · ${log.activity}`.toUpperCase(), leftMax), 52, photoH + 84);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  const duration = fmtDuration(log.duration_min);
  let size = 96;
  do {
    ctx.font = `700 ${size}px "Space Grotesk", "Inter", system-ui, sans-serif`;
    size -= 4;
  } while (ctx.measureText(duration).width > leftMax && size > 48);
  ctx.fillStyle = TEXT;
  ctx.fillText(duration, 52, photoH + 190);

  ctx.font = '500 34px "Inter", system-ui, sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText(fitText(ctx, fmtStamp(log.logged_at, log.timezone), leftMax), 52, photoH + 250);

  return toJpeg(canvas, 0.9);
}

function hexA(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Photo-first versions of the stamp: the photo fills a 3:4 frame (the shape a
// phone takes in portrait) and the details sit over the bottom of it.
//   glass - see-through dark bar      fade - no bar, the photo darkens at the bottom
//   light - see-through white bar     chip - a small white card in the corner
// Reading order by size: tally, name, activity, duration, date and time, group name.
async function makeOverlayStamp(photoBlob, log, selfieBlob, layout) {
  const W = 1080;
  const H = 1440;
  const c = stampColours();
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const accent = token('--accent', '#2F5233');
  const ink = token('--text', '#18211B');
  const ink2 = token('--text-2', '#465047');
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

  if (layout === 'chip') {
    const pad = 30;
    const cardH = 184;
    ctx.font = `700 116px ${DISPLAY}`;
    const tallyW = ctx.measureText(tally).width;
    const textMax = W - 80 - pad * 3 - tallyW - 34;
    ctx.font = `700 46px ${DISPLAY}`;
    const nameText = fitText(ctx, log.nickname, textMax);
    const nameW = ctx.measureText(nameText).width;
    ctx.font = `400 32px ${BODY}`;
    const lineW = ctx.measureText(`${log.activity} · ${duration}`).width + 8;
    ctx.font = `500 25px ${BODY}`;
    const whenW = ctx.measureText(when).width;
    const textW = Math.min(textMax, Math.max(nameW, lineW, whenW));
    const cardW = pad + tallyW + pad + 34 + textW + pad;
    const x = 40;
    const y = H - 40 - cardH;
    roundedPath(ctx, x, y, cardW, cardH, 36);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = `700 116px ${DISPLAY}`;
    ctx.fillStyle = accent;
    ctx.fillText(tally, x + pad, y + 128);
    ctx.fillStyle = hexA(ink, 0.16);
    ctx.fillRect(x + pad + tallyW + pad, y + 34, 3, cardH - 68);
    const tx = x + pad + tallyW + pad + 34;
    ctx.font = `700 46px ${DISPLAY}`;
    ctx.fillStyle = ink;
    ctx.fillText(nameText, tx, y + 68);
    activityLine(tx, y + 114, 32, textW, ink, ink2);
    ctx.font = `500 25px ${BODY}`;
    ctx.fillStyle = ink2;
    ctx.fillText(fitText(ctx, when, textW), tx, y + 154);
    return toJpeg(canvas, 0.9);
  }

  const BAR = 236;
  const top = H - BAR;
  let strong = '#FFFFFF';
  let soft = 'rgba(255, 255, 255, 0.88)';
  let quiet = 'rgba(255, 255, 255, 0.74)';
  let tallyColour = '#FFFFFF';
  if (layout === 'glass') {
    ctx.fillStyle = hexA(c.BAND, 0.6);
    ctx.fillRect(0, top, W, BAR);
  } else if (layout === 'fade') {
    const g = ctx.createLinearGradient(0, H - 620, 0, H);
    g.addColorStop(0, 'rgba(10, 18, 12, 0)');
    g.addColorStop(0.55, 'rgba(10, 18, 12, 0.5)');
    g.addColorStop(1, 'rgba(10, 18, 12, 0.86)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - 620, W, 620);
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.fillRect(0, top, W, BAR);
    strong = ink;
    soft = ink2;
    quiet = ink2;
    tallyColour = accent;
  }

  ctx.textAlign = 'right';
  ctx.font = `700 172px ${DISPLAY}`;
  ctx.fillStyle = tallyColour;
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
