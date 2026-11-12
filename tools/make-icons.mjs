// Draws the home-screen icons into public/. Run with: node tools/make-icons.mjs
// Pass a logo name to switch: node tools/make-icons.mjs tally | seal | dumbbell
// Pass "sheet <file.png>" to draw all the options side by side for comparison.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const NAVY = '#0B1430';
const GOLD = '#F2C230';
const WHITE = '#F3F5FB';

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
  // A stamp of approval: ring and tick.
  seal: `
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="256" cy="256" r="150" stroke="${GOLD}" stroke-width="36"/>
      <path d="M186 262l50 52 94-112" stroke="${WHITE}" stroke-width="44"/>
    </g>`,
  // A dumbbell on the tilt.
  dumbbell: `
    <g transform="rotate(-35 256 256)">
      <rect x="170" y="238" width="172" height="36" rx="12" fill="${WHITE}"/>
      <rect x="128" y="172" width="50" height="168" rx="16" fill="${GOLD}"/>
      <rect x="334" y="172" width="50" height="168" rx="16" fill="${GOLD}"/>
      <rect x="88" y="204" width="34" height="104" rx="14" fill="${GOLD}"/>
      <rect x="390" y="204" width="34" height="104" rx="14" fill="${GOLD}"/>
    </g>`,
};

const svg = (name, size, radius = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${NAVY}"/>${LOGOS[name]}</svg>`;

const [mode = 'tally', outFile] = process.argv.slice(2);
const browser = await chromium.launch();

if (mode === 'sheet') {
  const names = Object.keys(LOGOS);
  const page = await browser.newPage({ viewport: { width: 80 + names.length * 300, height: 440 }, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;background:#20242c;font-family:sans-serif;color:#fff">
    <div style="display:flex;gap:60px;padding:50px 70px;align-items:flex-start">
      ${names.map((n, i) => `<div style="text-align:center">
        ${svg(n, 240, 112)}
        <div style="margin-top:16px;font-size:20px;font-weight:700">${'ABC'[i]}. ${n[0].toUpperCase()}${n.slice(1)}</div>
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
