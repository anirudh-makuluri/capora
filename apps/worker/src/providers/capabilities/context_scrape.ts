import { DomainError } from '@capora/types';
import type { CapabilityDefinition } from './types';
import { object, record } from './shared';
import { authenticatedJson, providerSetting, publicHttpsUrl, sourceText } from './authenticated';

export const contextScrape: CapabilityDefinition = {
  metadata: {
    id: 'context_scrape',
    name: 'Context.dev Page Extraction',
    type: 'api',
    category: 'Research',
    description:
      'Retrieve one public HTTPS page as Markdown through Context.dev with Capora-managed credentials. One page, no crawl, login or custom headers. Returns at most 40,000 characters with an explicit truncation flag. Dynamic or blocked pages may fail. Prototype price is per invocation; source content retains its rights.',
    priceCents: 10,
    latency: 5000,
    tags: ['Context.dev', 'scrape', 'markdown', 'web', 'extraction'],
    documentationUrl: 'https://docs.context.dev/scrape/markdown',
    schema: object(
      {
        url: { type: 'string', minLength: 1, maxLength: 2000, default: 'https://example.com' },
      },
      ['url'],
    ),
    dataSchema: object(
      {
        url: { type: 'string' },
        markdown: { type: 'string' },
        truncated: { type: 'boolean' },
      },
      ['url', 'markdown', 'truncated'],
    ),
  },
  validateInput(input) {
    publicHttpsUrl(String(input.url));
  },
  async execute(input, { signal, env }) {
    const key = providerSetting(env, 'CONTEXT_DEV_API_KEY');
    const target = publicHttpsUrl(String(input.url));
    const body = record(
      await authenticatedJson(new URL('https://api.context.dev/v1/web/scrape'), signal, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: target.href,
          formats: { markdown: true },
          sharedParams: { mainContentOnly: true },
          timeoutOpts: { milliseconds: 20000, behavior: 'fail' },
        }),
      }),
    );
    const markdown = record(body.markdown);
    if (markdown.success !== true || typeof markdown.data !== 'string' || !markdown.data.trim())
      throw new DomainError('PROVIDER_FAILURE', 'Context.dev did not return usable page content.', 502);
    return {
      source: 'Context.dev',
      sourceUrl: target.href,
      license: 'Source website and Context.dev terms apply. Extraction does not transfer content rights.',
      data: {
        url: target.href,
        markdown: sourceText(markdown.data, 40000),
        truncated: markdown.data.length > 40000,
      },
    };
  },
};
