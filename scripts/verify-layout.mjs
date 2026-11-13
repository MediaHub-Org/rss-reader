/** Visible search/settings checks against the dev server. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: process.argv.includes('--headless') });
await mkdir('test-artifacts', { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 600 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.empty-state');
      if (viewport.width < 1000) await page.getByRole('button', { name: 'Show feed list', exact: true }).click();
      const search = page.locator('.search__input');
      const trigger = page.locator('.search__options');
      await trigger.hover();
      const field = await search.boundingBox();
      const button = await trigger.boundingBox();
      assert.ok(button.x > field.x && button.y > field.y);
      assert.ok(button.x + button.width < field.x + field.width);
      assert.ok(button.y + button.height < field.y + field.height);
      assert.ok(Math.abs(button.y + button.height / 2 - field.y - field.height / 2) < 1);
      await page.mouse.move(field.x + field.width + 2, field.y + field.height / 2);
      assert.equal(await trigger.evaluate((el) => el.matches(':hover')), false);
      await trigger.click();
      const menu = page.getByRole('menu', { name: 'Search options' });
      await menu.getByRole('menuitemcheckbox', { name: 'Case sensitive', exact: true }).hover();
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      await menu.getByRole('menuitemcheckbox', { name: 'Case sensitive', exact: true }).click();
      await page.keyboard.press('Escape');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      console.log(`PASS  Search hover stays inside the field and options work at ${viewport.width}px`);
      if (viewport.width < 1000) await page.getByRole('button', { name: 'Close feed list', exact: true }).click();

      await page.locator('.topbar__tools button[aria-label="Settings"]').click();
      const dialog = page.locator('.settings-dialog');
      await dialog.waitFor();
      await page.waitForTimeout(180); // opening animation must finish before measuring
      const initial = await dialog.boundingBox();
      for (const section of ['Manage', 'Rules', 'Services', 'Data', 'About', 'Preferences']) {
        await page.locator('.settings-nav').getByRole('button', { name: section, exact: true }).click();
        if (section === 'Manage') {
          await page.getByRole('tab', { name: 'Groups', exact: true }).click();
          await page.getByRole('tab', { name: 'Sources', exact: true }).click();
        }
        const box = await dialog.boundingBox();
        for (const key of ['x', 'y', 'width', 'height']) {
          assert.ok(Math.abs(box[key] - initial[key]) < 1, `${section} changed ${key} at ${viewport.width}px`);
        }
      }
      const body = dialog.locator('.dialog__body');
      assert.ok(await body.evaluate((el) => el.scrollHeight > el.clientHeight));
      await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      assert.ok(await body.evaluate((el) => el.scrollTop > 0));
      await page.locator('.settings-nav').getByRole('button', { name: 'About', exact: true }).click();
      assert.equal(await body.evaluate((el) => el.scrollTop), 0);
      await page.screenshot({ path: `test-artifacts/settings-layout-${viewport.width}.png` });
      console.log(`PASS  All settings sections keep their size/position and content scrolls at ${viewport.width}px`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
