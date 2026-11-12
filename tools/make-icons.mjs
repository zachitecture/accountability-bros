// Draws the home-screen icons into public/. Run with: node tools/make-icons.mjs
// Pass a logo name to switch, e.g.: node tools/make-icons.mjs barbell
// Pass "sheet <file.png> [names...]" to draw options side by side for comparison.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const NAVY = '#0B1430';
const GOLD = '#F2C230';
const WHITE = '#F3F5FB';

function barbell(angle, strokes = GOLD, bar = WHITE) {
  return `
    <g stroke="${strokes}" stroke-width="34" stroke-linecap="round" fill="none">
      <path d="M178 150v212"/><path d="M230 150v212"/><path d="M282 150v212"/><path d="M334 150v212"/>
    </g>
    <g transform="rotate(${angle} 256 256)" stroke="${NAVY}" stroke-width="12" stroke-linejoin="round" paint-order="stroke" fill="${bar}">
      <rect x="96" y="243" width="320" height="26" rx="8"/>
      <rect x="96" y="204" width="28" height="104" rx="10"/>
      <rect x="388" y="204" width="28" height="104" rx="10"/>
      <rect x="66" y="221" width="24" height="70" rx="9"/>
      <rect x="422" y="221" width="24" height="70" rx="9"/>
    </g>`;
}

// A more adjustable version of the gentle-tilt barbell, for trying refinements.
//   strokes: [centre x, top y, bottom y, lean in degrees] for each tally stroke
//   plates:  [distance from centre to the plate's inner edge, width, height]
function tallyBar({ angle = -12, width = 34, strokes, barHalf = 160, barHeight = 26, plates }) {
  const marks = strokes.map(([x, top, bottom, lean = 0]) =>
    `<path d="M${x} ${top}V${bottom}" transform="rotate(${lean} ${x} 256)"/>`).join('');
  const ends = plates.map(([inner, w, h]) => `
      <rect x="${256 - inner - w}" y="${256 - h / 2}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2.8}"/>
      <rect x="${256 + inner}" y="${256 - h / 2}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2.8}"/>`).join('');
  return `
    <g stroke="${GOLD}" stroke-width="${width}" stroke-linecap="round" fill="none">${marks}</g>
    <g transform="rotate(${angle} 256 256)" stroke="${NAVY}" stroke-width="12" stroke-linejoin="round" paint-order="stroke" fill="${WHITE}">
      <rect x="${256 - barHalf}" y="${256 - barHeight / 2}" width="${barHalf * 2}" height="${barHeight}" rx="${barHeight / 3}"/>${ends}
    </g>`;
}
const EVEN = [[178, 150, 362], [230, 150, 362], [282, 150, 362], [334, 150, 362]];
const WIDE = [[172, 136, 376], [228, 136, 376], [284, 136, 376], [340, 136, 376]];

