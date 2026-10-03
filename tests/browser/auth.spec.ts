import { test, expect } from '@playwright/test';

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1280, height: 600 },
  { width: 390, height: 600 },
  { width: 667, height: 320 },
]) {
  test(`sidebar keeps sign out visible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const response = await page.request.post('/api/auth/sign-up/email', {
      headers: { Origin: 'http://localhost:5174' },
      data: {
        name: 'A very long workspace owner name that should fit without widening the sidebar',
        email: `sidebar-${crypto.randomUUID()}@example.com`,
        password: 'browser-test-password-only-2026',
      },
    });
    expect(response.ok()).toBe(true);
    await page.goto('/overview');
    if (viewport.width <= 720) await page.getByRole('button', { name: 'Open navigation' }).click();
    const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await expect(signOut).toHaveText('Sign out');
    const sidebar = page.locator('.sidebar');
    expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByRole('link', { name: 'Documentation', exact: true }).scrollIntoViewIfNeeded();
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `.local/screenshots/sidebar-${viewport.width}x${viewport.height}.png` });
    await signOut.click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/auth/session')).status()).toBe(401);
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login$/);
  });
}

test('signup, account isolation, logout, and email/password login work in the browser', async ({ page }) => {
  const email = `browser-${crypto.randomUUID()}@example.com`;
  const password = 'browser-test-password-only-2026';
  await page.goto('/agents');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Browser Tester');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.screenshot({ path: '.local/screenshots/signup-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText('Create your first agent', { exact: true })).toBeVisible();
  await expect(page.locator('.user-row')).toContainText('Browser Tester');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Invalid email or password')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.reload();
  await expect(page.locator('.user-row')).toContainText('Browser Tester');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/screenshots/login-mobile.png', fullPage: true });
});
