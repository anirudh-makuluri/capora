import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { object, record, records, array } from './shared';
import { authenticatedJson, providerSetting, sourceText } from './authenticated';

export const azureMapsGeocode: CapabilityDefinition = {
  metadata: {
    id: 'azure_maps_geocode',
    name: 'Azure Maps Geocoding',
    type: 'api',
    category: 'Location',
    description:
      'Resolve one address or place query to coordinates and formatted addresses through Azure Maps using Capora-managed credentials. Returns up to five candidates with match confidence. Geocoding is approximate and may be ambiguous; does not provide routes or nearby-business search. Prototype price is per invocation.',
    priceCents: 5,
    latency: 1500,
    tags: ['Azure Maps', 'location', 'geocoding', 'address', 'coordinates'],
    documentationUrl: 'https://learn.microsoft.com/en-us/rest/api/maps/search/get-geocoding',
    schema: object(
      {
        query: { type: 'string', minLength: 1, maxLength: 500, default: '1 Microsoft Way, Redmond, WA' },
        limit: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
      },
      ['query'],
    ),
    dataSchema: object({ query: { type: 'string' }, results: array, attribution: { type: 'string' } }, [
      'query',
      'results',
      'attribution',
    ]),
  },
  validateInput(input) {
    if (!String(input.query).trim())
      throw new DomainError('INVALID_CAPABILITY_INPUT', 'Use a nonempty address or place query.');
  },
  async execute(input, { signal, env }) {
    const key = providerSetting(env, 'AZURE_MAPS_KEY');
    const url = new URL('https://atlas.microsoft.com/geocode');
    url.searchParams.set('api-version', '2025-01-01');
    url.searchParams.set('query', String(input.query));
    url.searchParams.set('top', String(input.limit ?? 3));
    const body = record(await authenticatedJson(url, signal, { headers: { 'subscription-key': key } }));
    if (body.type !== 'FeatureCollection')
      throw new DomainError(
        'INVALID_PROVIDER_OUTPUT',
        'Azure Maps did not return a geocoding collection.',
        502,
      );
    const results = records(body.features)
      .slice(0, Number(input.limit ?? 3))
      .map((feature) => {
        const properties = record(feature.properties);
        const address = record(properties.address);
        const geometry = record(feature.geometry);
        const coordinates = geometry.coordinates;
        if (
          geometry.type !== 'Point' ||
          !Array.isArray(coordinates) ||
          coordinates.length < 2 ||
          !coordinates.slice(0, 2).every((value) => typeof value === 'number' && Number.isFinite(value)) ||
          Math.abs(coordinates[0]) > 180 ||
          Math.abs(coordinates[1]) > 90
        )
          throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Azure Maps returned invalid coordinates.', 502);
        return {
          formattedAddress: sourceText(address.formattedAddress, 1000),
          longitude: coordinates[0],
          latitude: coordinates[1],
          confidence: sourceText(properties.confidence, 100),
          matchCodes: Array.isArray(properties.matchCodes)
            ? properties.matchCodes.filter((code) => typeof code === 'string').slice(0, 10)
            : [],
        };
      });
    return {
      source: 'Microsoft Azure Maps',
      sourceUrl: 'https://atlas.microsoft.com/geocode',
      license: 'Microsoft Azure Maps terms apply. No transfer of mapping or third-party data rights.',
      data: { query: input.query, results, attribution: '© Microsoft and its data suppliers' },
    };
  },
};
