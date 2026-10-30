/**
 * End-to-end smoke test against the running dev server.
 *   1. start the app:  npm run dev
 *   2. run:            node scripts/e2e.mjs
 *
 * Feeds come from `public/fixtures/` (same origin), so the run is hermetic:
 * no proxy hop, no third-party uptime, no rate limits.
 *
 * Covers: subscribe/validate, parsing, list + detail rendering, sanitization,
 * read state, sorting, theme/density/font settings, OPML export → import,
 * YouTube detection (link and embed modes), folders/context menus, and
 * keyboard navigation.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
/**
 * Feeds served from `public/fixtures/` instead of the live internet. They are
 * same-origin, so they exercise the real fetch/parse/render path with no
 * proxy hop and no third-party uptime in the loop — the suite stays
 * deterministic even on a locked-down network.
 */
const fixture = (name) => `${BASE}/fixtures/${name}`;
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

/**
 * Settings is reached from the top bar now (the old sidebar footer is gone);
 * Import/Export/Manage live in Settings → Data.
 */
async function openSettings(section) {
  await page.click('.topbar__tools .icon-button[aria-label="Settings"]');
  await page.waitForSelector('[role="dialog"]');
  if (section) await page.click(`.settings-nav__item:has-text("${section}")`);
}

async function openDataTab(action) {
  await openSettings('Data');
  await page.click(`.settings-data-actions .button:has-text("${action}")`);
  await page.waitForSelector('[role="dialog"]:has-text("Subscriptions")');
}

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

  await page.fill('[role="dialog"] input.input', fixture('news.xml'));
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  await page.waitForSelector('.article-card', { timeout: 30_000 });
  const rowCount = await page.locator('.article-card').count();
  check('Feed parsed and articles rendered', rowCount > 5, `${rowCount} rows`);

  /* second feed */
  await page.click('.sidebar__toolbar button[aria-label="New feed"]');
  await page.fill('[role="dialog"] input.input', fixture('bbc.xml'));
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  await page.waitForFunction(
    () => document.querySelectorAll('.sidebar .feed-item').length >= 2,
    undefined,
    { timeout: 30_000 }
  );
  const feeds = await page.locator('.sidebar .feed-item').count();
  check('Second feed added', feeds === 2, `${feeds} feeds`);

  /* homepage discovery (no direct feed URL) */
  await page.click('.sidebar__toolbar button[aria-label="New feed"]');
  await page.fill('[role="dialog"] input.input', fixture('site.html'));
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  const discoveredAdded = await page
    .waitForFunction(
      () => document.querySelectorAll('.sidebar .feed-item').length === 3,
      undefined,
      { timeout: 15_000 }
    )
    .then(() => true)
    .catch(() => false);
  check('Feed discovered from a homepage URL', discoveredAdded);
  if (!discoveredAdded) {
    const err = await page.locator('[role="dialog"] .field__error').first().textContent().catch(() => '');
    console.log('       discovery error:', (err || '').trim());
    await page.keyboard.press('Escape');
  }

  /* --------------------------- article detail -------------------------- */
  await page.click('.article-card >> nth=0');
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

  /* link context menu inside sanitized article HTML */
  await page.locator('.detail .content a[href^="http"]').first().click({ button: 'right' });
  await page.waitForSelector('.context-menu');
  const linkMenu = await page.textContent('.context-menu');
  check('Article link context menu offers link actions', /Copy link address/i.test(linkMenu || ''), linkMenu?.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('Escape');
  await page.waitForSelector('.context-menu', { state: 'detached' });

  await page.screenshot({ path: path.join(SHOTS, '01-detail-light.png'), fullPage: false });

  /* read state — opening the article already marked it read */
  await page.click('.detail .ghost-button:has-text("Back")');
  await page.waitForSelector('.article-grid');
  const firstRowRead = await page.getAttribute('.article-card >> nth=0', 'class');
  check('Read state reflected in list', /is-read/.test(firstRowRead || ''), firstRowRead);

  /* card context menu (app actions, no browser menu) */
  await page.locator('.article-card').first().click({ button: 'right' });
  await page.waitForSelector('.context-menu');
  const cardMenu = await page.textContent('.context-menu');
  check('Article card context menu offers article actions', /Copy title/i.test(cardMenu || ''), cardMenu?.replace(/\s+/g, ' ').trim().slice(0, 80));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.context-menu', { state: 'detached' });

  /* --------------------------- sorting/search -------------------------- */
  // The sort control is a themed listbox (a native <select> renders an
  // OS-styled popup that ignores the CSS variables, so it can never match
  // light/dark). Drive it the way a user would: open, then pick.
  const pickSort = async (label) => {
    await page.click('.topbar__sort .dropdown__trigger');
    await page.waitForSelector('.dropdown__menu');
    await page.click(`.dropdown__option:has-text("${label}")`);
    await page.waitForSelector('.dropdown__menu', { state: 'detached' });
  };

  await page.click('.topbar__sort .dropdown__trigger');
  await page.waitForSelector('.dropdown__menu');
  await page.waitForTimeout(250); // let the open animation settle for the screenshot
  const menuTheme = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--panel');
    document.body.appendChild(probe);
    const panelBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const menu = document.querySelector('.dropdown__menu');
    return {
      menuBg: getComputedStyle(menu).backgroundColor,
      panelBg,
      shadow: getComputedStyle(menu).boxShadow,
      theme: document.documentElement.dataset.theme,
    };
  });
  await page.screenshot({ path: 'test-artifacts/05-sort-menu.png' });
  check(
    'Sort menu is themed to the panel color',
    menuTheme.menuBg === menuTheme.panelBg && menuTheme.shadow !== 'none',
    `${menuTheme.theme}: ${menuTheme.menuBg} vs ${menuTheme.panelBg}`
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dropdown__menu', { state: 'detached' });

  await pickSort('Oldest first');
  const dates = await page.$$eval('.article-card time', (nodes) =>
    nodes.map((n) => new Date(n.dateTime).getTime())
  );
  const ascending = dates.every((v, i) => i === 0 || dates[i - 1] <= v);
  check('Sort by oldest works', ascending, `${dates.length} dates`);

  await pickSort('By feed name');
  await page.fill('.search__input', 'zzzzz-no-match-zzzzz');
  const noMatch = await page.textContent('.empty-state h2').catch(() => '');
  check('Search shows empty state for no matches', /No matches/i.test(noMatch || ''), noMatch?.trim());
  await page.fill('.search__input', '');
  await pickSort('Newest first');

  /* ------------------------- theme + settings -------------------------- */
  const before = await page.getAttribute('html', 'data-theme');
  await page.click('.topbar__tools .icon-button[aria-label*="theme" i]');
  const after = await page.getAttribute('html', 'data-theme');
  check('Theme toggle flips data-theme', before !== after, `${before} → ${after}`);

  // The menu must follow the new theme, not keep the old one.
  await page.click('.topbar__sort .dropdown__trigger');
  await page.waitForSelector('.dropdown__menu');
  await page.waitForTimeout(250);
  const themedAfterToggle = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--panel');
    document.body.appendChild(probe);
    const panelBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const menu = document.querySelector('.dropdown__menu');
    return {
      menuBg: getComputedStyle(menu).backgroundColor,
      panelBg,
      text: getComputedStyle(menu).color,
      theme: document.documentElement.dataset.theme,
    };
  });
  await page.screenshot({ path: 'test-artifacts/05b-sort-menu-toggled.png' });
  await page.keyboard.press('Escape');
  check(
    'Sort menu restyles with the toggled theme',
    themedAfterToggle.menuBg === themedAfterToggle.panelBg,
    `${themedAfterToggle.theme}: ${themedAfterToggle.menuBg} vs ${themedAfterToggle.panelBg}`
  );

  await openSettings('Appearance');
  await page.click('[role="dialog"] .segmented__option:has-text("Compact")');
  await page.click('[role="dialog"] .segmented__option:has-text("Large")');
  const density = await page.getAttribute('html', 'data-density');
  const fontSize = await page.getAttribute('html', 'data-font-size');
  check('Density preference applied', density === 'compact', density || '');
  check('Font size preference applied', fontSize === 'large', fontSize || '');

  /* Inline-media switch defaults to true; toggle off and back on */
  await page.click('[role="dialog"] .settings-nav__item:has-text("General")');
  const mediaSwitch = '[role="dialog"] .switch[aria-label*="Play media" i]';
  const defaultEmbed = await page.getAttribute(mediaSwitch, 'aria-checked');
  await page.click(mediaSwitch);
  const toggledOff = await page.getAttribute(mediaSwitch, 'aria-checked');
  await page.click(mediaSwitch);
  const embedOn = await page.getAttribute(mediaSwitch, 'aria-checked');
  check('Inline media toggle defaults on and persists to aria-checked', defaultEmbed === 'true' && toggledOff === 'false' && embedOn === 'true', `${defaultEmbed} → ${toggledOff} → ${embedOn}`);
  await page.keyboard.press('Escape');

  /* preferences survive reload */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.article-grid, .empty-state');
  const persistedTheme = await page.getAttribute('html', 'data-theme');
  const persistedDensity = await page.getAttribute('html', 'data-density');
  check('Theme persisted across reload', persistedTheme === after, persistedTheme || '');
  check('Density persisted across reload', persistedDensity === 'compact', persistedDensity || '');
  await page.screenshot({ path: path.join(SHOTS, '02-dark-compact.png') });

  /* --------------------------- backups panel --------------------------- */
  await openSettings('Data');
  await page.click('.settings-data-actions .button:has-text("Backups")');
  await page.waitForSelector('[role="dialog"]:has-text("Backups")');
  const backupsNote = await page.textContent('[role="dialog"]:has-text("Backups")');
  check(
    'Backups dialog explains that snapshots are desktop-only',
    /desktop app/i.test(backupsNote || ''),
    backupsNote?.replace(/\s+/g, ' ').trim().slice(0, 80)
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  /* --------------------------- OPML export ----------------------------- */
  await openDataTab('Export');
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

  /* ----------------------- full backup (JSON v2) ------------------------ */
  const [backupDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("Export full backup")'),
  ]);
  const backupPath = path.join(SHOTS, 'full-backup.json');
  await backupDownload.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  const backedUpArticles = Object.values(backup.articles ?? {}).reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0
  );
  check(
    'Full backup carries feeds, read state, preferences and cached articles',
    backup.version === 2 &&
      backup.feeds.length >= 2 &&
      backedUpArticles > 0 &&
      Array.isArray(backup.readIds) &&
      Boolean(backup.preferences) &&
      !('youtubeApiKey' in (backup.preferences ?? {})),
    `${backup.feeds.length} feeds · ${backedUpArticles} articles · ${backup.readIds.length} read`
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  /* Restoring the same full backup merges the cache back without refetching */
  await openDataTab('Import');
  await page.waitForSelector('[role="dialog"] [role="tabpanel"]');
  await page.setInputFiles('.file-input', backupPath);
  await page.waitForSelector('.import-preview__summary');
  const backupSummary = (await page.textContent('.import-preview__summary'))?.replace(/\s+/g, ' ') ?? '';
  check(
    'Full backup preview mentions cached articles and preferences',
    /cached articles/.test(backupSummary) && /preferences/.test(backupSummary),
    backupSummary.trim()
  );
  await page.click('.import-preview__actions .button--primary');
  await page.waitForFunction(
    () => /cached article/i.test(document.querySelector('.toast')?.textContent || ''),
    undefined,
    { timeout: 10_000 }
  );
  const restoreToast = (await page.locator('.toast').last().textContent())?.trim() ?? '';
  check(
    'Full backup restore reports the cached articles',
    /cached article/i.test(restoreToast),
    restoreToast
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  /* --------------------------- OPML import ----------------------------- */
  const feedsBeforeImport = await page.locator('.sidebar .feed-item').count();
  await openDataTab('Import');
  await page.waitForSelector('[role="dialog"] [role="tabpanel"]');
  const importPath = path.join(SHOTS, 'import.opml');
  await writeFile(
    importPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>t</title></head><body>
  <outline text="Zebra Video" title="Zebra Video">
    <outline type="rss" text="Fireship" title="Fireship" xmlUrl="${fixture('video.xml')}"/>
  </outline>
  <outline text="Alpha Tech" title="Alpha Tech">
    <outline type="rss" text="Zeta Feed" title="Zeta Feed" xmlUrl="${fixture('zeta.xml')}"/>
    <outline type="rss" text="Alpha Feed" title="Alpha Feed" xmlUrl="${fixture('alpha.xml')}"/>
  </outline>
  <outline text="Empty Folder" title="Empty Folder"/>
  <outline type="rss" text="The Verge" title="The Verge" xmlUrl="${fixture('news.xml')}"/>
  <outline type="rss" text="Bad" xmlUrl="javascript:alert(1)"/>
</body></opml>`
  );
  await page.setInputFiles('.file-input', importPath);
  await page.waitForSelector('.import-preview__summary');
  const summary = await page.textContent('.import-preview__summary');
  check('Import preview counts valid entries and folders', /4 feeds found.*3 folders/i.test(summary || ''), summary?.replace(/\s+/g, ' ').trim());
  check('Import flags invalid javascript: URL', (await page.$('.import-preview__warnings')) !== null);
  await page.click('.button--primary:has-text("Import")');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.sidebar .feed-item').length === expected,
    feedsBeforeImport + 3,
    { timeout: 30_000 }
  );
  check('Imported feeds appear (duplicates skipped)', true, `${await page.locator('.sidebar .feed-item').count()} feeds`);

  const folderOrder = await page.$$eval('.sidebar .folder-row .feed-row__title', (nodes) =>
    nodes.map((n) => n.textContent?.trim() || '')
  );
  check(
    'Imported folders sorted A–Z in sidebar (including an empty one)',
    folderOrder.length === 3 &&
      folderOrder[0] === 'Alpha Tech' &&
      folderOrder[1] === 'Empty Folder' &&
      folderOrder[2] === 'Zebra Video',
    folderOrder.join(' → ')
  );

  const alphaFeedOrder = await page.locator('.sidebar .folder-group').first().locator('.feed-item .feed-row__title').allTextContents();
  check(
    'Links inside folder sorted A–Z',
    alphaFeedOrder.length === 2 && alphaFeedOrder[0].trim() === 'Alpha Feed' && alphaFeedOrder[1].trim() === 'Zeta Feed',
    alphaFeedOrder.map((t) => t.trim()).join(' → ')
  );

  /* duplicate re-import reports skipped */
  await openDataTab('Import');
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
  await page.waitForSelector('.article-card');
  const videoCards = await page.locator('.article-card--video').count();
  const thumbSrc = await page.getAttribute('.article-card--video .article-card__img >> nth=0', 'src');
  const hasPlayBadge = (await page.$('.article-card--video .article-card__play')) !== null;
  check(
    'YouTube cards render thumbnail + play badge',
    videoCards > 0 && /i\.ytimg\.com\/vi\/[\w-]{11}\//.test(thumbSrc || '') && hasPlayBadge,
    `${videoCards} video cards · ${thumbSrc || ''}`
  );

  await page.click('.article-card >> nth=0');
  await page.waitForSelector('.detail');
  const embedVisible = (await page.$('.media-card__frame iframe')) !== null;
  const linkVisible = (await page.$('.media-card__link')) !== null;
  check('YouTube player behavior (inline iframe by default)', embedVisible && !linkVisible, `embed=${embedVisible} link=${linkVisible}`);

  if (embedVisible) {
    const src = await page.getAttribute('.media-card__frame iframe', 'src');
    check('Embed uses youtube-nocookie', /youtube-nocookie\.com\/embed\/[\w-]{11}/.test(src || ''), src || '');
  }

  /* link mode (with thumbnail poster) after disabling the setting */
  await page.click('.detail .ghost-button:has-text("Back")');
  await openSettings('General');
  const mediaToggle = '[role="dialog"] .switch[aria-label*="Play media" i]';
  const embedDefault = await page.getAttribute(mediaToggle, 'aria-checked');
  await page.click(mediaToggle);
  await page.keyboard.press('Escape');
  await page.click('.article-card >> nth=0');
  await page.waitForSelector('.detail');
  const linkHref = await page.getAttribute('.media-card__link', 'href');
  const posterSrc = await page.getAttribute('.media-card__poster img', 'src');
  check(
    'Fallback link shows thumbnail poster and opens youtube.com/watch',
    /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(linkHref || '') &&
      /i\.ytimg\.com\/vi\/[\w-]{11}\//.test(posterSrc || ''),
    `toggle was ${embedDefault} · ${linkHref || ''}`
  );
  await page.screenshot({ path: path.join(SHOTS, '03-video-link.png') });
  await page.click('.detail .ghost-button:has-text("Back")');
  await openSettings('General');
  await page.click(mediaToggle);
  await page.keyboard.press('Escape');

  /* --------------------------- keyboard nav ---------------------------- */
  await page.click('.feed-row:has-text("All articles")');
  await page.waitForSelector('.article-card');
  await page.locator('.article-card').first().focus();
  await page.keyboard.press('j');
  await page.waitForSelector('.detail');
  check('Keyboard j opens an article', true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.article-grid');
  check('Escape returns to list', true);

  /* --------------- mouse back/forward (browser history) ---------------- */
  // The side buttons on a mouse are the browser's back/forward, so exercising
  // history traversal covers them.
  const browserBackToGrid = async () => {
    await page.evaluate(() => window.history.back());
    await page.waitForSelector('.article-grid');
  };
  const browserForwardToDetail = async () => {
    await page.evaluate(() => window.history.forward());
    await page.waitForSelector('.detail');
  };

  await page.click('.article-card >> nth=0');
  await page.waitForSelector('.detail');
  const historyArticleTitle = (await page.textContent('.detail__title'))?.trim();
  await browserBackToGrid();
  check('Mouse back closes the article', true, historyArticleTitle || '');
  await browserForwardToDetail();
  const reopenedTitle = (await page.textContent('.detail__title'))?.trim();
  check(
    'Mouse forward reopens the same article',
    reopenedTitle === historyArticleTitle,
    reopenedTitle || ''
  );

  // Escape must step back through the same stack, not push a duplicate entry,
  // or forward would not return to the article.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.article-grid');
  await browserForwardToDetail();
  check('Escape reuses history, so forward still reaches the article', true);
  await browserBackToGrid();

  const firstFeedTitle = (
    await page.locator('.sidebar .feed-item .feed-row__title').first().textContent()
  )?.trim();
  await page.locator('.sidebar .feed-item .feed-row').first().click();
  await page.waitForTimeout(200);
  await page.click('.article-card >> nth=0');
  await page.waitForSelector('.detail');
  await browserBackToGrid();
  const activeFeedTitle = (
    await page.locator('.sidebar .feed-row[aria-current="page"] .feed-row__title').textContent()
  )?.trim();
  check(
    'Back from an article returns to its feed list',
    activeFeedTitle === firstFeedTitle,
    `${activeFeedTitle} vs ${firstFeedTitle}`
  );
  await page.evaluate(() => window.history.back());
  await page.waitForFunction(
    () =>
      document.querySelector('.sidebar .feed-row[aria-current="page"] .feed-row__title')
        ?.textContent === 'All articles',
    undefined,
    { timeout: 5000 }
  );
  const backAtAll = (
    await page.locator('.sidebar .feed-row[aria-current="page"] .feed-row__title').textContent()
  )?.trim();
  check('Back again returns to the previous view', backAtAll === 'All articles', backAtAll || '');

  // j/k between articles replaces the history entry, so Escape still means
  // “back to the list” instead of stepping through every article.
  await page.locator('.article-card').first().focus();
  await page.keyboard.press('j');
  await page.waitForSelector('.detail');
  const firstArticleTitle = (await page.textContent('.detail__title'))?.trim();
  await page.keyboard.press('j');
  await page.waitForFunction(
    (previous) => document.querySelector('.detail__title')?.textContent?.trim() !== previous,
    firstArticleTitle,
    { timeout: 5000 }
  );
  const secondArticleTitle = (await page.textContent('.detail__title'))?.trim();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.article-grid');
  check(
    'Escape from a j/k-opened article returns to the list',
    Boolean(secondArticleTitle) && secondArticleTitle !== firstArticleTitle,
    `${firstArticleTitle} → ${secondArticleTitle}`
  );
  await browserForwardToDetail();
  const forwardedTitle = (await page.textContent('.detail__title'))?.trim();
  check(
    'Forward returns to the latest article, not an earlier one',
    forwardedTitle === secondArticleTitle,
    forwardedTitle || ''
  );
  await browserBackToGrid();
  await page.keyboard.press('k');
  await page.waitForTimeout(200);
  const stillAtAll = (
    await page.locator('.sidebar .feed-row[aria-current="page"] .feed-row__title').textContent()
  )?.trim();
  check('k at the top of the list does not go back', stillAtAll === 'All articles', stillAtAll || '');
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
  await targetItem.locator('button[aria-label^="Unsubscribe"]').click();
  await page.waitForSelector('[role="dialog"]:has-text("Unsubscribe")');
  check('Unsubscribe asks for confirmation', true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.sidebar .feed-item').length === expected,
    feedsBeforeRemove - 1,
    { timeout: 5000 }
  );
  check('Feed removed after pressing Enter in confirmation', true, `${feedsBeforeRemove - 1} feeds left`);

  /* -------------------- context menu (portal + actions) ---------------- */
  const menuFeed = page.locator('.sidebar .feed-item').first();
  await menuFeed.click({ button: 'right' });
  await page.waitForSelector('.context-menu');
  const contextItems = await page.locator('.context-menu__item').count();
  check('Feed context menu opens with full actions', contextItems >= 7, `${contextItems} items`);
  const menuInBody = await page.evaluate(
    () => document.querySelector('.context-menu')?.parentElement === document.body
  );
  check('Context menu is portalled to <body>', menuInBody);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.context-menu', { state: 'detached' });

  /* ------- feed context menu → searchable “Move to folder…” picker ------ */
  await page.locator('.sidebar .feed-item').first().click({ button: 'right' });
  await page.waitForSelector('.context-menu');
  await page.click('.context-menu__item:has-text("Move to folder")');
  await page.waitForSelector('.folder-picker__list');
  check('Feed context menu opens the searchable folder picker', true);
  await page.fill('.folder-picker__search input', 'zeb');
  const pickerLabels = await page.$$eval('.folder-picker__option .folder-picker__label', (nodes) =>
    nodes.map((node) => node.textContent)
  );
  check(
    'Folder picker filters the list as you type',
    pickerLabels.length === 1 && /Zebra/.test(pickerLabels[0] || ''),
    pickerLabels.join(', ')
  );
  await page.keyboard.press('Enter');
  await page.waitForSelector('.folder-picker', { state: 'detached' });
  const movedByPicker = await page
    .locator('.sidebar .folder-group:has-text("Zebra Video") .feed-item')
    .count();
  check('Enter in the picker moves the feed', movedByPicker >= 1, `${movedByPicker} in Zebra Video`);

  /* ------------------- Manage (select all/none/folder) ----------------- */
  await openDataTab('Manage');
  await page.waitForSelector('#panel-manage');
  await page.click('#panel-manage button:has-text("Select all")');
  const allCountText = await page.textContent('.manage-toolbar__count');
  await page.click('#panel-manage button:has-text("Select none")');
  const noneCountText = await page.textContent('.manage-toolbar__count');
  check(
    'Manage tab supports Select all and Select none',
    /^[1-9]\d* selected$/.test((allCountText || '').trim()) && (noneCountText || '').trim() === '0 selected',
    `${allCountText?.trim()} → ${noneCountText?.trim()}`
  );

  /* ------------------- bulk move feeds from Manage ---------------------- */
  const manageFeedChecks = page.locator('#manage-feeds .manage-item input[type="checkbox"]');
  const feedsToMove = Math.min(2, await manageFeedChecks.count());
  for (let i = 0; i < feedsToMove; i += 1) await manageFeedChecks.nth(i).check();
  await page.click('#manage-feeds button:has-text("Move selected")');
  await page.waitForSelector('.folder-picker__list');
  check('Manage offers bulk move through the same picker', true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.folder-picker', { state: 'detached' });
  check(
    'Escape closes only the stacked picker, not the dialog under it',
    (await page.locator('#panel-manage').count()) === 1
  );
  await page.click('#manage-feeds button:has-text("Move selected")');
  await page.waitForSelector('.folder-picker__list');
  await page.fill('.folder-picker__search input', 'zebra');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.folder-picker', { state: 'detached' });
  const zebraFeeds = await page
    .locator('.sidebar .folder-group:has-text("Zebra Video") .feed-item')
    .count();
  check('Bulk move puts every selected feed in the folder', zebraFeeds >= feedsToMove, `${zebraFeeds} feeds in Zebra Video`);

  /* ----------------------- folders tab (bulk) --------------------------- */
  await page.click('#manage-tab-folders');
  await page.waitForSelector('#manage-folders');
  await page.click('#manage-folders button:has-text("Select all")');
  const foldersSelected = (await page.textContent('#manage-folders .manage-toolbar__count'))?.trim();
  check('Folders tab supports multiple selection', /^[1-9]\d* selected$/.test(foldersSelected || ''), foldersSelected || '');
  await page.click('#manage-folders button:has-text("Select none")');

  /* multi-folder delete: combined confirmation, cancelled here so the rest of
     the suite keeps its folders */
  const folderRowChecks = page.locator('#manage-folders .manage-folder-row input[type="checkbox"]');
  await folderRowChecks.nth(0).check();
  await folderRowChecks.nth(1).check();
  await page.click('#manage-folders button:has-text("Delete selected")');
  await page.waitForSelector('.manage-confirm');
  const multiDeleteText = (await page.textContent('.manage-confirm__text'))?.trim();
  check(
    'Deleting several folders shows one combined confirmation',
    /2 folders/.test(multiDeleteText || ''),
    multiDeleteText
  );
  await page.click('.manage-confirm button:has-text("Cancel")');
  await page.waitForSelector('.manage-confirm', { state: 'detached' });
  await page.click('#manage-folders button:has-text("Select none")');

  const foldersBeforeDelete = await page.locator('.sidebar .folder-group').count();
  await page.click('.manage-folder__delete >> nth=0');
  await page.waitForSelector('.manage-confirm');
  check('Delete folder asks for confirmation inside Manage', true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.sidebar .folder-group').length === expected,
    foldersBeforeDelete - 1,
    { timeout: 5000 }
  );
  const foldersRemaining = await page.locator('.sidebar .folder-group').count();
  check('Delete folder removes the folder and its feeds', foldersRemaining === foldersBeforeDelete - 1, `${foldersRemaining} folder(s) left`);

  /* ------------------ merge a folder into another one ------------------- */
  const sourceFolder = (
    await page.locator('#manage-folders .manage-folder-row .manage-folder__name').first().textContent()
  )?.trim();
  const foldersBeforeMerge = await page.locator('.sidebar .folder-group').count();
  await page.locator('#manage-folders .manage-folder-row').first().locator('input[type="checkbox"]').check();
  await page.click('#manage-folders button:has-text("Move selected")');
  await page.waitForSelector('.folder-picker__list');
  const mergeOptions = await page.$$eval('.folder-picker__option .folder-picker__label', (nodes) =>
    nodes.map((node) => node.textContent || '')
  );
  check(
    'Folder merge excludes the folders being moved',
    Boolean(sourceFolder) && !mergeOptions.includes(sourceFolder),
    mergeOptions.join(', ')
  );
  await page.keyboard.press('Enter');
  await page.waitForSelector('.folder-picker', { state: 'detached' });
  const foldersAfterMerge = await page.locator('.sidebar .folder-group').count();
  check(
    'Merging a folder removes it and keeps its feeds',
    foldersAfterMerge === foldersBeforeMerge - 1,
    `${foldersBeforeMerge} → ${foldersAfterMerge}`
  );

  /* ----------------------- OPML XML live editor ------------------------ */
  await page.click('#tab-xml');
  await page.waitForSelector('.opml-editor');
  const placeholder = await page.getAttribute('.opml-editor', 'placeholder');
  check('OPML editor shows an example placeholder', /<opml/.test(placeholder || ''));
  const currentXml = await page.inputValue('.opml-editor');
  const editedXml = currentXml.replace(/title="Fireship"/g, 'title="Fireship Channel"').replace(/text="Fireship"/g, 'text="Fireship Channel"');
  await page.fill('.opml-editor', editedXml);
  await page.click('#panel-xml .button--primary:has-text("Preview changes")');
  await page.waitForSelector('#panel-xml .import-preview');
  check('OPML XML shows a diff before applying', true);
  await page.click('#panel-xml .button--primary:has-text("Apply changes")');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  const renamedVisible = (await page.locator('.sidebar .feed-row:has-text("Fireship Channel")').count()) === 1;
  check('OPML XML editor updates titles/folders in place', renamedVisible);

  /* ------------------- folder row + collapse-all control ---------------- */
  const firstFolder = page.locator('.sidebar .folder-group').first();
  const firstFolderRow = firstFolder.locator('.folder-row');
  const firstFolderToggle = firstFolder.locator('.folder-row__toggle');
  await firstFolderRow.click();
  check(
    'Folder row filters its feeds',
    (await firstFolderRow.getAttribute('aria-current')) === 'page'
  );
  await firstFolderRow.click();
  check(
    'Clicking the active folder again keeps it open',
    (await firstFolderToggle.getAttribute('aria-expanded')) === 'true' &&
      (await firstFolderRow.getAttribute('aria-current')) === 'page'
  );
  await firstFolderToggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.sidebar .folder-group .folder-row__toggle')
        ?.getAttribute('aria-expanded') === 'false'
  );
  const caretKeepsView =
    (await firstFolderRow.getAttribute('aria-current')) === 'page' &&
    (await firstFolder.locator('.feed-list--nested').count()) === 0;
  check('Only the caret collapses the folder, without changing the view', caretKeepsView);
  await firstFolderRow.click();
  check(
    'Clicking a collapsed folder filters it without expanding',
    (await firstFolderToggle.getAttribute('aria-expanded')) === 'false' &&
      (await firstFolderRow.getAttribute('aria-current')) === 'page'
  );
  await firstFolderToggle.click();
  check(
    'Caret expands a filtered folder without changing the view',
    (await firstFolderToggle.getAttribute('aria-expanded')) === 'true' &&
      (await firstFolderRow.getAttribute('aria-current')) === 'page'
  );

  const folderToggle = page.locator('.sidebar__toolbar button[aria-label*="all folders"]');
  await folderToggle.click();
  const allCollapsed = await page.$$eval('.sidebar .folder-row__toggle', (rows) =>
    rows.every((row) => row.getAttribute('aria-expanded') === 'false')
  );
  check('Toolbar collapse-all closes every folder in one click', allCollapsed);
  await folderToggle.click();
  const allExpanded = await page.$$eval('.sidebar .folder-row__toggle', (rows) =>
    rows.every((row) => row.getAttribute('aria-expanded') === 'true')
  );
  check('Toolbar expand-all reopens every folder', allExpanded);

  const toastCount = await page.locator('.toast').count();
  const errorBannerCount = await page.locator('.banner--error').count();
  check('Never stacks error banners or multiple toasts', toastCount <= 1 && errorBannerCount === 0, `toasts=${toastCount} banners=${errorBannerCount}`);

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
  await page.click('.sidebar .feed-row:has-text("All articles")');
  await page.waitForFunction(
    () => document.querySelector('.app')?.getAttribute('data-sidebar-open') === 'false'
  );
  check('Mobile drawer closes after choosing a view', true);

  /* ------------------------- inline media providers --------------------- */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await page.click('.sidebar .feed-row:has-text("All articles")');
  await page.click('.sidebar__toolbar button[aria-label="New feed"]');
  await page.fill('[role="dialog"] input.input', fixture('media.xml'));
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  await page.waitForSelector('.article-card', { timeout: 30_000 });
  await page.click('.sidebar .feed-row:has-text("Media Fixture")');
  await page.waitForSelector('.article-card');

  const audioCards = await page.locator('.article-card--audio').count();
  const mediaChips = await page.locator('.article-card__media-chip').count();
  check(
    'Audio embeds get a card badge and an inline chip',
    audioCards >= 3 && mediaChips >= 5,
    `${audioCards} audio cards · ${mediaChips} chips`
  );

  /* Provider cards with no thumbnail still get a branded band, not blank space */
  const bands = await page.locator('.article-card__media--embed').count();
  check('Media cards without artwork get a branded band', bands >= 4, `${bands} bands`);

  /* Spotify item opens a track player, not a redirect */
  await page.click('.article-card:has-text("Spotify track fixture")');
  await page.waitForSelector('.detail .media-card iframe');
  const spotifySrc = await page.getAttribute('.detail .media-card iframe', 'src');
  const spotifyFrameClass = await page.getAttribute('.detail .media-card__frame', 'class');
  check(
    'Spotify track plays in an inline iframe',
    /open\.spotify\.com\/embed\/track\/[A-Za-z0-9]+/.test(spotifySrc || '') &&
      /--audio/.test(spotifyFrameClass || ''),
    spotifySrc || ''
  );
  await page.screenshot({ path: path.join(SHOTS, '06-spotify.png') });
  await page.click('.detail .ghost-button:has-text("Back")');

  /* Vimeo item gets a 16:9 video player */
  await page.click('.article-card:has-text("Vimeo clip fixture")');
  await page.waitForSelector('.detail .media-card iframe');
  const vimeoSrc = await page.getAttribute('.detail .media-card iframe', 'src');
  const vimeoFrameClass = await page.getAttribute('.detail .media-card__frame', 'class');
  check(
    'Vimeo plays inline with a 16:9 frame',
    /player\.vimeo\.com\/video\/76979871/.test(vimeoSrc || '') &&
      /--video/.test(vimeoFrameClass || ''),
    vimeoSrc || ''
  );
  await page.click('.detail .ghost-button:has-text("Back")');

  /* SoundCloud uses its widget player */
  await page.click('.article-card:has-text("SoundCloud track fixture")');
  await page.waitForSelector('.detail .media-card iframe');
  const soundcloudSrc = await page.getAttribute('.detail .media-card iframe', 'src');
  check(
    'SoundCloud plays inline via its widget',
    /w\.soundcloud\.com\/player\/\?url=/.test(soundcloudSrc || ''),
    soundcloudSrc || ''
  );
  await page.click('.detail .ghost-button:has-text("Back")');

  /* A provider link inside the body is detected without clicking anything */
  await page.click('.article-card:has-text("Spotify link in prose")');
  await page.waitForSelector('.detail .media-card iframe');
  const proseSrc = await page.getAttribute('.detail .media-card iframe', 'src');
  check(
    'A provider link in the article body is detected automatically',
    /open\.spotify\.com\/embed\/episode\//.test(proseSrc || ''),
    proseSrc || ''
  );
  await page.click('.detail .ghost-button:has-text("Back")');

  /* Clicking a provider link in the body swaps the player in place */
  const urlBeforeLink = page.url();
  await page.click('.article-card:has-text("Video with a bonus track")');
  await page.waitForSelector('.detail .media-card iframe');
  const primarySrc = await page.getAttribute('.detail .media-card iframe', 'src');
  await page.click('.detail .content a[href*="open.spotify.com"]');
  await page.waitForFunction(
    () =>
      /open\.spotify\.com\/embed\/track/.test(
        document.querySelector('.detail .media-card iframe')?.getAttribute('src') || ''
      ),
    undefined,
    { timeout: 5000 }
  );
  const swappedSrc = await page.getAttribute('.detail .media-card iframe', 'src');
  check(
    'Clicking a provider link in the body plays it in place',
    /youtube-nocookie\.com\/embed\//.test(primarySrc || '') &&
      /open\.spotify\.com\/embed\/track\//.test(swappedSrc || '') &&
      page.url() === urlBeforeLink,
    `${primarySrc || ''} → ${swappedSrc || ''}`
  );
  await page.click('.detail .media-card .ghost-button:has-text("Close player")');
  await page.waitForFunction(
    () =>
      /youtube-nocookie\.com\/embed\//.test(
        document.querySelector('.detail .media-card iframe')?.getAttribute('src') || ''
      ),
    undefined,
    { timeout: 5000 }
  );
  check('Close player restores the article’s own media', true);
  await page.click('.detail .ghost-button:has-text("Back")');

  /* Plain text item: nothing to play */
  await page.click('.article-card:has-text("Plain article with no media")');
  await page.waitForSelector('.detail');
  check('Articles without media get no player', (await page.$('.detail .media-card')) === null);
  await page.click('.detail .ghost-button:has-text("Back")');

  /* ------------------- preferences schema migration -------------------- */
  // Profiles created before inline players existed stored `embedMedia:false`
  // (the old YouTube-only option's default). The first migration carried it
  // over as an explicit choice, so those users never saw a player. Simulate
  // such a profile: it must be upgraded once, and a later opt-out respected.
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('rss-reader:prefs') || '{}');
    delete prefs.prefsVersion;
    prefs.embedMedia = false;
    localStorage.setItem('rss-reader:prefs', JSON.stringify(prefs));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.article-grid');
  await openSettings('General');
  const migratedToggle = await page.getAttribute(mediaToggle, 'aria-checked');
  check('Legacy “inline media off” profile migrates to on', migratedToggle === 'true');

  await page.click(mediaToggle);
  const savedPrefs = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('rss-reader:prefs') || '{}')
  );
  check(
    'Explicit opt-out is saved with the current schema version',
    savedPrefs.prefsVersion === 2 && savedPrefs.embedMedia === false,
    `v${savedPrefs.prefsVersion} · embed=${savedPrefs.embedMedia}`
  );
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.article-grid');
  await openSettings('General');
  const respectedToggle = await page.getAttribute(mediaToggle, 'aria-checked');
  check('An opt-out made after the migration survives a reload', respectedToggle === 'false');
  await page.click(mediaToggle);
  await page.keyboard.press('Escape');

  /* ---------------------------- console noise -------------------------- */
  // Direct-first fetching always logs a CORS refusal before the proxy hop, and
  // favicon misses are cosmetic — neither is an application error. Third-party
  // players may also refuse framing or be unreachable offline; that is the
  // provider's business, not ours.
  const relevantErrors = consoleErrors.filter(
    (e) =>
      !/favicon|Failed to load resource|net::ERR|CORS policy|404|419|Refused to display|X-Frame-Options|open\.spotify\.com|player\.vimeo\.com|w\.soundcloud\.com/.test(
        e
      )
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
