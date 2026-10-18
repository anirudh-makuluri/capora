import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';
import type { Capability } from '../../packages/types/src/index';

const evidence = process.env.CAPORA_CAPTURE_LANDING === 'true';
const evidenceDir = 'docs/review/pixel-agora';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.ag-stall h3').first()).toHaveText('Company Registry Search');
  await page.evaluate(() => document.fonts.ready);
}

async function transformX(locator: Locator) {
  return locator.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
}

async function snapshot(page: Page, name: string, scene = false) {
  if (!evidence) return;
  await mkdir(evidenceDir, { recursive: true });
  if (scene)
    await page.locator('#game').screenshot({ path: `${evidenceDir}/${name}.png`, animations: 'disabled' });
  else {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true, animations: 'disabled' });
  }
}

test('public landing uses current catalog metadata, accessible inspection, and existing auth routes', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url());
  });
  const catalog = (await (await page.request.get('/api/capabilities')).json()) as Capability[];
  await ready(page);
  for (const [i, id] of ['gleif_entities', 'sd_repo_analysis', 'code_scan'].entries()) {
    const item = catalog.find((c) => c.id === id)!;
    const card = page.locator('.ag-stall').nth(i);
    await expect(card.locator('h3')).toHaveText(item.name);
    const trigger = card.getByRole('button', { name: 'Inspect stall' });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(item.description);
    await expect(dialog).toContainText(`$${(item.priceCents / 100).toFixed(2)}`);
    await expect(dialog).toContainText('FOR DEMONSTRATION PURPOSES ONLY');
    await expect(dialog.getByRole('link')).toHaveAttribute('href', `/marketplace/${id}`);
    for (let j = 0; j < 6; j++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  expect(writes).toEqual([]);
  await page.getByRole('link', { name: 'Explore the agora' }).click();
  await expect(page).toHaveURL(/\/login$/);
  // Sign-in still restores the intended marketplace route.
  const credentials = JSON.parse(await readFile('.local/credentials.json', 'utf8'));
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('demo@capora.local');
  await page.getByLabel('Password', { exact: true }).fill(credentials.dashboardPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace$/);
  await expect(page.getByRole('heading', { name: 'Marketplace', exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Open workspace', exact: false }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  // The approved agora typeface now continues into the authenticated workspace.
  await expect(page.locator('.app-shell')).toBeVisible();
  expect(await page.locator('.app-shell').evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
    'Chakra',
  );
});

test('five-stage exchange moves scroll from merchant to robot and coin toward merchant', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await expect(page.locator('.ag-ticker-track')).toHaveCSS('animation-play-state', 'paused');
  await expect(page.locator('.ag-robot-core')).toHaveCSS('animation-play-state', 'paused');
  const robot = page.locator('.ag-robot');
  const scroll = page.locator('.ag-crystal');
  const coin = page.locator('.ag-coin');
  await page.getByRole('button', { name: 'Trade step 1', exact: true }).click();
  await expect.poll(() => robot.evaluate((el) => getComputedStyle(el).translate)).toBe('-60px');
  await expect(scroll).toHaveCSS('opacity', '0');
  await snapshot(page, 'desktop-stage-1-arrival', true);

  await page.getByRole('button', { name: 'Trade step 2', exact: true }).click();
  const offerStart = await transformX(scroll);
  expect(offerStart).toBeGreaterThan(620); // Merchant's counter is at x=579..751.
  await expect.poll(() => transformX(scroll)).toBeCloseTo(556, 0);
  await snapshot(page, 'desktop-stage-2-offer', true);

  await page.getByRole('button', { name: 'Trade step 3', exact: true }).click();
  await expect.poll(() => transformX(scroll)).toBeCloseTo(542, 0);
  await expect.poll(() => robot.evaluate((el) => getComputedStyle(el).translate)).toBe('0px');
  await expect(page.locator('.ag-bot-arm')).toHaveCSS('rotate', '-24deg');
  await snapshot(page, 'desktop-stage-3-inspection', true);
  const coinBefore = await coin.boundingBox();

  await page.getByRole('button', { name: 'Trade step 4', exact: true }).click();
  await expect.poll(() => transformX(scroll)).toBeCloseTo(503, 0);
  await expect(coin).toHaveCSS('translate', '94px -40px');
  expect((await coin.boundingBox())!.x).toBeGreaterThan(coinBefore!.x);
  await snapshot(page, 'desktop-stage-4-purchase', true);

  await page.getByRole('button', { name: 'Trade step 5', exact: true }).click();
  await expect(page.locator('.ag-acquire-burst')).toHaveCSS('visibility', 'hidden');
  await expect.poll(() => transformX(scroll)).toBeCloseTo(448, 0);
  await expect(page.locator('.ag-acquire-burst')).toHaveCSS('visibility', 'visible');
  await expect(coin).toHaveCSS('opacity', '0');
  // The acquired scroll overlaps the robot's chest (local scene x=416..473, y=333..407).
  const chest = await page.locator('.ag-robot-core > rect').nth(8).boundingBox();
  const acquired = await scroll.boundingBox();
  expect(acquired!.x).toBeLessThan(chest!.x + chest!.width);
  expect(acquired!.x + acquired!.width).toBeGreaterThan(chest!.x);
  expect(acquired!.y).toBeLessThan(chest!.y + chest!.height);
  await snapshot(page, 'desktop-stage-5-acquisition', true);
  await snapshot(page, 'desktop-1440');
  await page.getByRole('button', { name: 'Replay animation' }).click();
  await expect(page.locator('#game')).toHaveClass(/ag-phase-0/);
  await expect(page.getByRole('button', { name: 'Pause animation' })).toBeVisible();
  await expect(page.locator('#game')).toHaveClass(/ag-phase-1/, { timeout: 5000 });
});

for (const width of [1440, 390]) {
  test(`reference palette, typography and original artwork remain at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page);
    const textFonts = await page
      .locator('.agora-landing :is(h1,h2,h3,p,a,button,small,strong)')
      .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fontFamily))]);
    expect(textFonts.every((font) => font.includes('Chakra Petch'))).toBe(true);
    const reference = await context.newPage();
    await reference.setViewportSize({ width, height: width === 390 ? 844 : 1050 });
    await reference.emulateMedia({ reducedMotion: 'reduce' });
    await reference.route('**/__landing-reference', (route) =>
      route.fulfill({ contentType: 'text/html', path: 'docs/design/pixel-agora-reference.html' }),
    );
    await reference.goto('/__landing-reference');
    await reference.evaluate(() => document.fonts.ready);
    for (const selector of ['.section h2', '.ledger', '.how-copy p', '.decree']) {
      const actualSelector = selector.replace(/\.([\w-]+)/g, '.ag-$1');
      const actual = await page
        .locator(actualSelector)
        .first()
        .evaluate((el) => {
          const css = getComputedStyle(el);
          return [
            css.fontFamily,
            css.fontWeight,
            css.color,
            css.backgroundColor,
            css.borderTopWidth === '0px' ? '0px' : css.border,
            css.boxShadow,
          ];
        });
      const expected = await reference
        .locator(selector)
        .first()
        .evaluate((el) => {
          const css = getComputedStyle(el);
          return [
            css.fontFamily,
            css.fontWeight,
            css.color,
            css.backgroundColor,
            css.borderTopWidth === '0px' ? '0px' : css.border,
            css.boxShadow,
          ];
        });
      expect(actual, selector).toEqual(expected);
    }
    // Viewport sizing is intentional; the approved palette, typeface, borders
    // and original artwork remain intact across every section.
    for (const selector of ['.hero', '.hero h1', '.badge', '.game']) {
      const appearance = (el: Element) => {
        const css = getComputedStyle(el);
        return [
          css.fontFamily,
          css.fontWeight,
          css.color,
          css.backgroundColor,
          css.borderColor,
          css.boxShadow,
        ];
      };
      expect(await page.locator(selector.replace(/\.([\w-]+)/g, '.ag-$1')).evaluate(appearance)).toEqual(
        await reference.locator(selector).evaluate(appearance),
      );
    }
    // All original SVG nodes/attributes survive the JSX port, including the scroll and merchant.
    const svgNodes = (svg: SVGElement) =>
      Array.from(svg.querySelectorAll('*')).map((el) => ({
        tag: el.tagName,
        attributes: Array.from(el.attributes)
          .filter((a) => a.name !== 'class')
          .map((a) => [a.name, a.value]),
      }));
    expect(await page.locator('.ag-game svg').evaluate(svgNodes)).toEqual(
      await reference.locator('.game svg').evaluate(svgNodes),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole('button', { name: 'Trade step 5', exact: true }).click();
    await snapshot(page, width === 390 ? 'mobile-390' : 'desktop-1440-reduced-motion');
    await reference.getByRole('button', { name: 'Trade step 5', exact: true }).click();
    if (evidence) {
      await reference.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await reference.screenshot({
        path: `${evidenceDir}/reference-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    await reference.close();
  });
}

test('mobile keyboard navigation, all stages, reduced motion, and accessible dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  const menu = page.getByRole('button', { name: 'Toggle menu' });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Open workspace' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  for (let i = 0; i < 5; i++) {
    const control = page.getByRole('button', { name: `Trade step ${i + 1}`, exact: true });
    await control.focus();
    await page.keyboard.press('Enter');
    await expect(control).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#game')).toHaveClass(new RegExp(`ag-phase-${i}`));
    await expect
      .poll(() => transformX(page.locator('.ag-crystal')))
      .toBeCloseTo([665, 556, 542, 503, 448][i], 0);
    await snapshot(page, `mobile-stage-${i + 1}`, true);
  }
  await expect(page.getByRole('button', { name: 'Pause animation' })).not.toBeVisible();
  expect(await page.locator('.ag-robot-core').evaluate((el) => getComputedStyle(el).animationDuration)).toBe(
    '1e-05s',
  );
  await page.getByRole('button', { name: 'Replay animation' }).click();
  await page.waitForTimeout(3300);
  await expect(page.locator('#game')).toHaveClass(/ag-phase-0/);
  await page.locator('.ag-ledger-step').nth(3).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#game')).toHaveClass(/ag-phase-3/);
  // The approved palette has inherited contrast failures; preserve its colors and
  // document that separate audit in docs/review/pixel-agora/README.md.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['color-contrast'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('button', { name: 'Inspect stall' }).first().click();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .disableRules(['color-contrast'])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test('catalog failure or missing listing cannot create a fabricated offer', async ({ page }) => {
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":{"message":"Temporarily unavailable"}}',
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('The catalog could not be loaded');
  await expect(page.getByRole('button', { name: 'Inspect stall' })).toHaveCount(0);
  await expect(page.locator('.ag-stall-price')).not.toContainText(['$0.20', '$0.05', '$3.00']);
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }),
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('status')).not.toBeVisible();
  await expect(page.locator('.ag-stall h3')).toHaveText([
    'Stall unavailable',
    'Stall unavailable',
    'Stall unavailable',
  ]);
});

