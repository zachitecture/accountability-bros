// Draws the home-screen icons into public/. Run with: node tools/make-icons.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = readFileSync(join(root, 'node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2')).toString('base64');

const html = (size) => `<!doctype html><html><head><style>
@font-face { font-family: SG; font-weight: 700; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; }
.icon { width: ${size}px; height: ${size}px; background: #0B1430; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${size * 0.035}px; }
.ab { font-family: SG, sans-serif; font-weight: 700; font-size: ${size * 0.44}px; line-height: 0.9; color: #F2C230; letter-spacing: -0.02em; }
.bar { width: ${size * 0.5}px; height: ${size * 0.045}px; border-radius: ${size * 0.03}px; background: #F3F5FB; }
</style></head><body><div class="icon"><div class="ab">AB</div><div class="bar"></div></div></body></html>`;

const browser = await chromium.launch();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html(size));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, 'public', name), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
await browser.close();
console.log('icons written to public/');
