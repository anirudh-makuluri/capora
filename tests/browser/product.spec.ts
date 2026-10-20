import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { builtinCapabilities } from '../../apps/worker/src/providers/capabilities/registry';

import type { Capability, Invocation } from '../../packages/types/src/index';

test.beforeEach(async ({ page }) => {
  const credentials = JSON.parse(await readFile('.local/credentials.json', 'utf8'));
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'http://localhost:5174' },
    data: { email: 'demo@capora.local', password: credentials.dashboardPassword },
  });
  expect(response.ok(), response.ok() ? '' : await response.text()).toBe(true);
});
test('marketplace discovers, filters, and opens machine-readable details', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/marketplace');
  await expect(page.getByRole('heading', { name: 'Marketplace', exact: true })).toBeVisible();
  await expect(page.locator('.market-hero, .market-trust, .catalog-count, .catalog-note')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Find your next capability' })).toHaveCount(0);
  await expect(page.getByText(/Your agent’s next breakthrough|Give your agents access/)).toHaveCount(0);
  await expect(page.locator('.capability-card[href*="/bank_"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(
    page.getByLabel('Filter category').getByRole('option', { name: 'Capora Bank', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.locator('.capability-card')).toHaveCount(builtinCapabilities.length);
  await page.getByRole('tab', { name: 'Datasets', exact: true }).click();
  await expect(page.locator('.capability-card')).toHaveCount(
    builtinCapabilities.filter((capability) => capability.type === 'dataset').length,
  );
  await page.getByRole('tab', { name: /All capabilities/ }).click();
  await page.getByRole('textbox', { name: 'Search capabilities' }).fill('registry');
  await expect(page.locator('.capability-card')).toHaveCount(1);
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Company Registry Search', exact: true }) })
    .click();
  await expect(page.getByRole('heading', { name: 'Company Registry Search', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Input schema', exact: true }).click();
  await expect(page.locator('.detail-panel pre')).toContainText('company');
  await page.screenshot({ path: '.local/screenshots/capability-desktop.png', fullPage: true });
  await page.goto('/marketplace');
  await page.getByRole('textbox', { name: 'Search capabilities' }).fill('AWS Lambda');
  await expect(page.locator('.capability-card')).toHaveCount(1);
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'AWS Lambda Cost Estimate', exact: true }) })
    .click();
  await expect(page.getByRole('heading', { name: 'AWS Lambda Cost Estimate', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Input schema', exact: true }).click();
  await expect(page.locator('.detail-panel pre')).toContainText('averageBilledDurationMs');
  for (const [id, name, field] of [
    ['brave_search', 'Brave Web Search', 'query'],
    ['context_scrape', 'Context.dev Page Extraction', 'url'],
    ['azure_maps_geocode', 'Azure Maps Geocoding', 'query'],
    ['sd_repo_analysis', 'SD-Artifacts Repository Analysis', 'packagePath'],
    ['riot_recent_matches', 'Riot Recent League Matches', 'gameName'],
  ]) {
    await page.goto(`/marketplace/${id}`);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Input schema', exact: true }).click();
    await expect(page.locator('.detail-panel pre')).toContainText(field);
  }
  expect(errors).toEqual([]);
});
test('purchased computed tools deliver usable results with approval and queued execution', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/marketplace/document_fingerprint');
  await expect(page.locator('.detail-provider')).toContainText('Capora Bank');
  await page.getByRole('textbox', { name: 'Invocation arguments' }).fill(JSON.stringify({ text: 'abc' }));
  await page.getByRole('button', { name: 'Get a quote' }).click();
  await page.getByRole('button', { name: 'Purchase capability' }).click();
  const invocationResponse = page.waitForResponse(
    (response) => response.url().endsWith('/invocations') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Invoke capability' }).click();
  const invocation = (await (await invocationResponse).json()) as Invocation;
  await expect(page.locator('.result-panel')).toContainText(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  await expect(page.locator('.result-panel')).toContainText('"synthetic": false');
  expect(invocation.ratingRequest).toMatchObject({ required: true, tool: 'rate_capability' });
  const before = (await (
    await page.request.get('/api/capabilities/document_fingerprint')
  ).json()) as Capability;
  const rating = await page.request.post(`/api/agents/${invocation.agentId}/ratings`, {
    data: { invocation_id: invocation.id, rating: 4, body: 'Returned the expected known digest.' },
  });
  expect(rating.ok()).toBe(true);
  await page.reload();
  const count = before.reviewCount + 1;
  const average = ((before.rating * before.reviewCount + 4) / count).toFixed(1);
  await expect(page.locator('.detail-trust')).toContainText(`${average} / 5`);
  await expect(page.locator('.detail-trust')).toContainText(
    `${count} verified ${count === 1 ? 'rating' : 'ratings'}`,
  );
  await page.goto('/marketplace');
  const card = page.locator('.capability-card').filter({ hasText: 'Document Fingerprint' });
  await expect(card).toContainText(`${average} (${count})`);
  await page.goto('/marketplace/code_scan');
  await page
    .getByRole('textbox', { name: 'Invocation arguments' })
    .fill(JSON.stringify({ code: 'eval(req.body.code);' }));
  await page.getByRole('button', { name: 'Get a quote' }).click();
  await page.getByRole('button', { name: 'Purchase capability' }).click();
  await page.goto('/approvals');
  await page.getByRole('button', { name: 'Approve 3.00 cUSD' }).click();
  await page.goto('/transactions');
  await page.locator('.table-capability').filter({ hasText: 'Code Pattern Scan' }).first().click();
  await page.getByRole('button', { name: 'Invoke capability' }).click();
  await expect(page.getByRole('dialog')).toContainText('unsafe-eval', { timeout: 20_000 });
  await expect(page.getByRole('dialog')).toContainText('"synthetic": false');
  await expect(page.getByRole('dialog')).toContainText('DEMO-CAPTURE-');
  expect(errors).toEqual([]);
});

test('desktop and mobile navigation render without overflow', async ({ page }) => {
  await page.goto('/marketplace');
  await expect(page.locator('.capability-card')).toHaveCount(builtinCapabilities.length);
  await page.screenshot({ path: '.local/screenshots/marketplace-desktop.png', fullPage: true });
  for (const path of ['/overview', '/agents', '/transactions', '/providers', '/developers', '/']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    if (path === '/developers') {
      await expect(page.locator('.tool-surface')).toContainText('9 stable tools');
      await expect(page.locator('.docs-flow')).toContainText('rate_capability');
    }
  }
  await page.screenshot({ path: '.local/screenshots/landing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/marketplace');
  await expect(page.locator('.capability-card')).toHaveCount(builtinCapabilities.length);
  await page.screenshot({ path: '.local/screenshots/marketplace-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'My agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My agents' })).toBeVisible();
});
