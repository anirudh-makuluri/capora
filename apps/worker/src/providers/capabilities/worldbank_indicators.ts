import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { object, array, record, records, sourceJson } from './shared';

export const worldbankIndicators: CapabilityDefinition = {
  metadata: {
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
  validateInput(input) {
    if (Number(input.endYear) < Number(input.startYear))
      throw new DomainError('INVALID_CAPABILITY_INPUT', 'endYear must be at least startYear.');
  },
  async execute(input, { signal }) {
    const url = new URL(
      `https://api.worldbank.org/v2/country/${encodeURIComponent(String(input.country))}/indicator/${encodeURIComponent(String(input.indicator))}`,
    );
    url.searchParams.set('format', 'json');
    url.searchParams.set('date', `${input.startYear}:${input.endYear}`);
    url.searchParams.set('per_page', '150');
    const result = await sourceJson(url, signal);
    if (!Array.isArray(result) || result.length !== 2)
      throw new DomainError(
        'INVALID_PROVIDER_OUTPUT',
        'World Bank could not resolve this indicator query.',
        502,
      );
    const data = {
      total: Number(record(result[0]).total),
      observations:
        result[1] === null
          ? []
          : records(result[1]).map((item) => ({
              country: item.country,
              indicator: item.indicator,
              year: item.date,
              value: item.value,
              unit: item.unit,
              status: item.obs_status,
            })),
    };
    const source = 'World Bank';
    const sourceUrl = url.href;
    const license =
      'World Bank open data: CC BY 4.0, subject to dataset-specific terms. Attribution: World Bank.';

    return { data, source, sourceUrl, license };
  },
};
