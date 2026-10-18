import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { object, record, records } from './shared';
import { authenticatedJson, providerSetting, sourceText } from './authenticated';

const regions = ['americas', 'europe', 'asia', 'sea'] as const;
const nonnegativeInteger = { type: 'integer', minimum: 0 };
const gameSchema = object(
  {
    matchId: { type: 'string' },
    startedAt: { type: 'string' },
    durationSeconds: nonnegativeInteger,
    gameMode: { type: 'string' },
    queueId: nonnegativeInteger,
    champion: { type: 'string' },
    win: { type: 'boolean' },
    kills: nonnegativeInteger,
    deaths: nonnegativeInteger,
    assists: nonnegativeInteger,
  },
  [
    'matchId',
    'startedAt',
    'durationSeconds',
    'gameMode',
    'queueId',
    'champion',
    'win',
    'kills',
    'deaths',
    'assists',
  ],
);

function invalidOutput(): never {
  throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Riot returned incomplete or unexpected match data.', 502);
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalidOutput();
  return value;
}

export const riotRecentMatches: CapabilityDefinition = {
  metadata: {
    id: 'riot_recent_matches',
    name: 'Riot Recent League Matches',
    type: 'api',
    category: 'Gaming',
    description:
      'Demonstration only. Retrieve the latest 1–10 League of Legends games for a Riot ID using Capora-managed credentials. Returns only the requested player’s champion, win/loss, K/D/A, queue, game mode, start time and duration. Default: five games. No timelines, inventories, other-player details or live-game data. Choose the regional route containing the player’s matches. Fewer games may be available.',
    priceCents: 10,
    latency: 5000,
    tags: ['Riot', 'League of Legends', 'LoL', 'gaming', 'match history'],
    documentationUrl: 'https://developer.riotgames.com/docs/lol',
    schema: object(
      {
        gameName: { type: 'string', minLength: 1, maxLength: 100, default: 'Hide on bush' },
        tagLine: { type: 'string', minLength: 1, maxLength: 20, default: 'KR1' },
        region: { type: 'string', enum: [...regions], default: 'asia' },
        count: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
      ['gameName', 'tagLine', 'region'],
    ),
    dataSchema: object(
      {
        riotId: { type: 'string' },
        region: { type: 'string', enum: [...regions] },
        requestedCount: { type: 'integer', minimum: 1, maximum: 10 },
        returnedCount: { type: 'integer', minimum: 0, maximum: 10 },
        games: { type: 'array', maxItems: 10, items: gameSchema },
      },
      ['riotId', 'region', 'requestedCount', 'returnedCount', 'games'],
    ),
  },
  validateInput(input) {
    if (!String(input.gameName).trim() || !String(input.tagLine).trim())
      throw new DomainError('INVALID_CAPABILITY_INPUT', 'Provide a nonempty Riot game name and tag line.');
  },
  async execute(input, { signal, env }) {
    const key = providerSetting(env, 'RIOT_API_KEY');
    const region = String(input.region);
    const count = Number(input.count ?? 5);
    const origin = `https://${region}.api.riotgames.com`;
    const headers = { 'X-Riot-Token': key };
    const gameName = String(input.gameName).trim();
    const tagLine = String(input.tagLine).trim();
    const account = record(
      await authenticatedJson(
        new URL(
          `${origin}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
        ),
        signal,
        { headers },
      ),
    );
    if (typeof account.puuid !== 'string' || !account.puuid || account.puuid.length > 256) invalidOutput();
    const historyUrl = new URL(
      `${origin}/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids`,
    );
    historyUrl.searchParams.set('start', '0');
    historyUrl.searchParams.set('count', String(count));
    const history = await authenticatedJson(historyUrl, signal, { headers });
    if (!Array.isArray(history)) invalidOutput();
    const ids = history.slice(0, count);
    if (
      ids.some((id) => typeof id !== 'string' || !/^[A-Z0-9]+_\d+$/.test(id)) ||
      new Set(ids).size !== ids.length
    )
      invalidOutput();
    const games: Record<string, unknown>[] = [];
    // Sequential requests keep the per-invocation burst small: at most count + 2 calls.
    for (const matchId of ids) {
      const match = record(
        await authenticatedJson(
          new URL(`${origin}/lol/match/v5/matches/${encodeURIComponent(String(matchId))}`),
          signal,
          { headers },
        ),
      );
      if (record(match.metadata).matchId !== matchId) invalidOutput();
      const info = record(match.info);
      const player = records(info.participants).find((participant) => participant.puuid === account.puuid);
      if (!player || typeof player.win !== 'boolean') invalidOutput();
      const started = new Date(integer(info.gameStartTimestamp));
      if (!Number.isFinite(started.getTime())) invalidOutput();
      games.push({
        matchId,
        startedAt: started.toISOString(),
        durationSeconds: integer(info.gameDuration),
        gameMode: sourceText(info.gameMode, 100),
        queueId: integer(info.queueId),
        champion: sourceText(player.championName, 100),
        win: player.win,
        kills: integer(player.kills),
        deaths: integer(player.deaths),
        assists: integer(player.assists),
      });
    }
    return {
      source: 'Riot Games Account-v1 and Match-v5',
      sourceUrl: 'https://developer.riotgames.com/docs/lol',
      license:
        'Capora is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.',
      data: {
        riotId: `${gameName}#${tagLine}`,
        region,
        requestedCount: count,
        returnedCount: games.length,
        games,
      },
    };
  },
};
