import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('Bank keeps simulated-funds disclosure, real setup errors and owner controls usable on desktop and mobile', async ({
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
    await expect(page.getByText('TESTNET / SIMULATED FUNDS', { exact: true })).toBeVisible();
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
