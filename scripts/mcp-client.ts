import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ApiErrorBody } from '../packages/types/src/index';
export const baseUrl = process.env.CAPORA_BASE_URL ?? 'http://127.0.0.1:8787';
let localSessionCookie: string | undefined;
async function humanCookie() {
  if (process.env.CAPORA_SESSION_COOKIE) return process.env.CAPORA_SESSION_COOKIE;
  if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) return undefined;
  if (localSessionCookie) return localSessionCookie;
  const credentials = JSON.parse(
    await readFile(resolve(import.meta.dirname, '../.local/credentials.json'), 'utf8'),
  );
  const response = await fetch(new URL('/api/auth/sign-in/email', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: process.env.CAPORA_AUTH_ORIGIN ?? 'http://localhost:5173',
    },
    body: JSON.stringify({ email: 'demo@capora.local', password: credentials.dashboardPassword }),
  });
  if (!response.ok) throw new Error('Local owner login failed. Run pnpm setup:local first.');
  localSessionCookie = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  return localSessionCookie;
}
export async function connect(token?: string) {
  const credentials =
    token || process.env.CAPORA_AGENT_TOKEN
      ? undefined
      : (JSON.parse(await readFile(resolve(import.meta.dirname, '../.local/credentials.json'), 'utf8')) as {
          agentToken: string;
        });
  const agentToken = token ?? process.env.CAPORA_AGENT_TOKEN ?? credentials?.agentToken;
  if (!agentToken) throw new Error('Set CAPORA_AGENT_TOKEN or run pnpm setup:local.');
  const client = new Client({ name: 'Capora acquisition research demo', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${agentToken}` } },
    }),
  );
  return client;
}
export async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[];
  const parsed = JSON.parse(content.find((c) => c.type === 'text')?.text ?? 'null');
  if (result.isError) throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
  return parsed as T;
}
export async function rest<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const cookie = await humanCookie();
  const res = await fetch(
    new URL(`/api${path}`, baseUrl),
    body === undefined
      ? { headers: cookie ? { Cookie: cookie } : {} }
      : {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok) {
    const failure = data as ApiErrorBody;
    throw new Error(`${failure.error?.code}: ${failure.error?.message}`);
  }
  return data as T;
}
export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
