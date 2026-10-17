import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { object, record, sourceJson } from './shared';

const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1', 'ap-southeast-1'];
// Regional Lambda files include unrelated products and exceed the default source limit.
const MAX_PRICE_FILE_BYTES = 2 * 1024 * 1024;
const pricingUrl = 'https://aws.amazon.com/lambda/pricing/';
const assumptions = [
  'Standard on-demand Lambda requests and duration only, in USD for the supplied monthly workload.',
  'Monthly volume tiers start at zero; other functions and AWS Organizations usage are not included.',
  'Average billed duration must include initialization and billing rounding. Async payloads may count as multiple requests.',
  'Excludes free tier, credits, Savings Plans, negotiated discounts, taxes and currency conversion.',
  'Excludes provisioned concurrency, managed instances, ephemeral storage above 512 MB, response streaming, data transfer, CloudWatch and other services.',
  'Informational estimate, not an AWS bill or quote. AWS service pricing pages take precedence.',
];
const amount = { type: 'number', minimum: 0 };
const string = { type: 'string', minLength: 1 };
const invalidPrice = () =>
  new DomainError('INVALID_PROVIDER_OUTPUT', 'AWS did not return unambiguous Lambda on-demand prices.', 502);

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw invalidPrice();
  return value;
}

function readRates(
  products: Record<string, unknown>,
  onDemand: Record<string, unknown>,
  group: string,
  region: string,
  units: string[],
) {
  const matches = Object.values(products)
    .map(record)
    .filter((product) => {
      const attributes = record(product.attributes);
      return (
        attributes.servicecode === 'AWSLambda' &&
        attributes.regionCode === region &&
        attributes.group === group
      );
    });
  if (matches.length !== 1) throw invalidPrice();
  const sku = requiredString(matches[0].sku);
  const terms = Object.values(record(onDemand[sku])).map(record);
  if (terms.length !== 1 || terms[0].sku !== sku) throw invalidPrice();
  const effectiveDate = requiredString(terms[0].effectiveDate);
  if (!Number.isFinite(Date.parse(effectiveDate))) throw invalidPrice();
  const tiers = Object.values(record(terms[0].priceDimensions))
    .map((value) => {
      const dimension = record(value);
      const price = requiredString(record(dimension.pricePerUnit).USD);
      const begin = requiredString(dimension.beginRange);
      const end = requiredString(dimension.endRange);
      const beginRange = Number(begin);
      const endRange = end === 'Inf' ? Infinity : Number(end);
      const usdPerUnit = Number(price);
      if (
        !/^\d+(\.\d+)?$/.test(price) ||
        !Number.isFinite(usdPerUnit) ||
        usdPerUnit <= 0 ||
        !/^\d+(\.\d+)?$/.test(begin) ||
        (end !== 'Inf' && !/^\d+(\.\d+)?$/.test(end)) ||
        !Number.isFinite(beginRange) ||
        beginRange < 0 ||
        (end !== 'Inf' && !Number.isFinite(endRange)) ||
        endRange <= beginRange ||
        !units.includes(String(dimension.unit)) ||
        !Array.isArray(dimension.appliesTo) ||
        dimension.appliesTo.length !== 0
      )
        throw invalidPrice();
      return {
        beginRange,
        endRange: end === 'Inf' ? ('Inf' as const) : endRange,
        usdPerUnit,
        rateCode: requiredString(dimension.rateCode),
      };
    })
    .sort((a, b) => a.beginRange - b.beginRange);
  if (!tiers.length || tiers[0].beginRange !== 0 || tiers.at(-1)?.endRange !== 'Inf') throw invalidPrice();
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i - 1].endRange !== tiers[i].beginRange) throw invalidPrice();
  }
  return { sku, effectiveDate, tiers };
}

function costFor(quantity: number, rates: ReturnType<typeof readRates>) {
  return rates.tiers.reduce((cost, tier) => {
    const end = tier.endRange === 'Inf' ? Infinity : tier.endRange;
    return cost + Math.max(0, Math.min(quantity, end) - tier.beginRange) * tier.usdPerUnit;
  }, 0);
}

