import { afterEach, describe, expect, it, vi } from 'vitest';
import * as registry from '../apps/worker/src/providers/capabilities/registry';
import { documentFingerprint } from '../apps/worker/src/providers/capabilities/document_fingerprint';
import type { CapabilityDefinition } from '../apps/worker/src/providers/capabilities/types';
import { invokeBuiltin } from '../apps/worker/src/providers/live';

afterEach(() => vi.restoreAllMocks());

const echo = (): CapabilityDefinition => ({
  metadata: {
    ...documentFingerprint.metadata,
    id: 'test_echo',
    schema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    dataSchema: {
      type: 'object',
      properties: { echo: { type: 'string' } },
      required: ['echo'],
      additionalProperties: false,
    },
  },
  execute: vi.fn(async (input, context) => {
    expect(context.signal).toBeInstanceOf(AbortSignal);
    return { source: 'Test echo', data: { echo: input.value } };
  }),
});

describe('Capability registry', () => {
  it('rejects duplicate IDs, invalid IDs and invalid schemas at registration', () => {
    const definition = echo();
    expect(() => registry.createCapabilityRegistry([definition, definition])).toThrow('Duplicate');
    expect(() =>
      registry.createCapabilityRegistry([
        { ...definition, metadata: { ...definition.metadata, id: '../other' } },
      ]),
    ).toThrow('Invalid built-in');
    expect(() =>
      registry.createCapabilityRegistry([
        { ...definition, metadata: { ...definition.metadata, schema: { type: 'string' } } },
      ]),
    ).toThrow('root schema');
  });

  it('dispatches a newly registered handler with shared input and output validation', async () => {
    const definition = echo();
    const customRegistry = registry.createCapabilityRegistry([definition]);
    expect(customRegistry.metadata).toEqual([definition.metadata]);
    expect(() => customRegistry.get('builtin://test_echo/extra')).toThrow('Unknown');
    vi.spyOn(registry, 'getRegisteredCapability').mockImplementation(customRegistry.get);

    await expect(
      invokeBuiltin('builtin://test_echo', { value: 'actual buyer input' }),
    ).resolves.toMatchObject({
      synthetic: false,
      source: 'Test echo',
      data: { echo: 'actual buyer input' },
    });
    await expect(invokeBuiltin('builtin://test_echo', { value: 42 })).rejects.toMatchObject({
      code: 'INVALID_CAPABILITY_INPUT',
    });
    expect(definition.execute).toHaveBeenCalledTimes(1);

    vi.mocked(definition.execute).mockResolvedValueOnce({ source: 'Test echo', data: {} });
    await expect(invokeBuiltin('builtin://test_echo', { value: 'x' })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_OUTPUT',
    });
    await expect(invokeBuiltin('builtin://test_echo', { value: 'x'.repeat(262145) })).rejects.toMatchObject({
      code: 'PROVIDER_OUTPUT_TOO_LARGE',
    });
  });
});
