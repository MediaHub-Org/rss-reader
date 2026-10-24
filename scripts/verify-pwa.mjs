/**
 * Verifies the app is installable as a PWA and works offline.
 *   npm run build && npm run preview   (port 4173)
 *   node scripts/verify-pwa.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.empty-state, .article-list', { timeout: 15_000 });
  check('Production app boots', true);

  /* ------------------------------ manifest ----------------------------- */
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  check('Manifest linked from the document', Boolean(manifestHref), manifestHref || '');

  const manifestResponse = await page.request.get(new URL(manifestHref, BASE).toString());
  check('Manifest is served', manifestResponse.ok(), String(manifestResponse.status()));
  const manifest = await manifestResponse.json();

  check('Manifest declares name and start_url', Boolean(manifest.name && manifest.start_url), manifest.start_url);
  check('Manifest display mode', manifest.display === 'standalone', manifest.display);
  const sizes = (manifest.icons || []).map((i) => i.sizes).join(',');
  check('Manifest has 192 + 512 icons', /192x192/.test(sizes) && /512x512/.test(sizes), sizes);

  for (const icon of manifest.icons || []) {
    const res = await page.request.get(new URL(icon.src, BASE).toString());
    if (!res.ok()) check(`Icon reachable: ${icon.src}`, false, String(res.status()));
  }
  const iconStatus = await page.request.get(new URL(manifest.icons[0].src, BASE).toString());
  check('Icon assets are reachable', iconStatus.ok());

  const favicon = await page.request.get(new URL('./favicon.svg', BASE).toString());
  check('Favicon served', favicon.ok());

  /* --------------------------- installability --------------------------- */
  // Headless Chromium never fires beforeinstallprompt (there is no install UI),
  // so ask the browser directly — this is what DevTools reports.
  const cdp = await context.newCDPSession(page);
  const manifestReport = await cdp.send('Page.getAppManifest');
  check(
    'Manifest parses without errors',
    (manifestReport.errors || []).length === 0,
    JSON.stringify(manifestReport.errors || []).slice(0, 200)
  );
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  check(
    'Chromium reports the app installable',
    installabilityErrors.length === 0,
    JSON.stringify(installabilityErrors).slice(0, 300)
  );

  /* --------------------------- service worker -------------------------- */
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return {
      scope: reg.scope,
      script: reg.active?.scriptURL ?? null,
      controlled: Boolean(navigator.serviceWorker.controller),
    };
  });
  check('Service worker registered and active', Boolean(swState.script), swState.script || '');
  check('Page controlled by the service worker', swState.controlled, swState.scope || '');

  const shellCached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  check('App shell precached', shellCached.some((p) => p === '/' || p.endsWith('index.html')), shellCached.join(', '));
  check('Feed proxy excluded from the cache', !shellCached.some((p) => p.endsWith('/proxy')));

  /* -------------------------------- offline ---------------------------- */
  await page.waitForTimeout(800); // let the first controlled load settle
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.empty-state, .article-list', { timeout: 15_000 });
  check('App still boots with the network offline', true);

  const offlineHtml = await page.innerHTML('#main-content');
  check('Shell CSS/JS served from cache offline', /class="(?:list|empty-state)/.test(offlineHtml));

  await page.screenshot({ path: 'test-artifacts/06-offline.png' });
  await context.setOffline(false);
} catch (error) {
  check('Verification completed without throwing', false, String(error).slice(0, 300));
  await page.screenshot({ path: 'test-artifacts/99-pwa-failure.png' }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('Failed:');
  for (const f of failed) console.log(`  - ${f.name}`);
}
process.exit(failed.length ? 1 : 0);
