/**
 * End-to-end smoke test against the running dev server.
 *   1. start the app:  npm run dev
 *   2. run:            node scripts/e2e.mjs
 *
 * Covers: subscribe/validate, parsing, list + detail rendering, sanitization,
 * read state, sorting, theme/density/font settings, OPML export → import,
 * YouTube detection (link and embed modes), and keyboard navigation.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SHOTS = path.resolve('test-artifacts');
await mkdir(SHOTS, { recursive: true });

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

try {
  /* ------------------------------- boot -------------------------------- */
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.empty-state', { timeout: 15_000 });
  check('App boots to empty state', true);
  check(
    'Initial theme attribute set before paint',
    ['light', 'dark'].includes(await page.evaluate(() => document.documentElement.dataset.theme))
  );

  /* ----------------------------- subscribe ------------------------------ */
  await page.click('.empty-state .button--primary');
  await page.waitForSelector('[role="dialog"]');
  await page.fill('[role="dialog"] input.input', 'not a url');
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  const invalidMsg = await page.textContent('[role="dialog"] .field__error');
  check('Invalid URL rejected with a message', /valid url|http|spaces|enter a feed/i.test(invalidMsg || ''), invalidMsg?.trim());

  await page.fill('[role="dialog"] input.input', 'https://www.theverge.com/rss/index.xml');
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  await page.waitForSelector('.article-row', { timeout: 30_000 });
  const rowCount = await page.locator('.article-row').count();
  check('Feed parsed and articles rendered', rowCount > 5, `${rowCount} rows`);

  /* second feed */
  await page.click('.sidebar__cta');
  await page.fill('[role="dialog"] input.input', 'https://feeds.bbci.co.uk/news/rss.xml');
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  await page.waitForFunction(
    () => document.querySelectorAll('.sidebar .feed-item').length >= 2,
    undefined,
    { timeout: 30_000 }
  );
  const feeds = await page.locator('.sidebar .feed-item').count();
  check('Second feed added', feeds === 2, `${feeds} feeds`);

  /* homepage discovery (no direct feed URL) */
  await page.click('.sidebar__cta');
  await page.fill('[role="dialog"] input.input', 'https://www.nasa.gov');
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  await page.waitForTimeout(6000);
  const nasaAdded = (await page.locator('.sidebar .feed-item').count()) === 3;
  check('Feed discovered from a homepage URL', nasaAdded);
  if (!nasaAdded) {
    const err = await page.locator('[role="dialog"] .field__error').first().textContent().catch(() => '');
    console.log('       discovery error:', (err || '').trim());
    await page.keyboard.press('Escape');
  }

  /* --------------------------- article detail -------------------------- */
  await page.click('.article-row >> nth=0');
  await page.waitForSelector('.detail .content');
  const html = await page.innerHTML('.detail .content');
  check('Article content rendered', html.trim().length > 100, `${html.length} chars`);
  check('No <script> injected from feed HTML', !/<script/i.test(html));
  check('No inline event handlers survive sanitization', !/\son(error|click|load|mouseover)=/i.test(html));

  const links = await page.$$eval('.detail .content a[href]', (nodes) =>
    nodes.map((n) => n.getAttribute('href'))
  );
  check(
    'External links forced to new tab with rel',
    await page.$$eval('.detail .content a[target="_blank"]', (n) => n.length) ===
      (await page.$$eval('.detail .content a[href^="http"]', (n) => n.length)) &&
      links.every((h) => !h?.startsWith('javascript:')),
    `${links.length} links`
  );

  await page.screenshot({ path: path.join(SHOTS, '01-detail-light.png'), fullPage: false });

  /* read state — opening the article already marked it read */
  await page.click('.detail .ghost-button:has-text("Back")');
  await page.waitForSelector('.article-list');
  const firstRowRead = await page.getAttribute('.article-row >> nth=0', 'class');
  check('Read state reflected in list', /is-read/.test(firstRowRead || ''), firstRowRead);

  /* --------------------------- sorting/search -------------------------- */
  await page.selectOption('.select', 'date-asc');
  const dates = await page.$$eval('.article-row time', (nodes) =>
    nodes.map((n) => new Date(n.dateTime).getTime())
  );
  const ascending = dates.every((v, i) => i === 0 || dates[i - 1] <= v);
  check('Sort by oldest works', ascending, `${dates.length} dates`);

  await page.selectOption('.select', 'feed');
  await page.fill('.search__input', 'zzzzz-no-match-zzzzz');
  const noMatch = await page.textContent('.empty-state h2').catch(() => '');
  check('Search shows empty state for no matches', /No matches/i.test(noMatch || ''), noMatch?.trim());
  await page.fill('.search__input', '');
  await page.selectOption('.select', 'date-desc');

  /* ------------------------- theme + settings -------------------------- */
  const before = await page.getAttribute('html', 'data-theme');
  await page.click('.topbar__tools .icon-button[aria-label*="theme" i]');
  const after = await page.getAttribute('html', 'data-theme');
  check('Theme toggle flips data-theme', before !== after, `${before} → ${after}`);

  await page.click('.sidebar__actions .ghost-button:has-text("Settings")');
  await page.waitForSelector('[role="dialog"]');
  await page.click('[role="dialog"] .segmented__option:has-text("Compact")');
  await page.click('[role="dialog"] .segmented__option:has-text("Large")');
  const density = await page.getAttribute('html', 'data-density');
  const fontSize = await page.getAttribute('html', 'data-font-size');
  check('Density preference applied', density === 'compact', density || '');
  check('Font size preference applied', fontSize === 'large', fontSize || '');

  /* YouTube embed switch on */
  await page.click('[role="dialog"] .switch[aria-label*="Embed YouTube" i]');
  const embedOn = await page.getAttribute('[role="dialog"] .switch[aria-label*="Embed YouTube" i]', 'aria-checked');
  check('Embed toggle persists to aria-checked', embedOn === 'true', embedOn || '');
  await page.keyboard.press('Escape');

  /* preferences survive reload */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.article-list, .empty-state');
  const persistedTheme = await page.getAttribute('html', 'data-theme');
  const persistedDensity = await page.getAttribute('html', 'data-density');
  check('Theme persisted across reload', persistedTheme === after, persistedTheme || '');
  check('Density persisted across reload', persistedDensity === 'compact', persistedDensity || '');
  await page.screenshot({ path: path.join(SHOTS, '02-dark-compact.png') });

  /* --------------------------- OPML export ----------------------------- */
  await page.click('.sidebar__actions .ghost-button:has-text("Export")');
  await page.waitForSelector('[role="tabpanel"][id="panel-export"]');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[role="tabpanel"] .button--primary'),
  ]);
  const opmlPath = path.join(SHOTS, 'export.opml');
  await download.saveAs(opmlPath);
  const opml = await readFile(opmlPath, 'utf8');
  check('OPML export is valid XML with outlines', /<opml[\s>]/.test(opml) && (opml.match(/<outline/g) || []).length >= 2, download.suggestedFilename());
  check('OPML export escapes safely', !/<outline[^>]*&(?!amp;|lt;|gt;|quot;|apos;)/.test(opml));
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  /* --------------------------- OPML import ----------------------------- */
  const feedsBeforeImport = await page.locator('.sidebar .feed-item').count();
  await page.click('.sidebar__actions .ghost-button:has-text("Import")');
  await page.waitForSelector('[role="dialog"] [role="tabpanel"]');
  const importPath = path.join(SHOTS, 'import.opml');
  const incomingUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA';
  await writeFile(
    importPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>t</title></head><body>
  <outline type="rss" text="Duplicate" xmlUrl="https://www.theverge.com/rss/index.xml"/>
  <outline type="rss" text="Fireship" xmlUrl="${incomingUrl}"/>
  <outline type="rss" text="Bad" xmlUrl="javascript:alert(1)"/>
</body></opml>`
  );
  await page.setInputFiles('.file-input', importPath);
  await page.waitForSelector('.import-preview__summary');
  const summary = await page.textContent('.import-preview__summary');
  check('Import preview counts valid entries', /2 feeds found/.test(summary || ''), summary?.replace(/\s+/g, ' ').trim());
  check('Import flags invalid javascript: URL', (await page.$('.import-preview__warnings')) !== null);
  await page.click('.button--primary:has-text("Import")');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.sidebar .feed-item').length === expected,
    feedsBeforeImport + 1,
    { timeout: 30_000 }
  );
  check('Imported feed appears (duplicates skipped)', true, `${await page.locator('.sidebar .feed-item').count()} feeds`);

  /* duplicate re-import reports skipped */
  await page.click('.sidebar__actions .ghost-button:has-text("Import")');
  await page.setInputFiles('.file-input', importPath);
  await page.waitForSelector('.import-preview__summary');
  await page.click('.button--primary:has-text("Import")');
  await page.waitForSelector('.toast');
  await page.waitForTimeout(300);
  const toastText = await page.locator('.toast').last().textContent();
  check('Duplicate import handled gracefully', /skipped|Nothing to import/i.test(toastText || ''), toastText?.trim());
  await page.keyboard.press('Escape');

  /* ---------------------------- YouTube ------------------------------- */
  await page.click('.feed-row:has-text("Fireship")');
  await page.waitForSelector('.article-row');
  const videoChips = await page.locator('.chip--video').count();
  check('YouTube references detected in feed items', videoChips > 0, `${videoChips} video chips`);

  await page.click('.article-row >> nth=0');
  await page.waitForSelector('.detail');
  const embedVisible = (await page.$('.video-card__frame iframe')) !== null;
  const linkVisible = (await page.$('.video-card__link')) !== null;
  check('YouTube player behavior (embed vs link)', embedVisible || linkVisible, `embed=${embedVisible} link=${linkVisible}`);

  if (embedVisible) {
    const src = await page.getAttribute('.video-card__frame iframe', 'src');
    check('Embed uses youtube-nocookie', /youtube-nocookie\.com\/embed\/[\w-]{11}/.test(src || ''), src || '');
  }

  /* link mode after disabling the setting */
  await page.click('.detail .ghost-button:has-text("Back")');
  await page.click('.sidebar__actions .ghost-button:has-text("Settings")');
  await page.click('[role="dialog"] .switch[aria-label*="Embed YouTube" i]');
  await page.keyboard.press('Escape');
  await page.click('.article-row >> nth=0');
  await page.waitForSelector('.detail');
  const linkHref = await page.getAttribute('.video-card__link', 'href');
  check('Fallback link opens youtube.com/watch', /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(linkHref || ''), linkHref || '');
  await page.screenshot({ path: path.join(SHOTS, '03-video-link.png') });
  await page.click('.detail .ghost-button:has-text("Back")');

  /* --------------------------- keyboard nav ---------------------------- */
  await page.click('.feed-row:has-text("All articles")');
  await page.waitForSelector('.article-row');
  await page.locator('.article-row').first().focus();
  await page.keyboard.press('j');
  await page.waitForSelector('.detail');
  check('Keyboard j opens an article', true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.article-list');
  check('Escape returns to list', true);

  await page.keyboard.press('/');
  const focused = await page.evaluate(() => document.activeElement?.className);
  check('Slash focuses search', /search__input/.test(focused || ''), focused || '');
  await page.keyboard.press('Escape');

  /* --------------------------- bulk actions ---------------------------- */
  const unreadBefore = await page.textContent('.topbar__meta');
  await page.click('.topbar__tools .icon-button[aria-label*="Mark all visible"]');
  const unreadAfter = await page.textContent('.topbar__meta');
  check('Bulk mark-as-read updates counts', unreadBefore !== unreadAfter, `${unreadBefore?.trim()} → ${unreadAfter?.trim()}`);

  /* ---------------------- unsubscribe confirmation --------------------- */
  const feedsBeforeRemove = await page.locator('.sidebar .feed-item').count();
  const targetItem = page.locator('.sidebar .feed-item').nth(1);
  await targetItem.hover();
  await targetItem.locator('.feed-row__remove').click();
  await page.waitForSelector('[role="dialog"]:has-text("Unsubscribe")');
  check('Unsubscribe asks for confirmation', true);
  await page.click('[role="dialog"] .button--danger');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.sidebar .feed-item').length === expected,
    feedsBeforeRemove - 1,
    { timeout: 5000 }
  );
  check('Feed removed after confirming', true, `${feedsBeforeRemove - 1} feeds left`);

  await page.screenshot({ path: path.join(SHOTS, '04-final.png') });

  /* ------------------------------ mobile ------------------------------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const menuVisible = await page.isVisible('.topbar__menu');
  check('Mobile menu button appears', menuVisible);
  await page.click('.topbar__menu');
  await page.waitForTimeout(400);
  const sidebarOpen = await page.getAttribute('.app', 'data-sidebar-open');
  check('Mobile drawer opens', sidebarOpen === 'true', sidebarOpen || '');
  await page.screenshot({ path: path.join(SHOTS, '05-mobile.png') });

  /* ---------------------------- console noise -------------------------- */
  // Direct-first fetching always logs a CORS refusal before the proxy hop, and
  // favicon misses are cosmetic — neither is an application error.
  const relevantErrors = consoleErrors.filter(
    (e) => !/favicon|Failed to load resource|net::ERR|CORS policy|404|419/.test(e)
  );
  check('No unexpected console errors', relevantErrors.length === 0, relevantErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('Script completed without throwing', false, String(error).slice(0, 300));
  await page.screenshot({ path: path.join(SHOTS, '99-failure.png') }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('Failed:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
}
process.exit(failed.length ? 1 : 0);
