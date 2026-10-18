import { capabilities, drizzle } from '@capora/db';
import { DomainError, type CapabilityRegistration } from '@capora/types';
import { validateSchemaDefinition } from '@capora/provider-sdk';
import { id, seal } from '../lib/crypto';
import { audit } from '../lib/audit';
import { validateProviderEndpoint } from './gateway';
import type { Env } from '../env';

export async function registerCapability(
  env: Env,
  actorId: string,
  providerOwnerId: string,
  body: CapabilityRegistration,
) {
  await validateProviderEndpoint(body.endpoint, env, body.type === 'dataset');
  if (body.endpoint.startsWith('r2://') && !body.endpoint.startsWith(`r2://datasets/${providerOwnerId}/`))
    throw new DomainError('INVALID_DATASET', 'Dataset must belong to the provider workspace.');
  validateSchemaDefinition(body.inputSchema);
  validateSchemaDefinition(body.outputSchema);
  const { secret, ...fields } = body;
  const capabilityId = id('cap');
  await drizzle(env.DB)
    .insert(capabilities)
    .values({
      ...fields,
      id: capabilityId,
      synthetic: body.endpoint.startsWith('demo://'),
      secretEncrypted: secret ? await seal(secret, env.ENCRYPTION_KEY) : null,
      createdAt: new Date().toISOString(),
    });
  await audit(env, actorId, 'capability_registered', `${body.name} added to the marketplace`, capabilityId);
  return { id: capabilityId };
}
