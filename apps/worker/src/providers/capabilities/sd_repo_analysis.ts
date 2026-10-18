import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { object, record, records, array } from './shared';
import { authenticatedSseResult, providerSetting, publicHttpsUrl, sourceText } from './authenticated';

export const sdRepoAnalysis: CapabilityDefinition = {
  metadata: {
    id: 'sd_repo_analysis',
    name: 'SD-Artifacts Repository Analysis',
    type: 'agent',
    category: 'Engineering',
    description:
      'Analyze one public GitHub repository and package path using the hosted SD-Artifacts service behind Smart Deploy. Returns build plans, a deployment briefing and actual build status; failed or skipped builds are reported honestly. Queued, with a two-minute deadline. Does not deploy infrastructure or accept private-repo credentials. Prototype price is per analysis.',
    priceCents: 100,
    async: true,
    latency: 60000,
    tags: ['repository', 'build', 'deployment', 'Railpack', 'Smart Deploy', 'SD-Artifacts'],
    documentationUrl: 'https://github.com/anirudh-makuluri/sd-artifacts',
    schema: object(
      {
        repository: { type: 'string', minLength: 3, maxLength: 200, default: 'anirudh-makuluri/capora' },
        packagePath: { type: 'string', minLength: 1, maxLength: 200, default: '.' },
        maxFiles: { type: 'integer', minimum: 1, maximum: 50, default: 30 },
      },
      ['repository'],
    ),
    dataSchema: object(
      {
        repository: { type: 'string' },
        commitSha: { type: 'string' },
        packagePath: { type: 'string' },
        deployShape: { type: 'string' },
        buildStatus: { type: 'string', enum: ['passed', 'failed', 'skipped', 'partial', 'error', 'not_run'] },
        briefing: { type: 'string' },
        deployUnits: array,
        errors: { type: 'array', items: { type: 'string' } },
      },
      [
        'repository',
        'commitSha',
        'packagePath',
        'deployShape',
        'buildStatus',
        'briefing',
        'deployUnits',
        'errors',
      ],
    ),
  },
  executionTimeoutMs: 120000,
  validateInput(input) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(String(input.repository)) ||
      /\/(\.|\.\.)$/.test(String(input.repository))
    )
      throw new DomainError('INVALID_CAPABILITY_INPUT', 'Use a public GitHub owner/repository name.');
    const path = String(input.packagePath ?? '.');
    if (
      path !== '.' &&
      (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(path) ||
        path.split('/').some((part) => part === '..' || part === '.'))
    )
      throw new DomainError('INVALID_CAPABILITY_INPUT', 'Use a relative package path without traversal.');
  },
  async execute(input, { signal, env }) {
    const token = providerSetting(env, 'SD_API_BEARER_TOKEN');
    let base: URL;
    try {
      base = publicHttpsUrl(providerSetting(env, 'SD_API_BASE_URL'));
      if (base.search) throw new Error('Query parameters are not allowed');
    } catch {
      throw new DomainError(
        'PROVIDER_NOT_CONFIGURED',
        'SD_API_BASE_URL must be a public HTTPS base URL without credentials, a query or a fragment.',
        503,
      );
    }
    const url = new URL(`${base.href.replace(/\/$/, '')}/analyze/stream`);
    const body = record(
      await authenticatedSseResult(url, signal, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          repo_url: `https://github.com/${String(input.repository)}`,
          package_path: String(input.packagePath ?? '.'),
          max_files: Number(input.maxFiles ?? 30),
          refresh: false,
        }),
      }),
    );
    if (
      body.schema_version !== 2 ||
      !['passed', 'failed', 'skipped', 'partial', 'error', 'not_run'].includes(String(body.build_status))
    )
      throw new DomainError(
        'INVALID_PROVIDER_OUTPUT',
        'SD-Artifacts returned an unsupported analysis response.',
        502,
      );
    // Exclude inputs_snapshot, LLM traces, cloud account details and raw build logs.
    const deployUnits = records(body.deploy_units).map((unit) => ({
      name: sourceText(unit.name, 200),
      root: sourceText(unit.root, 200),
      type: sourceText(unit.type, 100),
      artifacts: { railpackPlan: record(unit.artifacts).railpack_plan ?? null },
    }));
    return {
      source: 'SD-Artifacts',
      sourceUrl: 'https://github.com/anirudh-makuluri/sd-artifacts',
      license:
        'Analysis of public repository content; source repository and dependency licenses still apply.',
      data: {
        repository: input.repository,
        commitSha: sourceText(body.commit_sha, 100),
        packagePath: sourceText(body.package_path, 200),
        deployShape: sourceText(body.deploy_shape, 100),
        buildStatus: body.build_status,
        briefing: sourceText(body.deploy_briefing, 40000),
        deployUnits,
        errors: Array.isArray(body.errors)
          ? body.errors.map((error) => sourceText(error, 2000)).slice(0, 20)
          : [],
      },
    };
  },
};
