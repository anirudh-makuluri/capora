import { DomainError } from '@capora/types';
import { builtinCapabilities, builtinOutputSchema, validatePayload } from '@capora/provider-sdk';
import { PROVIDER_TIMEOUT_MS, MAX_PAYLOAD_BYTES } from '@capora/config';
import { boundedJson } from '../lib/provider-http';

export function validateBuiltinInput(endpoint: string, input: Record<string, unknown>) {
  const capability = builtinCapabilities.find((c) => endpoint === `builtin://${c.id}`);
  if (!capability) throw new DomainError('ENDPOINT_NOT_ALLOWED', 'Unknown built-in capability.');
  validatePayload(capability.schema, input);
  if (
    capability.id === 'github_repository' &&
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(String(input.repository))
  )
    throw new DomainError('INVALID_CAPABILITY_INPUT', 'Use a GitHub owner/repository name, without a URL.');
  if (capability.id === 'worldbank_indicators' && Number(input.endYear) < Number(input.startYear))
    throw new DomainError('INVALID_CAPABILITY_INPUT', 'endYear must be at least startYear.');
  if (
    capability.id === 'document_fingerprint' &&
    input.expectedSha256 !== undefined &&
    !/^[a-fA-F0-9]{64}$/.test(String(input.expectedSha256))
  )
    throw new DomainError(
      'INVALID_CAPABILITY_INPUT',
      'expectedSha256 must contain 64 hexadecimal characters.',
    );
  return capability;
}

// Source URLs are constructed here, never accepted from buyer input. Redirects fail closed.
async function sourceJson(url: URL, signal: AbortSignal, headers?: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Capora/0.1 (public-data retrieval)', ...headers },
      // Workers supports manual/follow; reject redirect responses below without following them.
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
      throw new DomainError('PROVIDER_TIMEOUT', 'Source exceeded the execution deadline.', 504);
    throw new DomainError(
      'PROVIDER_FAILURE',
      'Source could not be reached. No substitute data was returned.',
      502,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DomainError(
      response.status === 429 || response.status === 403 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_FAILURE',
      `Source returned HTTP ${response.status}. No substitute data was returned.`,
      502,
    );
  }
  return boundedJson(response);
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Source returned an unexpected object.', 502);
  return value as Record<string, unknown>;
};
const records = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value))
    throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Source returned an unexpected list.', 502);
  return value.map(record);
};

export async function invokeBuiltin(endpoint: string, input: Record<string, unknown>) {
  const capability = validateBuiltinInput(endpoint, input);
  const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  let data: Record<string, unknown>;
  let sourceUrl = capability.documentationUrl;
  let source: string;
  let license = 'Buyer-supplied content; no transfer of third-party rights.';
  const count = Number(input.limit ?? 5);
  if (capability.id === 'gleif_entities') {
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
    data = { entities, total: Number(record(record(result.meta).pagination).total) };
    source = 'GLEIF';
    sourceUrl = url.href;
    license = 'GLEIF LEI data: CC0. Public data retrieval service.';
  } else if (capability.id === 'crossref_research') {
    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query', String(input.query));
    url.searchParams.set('rows', String(count));
    url.searchParams.set('select', 'DOI,title,author,publisher,published,type,URL');
    const message = record(record(await sourceJson(url, signal)).message);
    data = {
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
    source = 'Crossref';
    sourceUrl = url.href;
    license = 'Public Crossref bibliographic metadata. Full text and abstracts are not included.';
  } else if (capability.id === 'worldbank_indicators') {
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
    data = {
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
    source = 'World Bank';
    sourceUrl = url.href;
    license = 'World Bank open data: CC BY 4.0, subject to dataset-specific terms. Attribution: World Bank.';
  } else if (capability.id === 'github_repository') {
    const url = new URL(
      `https://api.github.com/repos/${String(input.repository).split('/').map(encodeURIComponent).join('/')}`,
    );
    const item = record(
      await sourceJson(url, signal, {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }),
    );
    if (typeof item.full_name !== 'string')
      throw new DomainError('INVALID_PROVIDER_OUTPUT', 'GitHub did not return repository metadata.', 502);
    data = {
      repository: {
        fullName: item.full_name,
        description: item.description,
        language: item.language,
        stars: item.stargazers_count,
        forks: item.forks_count,
        openIssues: item.open_issues_count,
        archived: item.archived,
        defaultBranch: item.default_branch,
        pushedAt: item.pushed_at,
        license: item.license,
        sourceUrl: item.html_url,
      },
    };
    source = 'GitHub';
    sourceUrl = url.href;
    license = 'Public GitHub metadata; repository content retains its own license. No code is distributed.';
  } else if (capability.id === 'code_scan') {
    const code = String(input.code);
    const findings: Record<string, unknown>[] = [];
    code.split('\n').forEach((line, i) => {
      if (/\beval\s*\(/.test(line))
        findings.push({
          severity: 'high',
          rule: 'unsafe-eval',
          line: i + 1,
          message: 'Dynamic code execution may accept untrusted input.',
          remediation: 'Use an explicit validated operation map.',
        });
      if (/SELECT|INSERT|UPDATE/i.test(line) && /\$\{|\+\s*(req|input)/.test(line))
        findings.push({
          severity: 'high',
          rule: 'sql-interpolation',
          line: i + 1,
          message: 'Possible interpolated SQL.',
          remediation: 'Use parameterized queries.',
        });
      if (/\b(password|secret|api_key)\s*[:=]\s*["'][^"']{6,}["']/i.test(line))
        findings.push({
          severity: 'high',
          rule: 'hardcoded-secret',
          line: i + 1,
          message: 'Possible embedded credential.',
          remediation: 'Rotate the credential and use secret storage.',
        });
    });
    data = {
      linesAnalyzed: code.split('\n').length,
      findings: findings.slice(0, 100),
      totalFindings: findings.length,
      truncated: findings.length > 100,
      rules: ['unsafe-eval', 'sql-interpolation', 'hardcoded-secret'],
    };
    source = 'Capora code pattern scanner v1';
  } else {
    const bytes = new TextEncoder().encode(String(input.text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    data = {
      sha256,
      bytes: bytes.byteLength,
      matchesExpected:
        input.expectedSha256 === undefined ? null : sha256 === String(input.expectedSha256).toLowerCase(),
    };
    source = 'Capora SHA-256 fingerprint v1';
  }
  const output = {
    synthetic: false,
    source,
    sourceUrl,
    observedAt: new Date().toISOString(),
    license,
    limitations: capability.description,
    data,
  };
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > MAX_PAYLOAD_BYTES)
    throw new DomainError('PROVIDER_OUTPUT_TOO_LARGE', 'Normalized output exceeds the gateway limit.', 502);
  validatePayload(builtinOutputSchema(capability), output, true);
  return output;
}
