import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('.local', { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const results = [];
for (const path of ['/marketplace', '/agents', '/transactions', '/providers', '/developers', '/demo', '/']) {
  await page.goto(`http://localhost:5173${path}`);
  await page.waitForTimeout(1000);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  results.push({ path, violations: result.violations });
  console.log(
    path,
    result.violations.map((v) => ({
      id: v.id,
      count: v.nodes.length,
      examples: v.nodes.slice(0, 3).map((n) => ({ target: n.target, issue: n.failureSummary })),
    })),
  );
}
await writeFile('.local/accessibility.json', JSON.stringify(results, null, 2));
await browser.close();
if (results.some((result) => result.violations.length)) process.exitCode = 1;
