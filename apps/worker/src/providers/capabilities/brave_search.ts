import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { object, record, records, array } from './shared';
import { authenticatedJson, providerSetting, sourceText } from './authenticated';

export const braveSearch: CapabilityDefinition = {
  metadata: {
    id: 'brave_search',
    name: 'Brave Web Search',
    type: 'api',
    category: 'Research',
    description:
      'Search the live web through Brave using Capora-managed credentials. One query returns up to ten titles, URLs and snippets; no page scraping. Prototype price is per invocation, not Brave billing. Results retain third-party rights and are not verified facts.',
    priceCents: 5,
    latency: 1500,
    tags: ['search', 'web', 'Brave', 'research'],
    documentationUrl: 'https://api-dashboard.search.brave.com/documentation/quickstart',
    schema: object(
      {
        query: { type: 'string', minLength: 1, maxLength: 400, default: 'Cloudflare Workers documentation' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        country: { type: 'string', minLength: 2, maxLength: 2, default: 'US' },
        freshness: { type: 'string', enum: ['pd', 'pw', 'pm', 'py'] },
      },
      ['query'],
    ),
    dataSchema: object({ query: { type: 'string' }, results: array }, ['query', 'results']),
  },
  validateInput(input) {
    if (
      !String(input.query).trim() ||
      (input.country !== undefined && !/^[A-Z]{2}$/.test(String(input.country)))
    )
      throw new DomainError(
        'INVALID_CAPABILITY_INPUT',
        'Use a nonempty query and a two-letter uppercase country code.',
      );
  },
  async execute(input, { signal, env }) {
    const key = providerSetting(env, 'BRAVE_SEARCH_API_KEY');
    const count = Number(input.limit ?? 5);
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', String(input.query));
    url.searchParams.set('count', String(count));
    url.searchParams.set('country', String(input.country ?? 'US'));
    url.searchParams.set('safesearch', 'moderate');
    url.searchParams.set('result_filter', 'web');
    if (input.freshness) url.searchParams.set('freshness', String(input.freshness));
    const body = record(await authenticatedJson(url, signal, { headers: { 'X-Subscription-Token': key } }));
    // Brave omits the web section when a valid search has no web matches.
    const web =
      body.web === undefined && body.type === 'search' && body.query ? { results: [] } : record(body.web);
    const results = records(web.results)
      .slice(0, count)
      .map((item) => ({
        title: sourceText(item.title, 500),
        url: sourceText(item.url, 4000),
        description: typeof item.description === 'string' ? item.description.slice(0, 4000) : '',
      }));
    return {
      source: 'Brave Search API',
      sourceUrl: 'https://search.brave.com/',
      license:
        'Brave API and third-party content terms apply. Prototype access; no transfer of content rights.',
      data: { query: input.query, results },
    };
  },
};
