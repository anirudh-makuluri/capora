import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 40_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1440, height: 1050 },
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm exec tsx scripts/browser-server.ts',
    url: 'http://localhost:5174/api/health',
    reuseExistingServer: false,
    timeout: 45_000,
  },
  reporter: 'list',
});
