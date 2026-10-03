import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

// Disposable browser fixture: never reuses the developer's DB or payment credentials.
const secret = randomBytes(32).toString('base64url');
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: resolve('apps/worker/dist/index.js'),
    compatibilityDate: '2026-10-03',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    r2Buckets: ['ARTIFACTS'],
    queueProducers: { INVOCATION_QUEUE: 'browser-invocations' },
    queueConsumers: { 'browser-invocations': { maxBatchTimeout: 0, maxBatchSize: 1 } },
    assets: {
      directory: resolve('apps/web/dist'),
      binding: 'ASSETS',
      run_worker_first: ['/api/*', '/mcp', '/providers/*'],
      routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: 'single-page-application' },
    },
    bindings: {
      DEV_MODE: 'true',
      PAYMENT_MODE: 'demo',
      PAYPAL_ENVIRONMENT: 'sandbox',
      CAPORA_BASE_URL: 'http://localhost:5174',
      SESSION_SECRET: secret,
      ENCRYPTION_KEY: secret,
      DEMO_PROVIDER_SECRET: secret,
      PROVIDER_ALLOWED_HOSTS: '',
    },
  }),
);
const db = await mf.getD1Database('DB');
const dir = resolve('packages/db/migrations');
for (const file of (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort()) {
  for (const statement of (await readFile(resolve(dir, file), 'utf8'))
    .replaceAll('--> statement-breakpoint', '')
    .split(';')
    .filter((s) => s.trim()))
    await db.prepare(statement).run();
}
for (const statement of (await readFile('.local/seed.sql', 'utf8'))
  .split(/;\r?\n|;\s*$/)
  .filter((s) => s.trim()))
  await db.prepare(statement).run();
await mf.ready;
// Expose the HTTP listener only after schema and fixtures are fully initialized.
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    const result = await mf.dispatchFetch(`http://localhost:5174${request.url}`, {
      method: request.method,
      headers,
      ...(['GET', 'HEAD'].includes(request.method ?? 'GET') ? {} : { body: Buffer.concat(chunks) }),
    });
    response.writeHead(result.status, {
      ...Object.fromEntries(result.headers),
      'set-cookie': result.headers.getSetCookie(),
    });
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(500);
    response.end('Browser fixture request failed.');
  }
});
await new Promise<void>((resolve) => server.listen(5174, resolve));
console.log('Isolated browser Worker ready; payments are simulated.');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.close();
    void mf.dispose().then(() => process.exit(0));
  });
