import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test('admins approve hosts, publish, remove and restore capabilities on desktop and mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const credentials = JSON.parse(await readFile('.local/credentials.json', 'utf8'));
  const login = await page.request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'http://localhost:5174', 'CF-Connecting-IP': '192.0.2.50' },
    data: { email: 'demo@capora.local', password: credentials.dashboardPassword },
  });
  expect(login.ok()).toBe(true);
  await page.goto('/overview');
  await page.getByRole('link', { name: 'Admin dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Admin dashboard', exact: true })).toBeVisible();
  await page.getByLabel('Provider hostnames', { exact: true }).fill('api.admin-provider.com');
  await page.getByRole('button', { name: 'Save hostnames', exact: true }).click();
  await expect(page.getByText('1 approved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Provider hostnames', { exact: true })).toHaveValue('api.admin-provider.com');
  await page.getByRole('button', { name: 'Add capability', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Capability name', { exact: true }).fill('Admin Inventory Lookup');
  await dialog
    .getByLabel('What unique access does it provide?', { exact: true })
    .fill('Private inventory availability from an authenticated warehouse API.');
  await dialog.getByLabel('Provider endpoint').fill('https://api.admin-provider.com/query');
  await dialog.getByRole('button', { name: 'Publish capability', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search managed capabilities', exact: true })
    .fill('Admin Inventory Lookup');
  const row = page.getByRole('row').filter({ hasText: 'Admin Inventory Lookup' });
  await expect(row.getByText('Published', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/screenshots/admin-desktop.png', fullPage: true });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove capability', exact: true }).click();
  await expect(row.getByText('Removed', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(row.getByText('Published', { exact: true })).toBeVisible();
  await page.getByLabel('Provider hostnames', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save hostnames', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Revoke provider hostnames?' })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke and save', exact: true }).click();
  await expect(page.getByText('0 approved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Provider hostnames', { exact: true })).toHaveValue('');
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('textbox', { name: 'Search managed capabilities', exact: true })
    .fill('Admin Inventory Lookup');
  await page.screenshot({
    path: '.local/screenshots/admin-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('main').analyze();
  expect(
    accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
  ).toEqual([]);
  expect(errors).toEqual([]);
  // Leave the shared fixture catalog clean for the other browser specs.
  const capabilities = (await (await page.request.get('/api/admin/capabilities')).json()) as {
    id: string;
    name: string;
  }[];
  const added = capabilities.find((cap) => cap.name === 'Admin Inventory Lookup');
  await page.request.delete(`/api/admin/capabilities/${added?.id}`, { data: {} });
});

test('admins change marketplace fees, recover stale drafts and retain the rate after reload', async ({
  page,
  context,
}) => {
  const credentials = JSON.parse(await readFile('.local/credentials.json', 'utf8'));
  expect(
    (
      await page.request.post('/api/auth/sign-in/email', {
        headers: { Origin: 'http://localhost:5174', 'CF-Connecting-IP': '192.0.2.51' },
        data: { email: 'demo@capora.local', password: credentials.dashboardPassword },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/admin');
  const stale = await context.newPage();
  await stale.goto('/admin');
  const region = page.getByRole('region', { name: 'Marketplace transaction fee' });
  const field = region.getByRole('spinbutton', { name: /Marketplace fee/ });
  await expect(field).toHaveValue('2.5');
  await expect(stale.getByRole('spinbutton', { name: /Marketplace fee/ })).toHaveValue('2.5');
  try {
    for (const invalid of ['', '-1', '10.01', '1.001']) {
      await field.fill(invalid);
      await expect(region.getByRole('button', { name: 'Save fee', exact: true })).toBeDisabled();
    }
    await field.fill('1.75');
    await region.getByRole('button', { name: 'Save fee', exact: true }).click();
    await expect(region.getByText('1.75% current fee', { exact: true })).toBeVisible();
    await expect(region.getByRole('status')).toContainText('Marketplace fee saved');
    await page.reload();
    await expect(field).toHaveValue('1.75');
    await page.screenshot({ path: '.local/screenshots/admin-fee-desktop.png', fullPage: true });
    await stale.getByRole('spinbutton', { name: /Marketplace fee/ }).fill('4');
    await stale.getByRole('button', { name: 'Save fee', exact: true }).click();
    await expect(stale.getByRole('alert')).toContainText('Another admin changed the marketplace fee');
    await stale.getByRole('button', { name: 'Reload fee', exact: true }).click();
    await expect(stale.getByRole('spinbutton', { name: /Marketplace fee/ })).toHaveValue('1.75');
    await expect(stale.getByRole('alert')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await field.fill('0');
    await region.getByRole('button', { name: 'Save fee', exact: true }).click();
    await expect(region.getByText('0% current fee', { exact: true })).toBeVisible();
    await page.reload();
    await expect(field).toHaveValue('0');
    await page.screenshot({ path: '.local/screenshots/admin-fee-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).include('main').analyze();
    expect(accessibility.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual(
      [],
    );
  } finally {
    const saved = await (await page.request.get('/api/admin/marketplace-fee')).json();
    await page.request.put('/api/admin/marketplace-fee', { data: { feeBps: 250, revision: saved.revision } });
    await stale.close();
  }
});

test('ordinary accounts cannot see admin navigation or access the dashboard API', async ({ page }) => {
  const signup = await page.request.post('/api/auth/sign-up/email', {
    headers: { Origin: 'http://localhost:5174', 'CF-Connecting-IP': '192.0.2.50' },
    data: {
      name: 'Ordinary member',
      email: `admin-denied-${crypto.randomUUID()}@example.com`,
      password: 'browser-admin-test-password-only-2026',
    },
  });
  expect(signup.ok()).toBe(true);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin access required', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin dashboard', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/admin/capabilities')).status()).toBe(403);
  expect((await page.request.get('/api/admin/marketplace-fee')).status()).toBe(403);
  expect(
    (await page.request.put('/api/admin/marketplace-fee', { data: { feeBps: 0, revision: 0 } })).status(),
  ).toBe(403);
});
