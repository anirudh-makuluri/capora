import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeBuiltin, validateBuiltinInput } from '../apps/worker/src/providers/live';

const endpoint = 'builtin://riot_recent_matches';
const input = { gameName: 'Player Name', tagLine: 'NA1', region: 'americas', count: 2 };
const env = { RIOT_API_KEY: 'test-riot-key-never-return' };
const player = {
  puuid: 'requested-player',
  championName: 'Veigar',
  win: true,
  kills: 8,
  deaths: 2,
  assists: 6,
};
function match(id = 'NA1_123', participant: Record<string, unknown> = player) {
  return {
    metadata: { matchId: id },
    info: {
      gameStartTimestamp: 1792260000000,
      gameDuration: 1800,
      gameMode: 'CLASSIC',
      queueId: 420,
      participants: [{ ...player, puuid: 'another-player', championName: 'Yasuo' }, participant],
      teams: [{ private: 'not-needed' }],
    },
  };
}
function mockFlow(ids: string[] = ['NA1_123', 'NA1_124']) {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ puuid: 'requested-player', gameName: input.gameName, tagLine: input.tagLine }),
    )
    .mockResolvedValueOnce(Response.json(ids));
  for (const id of ids) fetcher.mockResolvedValueOnce(Response.json(match(id)));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

describe('Riot recent League matches', () => {
  it('resolves a Riot ID and returns only compact summaries for the correct player', async () => {
    const fetcher = mockFlow();
    const result = await invokeBuiltin(endpoint, input, env);
    expect(result).toMatchObject({
      synthetic: false,
      data: {
        riotId: 'Player Name#NA1',
        region: 'americas',
        requestedCount: 2,
        returnedCount: 2,
        games: [
          {
            matchId: 'NA1_123',
            champion: 'Veigar',
            win: true,
            kills: 8,
            deaths: 2,
            assists: 6,
            durationSeconds: 1800,
            queueId: 420,
            gameMode: 'CLASSIC',
          },
          { matchId: 'NA1_124', champion: 'Veigar' },
        ],
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][0].href).toBe(
      'https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Player%20Name/NA1',
    );
    expect(fetcher.mock.calls[1][0].pathname).toBe('/lol/match/v5/matches/by-puuid/requested-player/ids');
    expect(fetcher.mock.calls[1][0].searchParams.get('count')).toBe('2');
    expect(fetcher.mock.calls[1][0].searchParams.get('start')).toBe('0');
    for (const [url, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        redirect: 'manual',
        headers: { 'X-Riot-Token': env.RIOT_API_KEY },
        signal: expect.any(AbortSignal),
      });
      expect(url.href).not.toContain(env.RIOT_API_KEY);
      expect(url.pathname).not.toContain('/timeline');
    }
    const serialized = JSON.stringify(result);
    for (const hidden of [
      env.RIOT_API_KEY,
      'requested-player',
      'another-player',
      'participants',
      'teams',
      'Yasuo',
    ])
      expect(serialized).not.toContain(hidden);
    expect(Object.keys((result.data.games as Record<string, unknown>[])[0])).toHaveLength(10);
  });

  it('defaults to five games and bounds detail calls even if the source returns more IDs', async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `KR_${i}`);
    const fetcher = mockFlow(ids);
    const result = await invokeBuiltin(endpoint, { gameName: 'Faker', tagLine: 'KR1', region: 'asia' }, env);
    expect(result.data).toMatchObject({ requestedCount: 5, returnedCount: 5 });
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(fetcher.mock.calls[0][0].hostname).toBe('asia.api.riotgames.com');
  });

  it('returns empty history honestly without fetching match details', async () => {
    const fetcher = mockFlow([]);
    expect((await invokeBuiltin(endpoint, input, env)).data).toMatchObject({
      requestedCount: 2,
      returnedCount: 0,
      games: [],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { count: 0 },
    { count: 11 },
    { count: 1.5 },
    { count: '5' },
    { region: 'na1' },
    { region: 'https://localhost' },
    { gameName: ' ' },
    { tagLine: ' ' },
    { api_key: 'buyer-supplied-key' },
  ])('rejects invalid input before quoting: %j', (patch) => {
    expect(() => validateBuiltinInput(endpoint, { ...input, ...patch })).toThrow();
  });

  it('requires a server-side key before making requests', async () => {
    const fetcher = mockFlow();
    await expect(invokeBuiltin(endpoint, input)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 429])(
    'reports HTTP %s without exposing credentials or fabricating matches',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json({ detail: env.RIOT_API_KEY }, { status })),
      );
      const error = await invokeBuiltin(endpoint, input, env).catch((e) => e);
      expect(error.code).toBe(
        status === 401 || status === 403
          ? 'PROVIDER_AUTH_FAILED'
          : status === 429
            ? 'PROVIDER_RATE_LIMITED'
            : 'PROVIDER_FAILURE',
      );
      expect(error.message).not.toContain(env.RIOT_API_KEY);
    },
  );

  it('fails a partial upstream request rather than reporting incomplete history as complete', async () => {
    const fetcher = mockFlow();
    fetcher
      .mockReset()
      .mockResolvedValueOnce(Response.json({ puuid: 'requested-player' }))
      .mockResolvedValueOnce(Response.json(['NA1_123', 'NA1_124']))
      .mockResolvedValueOnce(Response.json(match()))
      .mockResolvedValueOnce(Response.json({ error: env.RIOT_API_KEY }, { status: 429 }));
    await expect(invokeBuiltin(endpoint, input, env)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('rejects a match that does not contain the requested player', async () => {
    const fetcher = mockFlow();
    fetcher
      .mockReset()
      .mockResolvedValueOnce(Response.json({ puuid: 'requested-player' }))
      .mockResolvedValueOnce(Response.json(['NA1_123']))
      .mockResolvedValueOnce(Response.json(match('NA1_123', { ...player, puuid: 'different-player' })));
    await expect(invokeBuiltin(endpoint, input, env)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_OUTPUT',
    });
  });
});
