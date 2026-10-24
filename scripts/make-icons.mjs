/**
 * Generates the PWA icon set from one SVG source.
 *   node scripts/make-icons.mjs
 *
 * Playwright is already a dev dependency for the e2e suite, so it doubles as
 * the rasterizer — no image tooling required.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const SIZES = [
  { name: 'icon-192', size: 192 },
  { name: 'icon-512', size: 512 },
  { name: 'apple-touch-icon', size: 180 },
];

/** The RSS glyph, shared by the app icon and the favicon. */
const glyph = (stroke, scale) => `
  <g transform="translate(60 60) scale(${scale}) translate(-12 -12)"
     fill="none" stroke="${stroke}" stroke-width="2.1" stroke-linecap="round">
    <circle cx="5" cy="19" r="1.6" fill="${stroke}" stroke="none" />
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
  </g>`;

const appIcon = (size, { maskable = false } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b84ff"/>
      <stop offset="1" stop-color="#3d5fe0"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="${maskable ? 0 : 26}" fill="url(#g)"/>
  ${glyph('#ffffff', maskable ? 3.4 : 4.2)}
</svg>`;

await mkdir('public/icons', { recursive: true });

const browser = await chromium.launch();
for (const { name, size } of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Maskable icons need the glyph inside the safe zone with a full-bleed background.
  await page.setContent(
    `<style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;overflow:hidden}</style>` +
      appIcon(size, { maskable: name === 'icon-512' })
  );
  await page.screenshot({ path: `public/icons/${name}.png` });
  await page.close();
  console.log(`wrote public/icons/${name}.png (${size}x${size})`);
}

await browser.close();

// Vector favicon for the tab / bookmarks bar.
await writeFile(
  'public/favicon.svg',
  appIcon(120).replace('viewBox="0 0 120 120"', 'viewBox="0 0 120 120"')
);
console.log('wrote public/favicon.svg');
