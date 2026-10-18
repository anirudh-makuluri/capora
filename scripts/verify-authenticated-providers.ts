import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { DomainError } from '@capora/types';
import { invokeBuiltin } from '../apps/worker/src/providers/live';
import type { Env } from '../apps/worker/src/env';
import { providerVariableNames } from './provider-env';

// Explicit opt-in live checks: consume real provider quota, never create Capora purchases/payments.
// Load root .env with Node's --env-file flag. Print only safe summaries, never credentials or raw errors.
const env: Partial<Env> = Object.fromEntries(providerVariableNames.map((name) => [name, process.env[name]]));
const checks: [string, Record<string, unknown>][] = [
  ['brave_search', { query: 'Cloudflare Workers documentation', limit: 2 }],
  ['context_scrape', { url: 'https://example.com' }],
  ['azure_maps_geocode', { query: '1 Microsoft Way, Redmond, WA', limit: 2 }],
];
if (process.argv.includes('--include-sd'))
  checks.push([
    'sd_repo_analysis',
    { repository: 'anirudh-makuluri/capora', packagePath: 'apps/web', maxFiles: 20 },
  ]);
const report: Record<string, unknown>[] = [];
for (const [id, input] of checks) {
  const started = Date.now();
  try {
    const result = await invokeBuiltin(`builtin://${id}`, input, env);
    assert.equal(result.synthetic, false);
    if (id === 'context_scrape')
      assert.ok(typeof result.data.markdown === 'string' && result.data.markdown.trim().length > 0);
    else if (id === 'sd_repo_analysis')
      assert.ok(result.data.commitSha && Array.isArray(result.data.deployUnits));
    else assert.ok(Array.isArray(result.data.results) && result.data.results.length > 0);
    const entry = {
      capability: id,
      success: true,
      elapsedMs: Date.now() - started,
      ...(id === 'sd_repo_analysis'
        ? { buildStatus: result.data.buildStatus, deployShape: result.data.deployShape }
        : {}),
    };
    report.push(entry);
    console.log(JSON.stringify(entry));
  } catch (error) {
    const entry = {
      capability: id,
      success: false,
      elapsedMs: Date.now() - started,
      code: error instanceof DomainError ? error.code : 'CHECK_FAILED',
      ...(error instanceof DomainError ? { message: error.message } : {}),
    };
    report.push(entry);
    console.log(JSON.stringify(entry));
  }
}
await mkdir('.local', { recursive: true });
await writeFile(
  '.local/authenticated-provider-check.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      paymentMode: 'no purchases',
      results: report,
    },
    null,
    2,
  ),
);
if (report.some((entry) => entry.success !== true)) process.exitCode = 1;
