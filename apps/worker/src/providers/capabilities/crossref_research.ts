import type { CapabilityDefinition } from './types';
import { text, limit, object, array, record, records, sourceJson } from './shared';

export const crossrefResearch: CapabilityDefinition = {
  metadata: {
    id: 'crossref_research',
    name: 'Research Metadata Search',
    type: 'dataset',
    category: 'Research',
    description:
      'Retrieve live Crossref scholarly metadata with titles, DOI links, authors, publishers and publication dates. Public bibliographic data. Price covers a bounded query and normalization. Does not sell full-text access or patent coverage.',
    priceCents: 25,
    latency: 2000,
    tags: ['research', 'papers', 'DOI', 'public data'],
    documentationUrl: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',
    schema: object({ query: { ...text, default: 'robotics' }, limit }, ['query']),
    dataSchema: object({ works: array, total: { type: 'integer', minimum: 0 } }, ['works', 'total']),
  },

  async execute(input, { signal }) {
    const count = Number(input.limit ?? 5);

    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query', String(input.query));
    url.searchParams.set('rows', String(count));
    url.searchParams.set('select', 'DOI,title,author,publisher,published,type,URL');
    const message = record(record(await sourceJson(url, signal)).message);
    const data = {
      total: Number(message['total-results']),
      works: records(message.items)
        .slice(0, count)
        .map((item) => ({
          doi: item.DOI,
          title: Array.isArray(item.title) ? (item.title[0] ?? '') : '',
          authors: item.author ?? [],
          publisher: item.publisher ?? null,
          published: item.published ?? null,
          type: item.type,
          sourceUrl: item.URL,
        })),
    };
    const source = 'Crossref';
    const sourceUrl = url.href;
    const license = 'Public Crossref bibliographic metadata. Full text and abstracts are not included.';

    return { data, source, sourceUrl, license };
  },
};
