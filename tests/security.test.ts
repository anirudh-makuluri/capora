import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonical, hash, seal, unseal, signSession, verifySession } from '../apps/worker/src/lib/crypto';
import { validateEndpoint, boundedJson, invokeProvider } from '../apps/worker/src/services/gateway';
import { validatePayload, validateSchemaDefinition } from '../packages/provider-sdk/src/index';
import { companySchema, outputSchema } from '../scripts/seed-data';
import type { Env } from '../apps/worker/src/env';
import type { capabilities } from '../packages/db/src/index';

describe('Gateway and credential boundaries', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('canonical input hashes do not depend on key order', async () =>
    expect(await hash(canonical({ b: 2, a: { z: 1, b: 2 } }))).toBe(
      await hash(canonical({ a: { b: 2, z: 1 }, b: 2 })),
    ));
  it('encrypts credentials and rejects the wrong key', async () => {
    const secret = 'test-encryption-key-that-is-at-least-32-characters';
    const sealed = await seal('test-provider-secret', secret);
    expect(sealed).not.toContain('test-provider-secret');
    expect(await unseal(sealed, secret)).toBe('test-provider-secret');
    await expect(unseal(sealed, secret + 'wrong')).rejects.toThrow();
  });
  it('accepts signed sessions and rejects tampering', async () => {
    const secret = 'test-session-key-that-is-at-least-32-characters';
    const session = await signSession('user_test', secret);
    expect(await verifySession(session, secret)).toBe('user_test');
    expect(await verifySession(session + 'changed', secret)).toBeNull();
  });
  it('validates required inputs and rejects unknown fields', () => {
    expect(() => validatePayload(companySchema, { company: 'Acme Robotics' })).not.toThrow();
    expect(() => validatePayload(companySchema, { region: 'Arizona' })).toThrow();
    expect(() => validatePayload(companySchema, { company: 'Acme', secret: 'value' })).toThrow();
  });
  it('validates provider outputs', () =>
    expect(() => validatePayload(outputSchema, { synthetic: true }, true)).toThrow());
  it('rejects remote references and regex schemas', () => {
    expect(() => validateSchemaDefinition({ type: 'object', $ref: 'https://evil.example' })).toThrow();
    expect(() =>
      validateSchemaDefinition({ type: 'object', properties: { value: { pattern: '(a+)+' } } }),
    ).toThrow();
  });
  it('allows only exact approved public HTTPS hosts', () => {
    const env = { PROVIDER_ALLOWED_HOSTS: 'api.provider.example,127.0.0.1,internal.local' };
    expect(() => validateEndpoint('https://api.provider.example/v1', env)).not.toThrow();
    for (const url of [
      'http://api.provider.example/v1',
      'https://api.provider.example.evil.test/v1',
      'https://127.0.0.1/v1',
      'https://internal.local/v1',
      'https://secret:password@api.provider.example/v1',
      'https://api.provider.example:444/v1',
    ])
      expect(() => validateEndpoint(url, env)).toThrow();
  });
  it('limits provider response bytes', async () => {
    await expect(boundedJson(new Response(JSON.stringify({ data: 'x'.repeat(1000) })), 100)).rejects.toThrow(
      'limit',
    );
  });
  it('rejects provider non-JSON responses', async () =>
    await expect(boundedJson(new Response('<html>oops</html>'))).rejects.toThrow('JSON'));
  it('classifies provider timeout without exposing request secrets', async () => {
    const env = { PROVIDER_ALLOWED_HOSTS: 'api.provider.example' } as Env;
    const capability = {
      endpoint: 'https://api.provider.example/query',
      type: 'api',
      inputSchema: companySchema,
      outputSchema,
      httpMethod: 'POST',
      secretEncrypted: null,
    } as typeof capabilities.$inferSelect;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
    await expect(invokeProvider(env, capability, 'inv-test', { company: 'Acme' })).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
  });
});
