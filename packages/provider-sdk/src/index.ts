import { Validator, type Schema } from '@cfworker/json-schema';
import { DomainError, type JsonSchema } from '@capora/types';
export { builtinOutputSchema } from './builtins';
export type { BuiltinCapability } from './builtins';
export type { CapabilityRegistration, JsonInput, JsonSchema, JobStatus } from '@capora/types';

export interface ProviderRequest {
  invocationId: string;
  input: Record<string, unknown>;
}
export interface ProviderResponse {
  data: unknown;
  synthetic: boolean;
  source: string;
}
export interface ProviderError {
  code: 'PROVIDER_FAILURE' | 'PROVIDER_TIMEOUT' | 'INVALID_CAPABILITY_INPUT';
  message: string;
  retryable: boolean;
}

export function validateSchemaDefinition(schema: JsonSchema): void {
  if (schema.type !== 'object') throw new DomainError('INVALID_SCHEMA', 'The root schema must be an object.');
  if (JSON.stringify(schema).length > 20_000) throw new DomainError('INVALID_SCHEMA', 'Schema is too large.');
  const walk = (node: unknown, depth: number): void => {
    if (depth > 12) throw new DomainError('INVALID_SCHEMA', 'Schema nesting exceeds 12 levels.');
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' || key === 'pattern' || key === 'patternProperties')
        throw new DomainError(
          'INVALID_SCHEMA',
          'References and regex schemas are not supported in this MVP.',
        );
      walk(value, depth + 1);
    }
  };
  walk(schema, 0);
  try {
    new Validator(schema as Schema, '7');
  } catch {
    throw new DomainError('INVALID_SCHEMA', 'Invalid JSON Schema (draft 7).');
  }
}

export function validatePayload(schema: JsonSchema, input: unknown, output = false): void {
  const result = new Validator(schema as Schema, '7').validate(input);
  if (!result.valid) {
    const message = result.errors
      .slice(0, 3)
      .map((e) => `${e.instanceLocation || '/'}: ${e.error}`)
      .join('; ');
    throw new DomainError(
      output ? 'INVALID_PROVIDER_OUTPUT' : 'INVALID_CAPABILITY_INPUT',
      message,
      output ? 502 : 400,
    );
  }
}