test('complete hero, actions, artwork and ticker fit the first viewport', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Trade step 5', exact: true }).click();
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1440, 768],
    [1366, 768],
    [1280, 600],
    [1024, 768],
    [820, 600],
    [768, 1024],
    [430, 932],
    [390, 844],
    [375, 667],
    [390, 600],
    [360, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    for (const selector of [
      'header',
      '.ag-hero h1',
      '.ag-hero-copy p',
      '.ag-hero-actions',
      '.ag-tiny-note',
      '#game',
      '.ag-dialogue',
      '.ag-game-foot',
      '.ag-playback',
      '.ag-ticker',
    ]) {
      const element = page.locator(selector).first();
      await expect(element, `${selector} at ${width}×${height}`).toBeInViewport({ ratio: 1 });
    }
    const ticker = await page.locator('.ag-ticker').boundingBox();
    expect(ticker!.y + ticker!.height, `ticker bottom at ${width}×${height}`).toBeLessThanOrEqual(
      height + 0.5,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    // No caption overlays the acquired capability, even in the smallest scene.
    const scroll = await page.locator('.ag-crystal').boundingBox();
    const dialogue = await page.locator('.ag-dialogue').boundingBox();
    expect(scroll!.y + scroll!.height).toBeLessThan(dialogue!.y);
    if (
      evidence &&
      [
        [1366, 768],
        [1280, 600],
        [1024, 768],
        [390, 844],
        [390, 600],
      ].some(([w, h]) => w === width && h === height)
    ) {
      await page.screenshot({
        path: `${evidenceDir}/first-view-${width}x${height}.png`,
        animations: 'disabled',
      });
    }
  }
  // Very short landscape/zoomed layouts remain scrollable instead of clipping.
  await page.setViewportSize({ width: 667, height: 320 });
  await page.getByRole('button', { name: 'Watch a trade' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Watch a trade' })).toBeInViewport({ ratio: 1 });
  expect(await page.locator('.ag-hero').evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible');
});

test('remaining sections fit below the header on desktop and mobile without clipping', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
    [1280, 600],
    [1024, 768],
    [820, 600],
    [768, 1024],
    [390, 844],
    [375, 667],
    [390, 600],
    [360, 600],
  ]) {
    await page.setViewportSize({ width, height });
    for (const selector of ['#stalls', '#how', '#guard', '.ag-end']) {
      await page.locator(selector).evaluate((el) => {
        const header = document.querySelector('header')!.getBoundingClientRect().height;
        window.scrollTo({ top: scrollY + el.getBoundingClientRect().top - header, behavior: 'instant' });
      });
      const section = await page.locator(selector).boundingBox();
      expect(section!.y + section!.height, `${selector} bottom at ${width}×${height}`).toBeLessThanOrEqual(
        height + 1,
      );
      const content = page.locator(`${selector} > .ag-wrap`);
      await expect(content).toBeInViewport({ ratio: 1 });
      // The full decree, footer buttons and stall inspection controls remain reachable.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (selector === '.ag-end') await expect(page.locator('footer')).toBeInViewport({ ratio: 1 });
      if (
        evidence &&
        [
          [1440, 900],
          [1280, 600],
          [390, 844],
          [390, 600],
        ].some(([w, h]) => w === width && h === height)
      ) {
        await page.screenshot({
          path: `${evidenceDir}/section-${selector.replace(/[.#]/g, '')}-${width}x${height}.png`,
          animations: 'disabled',
        });
      }
    }
  }
  // Expanded copy and unusually short windows grow naturally instead of being cut off.
  await page.locator('.ag-how-details summary').click();
  await expect(page.locator('.ag-how-details')).toHaveAttribute('open', '');
  await page
    .getByRole('link', { name: 'See the human guardrails' })
    .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(page.getByRole('link', { name: 'See the human guardrails' })).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 667, height: 320 });
  await page
    .locator('.ag-decree-foot')
    .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(page.locator('.ag-decree-foot')).toBeInViewport({ ratio: 1 });
});

