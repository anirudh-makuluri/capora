import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  builtinCapabilities,
  builtinOutputSchema,
  validateSchemaDefinition,
} from '../packages/provider-sdk/src/index';
import { invokeBuiltin, validateBuiltinInput } from '../apps/worker/src/providers/live';
import { validateEndpoint } from '../apps/worker/src/services/gateway';

afterEach(() => vi.unstubAllGlobals());
describe('Real provider contracts', () => {
  it('publishes valid schemas with no synthetic output or fabricated trust metrics', () => {
    for (const c of builtinCapabilities) {
      validateSchemaDefinition(c.schema);
      validateSchemaDefinition(builtinOutputSchema(c));
      expect(c.description).not.toMatch(/proprietary|exclusive|licensed employment/);
    }
  });
  it('rejects unknown built-ins and validates semantic input before payment', () => {
    expect(() => validateEndpoint('builtin://unknown', { PROVIDER_ALLOWED_HOSTS: '' })).toThrow();
    expect(() =>
      validateBuiltinInput('builtin://github_repository', { repository: 'https://localhost/admin' }),
    ).toThrow();
    expect(() => validateBuiltinInput('builtin://github_repository', { repository: 'a/../b' })).toThrow();
    expect(() =>
      validateBuiltinInput('builtin://worldbank_indicators', {
        country: 'USA',
        indicator: 'SP.POP.TOTL',
        startYear: 2025,
        endYear: 2020,
      }),
    ).toThrow();
    expect(() => validateBuiltinInput('builtin://code_scan', { repository: 'a/b' })).toThrow();
    expect(() =>
      validateBuiltinInput('builtin://document_fingerprint', { text: 'abc', expectedSha256: 'x'.repeat(64) }),
    ).toThrow();
  });
  it('scans supplied content and never substitutes sample code or invents a safe verdict', async () => {
    const unsafe = await invokeBuiltin('builtin://code_scan', { code: 'const x = 1;\neval(req.body.code);' });
    expect(unsafe.synthetic).toBe(false);
    expect(unsafe.data).toMatchObject({
      linesAnalyzed: 2,
      findings: [{ rule: 'unsafe-eval', line: 2 }],
      totalFindings: 1,
      truncated: false,
    });
    expect((await invokeBuiltin('builtin://code_scan', { code: 'const x = 1;' })).data.findings).toEqual([]);
    await expect(invokeBuiltin('builtin://code_scan', {})).rejects.toMatchObject({
      code: 'INVALID_CAPABILITY_INPUT',
    });
    const many = await invokeBuiltin('builtin://code_scan', { code: 'eval(x);\n'.repeat(1000) });
    expect(many.data).toMatchObject({ totalFindings: 1000, truncated: true });
    expect(many.data.findings).toHaveLength(100);
  });
  it('computes a known SHA-256 digest, UTF-8 byte count and optional comparison', async () => {
    const sha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(
      (
        await invokeBuiltin('builtin://document_fingerprint', {
          text: 'abc',
          expectedSha256: sha256.toUpperCase(),
        })
      ).data,
    ).toEqual({ sha256, bytes: 3, matchesExpected: true });
    expect(
      (await invokeBuiltin('builtin://document_fingerprint', { text: 'changed', expectedSha256: sha256 }))
        .data.matchesExpected,
    ).toBe(false);
    expect((await invokeBuiltin('builtin://document_fingerprint', { text: 'é' })).data).toMatchObject({
      bytes: 2,
      matchesExpected: null,
    });
  });
  it('normalizes actual source fields and constructs a fixed-host GLEIF query', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meta: { pagination: { total: 1 } },
          data: [
            {
              attributes: {
                lei: 'LEI123',
                entity: {
                  legalName: { name: 'Source name' },
                  jurisdiction: 'US',
                  status: 'ACTIVE',
                  legalAddress: { city: 'Seattle' },
                },
                registration: { status: 'ISSUED', lastUpdate: '2026-09-01' },
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await invokeBuiltin('builtin://gleif_entities', { company: 'Microsoft & Co', limit: 2 });
    expect(result.data).toMatchObject({
      total: 1,
      entities: [{ legalName: 'Source name', lei: 'LEI123', registrationStatus: 'ISSUED' }],
    });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.hostname).toBe('api.gleif.org');
    expect(url.searchParams.get('filter[entity.legalName]')).toBe('Microsoft & Co');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(result.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('accepts empty source results without fabricating records', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ meta: { pagination: { total: 0 } }, data: [] }))),
    );
    expect((await invokeBuiltin('builtin://gleif_entities', { company: 'no match' })).data).toEqual({
      total: 0,
      entities: [],
    });
  });
  it('preserves missing World Bank observations as null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { total: 1 },
            [
              {
                country: { value: 'United States' },
                indicator: { value: 'Population' },
                date: '2024',
                value: null,
                unit: '',
                obs_status: '',
              },
            ],
          ]),
        ),
      ),
    );
    expect(
      (
        await invokeBuiltin('builtin://worldbank_indicators', {
          country: 'USA',
          indicator: 'SP.POP.TOTL',
          startYear: 2024,
          endYear: 2024,
        })
      ).data,
    ).toMatchObject({ observations: [{ year: '2024', value: null }] });
  });
  it.each([302, 429, 403, 500])('returns source HTTP %s failures instead of fixtures', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream message', { status })));
    await expect(
      invokeBuiltin('builtin://github_repository', { repository: 'owner/repo' }),
    ).rejects.toMatchObject({
      code: status === 429 || status === 403 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_FAILURE',
    });
  });
  it('classifies timeouts and rejects oversized or malformed responses', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    fetcher.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(
      invokeBuiltin('builtin://github_repository', { repository: 'owner/repo' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(262145)));
    await expect(
      invokeBuiltin('builtin://github_repository', { repository: 'owner/repo' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_TOO_LARGE' });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: true })));
    await expect(
      invokeBuiltin('builtin://github_repository', { repository: 'owner/repo' }),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_OUTPUT' });
  });
});
