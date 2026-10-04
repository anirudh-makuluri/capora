import type { capabilities } from '@capora/db';
import { DomainError } from '@capora/types';
import { validatePayload, builtinCapabilities } from '@capora/provider-sdk';
import { PROVIDER_TIMEOUT_MS } from '@capora/config';
import { boundedJson } from '../lib/provider-http';
export { boundedJson } from '../lib/provider-http';
import { unseal } from '../lib/crypto';
import { demoProviders } from '../providers/demo';
import { readArtifact } from './storage';
import type { Env } from '../env';
import { invokeBuiltin } from '../providers/live';

export function validateEndpoint(
  endpoint: string,
  env: Pick<Env, 'PROVIDER_ALLOWED_HOSTS'>,
  dataset = false,
): void {
  if (endpoint.startsWith('builtin://')) {
    if (!builtinCapabilities.some((c) => endpoint === `builtin://${c.id}`))
      throw new DomainError('ENDPOINT_NOT_ALLOWED', 'Unknown built-in capability.');
    return;
  }
  if (endpoint.startsWith('demo://')) {
    if (!/^demo:\/\/[a-z0-9_]+$/.test(endpoint))
      throw new DomainError('INVALID_ENDPOINT', 'Invalid demo endpoint.');
    return;
  }
  if (dataset && endpoint.startsWith('r2://datasets/')) return;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DomainError('INVALID_ENDPOINT', 'A valid HTTPS provider URL is required.');
  }
  const allowlist = env.PROVIDER_ALLOWED_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !allowlist.includes(url.hostname.toLowerCase())
  )
    throw new DomainError(
      'ENDPOINT_NOT_ALLOWED',
      'Provider endpoints must use HTTPS on an operator-approved hostname.',
    );
  if (
    /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(url.hostname) ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(':')
  )
    throw new DomainError('ENDPOINT_NOT_ALLOWED', 'Private networks and IP literals are not allowed.');
}
export async function invokeProvider(
  env: Env,
  capability: typeof capabilities.$inferSelect,
  invocationId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  validatePayload(capability.inputSchema, input);
  validateEndpoint(capability.endpoint, env, capability.type === 'dataset');
  if (capability.endpoint.startsWith('builtin://')) {
    const output = await invokeBuiltin(capability.endpoint, input);
    validatePayload(capability.outputSchema, output, true);
    return output;
  }
  let response: Response;
  if (capability.endpoint.startsWith('r2://')) {
    const object = await readArtifact(env, capability.endpoint.slice(5));
    if (!object) throw new DomainError('PROVIDER_FAILURE', 'Dataset artifact not found.', 502);
    response = new Response(object.body);
  } else if (capability.endpoint.startsWith('demo://')) {
    // An actual protected provider route, dispatched within this Worker without a public loopback hop.
    response = await demoProviders.fetch(
      new Request(`https://providers.capora.internal/${capability.endpoint.slice(7)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEMO_PROVIDER_SECRET}` },
        body: JSON.stringify({ invocationId, input }),
      }),
      env,
    );
  } else {
    const url = new URL(capability.endpoint);
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Capora-Invocation-Id': invocationId,
      'Idempotency-Key': invocationId,
    });
    if (capability.secretEncrypted)
      headers.set(capability.authHeader, await unseal(capability.secretEncrypted, env.ENCRYPTION_KEY));
    if (capability.httpMethod === 'GET')
      for (const [key, value] of Object.entries(input))
        url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    try {
      response = await fetch(url, {
        method: capability.httpMethod,
        headers,
        ...(capability.httpMethod === 'POST' ? { body: JSON.stringify(input) } : {}),
        // Workers does not support redirect: 'error'. Non-2xx (including redirects) fail below.
        redirect: 'manual',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
        throw new DomainError('PROVIDER_TIMEOUT', 'Provider exceeded the execution deadline.', 504);
      throw new DomainError(
        'PROVIDER_FAILURE',
        'Provider could not be reached. Redirects are not permitted.',
        502,
      );
    }
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DomainError('PROVIDER_FAILURE', `Provider returned HTTP ${response.status}.`, 502);
  }
  const output = await boundedJson(response);
  validatePayload(capability.outputSchema, output, true);
  return output;
}
