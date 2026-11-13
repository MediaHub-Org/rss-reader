/** Run against a production preview: BASE_URL=http://localhost:4173 node scripts/verify-startup.mjs */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:4173';
const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const themeScript = await readFile(new URL('../public/theme-init.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: process.argv.includes('--headless') });
const cases = [
  { name: 'saved dark on a light system', system: 'light', prefs: '{"theme":"dark"}', expected: 'dark' },
  { name: 'saved light on a dark system', system: 'dark', prefs: '{"theme":"light"}', expected: 'light' },
  { name: 'system dark', system: 'dark', prefs: null, expected: 'dark' },
  { name: 'system light', system: 'light', prefs: null, expected: 'light' },
  { name: 'damaged preferences', system: 'dark', prefs: '{broken', expected: 'dark' },
  { name: 'blocked storage', system: 'dark', blocked: true, expected: 'dark' },
];

try {
  for (const test of cases) {
    const context = await browser.newContext({ colorScheme: test.system, serviceWorkers: 'block' });
    await context.addInitScript(({ prefs, blocked }) => {
      if (prefs) localStorage.setItem('rss-reader:prefs', prefs);
      if (blocked) Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); };
    }, test);
    // Apply the desktop CSP and hold back the app's JS/CSS. The initial
    // surface must already match the theme without help from React.
    // Serve the exact build bytes to avoid local filtering software injecting
    // scripts ahead of the startup code being tested.
    await context.route(base + '/', (route) => route.fulfill({
      body: html, contentType: 'text/html', headers: { 'Content-Security-Policy': config.app.security.csp },
    }));
    await context.route('**/theme-init.js', (route) => route.fulfill({
      body: themeScript, contentType: 'text/javascript',
    }));
    let release;
    const assetsReady = new Promise((resolve) => { release = resolve; });
    await context.route('**/assets/**', async (route) => {
      await assetsReady;
      await route.continue();
    });
    const page = await context.newPage();
    try {
      await page.goto(base, { waitUntil: 'commit' });
      await page.waitForFunction(() => Boolean(document.documentElement.dataset.theme));
      const early = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        background: getComputedStyle(document.documentElement).backgroundColor,
        appMounted: Boolean(document.querySelector('.app')),
      }));
      assert.equal(early.theme, test.expected);
      assert.equal(early.background, test.expected === 'dark' ? 'rgb(14, 16, 20)' : 'rgb(246, 247, 249)');
      assert.equal(early.appMounted, false);
      release();
      await page.waitForSelector('.app');
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), test.expected);
      console.log(`PASS  Correct surface before and after startup: ${test.name}`);
    } finally {
      release();
      await context.close();
    }
  }
} finally {
  await browser.close();
}
