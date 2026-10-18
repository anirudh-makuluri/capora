import { Hono } from 'hono';
import { capabilities, drizzle, providers, users } from '@capora/db';
import { eq, sql } from 'drizzle-orm';
import { capabilityRegistrationSchema, DomainError } from '@capora/types';
import { isAdminEmail } from '../lib/admin';
import { audit } from '../lib/audit';
import { publicCapability } from '../services/catalog';
import { getProviderHostSettings, saveProviderHosts } from '../services/provider-hosts';
import { registerCapability } from '../services/provider-registration';
import { validateProviderEndpoint } from '../services/gateway';
import type { AppEnv } from '../env';

export const adminRoutes = new Hono<AppEnv>();
// Mounted behind requireHuman; agent bearer tokens and client-supplied emails grant no access.
adminRoutes.use('*', async (c, next) => {
  if (!isAdminEmail(c.env, c.get('userEmail')))
    throw new DomainError('ADMIN_REQUIRED', 'Admin access is required.', 403);
  await next();
});
adminRoutes.get('/provider-hosts', async (c) => c.json(await getProviderHostSettings(c.env)));
adminRoutes.put('/provider-hosts', async (c) => {
  const settings = await saveProviderHosts(c.env, c.get('userId'), await c.req.json());
  await audit(
    c.env,
    c.get('userId'),
    'provider_hosts_updated',
    `Approved provider hostnames updated (${settings.hosts.length} hosts)`,
    'provider_allowed_hosts',
    c.get('correlationId'),
  );
  return c.json(settings);
});
adminRoutes.get('/providers', async (c) =>
  c.json(
    await drizzle(c.env.DB)
      .select({ id: providers.id, name: providers.name, ownerName: users.name })
      .from(providers)
      .innerJoin(users, eq(providers.userId, users.id)),
  ),
);
adminRoutes.get('/capabilities', async (c) => {
  const rows = await drizzle(c.env.DB)
    .select({ capability: capabilities, provider: providers })
    .from(capabilities)
    .innerJoin(providers, eq(capabilities.providerId, providers.id));
  return c.json(
    rows.map(({ capability, provider }) => ({
      ...publicCapability(capability, provider),
      endpoint: capability.endpoint,
      httpMethod: capability.httpMethod,
      hasSecret: Boolean(capability.secretEncrypted),
      removedAt: capability.removedAt,
    })),
  );
});
adminRoutes.post('/capabilities', async (c) => {
  const body = capabilityRegistrationSchema.parse(await c.req.json());
  const provider = await drizzle(c.env.DB)
    .select()
    .from(providers)
    .where(eq(providers.id, body.providerId))
    .get();
  if (!provider) throw new DomainError('NOT_FOUND', 'Provider not found.', 404);
  return c.json(await registerCapability(c.env, c.get('userId'), provider.userId, body), 201);
});
adminRoutes.delete('/capabilities/:id', async (c) => {
  const row = await drizzle(c.env.DB)
    .update(capabilities)
    .set({
      enabled: false,
      removedAt: new Date().toISOString(),
      version: sql`${capabilities.version} + 1`,
    })
    .where(eq(capabilities.id, c.req.param('id')))
    .returning({ id: capabilities.id })
    .get();
  if (!row) throw new DomainError('NOT_FOUND', 'Capability not found.', 404);
  await audit(
    c.env,
    c.get('userId'),
    'capability_removed',
    'Capability removed from the marketplace',
    row.id,
    c.get('correlationId'),
  );
  return c.json({ ok: true });
});
adminRoutes.post('/capabilities/:id/restore', async (c) => {
  const db = drizzle(c.env.DB);
  const existing = await db
    .select()
    .from(capabilities)
    .where(eq(capabilities.id, c.req.param('id')))
    .get();
  if (!existing) throw new DomainError('NOT_FOUND', 'Capability not found.', 404);
  await validateProviderEndpoint(existing.endpoint, c.env, existing.type === 'dataset');
  await db
    .update(capabilities)
    .set({ enabled: true, removedAt: null, version: sql`${capabilities.version} + 1` })
    .where(eq(capabilities.id, existing.id));
  await audit(
    c.env,
    c.get('userId'),
    'capability_restored',
    'Capability restored to the marketplace',
    existing.id,
    c.get('correlationId'),
  );
  return c.json({ ok: true });
});
