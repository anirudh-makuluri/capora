import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../apps/worker/src/env';
import { invokeBuiltin, validateBuiltinInput } from '../apps/worker/src/providers/live';
import { createCapabilityRegistry } from '../apps/worker/src/providers/capabilities/registry';
import { sdRepoAnalysis } from '../apps/worker/src/providers/capabilities/sd_repo_analysis';

const env = {
  BRAVE_SEARCH_API_KEY: 'test-brave-secret',
  CONTEXT_DEV_API_KEY: 'test-context-secret',
  AZURE_MAPS_KEY: 'test-maps-secret',
  SD_API_BASE_URL: 'https://analysis.capora.dev/v2',
  SD_API_BEARER_TOKEN: 'test-sd-secret',
} as Env;
const inputs: Record<string, Record<string, unknown>> = {
  brave_search: { query: 'workers', limit: 1 },
  context_scrape: { url: 'https://example.com' },
  azure_maps_geocode: { query: 'Redmond', limit: 1 },
  sd_repo_analysis: { repository: 'anirudh-makuluri/capora', packagePath: 'apps/web', maxFiles: 20 },
};
function response(body: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function sseResponse(body: unknown) {
  const wire = `event: progress\r\ndata: {"node":"scanner"}\r\n\r\nevent: complete\r\ndata: ${JSON.stringify(body)}\r\n\r\n`;
  const bytes = new TextEncoder().encode(wire);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17));
      controller.close();
    },
  });
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const sdResult = {
  schema_version: 2,
  commit_sha: 'abc123',
  package_path: 'apps/web',
  deploy_shape: 'static_build',
  build_status: 'failed',
  deploy_briefing: 'Build needs an environment variable.',
  errors: ['Build failed'],
  deploy_units: [
    { name: 'web', root: 'apps/web', type: 'static_build', artifacts: { railpack_plan: { steps: [] } } },
  ],
  inputs_snapshot: { github_token: 'must-not-leak' },
  llm_outputs: { internal: 'must-not-leak' },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Authenticated capability adapters', () => {
  it('uses Brave header authentication and returns bounded real result fields', async () => {
    const fetcher = response({
      web: {
        results: [
          { title: 'Workers', url: 'https://developers.cloudflare.com/', description: 'Edge runtime' },
          { title: 'Other', url: 'https://example.com' },
        ],
      },
    });
    const result = await invokeBuiltin('builtin://brave_search', inputs.brave_search, env);
    expect(result.data.results).toEqual([
      { title: 'Workers', url: 'https://developers.cloudflare.com/', description: 'Edge runtime' },
    ]);
    const [url, init] = fetcher.mock.calls[0];
    expect(url.hostname).toBe('api.search.brave.com');
    expect(url.searchParams.get('count')).toBe('1');
    expect(url.href).not.toContain(env.BRAVE_SEARCH_API_KEY);
    expect(init).toMatchObject({
      redirect: 'manual',
      headers: { 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY },
    });
    expect(JSON.stringify(result)).not.toContain(env.BRAVE_SEARCH_API_KEY);
  });

  it('checks Context per-format success and bounds returned content', async () => {
    const fetcher = response({ markdown: { success: true, data: 'x'.repeat(40001) } });
    const result = await invokeBuiltin('builtin://context_scrape', inputs.context_scrape, env);
    expect(result.data).toMatchObject({ markdown: 'x'.repeat(40000), truncated: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      url: 'https://example.com/',
      formats: { markdown: true },
      sharedParams: { mainContentOnly: true },
      timeoutOpts: { milliseconds: 20000, behavior: 'fail' },
    });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${env.CONTEXT_DEV_API_KEY}`);
    response({ markdown: { success: false, data: null, message: env.CONTEXT_DEV_API_KEY } });
    await expect(invokeBuiltin('builtin://context_scrape', inputs.context_scrape, env)).rejects.toMatchObject(
      {
        code: 'PROVIDER_FAILURE',
        message: 'Context.dev did not return usable page content.',
      },
    );
  });

  it('normalizes Azure longitude/latitude without putting its key in URLs', async () => {
    const fetcher = response({
      type: 'FeatureCollection',
      features: [
        {
          properties: {
            address: { formattedAddress: 'Redmond, WA' },
            confidence: 'High',
            matchCodes: ['Good'],
          },
          geometry: { type: 'Point', coordinates: [-122.12, 47.67] },
        },
      ],
    });
    const result = await invokeBuiltin('builtin://azure_maps_geocode', inputs.azure_maps_geocode, env);
    expect(result.data.results).toEqual([
      {
        formattedAddress: 'Redmond, WA',
        longitude: -122.12,
        latitude: 47.67,
        confidence: 'High',
        matchCodes: ['Good'],
      },
    ]);
    const [url, init] = fetcher.mock.calls[0];
    expect(url.pathname).toBe('/geocode');
    expect(url.searchParams.get('api-version')).toBe('2025-01-01');
    expect(init.headers['subscription-key']).toBe(env.AZURE_MAPS_KEY);
    expect(JSON.stringify(result)).not.toContain(env.AZURE_MAPS_KEY);
    expect(url.href).not.toContain(env.AZURE_MAPS_KEY);
  });

  it('maps the SD contract and preserves failed build status without returning internal fields', async () => {
    const fetcher = sseResponse(sdResult);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const result = await invokeBuiltin('builtin://sd_repo_analysis', inputs.sd_repo_analysis, env);
    expect(timeout).toHaveBeenCalledWith(120000);
    expect(result.data).toMatchObject({
      buildStatus: 'failed',
      commitSha: 'abc123',
      briefing: 'Build needs an environment variable.',
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    const [url, init] = fetcher.mock.calls[0];
    expect(url.href).toBe('https://analysis.capora.dev/v2/analyze/stream');
    expect(init.headers.Authorization).toBe(`Bearer ${env.SD_API_BEARER_TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      repo_url: 'https://github.com/anirudh-makuluri/capora',
      package_path: 'apps/web',
      max_files: 20,
      refresh: false,
    });
    expect(result.sourceUrl).not.toContain('analysis.capora.dev');
  });

  it.each(Object.keys(inputs))('fails explicitly without a configured credential for %s', async (id) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(invokeBuiltin(`builtin://${id}`, inputs[id])).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['context_scrape', { url: 'https://user:pass@example.com' }],
    ['context_scrape', { url: 'https://127.0.0.1' }],
    ['context_scrape', { url: 'https://[::1]' }],
    ['context_scrape', { url: 'https://metadata.google.internal' }],
    ['context_scrape', { url: 'http://example.com' }],
    ['brave_search', { query: 'x', limit: 11 }],
    ['azure_maps_geocode', { query: 'x', limit: 6 }],
    ['sd_repo_analysis', { repository: 'https://github.com/a/b' }],
    ['sd_repo_analysis', { repository: 'a/b', packagePath: '../private' }],
    ['sd_repo_analysis', { repository: 'a/b', packagePath: '/etc' }],
    ['sd_repo_analysis', { repository: 'a/b', github_token: 'not-accepted' }],
  ])('rejects unsafe or unbounded inputs before quoting: %s', (id, input) => {
    expect(() => validateBuiltinInput(`builtin://${id}`, input)).toThrow();
  });

  it.each([301, 401, 403, 429, 500])(
    'suppresses HTTP %s bodies and never follows redirects',
    async (status) => {
      const fetcher = response({ error: env.BRAVE_SEARCH_API_KEY }, status);
      const error = await invokeBuiltin('builtin://brave_search', inputs.brave_search, env).catch((e) => e);
      expect(error.message).not.toContain(env.BRAVE_SEARCH_API_KEY);
      expect(error.code).toBe(
        status === 401 || status === 403
          ? 'PROVIDER_AUTH_FAILED'
          : status === 429
            ? 'PROVIDER_RATE_LIMITED'
            : 'PROVIDER_FAILURE',
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects oversized source responses and sanitizes transport errors', async () => {
    response({ markdown: { success: true, data: 'x'.repeat(262145) } });
    await expect(invokeBuiltin('builtin://context_scrape', inputs.context_scrape, env)).rejects.toMatchObject(
      { code: 'PROVIDER_OUTPUT_TOO_LARGE' },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error(`failed ${env.SD_API_BASE_URL} ${env.SD_API_BEARER_TOKEN}`)),
    );
    await expect(
      invokeBuiltin('builtin://sd_repo_analysis', inputs.sd_repo_analysis, env),
    ).rejects.toMatchObject({
      code: 'PROVIDER_FAILURE',
      message: 'Source could not be reached. No substitute data was returned.',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('secret detail', 'TimeoutError')));
    await expect(
      invokeBuiltin('builtin://sd_repo_analysis', inputs.sd_repo_analysis, env),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('restricts extended timeouts to bounded queued capabilities', () => {
    expect(() =>
      createCapabilityRegistry([
        { ...sdRepoAnalysis, metadata: { ...sdRepoAnalysis.metadata, async: false } },
      ]),
    ).toThrow('timeout');
    expect(() => createCapabilityRegistry([{ ...sdRepoAnalysis, executionTimeoutMs: 300000 }])).toThrow(
      'timeout',
    );
  });

  it.each([
    `event: error\ndata: {"detail":"${env.SD_API_BEARER_TOKEN}"}\n\n`,
    'event: progress\ndata: {}\n\n',
    'event: complete\ndata: not-json\n\n',
  ])('rejects failed, incomplete or malformed SD streams without leaking upstream details', async (wire) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } })),
    );
    const error = await invokeBuiltin('builtin://sd_repo_analysis', inputs.sd_repo_analysis, env).catch(
      (e) => e,
    );
    expect(error.code).toMatch(/PROVIDER_FAILURE|INVALID_PROVIDER_OUTPUT/);
    expect(error.message).not.toContain(env.SD_API_BEARER_TOKEN);
  });
});
