import { DomainError } from '@capora/types';
import { builtinOutputSchema, validatePayload } from '@capora/provider-sdk';
import { PROVIDER_TIMEOUT_MS, MAX_PAYLOAD_BYTES } from '@capora/config';
import type { Env } from '../env';
import { getRegisteredCapability } from './capabilities/registry';

export function validateBuiltinInput(endpoint: string, input: Record<string, unknown>) {
  const definition = getRegisteredCapability(endpoint);
  validatePayload(definition.metadata.schema, input);
  definition.validateInput?.(input);
  return definition.metadata;
}

export async function invokeBuiltin(endpoint: string, input: Record<string, unknown>, env?: Env) {
  const definition = getRegisteredCapability(endpoint);
  const capability = validateBuiltinInput(endpoint, input);
  const result = await definition.execute(input, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    env,
  });
  const output = {
    synthetic: false,
    source: result.source,
    sourceUrl: result.sourceUrl ?? capability.documentationUrl,
    observedAt: new Date().toISOString(),
    license: result.license ?? 'Buyer-supplied content; no transfer of third-party rights.',
    limitations: capability.description,
    data: result.data,
  };
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > MAX_PAYLOAD_BYTES)
    throw new DomainError('PROVIDER_OUTPUT_TOO_LARGE', 'Normalized output exceeds the gateway limit.', 502);
  validatePayload(builtinOutputSchema(capability), output, true);
  return output;
}
