import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile } from 'node:fs/promises';

const capture = process.env.CAPORA_CAPTURE_THEME === 'true';
const evidence = 'docs/review/agora-app-theme';
const routes = [
  '/marketplace',
  '/marketplace/gleif_entities',
  '/overview',
  '/agents',
  '/bank',
  '/transactions',
  '/approvals',
  '/providers',
  '/developers',
  '/demo',
];

async function screenshot(page: Page, name: string) {
  if (!capture) return;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: 'disabled' });
}
let authenticatedCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
// Authenticate once and reuse this real fixture session across responsive contexts.
// Repeated sign-ins would consume the application's intentional login rate limit.
test.beforeAll(async ({ request }) => {
  const credentials = JSON.parse(await readFile('.local/credentials.json', 'utf8'));
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'http://localhost:5174' },
    data: { email: 'demo@capora.local', password: credentials.dashboardPassword },
  });
  expect(response.status()).toBe(200);
  authenticatedCookies = (await request.storageState()).cookies;
});
async function signIn(page: Page) {
  await page.context().addCookies(authenticatedCookies);
}
async function assertTheme(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page
      .locator('h1')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('Chakra Petch');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `Horizontal overflow on ${page.url()}`).toBe(page.viewportSize()!.width);
  const families = await page
    .locator('h1,h2,h3,p,button,input,textarea,code,pre,select')
    .evaluateAll((elements) => [
      ...new Set(
        elements.filter((el) => el.getClientRects().length).map((el) => getComputedStyle(el).fontFamily),
      ),
    ]);
  expect(
    families.every((font) => font.includes('Chakra Petch')),
    families.join(', '),
  ).toBe(true);
}

for (const [width, height] of [
  [1440, 900],
  [1280, 600],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [390, 600],
  [360, 600],
  [667, 320],
]) {
  test(`all workspace routes share the agora theme without overflow at ${width}x${height}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page);
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('main.page-content h1')).toBeVisible();
      await expect(page.locator('main.page-content .skeleton')).toHaveCount(0);
      await assertTheme(page);
      if (width === 1440) {
        const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(accessibility.violations, route).toEqual([]);
      }
      if (
        [
          [1440, 900],
          [390, 844],
        ].some(([w, h]) => w === width && h === height)
      ) {
        await screenshot(page, `${route.slice(1).replaceAll('/', '-')}-${width}`);
      }
    }
    expect(errors).toEqual([]);
  });
}

test('authentication screens use the shared theme', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const route of ['/login', '/signup']) {
      await page.goto(route);
      await assertTheme(page);
      await screenshot(page, `${route.slice(1)}-${width}`);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(results.violations).toEqual([]);
    }
  }
});

test('workspace dialogs retain keyboard focus, scrolling and readable forms in the agora theme', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 600 : 900 });
    await page.goto('/agents');
    const create = page.getByRole('button', { name: 'Create agent', exact: true }).first();
    await create.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Agent name')).toBeFocused();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await screenshot(page, `create-agent-${width}`);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(create).toBeFocused();
    await page.goto('/providers');
    await page.getByRole('button', { name: 'List capability', exact: true }).click();
    await expect(dialog.getByLabel('Capability name', { exact: true })).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog
      .getByLabel('Output JSON Schema')
      .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await expect(dialog.getByLabel('Output JSON Schema')).toBeInViewport({ ratio: 1 });
    await screenshot(page, `list-capability-${width}`);
    await page.keyboard.press('Escape');
    await page.goto('/developers');
    await expect(page.locator('main.page-content h1')).toBeVisible();
    await expect(page.locator('main.page-content .skeleton')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  }
});