// Each logo is drawn on a 512 x 512 canvas and kept inside the middle 80%,
// so Android can crop it to a circle without cutting anything off.
export const LOGOS = {
  // Four strokes and a slash: the tally you keep through the week.
  tally: `
    <g stroke-linecap="round" fill="none">
      <g stroke="${GOLD}" stroke-width="40">
        <path d="M151 142v228"/><path d="M221 142v228"/><path d="M291 142v228"/><path d="M361 142v228"/>
      </g>
      <path d="M100 322L412 190" stroke="${WHITE}" stroke-width="40"/>
    </g>`,
  // Tally with a barbell as the strike: bar plus two plates at each end.
  // Variants differ in how steeply the barbell sits.
  barbell: barbell(-23),
  gentle: barbell(-12),
  level: barbell(0),
  // Refinements of the gentle tilt.
  bold: tallyBar({ width: 40, strokes: WIDE, barHalf: 164, barHeight: 32, plates: [[126, 32, 120], [164, 28, 80]] }),
  clean: tallyBar({ strokes: EVEN, barHalf: 186, plates: [[118, 32, 116]] }),
  handdrawn: tallyBar({
    strokes: [[178, 156, 366, -4], [230, 146, 358, 3], [282, 152, 370, -2], [334, 144, 360, 4]],
    plates: [[132, 28, 104], [166, 24, 70]],
  }),
  boldclean: tallyBar({ width: 40, strokes: WIDE, barHalf: 190, barHeight: 32, plates: [[124, 38, 128]] }),
  // Same idea with the colours swapped: white strokes, gold barbell.
  goldbar: barbell(-12, WHITE, GOLD),
  // A level barbell whose four plates are the tally strokes: short, tall, tall, short.
  plates: `
    <g fill="${GOLD}">
      <rect x="128" y="181" width="40" height="150" rx="16"/>
      <rect x="200" y="144" width="40" height="224" rx="16"/>
      <rect x="272" y="144" width="40" height="224" rx="16"/>
      <rect x="344" y="181" width="40" height="150" rx="16"/>
    </g>
    <rect x="72" y="242" width="368" height="28" rx="10" fill="${WHITE}" stroke="${NAVY}" stroke-width="12" paint-order="stroke"/>`,
  // Tally with a chunky dumbbell as the strike: one heavy head at each end.
  dumbbell: `
    <g stroke="${GOLD}" stroke-width="34" stroke-linecap="round" fill="none">
      <path d="M178 150v212"/><path d="M230 150v212"/><path d="M282 150v212"/><path d="M334 150v212"/>
    </g>
    <g transform="rotate(-23 256 256)" stroke="${NAVY}" stroke-width="12" stroke-linejoin="round" paint-order="stroke">
      <rect x="110" y="242" width="292" height="28" rx="8" fill="${WHITE}"/>
      <rect x="70" y="210" width="58" height="92" rx="20" fill="${WHITE}"/>
      <rect x="384" y="210" width="58" height="92" rx="20" fill="${WHITE}"/>
    </g>`,
  // Tally with a heartbeat as the strike.
  pulse: `
    <g stroke="${GOLD}" stroke-width="36" stroke-linecap="round" fill="none">
      <path d="M163 146v220"/><path d="M225 146v220"/><path d="M287 146v220"/><path d="M349 146v220"/>
    </g>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-8 256 256)">
      <path d="M84 262H156L196 172L254 352L312 222L336 262H428" stroke="${NAVY}" stroke-width="46"/>
      <path d="M84 262H156L196 172L254 352L312 222L336 262H428" stroke="${WHITE}" stroke-width="26"/>
    </g>`,
  // Each tally stroke is an upright dumbbell, with a plain strike.
  uprights: `
    <g fill="${GOLD}">
      ${[160, 224, 288, 352].map((x) => `
        <rect x="${x - 11}" y="160" width="22" height="192" rx="8"/>
        <rect x="${x - 25}" y="142" width="50" height="46" rx="14"/>
        <rect x="${x - 25}" y="324" width="50" height="46" rx="14"/>`).join('')}
    </g>
    <g fill="none" stroke-linecap="round">
      <path d="M96 320L416 192" stroke="${NAVY}" stroke-width="54"/>
      <path d="M96 320L416 192" stroke="${WHITE}" stroke-width="32"/>
    </g>`,
  // A stamp of approval: ring and tick.
  seal: `
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="256" cy="256" r="150" stroke="${GOLD}" stroke-width="36"/>
      <path d="M186 262l50 52 94-112" stroke="${WHITE}" stroke-width="44"/>
    </g>`,
};

const svg = (name, size, radius = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${NAVY}"/>${LOGOS[name]}</svg>`;

const [mode = 'tally', outFile, ...pick] = process.argv.slice(2);
const browser = await chromium.launch();

if (mode === 'sheet') {
  const names = pick.length ? pick : Object.keys(LOGOS);
  const page = await browser.newPage({ viewport: { width: 80 + names.length * 300, height: 440 }, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;background:#20242c;font-family:sans-serif;color:#fff">
    <div style="display:flex;gap:60px;padding:50px 70px;align-items:flex-start">
      ${names.map((n, i) => `<div style="text-align:center">
        ${svg(n, 240, 112)}
        <div style="margin-top:16px;font-size:20px;font-weight:700">${i + 1}. ${n[0].toUpperCase()}${n.slice(1)}</div>
        <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;align-items:center">${svg(n, 60, 112)}<span style="font-size:13px;color:#aab">home screen size</span></div>
      </div>`).join('')}
    </div></body>`);
  await page.screenshot({ path: outFile });
} else {
  if (!LOGOS[mode]) throw new Error(`unknown logo "${mode}"`);
  for (const [file, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<body style="margin:0">${svg(mode, size)}</body>`);
    await page.screenshot({ path: join(root, 'public', file), clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
  console.log(`icons written to public/ using the "${mode}" logo`);
}
await browser.close();
