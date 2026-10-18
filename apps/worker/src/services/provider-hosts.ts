import { z } from 'zod';
import { DomainError, type ProviderHostSettings } from '@capora/types';
import type { Env } from '../env';

// Only plain, exact public DNS names; never interpret a URL, wildcard or IP as approval.
export const providerHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((host) => {
    const labels = host.split('.');
    return (
      labels.length >= 2 &&
      labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
      /^[a-z][a-z0-9-]*$/.test(labels.at(-1)!) &&
      !/\.(localhost|local|internal|lan|home|invalid|test|example)$/.test(host) &&
      !['localhost', 'local', 'internal'].includes(host)
    );
  }, 'Enter an exact public hostname, without a scheme, path, wildcard, port or IP address.');

export async function getProviderHostSettings(env: Env): Promise<ProviderHostSettings> {
  const row = await env.DB.prepare(
    "SELECT value,revision,updated_at FROM operator_settings WHERE key='provider_allowed_hosts'",
  ).first<{ value: string; revision: number; updated_at: string }>();
  return row
    ? {
        hosts: JSON.parse(row.value) as string[],
        source: 'dashboard',
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : {
        hosts: [
          ...new Set(
            env.PROVIDER_ALLOWED_HOSTS.split(',')
              .map((h) => h.trim().toLowerCase())
              .filter(Boolean),
          ),
        ].sort(),
        source: 'environment',
        revision: 0,
        updatedAt: null,
      };
}

export async function saveProviderHosts(env: Env, userId: string, input: unknown) {
  const body = z
    .object({
      hosts: z.array(providerHostnameSchema).max(200),
      revision: z.number().int().min(0),
    })
    .parse(input);
  const hosts = [...new Set(body.hosts)].sort();
  const now = new Date().toISOString();
  // Compare-and-swap prevents two open admin dashboards from silently overwriting each other.
  const row = await env.DB.prepare(
    `INSERT INTO operator_settings(key,value,revision,updated_at,updated_by)
     SELECT 'provider_allowed_hosts',?,1,?,? WHERE ?=0
     ON CONFLICT(key) DO NOTHING RETURNING revision`,
  )
    .bind(JSON.stringify(hosts), now, userId, body.revision)
    .first<{ revision: number }>();
  const updated =
    row ??
    (await env.DB.prepare(
      `UPDATE operator_settings SET value=?,revision=revision+1,updated_at=?,updated_by=?
     WHERE key='provider_allowed_hosts' AND revision=? AND ?>0 RETURNING revision`,
    )
      .bind(JSON.stringify(hosts), now, userId, body.revision, body.revision)
      .first<{ revision: number }>());
  if (!updated)
    throw new DomainError(
      'SETTINGS_CHANGED',
      'Another admin changed the hostnames. Reload the list before saving.',
      409,
    );
  return { hosts, source: 'dashboard' as const, revision: updated.revision, updatedAt: now };
}
