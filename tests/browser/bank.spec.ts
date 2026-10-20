import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('Bank keeps setup errors and owner controls usable on desktop and mobile without the removed copy', async ({
  page,
}) => {
  const signup = await page.request.post('/api/auth/sign-up/email', {
    headers: { Origin: 'http://localhost:5174', 'CF-Connecting-IP': '192.0.2.89' },
    data: {
      name: 'Bank browser tester',
      email: `bank-ui-${crypto.randomUUID()}@example.com`,
      password: 'bank-browser-test-password-2026',
    },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
  const agent = await page.request.post('/api/agents', { data: { name: 'Bank UI agent' } });
  expect(agent.ok()).toBe(true);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/bank');
    await expect(page.getByRole('heading', { name: 'Capora Bank', exact: true })).toBeVisible();
    await expect(page.locator('.bank-testnet')).toHaveCount(0);
    await expect(page.getByText('Advanced: network, custody and contract addresses')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Bank setup required' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Sandbox top-up' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Provision wallet' })).toBeDisabled();
    await page.getByRole('button', { name: 'Policy', exact: true }).click();
    await page.getByLabel('Allowed transfer recipients').fill('0x1111111111111111111111111111111111111111');
    await page.getByLabel('Investment limit (cUSD)').fill('20');
    await page.getByLabel('Loan exposure limit (cUSD)').fill('10');
    await page.getByLabel('Chit commitment limit (cUSD)').fill('5');
    await page.getByRole('button', { name: 'Save financial policy' }).click();
    await expect(page.getByRole('status')).toHaveText('Financial policy saved.');
    for (const section of ['Funds', 'Lending', 'Public chits', 'Activity', 'Earnings']) {
      await page.getByRole('button', { name: section, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Wallets', exact: true }).click();
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: `.local/screenshots/bank-${viewport.width}.png`, fullPage: true });
  }
});

test('Bank separates provider wallets and gives links, tabs and receipts room on desktop and mobile', async ({
  page,
}) => {
  // Presentation fixtures exercise confirmed receipts without using payment or signing services.
  const signup = await page.request.post('/api/auth/sign-up/email', {
    headers: { Origin: 'http://localhost:5174', 'CF-Connecting-IP': '192.0.2.90' },
    data: {
      name: 'Bank layout tester',
      email: `bank-layout-${crypto.randomUUID()}@example.com`,
      password: 'bank-layout-test-password-2026',
    },
  });
  expect(signup.ok()).toBe(true);
  const agent = await (await page.request.post('/api/agents', { data: { name: 'Active agent' } })).json();
  const pending = await (await page.request.post('/api/agents', { data: { name: 'Pending agent' } })).json();
  const provider = await (
    await page.request.post('/api/providers', {
      data: { name: 'SmartDeploy', description: 'Provider wallet layout fixture' },
    })
  ).json();
  await page.route('**/api/bank', (route) =>
    route.fulfill({
      json: {
        configured: true,
        contracts: { local: false },
        accounts: [
          {
            id: 'active',
            agent_id: agent.id,
            provider_id: null,
            address: `0x${'1'.repeat(40)}`,
            state: 'active',
            balance: '20',
            collateral: '0',
            gas: '0',
          },
          {
            id: 'pending',
            agent_id: pending.id,
            provider_id: null,
            address: null,
            state: 'pending',
            balance: null,
          },
          {
            id: 'provider',
            agent_id: null,
            provider_id: provider.id,
            address: `0x${'2'.repeat(40)}`,
            state: 'active',
            balance: '3',
            collateral: '0',
            gas: '0',
          },
        ],
        topups: [
          {
            id: 'layout-topup',
            state: 'available',
            amount_cents: 2000,
            order_id: 'SANDBOX-UI-ORDER',
            capture_id: 'SANDBOX-UI-CAPTURE',
            approval_url: null,
            tx_hash: `0x${'a'.repeat(64)}`,
            error: null,
          },
        ],
        entities: [],
        positions: [],
        policies: [],
        transactions: [],
        earnings: [],
        cashflow: { receivedUnits: '20000000', sentUnits: '0', indexedAt: '2026-10-20T12:00:00Z' },
      },
    }),
  );
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/bank');
    await expect(page.getByRole('article', { name: 'Active agent agent wallet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'SmartDeploy', exact: true })).toHaveCount(0);
    await expect(page.getByText('Bounded to the latest 1,000 indexed chain events.')).toHaveCount(0);
    await expect(page.getByText(/Server-verified Sandbox capture/)).toHaveCount(0);
    const link = page.getByRole('link', { name: 'Manage agent budgets and approvals' });
    const display = await link.evaluate((el) => getComputedStyle(el).backgroundColor);
    await link.hover();
    await expect.poll(() => link.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(display);
    expect(
      await link.evaluate((el) => {
        const text = el.querySelector('span')!.getBoundingClientRect(),
          icon = el.querySelector('svg')!.getBoundingClientRect();
        return Math.abs((text.top + text.bottom) / 2 - (icon.top + icon.bottom) / 2);
      }),
    ).toBeLessThan(3);
    const funds = page.getByRole('button', { name: 'Funds', exact: true });
    const before = await funds.evaluate((el) => getComputedStyle(el).backgroundColor);
    await funds.hover();
    await expect.poll(() => funds.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
    const card = page.getByRole('article', { name: 'Pending agent agent wallet' });
    expect(
      await card.evaluate((el) => {
        const badge = el.querySelector('.badge')!.getBoundingClientRect(),
          button = el.querySelector('button')!.getBoundingClientRect();
        return button.left >= badge.right ? button.left - badge.right : button.top - badge.bottom;
      }),
    ).toBeGreaterThanOrEqual(12);
    const receipt = page.locator('.bank-receipt').filter({ hasText: 'SANDBOX-UI-ORDER' });
    expect(
      await receipt.locator('.bank-receipt-heading').evaluate((el) => parseFloat(getComputedStyle(el).gap)),
    ).toBeGreaterThanOrEqual(12);
    expect(
      await receipt.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop)),
    ).toBeGreaterThanOrEqual(24);
    await page.getByRole('button', { name: 'Make a transfer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'bank.transfer', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: `.local/screenshots/bank-cleanup-wallets-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Earnings', exact: true }).click();
    await expect(page.getByRole('article', { name: 'SmartDeploy provider wallet' })).toBeVisible();
    await expect(page.getByText('Provider wallet', { exact: true })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
    ).toEqual([]);
  }
});
