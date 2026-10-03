import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';

export const root = resolve(import.meta.dirname, '..');
export const requiredSecrets = [
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'DEMO_PROVIDER_SECRET',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
];

export type DeploymentConfig = {
  name: string;
  vars: Record<string, string>;
  d1_databases: { binding: string; database_name: string; database_id: string }[];
};

export async function readDeploymentConfig(): Promise<DeploymentConfig> {
  const path = resolve(root, 'apps/worker/wrangler.jsonc');
  const parsed = ts.parseConfigFileTextToJson(path, await readFile(path, 'utf8'));
  if (parsed.error) throw new Error('Could not parse apps/worker/wrangler.jsonc.');
  return parsed.config as DeploymentConfig;
}

export function validateDeploymentConfig(config: DeploymentConfig): URL {
  const db = config.d1_databases?.find((binding) => binding.binding === 'DB');
  if (
    db?.database_name !== 'capora-db' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(db.database_id) ||
    db.database_id === '00000000-0000-0000-0000-000000000000'
  )
    throw new Error('Set the provisioned capora-db database ID in apps/worker/wrangler.jsonc.');
  let url: URL;
  try {
    url = new URL(config.vars.CAPORA_BASE_URL);
  } catch {
    throw new Error('Set CAPORA_BASE_URL to the final HTTPS origin in apps/worker/wrangler.jsonc.');
  }
  if (
    url.protocol !== 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.hostname.endsWith('.localhost') ||
    url.hostname.endsWith('.example') ||
    url.hostname.endsWith('.invalid') ||
    url.hostname === 'example.com' ||
    url.username ||
    url.password ||
    config.vars.CAPORA_BASE_URL !== url.origin
  )
    throw new Error('CAPORA_BASE_URL must be the final public HTTPS origin, without a trailing slash.');
  if (
    config.vars.DEV_MODE !== 'false' ||
    config.vars.PAYMENT_MODE !== 'sandbox' ||
    config.vars.PAYPAL_ENVIRONMENT !== 'sandbox'
  )
    throw new Error('Deploy with DEV_MODE=false, PAYMENT_MODE=sandbox, and PAYPAL_ENVIRONMENT=sandbox.');
  return url;
}
