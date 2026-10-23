import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('top-ups target the chosen agent and transfers choose named wallets in place', async ({ page }) => {
  const signup = await page.request.post('/api/auth/sign-up/email', {
    headers: { Origin: 'http://localhost:5174', 'CF-Connecting-IP': '192.0.2.91' },
    data: {
      name: 'Funding tester',
      email: `funding-${crypto.randomUUID()}@example.com`,
      password: 'bank-browser-test-password-2026',
    },
  });
  expect(signup.ok()).toBe(true);
  const agents: { id: string; name: string }[] = [];
  for (const name of ['Sender agent', 'Recipient agent', 'Unprovisioned agent']) {
    const response = await page.request.post('/api/agents', { data: { name } });
    expect(response.ok()).toBe(true);
    agents.push(await response.json());
  }
  const address = `0x${'2'.repeat(40)}`;
  await page.route('**/api/bank', (route) =>
    route.fulfill({
      json: {
        configured: true,
        contracts: { local: false },
        accounts: agents.map((a, i) => ({
          id: `account-${i}`,
          agent_id: a.id,
          provider_id: null,
          address: i === 2 ? null : `0x${String(i + 1).repeat(40)}`,
          state: i === 2 ? 'pending' : 'active',
          balance: '20',
        })),
        topups: [],
        entities: [],
        positions: [],
        policies: [],
        transactions: [],
        earnings: [],
        cashflow: null,
      },
    }),
  );
  const topups: { agentId: string; amountCents: number; idempotencyKey: string }[] = [];
  await page.route('**/api/bank/topups', (route) => {
    topups.push(route.request().postDataJSON());
    return route.fulfill({
      json: { id: 'test-topup', approval_url: 'https://www.sandbox.paypal.com/checkoutnow?token=fixture' },
    });
  });
  const quotes: { agent: string; body: { capability_id: string; input: { to: string; amount: string } } }[] =
    [];
  await page.route('**/api/agents/*/quotes', (route) => {
    quotes.push({ agent: route.request().url().split('/').at(-2)!, body: route.request().postDataJSON() });
    return route.fulfill({
      json: {
        id: 'transfer-quote',
        priceCents: 125,
        approvalRequired: false,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/bank?agent=${agents[0].id}`);
    await expect(page.getByLabel('Acting agent')).toHaveValue(agents[0].id);
    const destination = page.getByLabel('Agent to top up');
    await destination.selectOption(agents[1].id);
    const create = page.getByRole('button', { name: 'Create Sandbox top-up' });
    if (width === 1440) {
      const boxes = await Promise.all([
        destination.boundingBox(),
        page.getByLabel('Sandbox USD amount').boundingBox(),
        create.boundingBox(),
      ]);
      expect(
        Math.max(...boxes.map((b) => b!.y + b!.height)) - Math.min(...boxes.map((b) => b!.y + b!.height)),
      ).toBeLessThan(2);
    }
    await create.click();
    await expect(page.getByRole('link', { name: 'Approve in PayPal Sandbox' })).toBeVisible();
    expect(topups.at(-1)).toMatchObject({ agentId: agents[1].id, amountCents: 2000 });
    const previousKey = topups.at(-1)!.idempotencyKey;
    await destination.selectOption(agents[0].id);
    await expect(page.getByRole('link', { name: 'Approve in PayPal Sandbox' })).toHaveCount(0);
    await create.click();
    await expect(page.getByRole('link', { name: 'Approve in PayPal Sandbox' })).toBeVisible();
    expect(topups.at(-1)!.agentId).toBe(agents[0].id);
    expect(topups.at(-1)!.idempotencyKey).not.toBe(previousKey);
    const start = page.getByRole('button', { name: 'Make a transfer', exact: true });
    expect(await start.evaluate((el) => parseFloat(getComputedStyle(el).marginTop))).toBeGreaterThanOrEqual(
      16,
    );
    await start.click();
    await expect(start).toHaveCount(0);
    const action = page.getByRole('region', { name: 'Bank action' });
    await expect(action).toBeVisible();
    // The action occupies the original slot before receipts, instead of appending below them.
    expect(await action.evaluate((el) => el.nextElementSibling?.querySelector('h2')?.textContent)).toBe(
      'Top-up receipts',
    );
    const recipient = page.getByLabel('Recipient agent', { exact: true });
    await expect(recipient.locator('option')).toHaveText([
      'Choose a recipient',
      'Recipient agent',
      'Another wallet address',
    ]);
    await recipient.selectOption({ label: 'Recipient agent' });
    const amount = page.getByLabel('Amount (cUSD / test-token units)', { exact: true });
    await amount.fill('1.25');
    const review = page.getByRole('button', { name: 'Review action and fees' });
    if (width === 1440) {
      const boxes = await Promise.all([recipient.boundingBox(), amount.boundingBox(), review.boundingBox()]);
      expect(
        Math.max(...boxes.map((b) => b!.y + b!.height)) - Math.min(...boxes.map((b) => b!.y + b!.height)),
      ).toBeLessThan(2);
    }
    await review.click();
    await expect(page.getByRole('heading', { name: 'Confirm bank.transfer' })).toBeVisible();
    expect(quotes.at(-1)).toEqual({
      agent: agents[0].id,
      body: {
        capability_id: 'bank_transfer',
        input: { to: address, amount: '1.25' },
        reason: 'Owner initiated Capora Bank action',
      },
    });
    await recipient.selectOption('custom');
    await expect(page.getByRole('heading', { name: 'Confirm bank.transfer' })).toHaveCount(0);
    await page.getByLabel('Recipient wallet address').fill(`0x${'3'.repeat(40)}`);
    await review.click();
    await expect(page.getByRole('heading', { name: 'Confirm bank.transfer' })).toBeVisible();
    expect(quotes.at(-1)!.body.input.to).toBe(`0x${'3'.repeat(40)}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
    ).toEqual([]);
    await page.screenshot({ path: `.local/screenshots/bank-transfer-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cancel transfer' }).click();
    await expect(start).toBeVisible();
    await start.click();
    await page.getByLabel('Acting agent').selectOption(agents[1].id);
    await expect(start).toBeVisible();
    await expect(action).toHaveCount(0);
  }
});
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
