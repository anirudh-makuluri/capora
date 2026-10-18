import assert from 'node:assert/strict';
import { readDeploymentConfig, validateDeploymentConfig } from './deployment-config';
import { builtinCapabilities } from '../apps/worker/src/providers/capabilities/registry';

const base = validateDeploymentConfig(await readDeploymentConfig());

async function checkDeployment() {
  const get = (path: string) =>
    fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const health = await get('/api/health');
  assert.equal(health.status, 200, 'Health endpoint must return 200.');
  assert.match(health.headers.get('content-type') ?? '', /application\/json/);
  const status = await health.json();
  assert.ok(
    status && typeof status === 'object' && 'name' in status && 'status' in status && 'paymentMode' in status,
    'Health endpoint must return the Capora status object.',
  );
  assert.equal(status.name, 'Capora');
  assert.equal(status.status, 'ok');
  assert.equal(status.paymentMode, 'sandbox');
  const catalog = await get('/api/capabilities');
  assert.equal(catalog.status, 200, 'D1 marketplace query must succeed.');
  const capabilities: unknown = await catalog.json();
  assert.ok(Array.isArray(capabilities), 'Marketplace must return a capability list.');
  const entries: unknown[] = capabilities;
  for (const expected of builtinCapabilities) {
    const deployed = entries.find(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object' && 'id' in item && item.id === expected.id,
    );
    // Admins may intentionally remove or disable any listing, including every built-in.
    // Catalog sync inserts registered definitions without republishing removed listings.
    if (!deployed) continue;
    assert.equal(deployed.name, expected.name, `Catalog metadata is stale for ${expected.id}.`);
    assert.equal(deployed.priceCents, expected.priceCents, `Catalog price is stale for ${expected.id}.`);
    assert.deepEqual(deployed.inputSchema, expected.schema, `Input schema is stale for ${expected.id}.`);
  }
  for (const path of [
    '/api/dashboard',
    '/api/auth/session',
    '/api/storage/usage',
    '/api/admin/provider-hosts',
    '/api/admin/capabilities',
    '/api/admin/providers',
    '/mcp',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 401, `${path} must require authentication.`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  }
  const page = await get('/marketplace');
  assert.equal(page.status, 200, 'SPA deep link must load.');
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  const html = await page.text();
  const asset = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  assert.ok(asset, 'SPA HTML must reference the built JavaScript.');
  assert.equal(new URL(asset, base).origin, base.origin, 'SPA assets must be served by Capora.');
  const script = await get(asset);
  assert.equal(script.status, 200, 'Frontend JavaScript must load.');
  assert.match(script.headers.get('content-type') ?? '', /javascript/);
}

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await checkDeployment();
    console.log(
      `Deployment smoke checks passed at ${base.origin}: SPA/assets, D1 catalog, Sandbox mode, and auth gates.`,
    );
    break;
  } catch (error) {
    if (attempt === 5) throw error;
    console.log(`Deployment not ready yet (attempt ${attempt}/5); retrying in 5 seconds.`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