test('mobile stalls support arrows, keyboard scrolling and real inspection for every card', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const rail = page.getByRole('region', { name: 'Featured capability stalls' });
  const navigation = page.locator('.ag-stall-navigation');
  await rail.scrollIntoViewIfNeeded();
  await expect(navigation).toContainText('Stall 1 of 3');
  await expect(page.getByRole('button', { name: 'Previous stall' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next stall' }).click();
  await expect(navigation).toContainText('Stall 2 of 3');
  await rail.focus();
  await page.keyboard.press('ArrowRight');
  await expect(navigation).toContainText('Stall 3 of 3');
  await expect(page.getByRole('button', { name: 'Next stall' })).toBeDisabled();
  await page.locator('.ag-stall').nth(2).getByRole('button', { name: 'Inspect stall' }).click();
  await expect(page.getByRole('dialog')).toContainText('Code Pattern Scan');
  await page.keyboard.press('Escape');
  await rail.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(navigation).toContainText('Stall 2 of 3');
  // Native touch/trackpad scrolling shares the same counter and snap positions.
  await rail.evaluate((el) => el.scrollTo({ left: 0, behavior: 'instant' }));
  await expect(navigation).toContainText('Stall 1 of 3');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(navigation).not.toBeVisible();
  await expect(page.locator('.ag-how-details')).toHaveAttribute('open', '');
});
