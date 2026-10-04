import { DomainError, type JsonSchema } from '@capora/types';
import { boundedJson } from '../../lib/provider-http';

export const text = { type: 'string', minLength: 1, maxLength: 200 };
export const limit = { type: 'integer', minimum: 1, maximum: 10, default: 5 };
export const object = (properties: Record<string, unknown>, required: string[]): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
export const array = { type: 'array', items: { type: 'object' } };

// Capability modules construct fixed-host URLs. Redirects fail closed.
export async function sourceJson(
  url: URL,
  signal: AbortSignal,
  headers?: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Capora/0.1 (public-data retrieval)', ...headers },
      // Workers supports manual/follow; reject redirect responses below without following them.
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      throw new DomainError('PROVIDER_TIMEOUT', 'Source exceeded the execution deadline.', 504);
    throw new DomainError(
      'PROVIDER_FAILURE',
      'Source could not be reached. No substitute data was returned.',
      502,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DomainError(
      response.status === 429 || response.status === 403 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_FAILURE',
      `Source returned HTTP ${response.status}. No substitute data was returned.`,
      502,
    );
  }
  return boundedJson(response);
}

export const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Source returned an unexpected object.', 502);
  return value as Record<string, unknown>;
};
export const records = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value))
    throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Source returned an unexpected list.', 502);
  return value.map(record);
};
