import { DomainError } from '@capora/types';
import type { Env } from '../../env';
import { boundedJson } from '../../lib/provider-http';

export type ProviderSetting =
  | 'BRAVE_SEARCH_API_KEY'
  | 'CONTEXT_DEV_API_KEY'
  | 'AZURE_MAPS_KEY'
  | 'SD_API_BASE_URL'
  | 'SD_API_BEARER_TOKEN'
  | 'RIOT_API_KEY';

export function providerSetting(env: Partial<Env> | undefined, name: ProviderSetting): string {
  const value = env?.[name]?.trim();
  if (!value) throw new DomainError('PROVIDER_NOT_CONFIGURED', `The operator must configure ${name}.`, 503);
  return value;
}

// Only public HTTPS targets, without URL credentials, ports or fragments.
// This also applies to URLs passed to the remote scraper and the operator's SD endpoint.
export function publicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError('INVALID_CAPABILITY_INPUT', 'Use a public HTTPS URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !url.hostname.includes('.') ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(':') ||
    /(^|\.)(localhost|local|internal|test|invalid|example|home|lan|onion)\.?$/i.test(url.hostname)
  )
    throw new DomainError(
      'INVALID_CAPABILITY_INPUT',
      'Use a public HTTPS URL without credentials or a fragment.',
    );
  return url;
}

// Never return upstream error bodies, request URLs, or network exception text: they can contain secrets.
type SourceRequest = { method?: 'GET' | 'POST'; headers: Record<string, string>; body?: string };

async function authenticatedRequest(url: URL, signal: AbortSignal, init: SourceRequest): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
      redirect: 'manual',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      const code =
        response.status === 401 || response.status === 403
          ? 'PROVIDER_AUTH_FAILED'
          : response.status === 429
            ? 'PROVIDER_RATE_LIMITED'
            : 'PROVIDER_FAILURE';
      throw new DomainError(
        code,
        `Source returned HTTP ${response.status}. No substitute data was returned.`,
        502,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (signal.aborted || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)))
      throw new DomainError('PROVIDER_TIMEOUT', 'Source exceeded the execution deadline.', 504);
    throw new DomainError(
      'PROVIDER_FAILURE',
      'Source could not be reached. No substitute data was returned.',
      502,
    );
  }
}

function safeSourceError(error: unknown, signal: AbortSignal): never {
  if (error instanceof DomainError) throw error;
  if (signal.aborted || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)))
    throw new DomainError('PROVIDER_TIMEOUT', 'Source exceeded the execution deadline.', 504);
  throw new DomainError(
    'PROVIDER_FAILURE',
    'Source could not be reached. No substitute data was returned.',
    502,
  );
}

export async function authenticatedJson(
  url: URL,
  signal: AbortSignal,
  init: SourceRequest,
): Promise<unknown> {
  try {
    return await boundedJson(await authenticatedRequest(url, signal, init));
  } catch (error) {
    safeSourceError(error, signal);
  }
}

// SD-Artifacts emits progress plus one final JSON object. Consume incrementally so long builds
// do not rely on the blocking endpoint. Bound the entire stream and never expose error frames.
export async function authenticatedSseResult(
  url: URL,
  signal: AbortSignal,
  init: SourceRequest,
): Promise<unknown> {
  const response = await authenticatedRequest(url, signal, init);
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Source did not return an analysis event stream.', 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 256 * 1024)
        throw new DomainError(
          'PROVIDER_OUTPUT_TOO_LARGE',
          'Provider response exceeds the gateway limit.',
          502,
        );
      buffer += decoder.decode(part.value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const lines = frame.split(/\r?\n/);
        const event = lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        if (event === 'error')
          throw new DomainError('PROVIDER_FAILURE', 'SD-Artifacts reported an analysis failure.', 502);
        if (event !== 'complete') continue;
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        try {
          return JSON.parse(data);
        } catch {
          throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Source returned invalid analysis JSON.', 502);
        }
      }
    }
    throw new DomainError('PROVIDER_FAILURE', 'SD-Artifacts ended without a completed analysis.', 502);
  } catch (error) {
    safeSourceError(error, signal);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function sourceText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string')
    throw new DomainError('INVALID_PROVIDER_OUTPUT', 'Source returned an unexpected text field.', 502);
  return value.slice(0, maxLength);
}
