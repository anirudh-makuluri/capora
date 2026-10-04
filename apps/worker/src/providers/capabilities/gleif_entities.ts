import type { CapabilityDefinition } from './types';
import { text, limit, object, array, record, records, sourceJson } from './shared';

export const gleifEntities: CapabilityDefinition = {
  metadata: {
    id: 'gleif_entities',
    name: 'Company Registry Search',
    type: 'api',
    category: 'Company intelligence',
    description:
      'Search live GLEIF legal-entity records by company name. Returns LEIs, legal names, jurisdictions, registration status and source links. Public data. Price covers retrieval and normalization. Coverage is limited to entities with an LEI, not every business.',
    priceCents: 20,
    latency: 2000,
    tags: ['company', 'registry', 'LEI', 'public data'],
    documentationUrl: 'https://www.gleif.org/en/lei-data/gleif-api',
    schema: object({ company: { ...text, default: 'Microsoft' }, limit }, ['company']),
    dataSchema: object({ entities: array, total: { type: 'integer', minimum: 0 } }, ['entities', 'total']),
  },

  async execute(input, { signal }) {
    const count = Number(input.limit ?? 5);

    const url = new URL('https://api.gleif.org/api/v1/lei-records');
    url.searchParams.set('filter[entity.legalName]', String(input.company));
    url.searchParams.set('page[size]', String(count));
    const result = record(await sourceJson(url, signal));
    const entities = records(result.data)
      .slice(0, count)
      .map((item) => {
        const attrs = record(item.attributes);
        const entity = record(attrs.entity);
        const registration = record(attrs.registration);
        return {
          lei: attrs.lei,
          legalName: record(entity.legalName).name,
          jurisdiction: entity.jurisdiction,
          status: entity.status,
          legalAddress: entity.legalAddress,
          registrationStatus: registration.status,
          lastUpdated: registration.lastUpdate,
          sourceUrl: `https://api.gleif.org/api/v1/lei-records/${encodeURIComponent(String(attrs.lei))}`,
        };
      });
    const data = { entities, total: Number(record(record(result.meta).pagination).total) };
    const source = 'GLEIF';
    const sourceUrl = url.href;
    const license = 'GLEIF LEI data: CC0. Public data retrieval service.';

    return { data, source, sourceUrl, license };
  },
};
