import { afterEach, describe, expect, it, vi } from 'vitest';
import { invokeBuiltin, validateBuiltinInput } from '../apps/worker/src/providers/live';

const endpoint = 'builtin://aws_lambda_estimate';
const input = {
  region: 'us-east-1',
  architecture: 'x86_64',
  monthlyRequests: 1_000_000,
  memoryMb: 512,
  averageBilledDurationMs: 200,
};

// Simplified prices and tier boundaries make billing checks independent of live AWS prices.
function priceFile(region = 'us-east-1') {
  const products: Record<string, unknown> = {};
  const onDemand: Record<string, unknown> = {};
  for (const suffix of ['', '-ARM']) {
    for (const kind of ['Requests', 'Duration']) {
      const sku = `${kind}${suffix}`;
      products[sku] = {
        sku,
        attributes: { servicecode: 'AWSLambda', regionCode: region, group: `AWS-Lambda-${kind}${suffix}` },
      };
      const rates =
        kind === 'Requests'
          ? [['0', 'Inf', '0.0000002']]
          : [
              ['0', '100000', suffix ? '0.000015' : '0.00002'],
              ['100000', '300000', '0.00001'],
              ['300000', 'Inf', '0.000005'],
            ];
      onDemand[sku] = {
        term: {
          sku,
          effectiveDate: '2026-10-01T00:00:00Z',
          priceDimensions: Object.fromEntries(
            rates.map(([beginRange, endRange, price], i) => [
              String(i),
              {
                rateCode: `${sku}-${i}`,
                beginRange,
                endRange,
                unit: kind === 'Requests' ? 'Requests' : 'Lambda-GB-Second',
                pricePerUnit: { USD: price },
                appliesTo: [],
              },
            ]),
          ),
        },
      };
    }
  }
  return {
    offerCode: 'AWSLambda',
    version: '20261001000000',
    publicationDate: '2026-10-01T00:00:00Z',
    disclaimer: 'Informational AWS prices.',
    products,
    terms: { OnDemand: onDemand },
  };
}
function mockPrices(file: unknown = priceFile()) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(file)));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

describe('AWS Lambda cost estimate', () => {
  it('computes charges from source rates and includes provenance', async () => {
    const fetcher = mockPrices();
    const result = await invokeBuiltin(endpoint, input);
    expect(result).toMatchObject({
      synthetic: false,
      source: 'AWS Price List',
      data: {
        currency: 'USD',
        requestCostUsd: 0.2,
        computeCostUsd: 2,
        estimatedMonthlyUsd: 2.2,
        workload: { monthlyGbSeconds: 100000 },
        priceListVersion: '20261001000000',
        priceListPublishedAt: '2026-10-01T00:00:00Z',
        sourceDisclaimer: 'Informational AWS prices.',
      },
    });
    expect(result.data.assumptions).toEqual(
      expect.arrayContaining([expect.stringContaining('Excludes free tier')]),
    );
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      new URL(
        'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json',
      ),
      expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
    );
  });
  it('selects ARM prices in another region without mixing architectures', async () => {
    const fetcher = mockPrices(priceFile('eu-west-1'));
    expect(
      (await invokeBuiltin(endpoint, { ...input, region: 'eu-west-1', architecture: 'arm64' })).data,
    ).toMatchObject({
      computeCostUsd: 1.5,
      estimatedMonthlyUsd: 1.7,
      rates: { compute: { sku: 'Duration-ARM' }, requests: { sku: 'Requests-ARM' } },
    });
    expect(String(fetcher.mock.calls[0][0])).toContain('/eu-west-1/index.json');
  });
  it.each([
    [2_000_000, 3, 3.4],
    [5_000_000, 5, 6],
    [0, 0, 0],
  ])(
    'applies marginal tiers for %s requests',
    async (monthlyRequests, computeCostUsd, estimatedMonthlyUsd) => {
      mockPrices();
      expect((await invokeBuiltin(endpoint, { ...input, monthlyRequests })).data).toMatchObject({
        computeCostUsd,
        estimatedMonthlyUsd,
      });
    },
  );
  it.each([
    { region: '../../localhost' },
    { region: 'https://localhost' },
    { architecture: 'gpu' },
    { memoryMb: 127 },
    { monthlyRequests: -1 },
    { monthlyRequests: 1.5 },
    { averageBilledDurationMs: 0 },
    { averageBilledDurationMs: 0.5 },
    { memoryMb: 10241 },
    { averageBilledDurationMs: 900001 },
    { monthlyRequests: 1_000_000_001 },
    { awsSecretAccessKey: 'never accepted' },
  ])('rejects invalid input before quoting or fetching: %j', (change) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(() => validateBuiltinInput(endpoint, { ...input, ...change })).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'missing',
    'duplicate',
    'wrong-region',
    'wrong-unit',
    'missing-usd',
    'negative-price',
    'gapped-tiers',
    'overlapping-tiers',
    'missing-final-tier',
    'malformed-date',
  ])('rejects %s pricing instead of inventing a rate', async (fault) => {
    const file = priceFile();
    const terms = file.terms.OnDemand as Record<
      string,
      { term: { effectiveDate: string; priceDimensions: Record<string, Record<string, unknown>> } }
    >;
    const dimensions = terms.Duration.term.priceDimensions;
    if (fault === 'missing') delete file.products.Duration;
    if (fault === 'duplicate') file.products.duplicate = file.products.Duration;
    if (fault === 'wrong-region')
      file.products.Duration = {
        sku: 'Duration',
        attributes: { servicecode: 'AWSLambda', regionCode: 'us-west-2', group: 'AWS-Lambda-Duration' },
      };
    if (fault === 'wrong-unit') dimensions['0'].unit = 'Hours';
    if (fault === 'missing-usd') dimensions['0'].pricePerUnit = { EUR: '0.01' };
    if (fault === 'negative-price') dimensions['0'].pricePerUnit = { USD: '-0.01' };
    if (fault === 'gapped-tiers') dimensions['1'].beginRange = '100001';
    if (fault === 'overlapping-tiers') dimensions['1'].beginRange = '99999';
    if (fault === 'missing-final-tier') delete dimensions['2'];
    if (fault === 'malformed-date') terms.Duration.term.effectiveDate = 'unknown';
    mockPrices(file);
    await expect(invokeBuiltin(endpoint, input)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_OUTPUT' });
  });
  it('allows a bounded AWS file above the default 256 KiB limit', async () => {
    mockPrices({ ...priceFile(), padding: ' '.repeat(300000) });
    await expect(invokeBuiltin(endpoint, input)).resolves.toMatchObject({
      data: { estimatedMonthlyUsd: 2.2 },
    });
  });
  it('rejects files over the AWS-specific 2 MiB bound', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1))));
    await expect(invokeBuiltin(endpoint, input)).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_TOO_LARGE' });
  });
  it.each([302, 403, 429, 500])('propagates source HTTP %s without fallback prices', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream error', { status })));
    await expect(invokeBuiltin(endpoint, input)).rejects.toMatchObject({
      code: status === 403 || status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_FAILURE',
    });
  });
});
