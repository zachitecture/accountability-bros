// Photo handling: shrink what the camera gives us, and draw the stamped image.
import { fmtDuration, fmtStamp } from './format.js';

// The stamp keeps a dark band so it stands out on any photo in the chat.
const BAND = '#1F3326';
const POP = '#F0683F'; // tally and top rule
const TEXT = '#F6F5F0';
const TEXT_2 = '#CBD5C7';
const MUTED = '#A5B2A1';
const FLAG = '#C9431F';

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
export async function makeStamp(photoBlob, log, selfieBlob = null) {
  const W = 1080;
  const H = 1350;
  const BAND_H = 310;
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
