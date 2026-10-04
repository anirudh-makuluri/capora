import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { text, object, record, sourceJson } from './shared';

export const githubRepository: CapabilityDefinition = {
  metadata: {
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
  validateInput(input) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(String(input.repository)))
      throw new DomainError('INVALID_CAPABILITY_INPUT', 'Use a GitHub owner/repository name, without a URL.');
  },
  async execute(input, { signal }) {
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
    const data = {
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
    const source = 'GitHub';
    const sourceUrl = url.href;
    const license =
      'Public GitHub metadata; repository content retains its own license. No code is distributed.';

    return { data, source, sourceUrl, license };
  },
};
