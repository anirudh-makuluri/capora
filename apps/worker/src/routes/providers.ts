import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle, providers, capabilities } from '@capora/db';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { capabilityRegistrationSchema, DomainError } from '@capora/types';
import { validateSchemaDefinition } from '@capora/provider-sdk';
import { validateProviderEndpoint } from '../services/gateway';
import { id, seal } from '../lib/crypto';
import { publicCapability } from '../services/catalog';
import { registerCapability } from '../services/provider-registration';
import { writeArtifact } from '../services/storage';
import type { AppEnv, Env } from '../env';

export const providerRoutes = new Hono<AppEnv>();
async function ownProvider(env: Env, providerId: string, userId: string) {
  const provider = await drizzle(env.DB)
    .select()
    .from(providers)
    .where(and(eq(providers.id, providerId), eq(providers.userId, userId)))
    .get();
  if (!provider) throw new DomainError('NOT_FOUND', 'Provider not found in your workspace.', 404);
  return provider;
}
providerRoutes.post('/', async (c) => {
  const body = z
    .object({ name: z.string().min(2).max(80), description: z.string().min(10).max(1000) })
    .parse(await c.req.json());
  const row = { id: id('provider'), userId: c.get('userId'), ...body, createdAt: new Date().toISOString() };
  await drizzle(c.env.DB).insert(providers).values(row);
  const { accountIntent } = await import('../bank/accounts');
  await accountIntent(c.env, 'provider', row.id);
  return c.json(row, 201);
});
providerRoutes.get('/capabilities', async (c) => {
  const rows = await drizzle(c.env.DB)
    .select({ capability: capabilities, provider: providers })
    .from(capabilities)
    .innerJoin(providers, eq(capabilities.providerId, providers.id))
    .where(eq(providers.userId, c.get('userId')));
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
providerRoutes.post('/datasets', async (c) => {
  const body = z.object({ data: z.record(z.string(), z.unknown()) }).parse(await c.req.json());
  const key = `datasets/${c.get('userId')}/${id('dataset')}.json`;
  await writeArtifact(c.env, key, JSON.stringify(body.data));
  return c.json({ key, endpoint: `r2://${key}` }, 201);
});
providerRoutes.post('/capabilities', async (c) => {
  const body = capabilityRegistrationSchema.parse(await c.req.json());
  await ownProvider(c.env, body.providerId, c.get('userId'));
  return c.json(await registerCapability(c.env, c.get('userId'), c.get('userId'), body), 201);
});
providerRoutes.put('/capabilities/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const existing = await db
    .select()
    .from(capabilities)
    .where(eq(capabilities.id, c.req.param('id')))
    .get();
  if (!existing) throw new DomainError('NOT_FOUND', 'Capability not found.', 404);
  await ownProvider(c.env, existing.providerId, c.get('userId'));
  if (existing.removedAt)
    throw new DomainError('CAPABILITY_REMOVED', 'This capability was removed by an admin.', 409);
  const body = capabilityRegistrationSchema.parse(await c.req.json());
  if (body.providerId !== existing.providerId)
    throw new DomainError('INVALID_PROVIDER', 'A capability cannot be moved to another provider.');
  await validateProviderEndpoint(body.endpoint, c.env, body.type === 'dataset');
  if (body.endpoint.startsWith('r2://') && !body.endpoint.startsWith(`r2://datasets/${c.get('userId')}/`))
    throw new DomainError('INVALID_DATASET', 'Dataset must belong to your workspace.');
  validateSchemaDefinition(body.inputSchema);
  validateSchemaDefinition(body.outputSchema);
  const { secret, ...fields } = body;
  const updated = await db
    .update(capabilities)
    .set({
      ...fields,
      synthetic: body.endpoint.startsWith('demo://'),
      version: sql`${capabilities.version} + 1`,
      ...(secret !== undefined
        ? { secretEncrypted: secret ? await seal(secret, c.env.ENCRYPTION_KEY) : null }
        : {}),
    })
    .where(and(eq(capabilities.id, existing.id), isNull(capabilities.removedAt)))
    .returning({ id: capabilities.id })
    .get();
  if (!updated) throw new DomainError('CAPABILITY_REMOVED', 'This capability was removed by an admin.', 409);
  return c.json({ ok: true });
});
providerRoutes.patch('/capabilities/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const capability = await db
    .select()
    .from(capabilities)
    .where(eq(capabilities.id, c.req.param('id')))
    .get();
  if (!capability) throw new DomainError('NOT_FOUND', 'Capability not found.', 404);
  await ownProvider(c.env, capability.providerId, c.get('userId'));
  if (capability.removedAt)
    throw new DomainError('CAPABILITY_REMOVED', 'This capability was removed by an admin.', 409);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  const updated = await db
    .update(capabilities)
    .set({ enabled })
    .where(and(eq(capabilities.id, capability.id), isNull(capabilities.removedAt)))
    .returning({ id: capabilities.id })
    .get();
  if (!updated) throw new DomainError('CAPABILITY_REMOVED', 'This capability was removed by an admin.', 409);
  return c.json({ ok: true });
});
