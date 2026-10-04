import type { JsonSchema, CapabilityType } from '@capora/types';
const string = { type: 'string', minLength: 1, maxLength: 200 };
const objectSchema = (properties: Record<string, unknown>, required: string[]): JsonSchema => ({
  type: 'object',
  properties: { ...properties, demoFailure: { type: 'boolean' } },
  required,
  additionalProperties: false,
});
export const companySchema = objectSchema(
  { company: string, region: string, timeRange: { type: 'string', maxLength: 60 } },
  ['company'],
);
export const codeSchema = objectSchema(
  { repository: string, code: { type: 'string', maxLength: 100_000 } },
  [],
);
export const querySchema = objectSchema({ query: string, region: string }, ['query']);
export const outputSchema: JsonSchema = {
  type: 'object',
  properties: {
    synthetic: { type: 'boolean' },
    disclaimer: { type: 'string' },
    source: { type: 'string' },
    observedAt: { type: 'string' },
    data: { type: 'object' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    company: { type: 'string' },
    region: { type: 'string' },
  },
  required: ['synthetic', 'source', 'data'],
};
export interface SeedCapability {
  id: string;
  name: string;
  provider: string;
  description: string;
  type: CapabilityType;
  category: string;
  priceCents: number;
  pricingUnit: string;
  reliability: number;
  reputation: number;
  latency: number;
  async?: boolean;
  tags: string[];
  schema: JsonSchema;
}
export const seedCapabilities: SeedCapability[] = [
  {
    id: 'datapulse_headcount',
    name: 'DataPulse Employment Intelligence',
    provider: 'DataPulse',
    description:
      'Proprietary headcount, hiring trends, and regional employee growth for private companies. A licensed employment panel your agent cannot find on the public web.',
    type: 'api',
    category: 'Company intelligence',
    priceCents: 20,
    pricingUnit: 'query',
    reliability: 94,
    reputation: 4.8,
    latency: 2000,
    tags: ['headcount', 'employment', 'hiring', 'private company', 'Arizona'],
    schema: companySchema,
  },
  {
    id: 'companyintel_premium',
    name: 'CompanyIntel Premium',
    provider: 'CompanyIntel',
    description:
      'Verified private-company employment intelligence with corroborated payroll data and a deeper historical record. Built for decisions that demand higher confidence.',
    type: 'api',
    category: 'Company intelligence',
    priceCents: 150,
    pricingUnit: 'query',
    reliability: 99,
    reputation: 4.9,
    latency: 8000,
    tags: ['headcount', 'employment', 'hiring', 'private company', 'verified', 'payroll'],
    schema: companySchema,
  },
  {
    id: 'verifycorp',
    name: 'VerifyCorp Business Verification',
    provider: 'VerifyCorp',
    description:
      'Resolve business identities against a licensed corporate registry. Get registration status, jurisdiction, and entity-level verification in one call.',
    type: 'api',
    category: 'Verification',
    priceCents: 15,
    pricingUnit: 'company',
    reliability: 98.6,
    reputation: 4.7,
    latency: 1200,
    tags: ['business', 'verification', 'registry', 'KYB'],
    schema: companySchema,
  },
  {
    id: 'securescan_advanced',
    name: 'SecureScan Advanced',
    provider: 'SecureScan',
    description:
      'Advanced Security Analysis backed by static-analysis tooling. Inspect a code sample for dangerous patterns and receive prioritized findings with remediation.',
    type: 'agent',
    category: 'Security',
    priceCents: 300,
    pricingUnit: 'job',
    reliability: 99.2,
    reputation: 4.9,
    latency: 12000,
    async: true,
    tags: ['security', 'repository', 'code', 'vulnerability', 'analysis'],
    schema: codeSchema,
  },
  {
    id: 'legalarchive',
    name: 'LegalArchive Search',
    provider: 'LegalArchive',
    description:
      'Search an exclusive index of corporate filings and legal records. Structured results with jurisdictions and document references.',
    type: 'dataset',
    category: 'Legal & compliance',
    priceCents: 35,
    pricingUnit: 'query',
    reliability: 97.8,
    reputation: 4.6,
    latency: 1800,
    tags: ['legal', 'filings', 'records', 'compliance'],
    schema: querySchema,
  },
  {
    id: 'geointel',
    name: 'GeoIntel Location Signals',
    provider: 'GeoIntel',
    description:
      'Premium geospatial and commercial activity intelligence for regional market analysis. Location signals beyond public maps.',
    type: 'api',
    category: 'Geospatial',
    priceCents: 10,
    pricingUnit: 'query',
    reliability: 98.1,
    reputation: 4.7,
    latency: 900,
    tags: ['geospatial', 'location', 'Arizona', 'business'],
    schema: objectSchema({ region: string }, ['region']),
  },
  {
    id: 'retail_demand',
    name: 'Retail Demand Pulse',
    provider: 'RetailPulse',
    description:
      'Proprietary purchase-panel signals across retail channels. Track product demand, regional changes, and emerging category trends.',
    type: 'dataset',
    category: 'Market signals',
    priceCents: 40,
    pricingUnit: 'query',
    reliability: 96.4,
    reputation: 4.5,
    latency: 2500,
    tags: ['retail', 'product', 'demand', 'market'],
    schema: querySchema,
  },
  {
    id: 'documentverify',
    name: 'DocumentVerify Pro',
    provider: 'DocumentVerify',
    description:
      'Document verification using specialized OCR and issuer checks. Structured confidence scores and integrity signals for sensitive workflows.',
    type: 'agent',
    category: 'Verification',
    priceCents: 75,
    pricingUnit: 'document',
    reliability: 99.1,
    reputation: 4.8,
    latency: 6000,
    async: true,
    tags: ['document', 'OCR', 'verification', 'identity'],
    schema: objectSchema({ document: string }, ['document']),
  },
  {
    id: 'supplychain_radar',
    name: 'SupplyChain Radar',
    provider: 'SupplyChainIQ',
    description:
      'Private supplier-network data and concentration risk signals. See dependencies and emerging risks across an organization’s supply chain.',
    type: 'dataset',
    category: 'Company intelligence',
    priceCents: 60,
    pricingUnit: 'query',
    reliability: 96.9,
    reputation: 4.6,
    latency: 3200,
    tags: ['supplier', 'risk', 'company', 'network'],
    schema: companySchema,
  },
  {
    id: 'patentlens',
    name: 'PatentLens Research Index',
    provider: 'PatentLens',
    description:
      'A curated patent and technology-transfer index with normalized entities and licensed research annotations.',
    type: 'dataset',
    category: 'Research',
    priceCents: 25,
    pricingUnit: 'query',
    reliability: 98.4,
    reputation: 4.7,
    latency: 1500,
    tags: ['patent', 'research', 'robotics', 'technology'],
    schema: querySchema,
  },
];