export const awsLambdaEstimate: CapabilityDefinition = {
  metadata: {
    id: 'aws_lambda_estimate',
    name: 'AWS Lambda Cost Estimate',
    type: 'api',
    category: 'Engineering',
    description:
      'Estimate monthly standard on-demand AWS Lambda request and compute costs using live public AWS prices, architecture and workload. Applies monthly volume tiers starting at zero. Excludes free tier, discounts, taxes and related services. No AWS account access. Price covers retrieval and calculation; not an AWS billing quote.',
    priceCents: 10,
    latency: 2000,
    tags: ['AWS', 'Lambda', 'cloud', 'cost', 'pricing', 'public data'],
    documentationUrl: pricingUrl,
    schema: object(
      {
        region: { type: 'string', enum: regions, default: 'us-east-1' },
        architecture: { type: 'string', enum: ['x86_64', 'arm64'], default: 'arm64' },
        monthlyRequests: {
          type: 'integer',
          minimum: 0,
          maximum: 1_000_000_000,
          default: 1_000_000,
          description: 'Billable request units, including retries and async payload multipliers.',
        },
        memoryMb: { type: 'integer', minimum: 128, maximum: 10240, default: 512 },
        averageBilledDurationMs: {
          type: 'number',
          minimum: 1,
          maximum: 900000,
          default: 200,
          description: 'Average billed duration including initialization and billing rounding.',
        },
      },
      ['region', 'architecture', 'monthlyRequests', 'memoryMb', 'averageBilledDurationMs'],
    ),
    dataSchema: object(
      {
        region: string,
        architecture: string,
        currency: { type: 'string', enum: ['USD'] },
        workload: object(
          {
            monthlyRequests: amount,
            memoryMb: amount,
            averageBilledDurationMs: amount,
            monthlyGbSeconds: amount,
          },
          ['monthlyRequests', 'memoryMb', 'averageBilledDurationMs', 'monthlyGbSeconds'],
        ),
        requestCostUsd: amount,
        computeCostUsd: amount,
        estimatedMonthlyUsd: amount,
        rates: object({ requests: { type: 'object' }, compute: { type: 'object' } }, ['requests', 'compute']),
        priceListVersion: string,
        priceListPublishedAt: string,
        pricingPage: string,
        sourceDisclaimer: string,
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      [
        'region',
        'architecture',
        'currency',
        'workload',
        'requestCostUsd',
        'computeCostUsd',
        'estimatedMonthlyUsd',
        'rates',
        'priceListVersion',
        'priceListPublishedAt',
        'pricingPage',
        'sourceDisclaimer',
        'assumptions',
      ],
    ),
  },
  async execute(input, { signal }) {
    const region = String(input.region);
    const url = new URL(
      `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/${encodeURIComponent(region)}/index.json`,
    );
    const prices = record(await sourceJson(url, signal, undefined, MAX_PRICE_FILE_BYTES));
    if (prices.offerCode !== 'AWSLambda') throw invalidPrice();
    const version = requiredString(prices.version);
    const publishedAt = requiredString(prices.publicationDate);
    const disclaimer = requiredString(prices.disclaimer);
    if (!Number.isFinite(Date.parse(publishedAt))) throw invalidPrice();
    const products = record(prices.products);
    const onDemand = record(record(prices.terms).OnDemand);
    const suffix = input.architecture === 'arm64' ? '-ARM' : '';
    const requests = readRates(products, onDemand, `AWS-Lambda-Requests${suffix}`, region, [
      'Request',
      'Requests',
    ]);
    const compute = readRates(products, onDemand, `AWS-Lambda-Duration${suffix}`, region, [
      'Lambda-GB-Second',
    ]);
    const monthlyRequests = Number(input.monthlyRequests);
    const memoryMb = Number(input.memoryMb);
    const averageBilledDurationMs = Number(input.averageBilledDurationMs);
    const monthlyGbSeconds = monthlyRequests * (memoryMb / 1024) * (averageBilledDurationMs / 1000);
    const requestCost = costFor(monthlyRequests, requests);
    const computeCost = costFor(monthlyGbSeconds, compute);
    if (!Number.isFinite(requestCost + computeCost)) throw invalidPrice();
    // Keep sub-cent estimates useful; round only after calculating each full charge.
    const usd = (value: number) => Number(value.toFixed(6));
    return {
      source: 'AWS Price List',
      sourceUrl: url.href,
      license:
        'Public AWS pricing information; subject to AWS terms and service pricing pages. Capora charges for retrieval and calculation. No AWS affiliation or endorsement.',
      data: {
        region,
        architecture: input.architecture,
        currency: 'USD',
        workload: { monthlyRequests, memoryMb, averageBilledDurationMs, monthlyGbSeconds },
        requestCostUsd: usd(requestCost),
        computeCostUsd: usd(computeCost),
        estimatedMonthlyUsd: usd(requestCost + computeCost),
        rates: { requests, compute },
        priceListVersion: version,
        priceListPublishedAt: publishedAt,
        pricingPage: pricingUrl,
        sourceDisclaimer: disclaimer,
        assumptions,
      },
    };
  },
};
