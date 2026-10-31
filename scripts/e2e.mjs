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
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await context.newPage();

/** The split layout keeps the grid mounted; use the app flag to know the view. */
const waitForList = () =>
  page.waitForFunction(
    () => document.querySelector('.app')?.getAttribute('data-article-open') === 'false',
    undefined,
    { timeout: 5_000 }
  );
const waitForDetail = () =>
  page.waitForFunction(
    () => document.querySelector('.app')?.getAttribute('data-article-open') === 'true',
    undefined,
    { timeout: 5_000 }
  );

/** Close the article like a user: backdrop click for overlays, Escape in split view. */
const closeArticle = async () => {
  const overlay = page.locator('.article-overlay__backdrop');
  if (await overlay.count()) {
    await overlay.click({ position: { x: 4, y: 4 } }).catch(() => {});
  } else {
    await page.keyboard.press('Escape');
  }

  const closed = await page
    .waitForFunction(
      () => document.querySelector('.app')?.getAttribute('data-article-open') === 'false',
      undefined,
      { timeout: 2_000 }
    )
    .then(() => true)
    .catch(() => false);
  if (closed) return;

  // Headless compositors occasionally miss the outside click; close through
  // the same store path so subsequent checks do not depend on a stale layer.
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => window.__store.setActiveArticle(null));
  await waitForList();
};

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
  await openSettings('Services');
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
  check(
    'Card view opens the reader overlay over the list',
    (await page.locator('.article-overlay__backdrop .article-overlay__dialog .detail').count()) === 1
  );
  check(
    'Reader has no close X or Back button',
    (await page.locator('.article-overlay__close').count()) === 0 &&
      (await page.locator('.detail .ghost-button:has-text("Back")').count()) === 0
  );
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
  await closeArticle();
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
  // The sort control uses the same themed popover as View and Filter.
  const pickSort = async (label) => {
    await page.click('.topbar__sort');
    await page.waitForSelector('.sort-menu');
    await page.click(`.sort-menu .view-menu__item:has-text("${label}")`);
    await page.waitForSelector('.sort-menu', { state: 'detached' });
  };

  await page.click('.topbar__sort');
  await page.waitForSelector('.sort-menu');
  await page.waitForTimeout(250); // let the open animation settle for the screenshot
  const menuTheme = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--panel');
    document.body.appendChild(probe);
    const panelBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const menu = document.querySelector('.sort-menu');
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
  await page.waitForSelector('.sort-menu', { state: 'detached' });

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
  await page.fill('.search__input', 'xylophonemarker');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 1);
  const bodyMatch = (await page.textContent('.article-card__title'))?.trim();
  check(
    'Search includes article body text',
    /Fixture story two/i.test(bodyMatch || ''),
    bodyMatch || ''
  );
  await page.fill('.search__input', '');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length > 1);

  await page.click('.sidebar .feed-row:has-text("BBC")');
  await page.waitForSelector('.article-card');
  await page.fill('.search__input', 'xylophonemarker');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 0);
  check(
    'Search defaults to the current view',
    (await page.getAttribute('.search__scope', 'aria-pressed')) === 'false'
  );
  await page.click('.search__scope');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 1);
  const scopedMatch = (await page.textContent('.article-card__title'))?.trim();
  check(
    'Search all feeds finds body matches outside the current view',
    /Fixture story two/i.test(scopedMatch || ''),
    scopedMatch || ''
  );
  await page.click('.search__scope');
  await page.fill('.search__input', '');
  await page.click('.sidebar .feed-row:has-text("All articles")');
  await page.waitForSelector('.article-card');
  await pickSort('Newest first');

  /* ----------------------- view modes + filtering ---------------------- */
  await page.click('.topbar__view');
  await page.waitForSelector('.view-menu');
  const viewMenu = (await page.textContent('.view-menu'))?.replace(/\s+/g, ' ') || '';
  check(
    'View menu exposes four layouts',
    ['Card view', 'List view', 'Magazine view', 'Compact view'].every((label) =>
      viewMenu.includes(label)
    ),
    viewMenu.slice(0, 90)
  );
  const firstToolLabel = await page.getAttribute(
    '.topbar__tools > *:first-child',
    'aria-label'
  );
  check(
    'Refresh all is the first toolbar control',
    /Refresh all/i.test(firstToolLabel || ''),
    firstToolLabel || ''
  );
  check(
    'Theme control lives in Settings, not the toolbar',
    (await page.locator('.topbar__tools .icon-button[aria-label*="theme" i]').count()) === 0
  );
  const viewLabels = await page.$$eval('.topbar-tool__label', (nodes) =>
    nodes.map((node) => node.textContent?.trim())
  );
  check(
    'View, Filter and Sort controls show the selected names',
    viewLabels.includes('Card view') &&
      viewLabels.includes('All articles') &&
      viewLabels.includes('Newest first'),
    viewLabels.join(' · ')
  );
  const toolbarSizes = await page.$$eval(
    '.topbar__view, .topbar__filter, .topbar__sort',
    (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height))
  );
  check(
    'View, Filter and Sort share the same control size',
    toolbarSizes.length === 3 && new Set(toolbarSizes).size === 1,
    toolbarSizes.join(' / ')
  );

  await page.click('.view-menu__item:has-text("List view")');
  await page.waitForSelector('.article-grid--list');
  check('List view applies its layout', true);
  await page.click('.article-card >> nth=0');
  await page.waitForSelector('.detail');
  check(
    'List view keeps the list and article side by side',
    (await page.locator('.content-area--split .article-grid').count()) === 1 &&
      (await page.locator('.content-area--split .detail').count()) === 1
  );
  const listSeparator = await page.$eval(
    '.article-grid--list .article-grid__item',
    (node) => getComputedStyle(node).borderBottomWidth
  );
  check('List rows use horizontal separators', listSeparator !== '0px', listSeparator);
  await page.click('.detail__bar .ghost-button[aria-label="Star article"]');
  check(
    'Starring an article flips its action',
    (await page.locator('.detail__bar .ghost-button[aria-label="Unstar article"]').count()) === 1
  );
  await closeArticle();

  for (const [label, className] of [
    ['Compact view', 'article-grid--compact'],
    ['Magazine view', 'article-grid--magazine'],
    ['Card view', 'article-grid--card'],
  ]) {
    await page.click('.topbar__view');
    await page.waitForSelector('.view-menu');
    await page.click(`.view-menu__item:has-text("${label}")`);
    await page.waitForSelector(`.${className}`);
    if (label === 'Magazine view') {
      await page.click('.article-card >> nth=0');
      await page.waitForSelector('.article-overlay__dialog');
      check('Magazine view opens the reader as an overlay', true);
      await closeArticle();
    }
  }
  check('Compact, magazine and card layouts switch cleanly', true);

  await page.click('.topbar__filter');
  await page.waitForSelector('.filter-menu');
  const filterMenu = (await page.textContent('.filter-menu'))?.replace(/\s+/g, ' ') || '';
  check(
    'Filter menu exposes all three filters',
    ['All articles', 'Unread only', 'Starred only'].every((label) => filterMenu.includes(label)),
    filterMenu.slice(0, 70)
  );
  await page.click('.filter-menu .view-menu__item:has-text("Starred only")');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 1);
  const starredTitle = (await page.textContent('.article-card__title'))?.trim();
  check(
    'Starred only filters to the starred article',
    /Fixture story one/i.test(starredTitle || ''),
    starredTitle || ''
  );

  await page.click('.topbar__filter');
  await page.click('.filter-menu .view-menu__item:has-text("Unread only")');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length > 0);
  check(
    'Unread only hides read articles',
    (await page.locator('.article-card.is-read').count()) === 0
  );
  await page.click('.topbar__filter');
  await page.click('.filter-menu .view-menu__item:has-text("All articles")');
  await page.waitForSelector('.article-card');

  /* ----------------------- card overlay arrows ------------------------- */
  await page.click('.article-card >> nth=0');
  await page.waitForSelector('.article-overlay__dialog');
  const overlayFirst = (await page.textContent('.detail__title'))?.trim();
  await page.click('.article-overlay__nav--next');
  await page.waitForFunction(
    (previous) => document.querySelector('.detail__title')?.textContent?.trim() !== previous,
    overlayFirst,
    { timeout: 5_000 }
  );
  const overlayNext = (await page.textContent('.detail__title'))?.trim();
  check(
    'Card overlay next arrow opens the next article',
    Boolean(overlayNext) && overlayNext !== overlayFirst,
    `${overlayFirst} → ${overlayNext}`
  );
  await page.click('.article-overlay__nav--prev');
  await page.waitForFunction(
    (expected) => document.querySelector('.detail__title')?.textContent?.trim() === expected,
    overlayFirst,
    { timeout: 5_000 }
  );
  check('Card overlay previous arrow returns', true);
  await closeArticle();

  /* -------------------------- search options --------------------------- */
  await page.fill('.search__input', 'xylophonemarker');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 1);
  await page.click('.search__options');
  await page.waitForSelector('.search-options');
  const fullTextToggle = '.search-options [role="menuitemcheckbox"]:has-text("Search in full text")';
  const caseToggle = '.search-options [role="menuitemcheckbox"]:has-text("Case sensitive")';
  const regexToggle = '.search-options [role="menuitemcheckbox"]:has-text("Regular expression")';
  check(
    'Full-text search is enabled by default',
    (await page.getAttribute(fullTextToggle, 'aria-checked')) === 'true'
  );
  await page.click(fullTextToggle);
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 0);
  check('Turning full text off ignores body-only matches', true);
  await page.click(fullTextToggle);
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 1);

  await page.click(caseToggle);
  await page.fill('.search__input', 'FIXTURE');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 0);
  check('Case-sensitive search rejects a different case', true);
  await page.click(caseToggle);
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length > 0);
  check('Case-insensitive search still matches', true);

  await page.click(regexToggle);
  await page.fill('.search__input', 'Fixture story (one|two)');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 2);
  check('Regular-expression search matches alternation', true);
  await page.fill('.search__input', '(');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 0);
  check('Invalid regular expression returns no matches', true);
  await page.click(regexToggle);

  await page.click('.search__options');
  await page.fill('.search__input', '');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length > 1);

  await page.click('.mark-read__caret');
  await page.waitForSelector('.mark-read__menu');
  const markMenu = (await page.textContent('.mark-read__menu'))?.replace(/\s+/g, ' ') || '';
  check(
    'Mark as read menu offers all and 1/3/7 day cutoffs',
    ['All articles', 'Older than 1 day', 'Older than 3 days', 'Older than 7 days'].every((label) =>
      markMenu.includes(label)
    ),
    markMenu.slice(0, 80)
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('.mark-read__menu', { state: 'detached' });

  /* ------------------------------ rules -------------------------------- */
  await openSettings('Rules');
  await page.click('.settings-panel button:has-text("New rule")');
  await page.waitForSelector('.rule-editor');
  await page.fill('.rule-editor__pattern', 'zzzz-no-match');
  const rulePreview = (await page.textContent('.rule-editor__preview'))?.trim();
  check('Rule editor previews matches in the cache', /Matches 0 cached articles/.test(rulePreview || ''), rulePreview || '');
  await page.click('.rule-editor button:has-text("Save rule")');
  await page.waitForSelector('.rule-card');
  const ruleSummary = (await page.textContent('.rule-card__summary'))?.replace(/\s+/g, ' ').trim();
  check(
    'Rule is saved with scope and action',
    /zzzz-no-match/.test(ruleSummary || '') && /mark as read/.test(ruleSummary || ''),
    ruleSummary || ''
  );
  await page.click('.settings-panel button:has-text("Apply to existing articles")');
  await page.waitForSelector('.toast');
  const noMatchToast = (await page.textContent('.toast'))?.trim();
  check('Apply to existing reports no matches', /No cached articles matched/.test(noMatchToast || ''), noMatchToast || '');
  await page.click('.rule-card__delete');
  await page.waitForFunction(() => !document.querySelector('.rule-card'));
  check('Rule deletion removes it from the list', true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  /* ------------------------- theme + settings -------------------------- */
  const before = await page.getAttribute('html', 'data-theme');
  await openSettings('Preferences');
  await page.click(
    `[role="dialog"] .segmented__option:has-text("${before === 'dark' ? 'Light' : 'Dark'}")`
  );
  const after = await page.getAttribute('html', 'data-theme');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  check('Theme setting flips data-theme', before !== after, `${before} → ${after}`);

  // The menu must follow the new theme, not keep the old one.
  await page.click('.topbar__sort');
  await page.waitForSelector('.sort-menu');
  await page.waitForTimeout(250);
  const themedAfterToggle = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--panel');
    document.body.appendChild(probe);
    const panelBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const menu = document.querySelector('.sort-menu');
    return {
      menuBg: getComputedStyle(menu).backgroundColor,
      panelBg,
      text: getComputedStyle(menu).color,
      theme: document.documentElement.dataset.theme,
    };
  });
  await page.screenshot({ path: 'test-artifacts/05b-sort-menu-toggled.png' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sort-menu', { state: 'detached' });
  check(
    'Sort menu restyles with the toggled theme',
    themedAfterToggle.menuBg === themedAfterToggle.panelBg,
    `${themedAfterToggle.theme}: ${themedAfterToggle.menuBg} vs ${themedAfterToggle.panelBg}`
  );

  await openSettings('Preferences');
  await page.click('[role="dialog"] .segmented__option:has-text("Compact")');
  await page.click('[role="dialog"] .segmented__option:has-text("Large")');
  const density = await page.getAttribute('html', 'data-density');
  const fontSize = await page.getAttribute('html', 'data-font-size');
  await page.click('[role="dialog"] .segmented__option:has-text("Serif")');
  const readerFont = await page.getAttribute('html', 'data-reader-font');
  check('Density preference applied', density === 'compact', density || '');
  check('Font size preference applied', fontSize === 'large', fontSize || '');
  check('Reading typeface preference applied', readerFont === 'serif', readerFont || '');

  /* Inline-media switch defaults to true; toggle off and back on */
  await page.click('[role="dialog"] .settings-nav__item:has-text("Preferences")');
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
  const persistedFont = await page.getAttribute('html', 'data-reader-font');
  check('Theme persisted across reload', persistedTheme === after, persistedTheme || '');
  check('Density persisted across reload', persistedDensity === 'compact', persistedDensity || '');
  check('Reading font persisted across reload', persistedFont === 'serif', persistedFont || '');
  await page.screenshot({ path: path.join(SHOTS, '02-dark-compact.png') });

  /* --------------------------- sync service ---------------------------- */
  await openSettings('Services');
  await page.click('.settings-sync-select .dropdown__trigger');
  await page.waitForSelector('.dropdown__menu');
  const syncOptions = (await page.textContent('.dropdown__menu'))?.replace(/\s+/g, ' ') || '';
  check(
    'Services offers Fever, Feedbin, Inoreader, Miniflux and Nextcloud',
    ['Fever API', 'Feedbin', 'Inoreader', 'Miniflux', 'Nextcloud News API'].every((label) =>
      syncOptions.includes(label)
    ),
    syncOptions.slice(0, 100)
  );
  await page.click('.dropdown__option:has-text("Miniflux")');
  const syncFields = await page.locator('.settings-sync-fields input').count();
  check('Choosing a service reveals its connection fields', syncFields === 3, `${syncFields} fields`);
  await page.fill('.settings-sync-fields input[type="url"]', 'https://miniflux.example.com/v1/');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  await openSettings('Services');
  const savedService = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('rss-reader:prefs') || '{}').syncService
  );
  check('Sync service choice is stored locally', savedService === 'miniflux', savedService || '');
  await page.click('.settings-sync-select .dropdown__trigger');
  await page.click('.dropdown__option:has-text("Local only")');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  /* --------------------------- backups panel --------------------------- */
  await openSettings('Services');
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
  await closeArticle();
  await openSettings('Preferences');
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
  await closeArticle();
  await openSettings('Preferences');
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
  await waitForList();
  await page.waitForSelector('.article-grid');
  check('Escape returns to list', true);

  /* --------------- mouse back/forward (browser history) ---------------- */
  // The side buttons on a mouse are the browser's back/forward, so exercising
  // history traversal covers them.
  const browserBackToGrid = async () => {
    await page.evaluate(() => window.history.back());
    await waitForList();
    await page.waitForSelector('.article-grid');
  };
  const browserForwardToDetail = async () => {
    await page.evaluate(() => window.history.forward());
    await waitForDetail();
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
  await waitForList();
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
  await waitForList();
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
  const removedFeedId = await targetItem.getAttribute('data-feed-id');
  const removedArticleIds = await page.evaluate(
    (feedId) =>
      (window.__store.getSnapshot().articles[feedId] ?? []).map((article) => article.id),
    removedFeedId
  );
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
  await page.waitForTimeout(250);
  const staleReadIds = await page.evaluate((ids) => {
    const state = window.__store.getSnapshot();
    const stored = JSON.parse(localStorage.getItem('rss-reader:read') || '{}');
    return ids.filter((id) => state.readIds[id] || stored[id]).length;
  }, removedArticleIds);
  check(
    'Removing a feed cleans its read state',
    removedArticleIds.length > 0 && staleReadIds === 0,
    `${removedArticleIds.length} articles checked`
  );

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

  /* ------------------- Sources (select all/none) ----------------------- */
  await openSettings('Sources');
  await page.waitForSelector('#settings-feeds');
  await page.click('#settings-feeds button:has-text("Select all")');
  const allCountText = await page.textContent('#settings-feeds .manage-toolbar__count');
  await page.click('#settings-feeds button:has-text("Select none")');
  const noneCountText = await page.textContent('#settings-feeds .manage-toolbar__count');
  check(
    'Sources section supports Select all and Select none',
    /[1-9]\d* selected$/.test((allCountText || '').trim()) && /\b0 selected$/.test((noneCountText || '').trim()),
    `${allCountText?.trim()} → ${noneCountText?.trim()}`
  );

  /* ------------------- bulk move sources from Settings ------------------ */
  const sourceChecks = page.locator('#settings-feeds .manage-item input[type="checkbox"]');
  const feedsToMove = Math.min(2, await sourceChecks.count());
  for (let i = 0; i < feedsToMove; i += 1) await sourceChecks.nth(i).check();
  await page.click('#settings-feeds button:has-text("Move selected")');
  await page.waitForSelector('.folder-picker__list');
  check('Sources section offers bulk move through the same picker', true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.folder-picker', { state: 'detached' });
  check(
    'Escape closes only the stacked picker, not Settings under it',
    (await page.locator('#settings-feeds').count()) === 1
  );
  await page.click('#settings-feeds button:has-text("Move selected")');
  await page.waitForSelector('.folder-picker__list');
  await page.fill('.folder-picker__search input', 'zebra');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.folder-picker', { state: 'detached' });
  const zebraFeeds = await page
    .locator('.sidebar .folder-group:has-text("Zebra Video") .feed-item')
    .count();
  check('Bulk move puts every selected source in the group', zebraFeeds >= feedsToMove, `${zebraFeeds} sources in Zebra Video`);

  /* ----------------------- groups section (bulk) ----------------------- */
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  await openSettings('Groups');
  await page.waitForSelector('#settings-folders');
  await page.click('#settings-folders button:has-text("Select all")');
  const foldersSelected = (await page.textContent('#settings-folders .manage-toolbar__count'))?.trim();
  check('Groups section supports multiple selection', /^[1-9]\d* selected$/.test(foldersSelected || ''), foldersSelected || '');
  await page.click('#settings-folders button:has-text("Select none")');

  const folderRowChecks = page.locator('#settings-folders .manage-folder-row input[type="checkbox"]');
  await folderRowChecks.nth(0).check();
  await folderRowChecks.nth(1).check();
  await page.click('#settings-folders button:has-text("Delete selected")');
  await page.waitForSelector('.manage-confirm');
  const multiDeleteText = (await page.textContent('.manage-confirm__text'))?.trim();
  check(
    'Deleting several groups shows one combined confirmation',
    /2 groups/.test(multiDeleteText || ''),
    multiDeleteText
  );
  await page.click('.manage-confirm button:has-text("Cancel")');
  await page.waitForSelector('.manage-confirm', { state: 'detached' });
  await page.click('#settings-folders button:has-text("Select none")');

  const foldersBeforeDelete = await page.locator('.sidebar .folder-group').count();
  check(
    'Groups do not repeat per-row delete buttons',
    (await page.locator('#settings-folders .manage-folder__delete').count()) === 0
  );
  await page.locator('#settings-folders .manage-folder-row').first().locator('input').check();
  await page.click('#settings-folders button:has-text("Delete selected")');
  await page.waitForSelector('.manage-confirm');
  check('Delete group asks for confirmation inside Settings', true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.sidebar .folder-group').length === expected,
    foldersBeforeDelete - 1,
    { timeout: 5000 }
  );
  const foldersRemaining = await page.locator('.sidebar .folder-group').count();
  check('Delete group removes it and its sources', foldersRemaining === foldersBeforeDelete - 1, `${foldersRemaining} group(s) left`);

  /* ------------------ merge a group into another one ------------------- */
  const sourceFolder = (
    await page.locator('#settings-folders .manage-folder-row .manage-folder__name').first().textContent()
  )?.trim();
  const foldersBeforeMerge = await page.locator('.sidebar .folder-group').count();
  await page.locator('#settings-folders .manage-folder-row').first().locator('input[type="checkbox"]').check();
  await page.click('#settings-folders button:has-text("Merge selected")');
  await page.waitForSelector('.folder-picker__list');
  const mergeOptions = await page.$$eval('.folder-picker__option .folder-picker__label', (nodes) =>
    nodes.map((node) => node.textContent || '')
  );
  check(
    'Group merge excludes the groups being moved',
    Boolean(sourceFolder) && !mergeOptions.includes(sourceFolder),
    mergeOptions.join(', ')
  );
  await page.keyboard.press('Enter');
  await page.waitForSelector('.folder-picker', { state: 'detached' });
  const foldersAfterMerge = await page.locator('.sidebar .folder-group').count();
  check(
    'Merging a group removes it and keeps its sources',
    foldersAfterMerge === foldersBeforeMerge - 1,
    `${foldersBeforeMerge} → ${foldersAfterMerge}`
  );
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  await openDataTab('Import');

  /* ----------------------- OPML XML live editor ------------------------ */
  await page.click('#tab-xml');
  await page.waitForSelector('.opml-editor');
  const placeholder = await page.getAttribute('.opml-editor', 'placeholder');
  check('OPML editor shows an example placeholder', /<opml/.test(placeholder || ''));
  const currentXml = await page.inputValue('.opml-editor');
  const editedXml = currentXml.replace(/title="Fireship"/g, 'title="Fireship Channel"').replace(/text="Fireship"/g, 'text="Fireship Channel"');
  await page.fill('.opml-editor', editedXml);
  // React still has to commit the textarea value; without this breathing room
  // a fast click on CI can run previewXml against the previous text.
  await page.waitForTimeout(150);
  await page.click('#panel-xml .button--primary:has-text("Preview changes")');
  await page.waitForSelector('#panel-xml .import-preview', { timeout: 10_000 });
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

  await page.click('.sidebar__toolbar button[aria-label="New folder"]');
  await page.waitForSelector('[role="dialog"]');
  check('New folder opens as a dialog', (await page.locator('[role="dialog"]:has-text("New folder")').count()) === 1);
  await page.fill('[role="dialog"] input.input', 'Popup Group');
  await page.click('[role="dialog"] .dialog__footer .button--primary');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.folder-row .feed-row__title')].some((node) => node.textContent === 'Popup Group'),
    undefined,
    { timeout: 5000 }
  );
  check('New folder dialog creates the group', true);

  const toastCount = await page.locator('.toast').count();
  const errorBannerCount = await page.locator('.banner--error').count();
  check('Never stacks error banners or multiple toasts', toastCount <= 1 && errorBannerCount === 0, `toasts=${toastCount} banners=${errorBannerCount}`);

  await page.screenshot({ path: path.join(SHOTS, '04-final.png') });

  /* ------------------------------ mobile ------------------------------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const menuVisible = await page.isVisible('.topbar__menu');
  check('Mobile menu button appears', menuVisible);
  const refreshBox = await page
    .locator('.topbar__tools .icon-button[aria-label="Refresh all feeds"]')
    .boundingBox();
  const viewBox = await page.locator('.topbar__view').boundingBox();
  const filterBox = await page.locator('.topbar__filter').boundingBox();
  check(
    'Small-window toolbar icons match the refresh control size',
    Boolean(refreshBox && viewBox && filterBox) &&
      Math.abs(refreshBox.height - viewBox.height) < 1 &&
      Math.abs(refreshBox.height - filterBox.height) < 1 &&
      Math.abs(refreshBox.width - viewBox.width) < 1 &&
      Math.abs(refreshBox.width - filterBox.width) < 1,
    `${refreshBox?.width}×${refreshBox?.height} / ${viewBox?.width}×${viewBox?.height}`
  );
  const mainBefore = await page.locator('.main').boundingBox();
  await page.click('.topbar__menu');
  await page.waitForTimeout(400);
  const sidebarOpen = await page.getAttribute('.app', 'data-sidebar-open');
  check('Mobile drawer opens', sidebarOpen === 'true', sidebarOpen || '');
  const mainAfter = await page.locator('.main').boundingBox();
  const drawerBox = await page.locator('.sidebar').boundingBox();
  check(
    'Mobile drawer overlays from the left without moving the panel',
    Boolean(mainBefore && mainAfter && drawerBox) &&
      Math.abs(mainBefore.x - mainAfter.x) < 1 &&
      Math.abs(mainBefore.width - mainAfter.width) < 1 &&
      Math.abs(drawerBox.x) < 2 &&
      drawerBox.width <= 390 * 0.8,
    `drawer x=${drawerBox?.x}, width=${drawerBox?.width}, main x=${mainBefore?.x}→${mainAfter?.x}`
  );
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
  await closeArticle();

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
  await closeArticle();

  /* SoundCloud uses its widget player */
  await page.click('.article-card:has-text("SoundCloud track fixture")');
  await page.waitForSelector('.detail .media-card iframe');
  const soundcloudSrc = await page.getAttribute('.detail .media-card iframe', 'src');
  check(
    'SoundCloud plays inline via its widget',
    /w\.soundcloud\.com\/player\/\?url=/.test(soundcloudSrc || ''),
    soundcloudSrc || ''
  );
  await closeArticle();

  /* A provider link inside the body is detected without clicking anything */
  await page.click('.article-card:has-text("Spotify link in prose")');
  await page.waitForSelector('.detail .media-card iframe');
  const proseSrc = await page.getAttribute('.detail .media-card iframe', 'src');
  check(
    'A provider link in the article body is detected automatically',
    /open\.spotify\.com\/embed\/episode\//.test(proseSrc || ''),
    proseSrc || ''
  );
  await closeArticle();

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
  await closeArticle();

  /* Plain text item: nothing to play. Focus + Enter avoids a pointer click
     being intercepted by a transient overlay in CI. */
  const plainCard = page.locator('.article-card:has-text("Plain article with no media")');
  await plainCard.scrollIntoViewIfNeeded();
  await plainCard.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.detail');
  check('Articles without media get no player', (await page.$('.detail .media-card')) === null);
  await closeArticle();

  /* ------------------- copy link + load full content ------------------- */
  // Pointer hit-testing can get stuck on a stale compositor layer after the
  // provider iframes close in headless CI. Dispatch the click so this block
  // tests the app handlers without depending on that layer.
  await page
    .locator('.sidebar .feed-row:has-text("All articles")')
    .dispatchEvent('click');
  await page.fill('.search__input', 'Fixture story two');
  await page.waitForFunction(() => document.querySelectorAll('.article-card').length === 1);
  await page.locator('.article-card').dispatchEvent('click');
  await page.waitForSelector('.detail');
  const copyLinkButton = '.detail__actions button[aria-label="Copy article link"]';
  check(
    'Article toolbar offers Copy link',
    (await page.locator(copyLinkButton).count()) === 1
  );
  await page.locator(copyLinkButton).dispatchEvent('click');
  const copyOk = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.toast')].some((node) =>
          /Article link copied/i.test(node.textContent || '')
        ),
      undefined,
      { timeout: 5000 }
    )
    .then(() => true)
    .catch(() => false);
  check('Copy link copies the article URL', copyOk);

  await page
    .locator('.detail__actions button[aria-label="Load full article content"]')
    .dispatchEvent('click');
  await page.waitForFunction(
    () => /Original full article/.test(document.querySelector('.detail .content')?.textContent || ''),
    undefined,
    { timeout: 15_000 }
  );
  check('Load full content replaces the feed excerpt', true);
  check(
    'Full content is marked active',
    (await page.getAttribute('.detail__actions button[aria-label="Show feed content"]', 'aria-pressed')) === 'true'
  );
  await page
    .locator('.detail__actions button[aria-label="Show feed content"]')
    .dispatchEvent('click');
  await page.waitForFunction(
    () => !/Original full article/.test(document.querySelector('.detail .content')?.textContent || '')
  );
  check('Toggling full content off restores the feed content', true);
  // Reset through the store: the next section reloads the page, and closing
  // through history is already covered by the dedicated history tests above.
  await page.evaluate(() => {
    window.__store.setActiveArticle(null);
    window.__store.setQuery('');
  });
  await page.waitForTimeout(100);

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
  await openSettings('Preferences');
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
  await openSettings('Preferences');
  const respectedToggle = await page.getAttribute(mediaToggle, 'aria-checked');
  check('An opt-out made after the migration survives a reload', respectedToggle === 'false');
  await page.click(mediaToggle);
  await page.keyboard.press('Escape');

  /* -------------------------- retry backoff ---------------------------- */
  // Failed feeds are retried automatically with exponential backoff; a manual
  // refresh bypasses it. Uses the dev store directly so no UI is involved.
  const backoff = await page.evaluate(async (badUrl) => {
    const store = window.__store;
    const snapshot = () => store.getSnapshot();
    store.importFeeds([{ url: badUrl, title: 'Backoff fixture' }], { skipRefresh: true });
    const feed = snapshot().feeds.find((f) => f.title === 'Backoff fixture');
    await store.refreshFeed(feed.id, { force: true });
    const first = snapshot().feeds.find((f) => f.id === feed.id);
    await store.refreshFeed(feed.id); // inside the backoff window: no request
    const skipped = snapshot().feeds.find((f) => f.id === feed.id);
    await store.refreshFeed(feed.id, { force: true }); // manual: retries
    const forced = snapshot().feeds.find((f) => f.id === feed.id);
    store.removeFeeds([feed.id], { silent: true });
    return {
      failures: first.failures,
      retryInMs: first.nextRetryAt - Date.now(),
      failuresAfterSkip: skipped.failures,
      failuresAfterForce: forced.failures,
    };
  }, fixture('missing.xml'));
  check(
    'Failed feeds back off and only a forced refresh retries',
    backoff.failures === 1 &&
      backoff.retryInMs > 0 &&
      backoff.failuresAfterSkip === 1 &&
      backoff.failuresAfterForce === 2,
    `${backoff.failures} → ${backoff.failuresAfterSkip} → ${backoff.failuresAfterForce}`
  );

  /* ---------------------------- console noise -------------------------- */
  // Direct-first fetching always logs a CORS refusal before the proxy hop, and
  // favicon misses are cosmetic — neither is an application error. Third-party
  // players may also refuse framing or be unreachable offline; that is the
  // provider's business, not ours.
  const relevantErrors = consoleErrors.filter(
    (e) =>
      !/favicon|Failed to load resource|net::ERR|CORS policy|Permissions policy violation|compute-pressure|404|419|Refused to display|X-Frame-Options|open\.spotify\.com|player\.vimeo\.com|w\.soundcloud\.com/.test(
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
