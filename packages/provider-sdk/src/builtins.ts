import type { CapabilityType, JsonSchema } from '@capora/types';

const text = { type: 'string', minLength: 1, maxLength: 200 };
const limit = { type: 'integer', minimum: 1, maximum: 10, default: 5 };
const object = (properties: Record<string, unknown>, required: string[]): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = { type: 'array', items: { type: 'object' } };
export interface BuiltinCapability {
  id: string;
  name: string;
  description: string;
  type: CapabilityType;
  category: string;
  priceCents: number;
  async?: boolean;
  latency: number;
  tags: string[];
  documentationUrl: string;
  schema: JsonSchema;
  dataSchema: JsonSchema;
}

export const builtinCapabilities: BuiltinCapability[] = [
  {
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
  {
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
  {
    id: 'worldbank_indicators',
    name: 'World Bank Economic Indicators',
    type: 'dataset',
    category: 'Market signals',
    description:
      'Retrieve reported World Bank population, GDP or unemployment observations for a country and year range. Public data. Price covers retrieval and normalization. Missing observations remain null and reported years can lag the retrieval date.',
    priceCents: 10,
    latency: 2000,
    tags: ['economic', 'GDP', 'population', 'public data'],
    documentationUrl:
      'https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures',
    schema: object(
      {
        country: {
          type: 'string',
          enum: ['USA', 'IND', 'GBR', 'DEU', 'FRA', 'CAN', 'AUS', 'JPN', 'BRA', 'CHN'],
          default: 'USA',
        },
        indicator: {
          type: 'string',
          enum: ['SP.POP.TOTL', 'NY.GDP.MKTP.CD', 'SL.UEM.TOTL.ZS'],
          default: 'SP.POP.TOTL',
        },
        startYear: { type: 'integer', minimum: 1960, maximum: 2100, default: 2020 },
        endYear: { type: 'integer', minimum: 1960, maximum: 2100, default: 2024 },
      },
      ['country', 'indicator', 'startYear', 'endYear'],
    ),
    dataSchema: object({ observations: array, total: { type: 'integer', minimum: 0 } }, [
      'observations',
      'total',
    ]),
  },
  {
    id: 'github_repository',
    name: 'GitHub Repository Intelligence',
    type: 'api',
    category: 'Engineering',
    description:
      'Retrieve current public GitHub repository metadata: language, license, stars, forks, open issue count and last push. Public data. Price covers retrieval and normalization. Does not clone code, access private repositories or perform a security audit.',
    priceCents: 15,
    latency: 1500,
    tags: ['repository', 'GitHub', 'engineering', 'public data'],
    documentationUrl: 'https://docs.github.com/en/rest/repos/repos#get-a-repository',
    schema: object({ repository: { ...text, default: 'cloudflare/workers-sdk' } }, ['repository']),
    dataSchema: object({ repository: { type: 'object' } }, ['repository']),
  },
  {
    id: 'code_scan',
    name: 'Code Pattern Scan',
    type: 'agent',
    category: 'Security',
    description:
      'Run deterministic rules on your supplied code for eval, interpolated SQL and possible embedded credentials. Returns actual line-level findings and remediation. A limited pattern scanner with false positives and false negatives. It does not execute code or audit repositories.',
    priceCents: 300,
    async: true,
    latency: 1000,
    tags: ['security', 'code', 'analysis', 'tool'],
    documentationUrl: '/developers',
    schema: object(
      { code: { type: 'string', minLength: 1, maxLength: 100000, default: 'eval(req.body.code)' } },
      ['code'],
    ),
    dataSchema: object(
      {
        linesAnalyzed: { type: 'integer', minimum: 1 },
        findings: array,
        totalFindings: { type: 'integer', minimum: 0 },
        truncated: { type: 'boolean' },
        rules: { type: 'array', items: { type: 'string' } },
      },
      ['linesAnalyzed', 'findings', 'totalFindings', 'truncated', 'rules'],
    ),
  },
  {
    id: 'document_fingerprint',
    name: 'Document Fingerprint',
    type: 'agent',
    category: 'Verification',
    description:
      'Compute a SHA-256 digest and UTF-8 byte count of your supplied text. Optionally compare an expected digest to detect changes. Processes actual content. It does not verify issuer identity, authenticity, OCR or legal validity.',
    priceCents: 10,
    latency: 100,
    tags: ['document', 'integrity', 'SHA-256', 'tool'],
    documentationUrl: '/developers',
    schema: object(
      {
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 100000,
          default: 'Document content to fingerprint.',
        },
        expectedSha256: { type: 'string', minLength: 64, maxLength: 64 },
      },
      ['text'],
    ),
    dataSchema: object(
      {
        sha256: { type: 'string', minLength: 64, maxLength: 64 },
        bytes: { type: 'integer', minimum: 1 },
        matchesExpected: { type: ['boolean', 'null'] },
      },
      ['sha256', 'bytes', 'matchesExpected'],
    ),
  },
];

export function builtinOutputSchema(capability: BuiltinCapability): JsonSchema {
  return object(
    {
      synthetic: { type: 'boolean', enum: [false] },
      source: { type: 'string' },
      sourceUrl: { type: 'string' },
      observedAt: { type: 'string' },
      license: { type: 'string' },
      limitations: { type: 'string' },
      data: capability.dataSchema,
    },
    ['synthetic', 'source', 'sourceUrl', 'observedAt', 'license', 'limitations', 'data'],
  );
}
