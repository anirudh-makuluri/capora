import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../apps/web/src/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('Dashboard API responses', () => {
  it('returns valid JSON results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'completed' })));
    expect(await api('/status')).toEqual({ status: 'completed' });
  });

  it('preserves structured API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'FORBIDDEN', message: 'Owner approval required.' } },
            { status: 403 },
          ),
        ),
    );
    await expect(api('/status')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Owner approval required.',
      status: 403,
    });
  });

  it.each([200, 502])('reports an unreadable HTTP %s response without exposing HTML', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>internal edge details</html>', { status })),
    );
    const error = await api('/status').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: status >= 500 ? 'SERVICE_UNAVAILABLE' : 'INVALID_RESPONSE', status });
    expect((error as ApiError).message).not.toContain('internal edge details');
  });

  it('does not replay a purchase after an uncertain edge response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('<html>failure</html>', { status: 500 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      api('/agents/test/purchases', { method: 'POST', body: { quote_id: 'quote_test' } }),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: expect.stringContaining('existing transaction'),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, 'unavailable', { error: { code: 123, message: {} } }])(
    'handles unexpected JSON error shapes safely',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status: 503 })));
      await expect(api('/status')).rejects.toMatchObject({
        code: 'REQUEST_FAILED',
        message: 'The request failed.',
        status: 503,
      });
    },
  );
});
