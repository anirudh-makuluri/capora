import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hashPassword } from '../apps/worker/src/lib/password';
import { root, readDeploymentConfig, validateDeploymentConfig } from './deployment-config';
import { sqlValue } from './seed-data';

// Explicit operator provisioning; never overwrites existing users or resets their passwords.
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const fileIndex = args.indexOf('--file');
if (fileIndex < 0 || !args[fileIndex + 1])
  throw new Error('Provide --file .local/admin-account.json containing email, name and password.');
const remote = args.includes('--remote');
if (remote) validateDeploymentConfig(await readDeploymentConfig());
let parsed: unknown;
try {
  parsed = JSON.parse(await readFile(resolve(root, args[fileIndex + 1]), 'utf8'));
} catch {
  throw new Error(
    'Provide a valid email, name (1–80 characters) and password (12–128 characters). File contents were not printed.',
  );
}
const input = parsed as { email?: unknown; name?: unknown; password?: unknown } | null;
if (
  !input ||
  typeof input.email !== 'string' ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
  input.email.length > 254 ||
  typeof input.name !== 'string' ||
  !input.name.trim() ||
  input.name.trim().length > 80 ||
  typeof input.password !== 'string' ||
  input.password.length < 12 ||
  input.password.length > 128
)
  throw new Error('Provide a valid email, name (1–80 characters) and password (12–128 characters).');
const email = input.email.trim().toLowerCase();
const userId = `user_${randomUUID()}`;
const accountId = `account_${randomUUID()}`;
const now = Date.now();
const q = sqlValue;
const passwordHash = await hashPassword(input.password);
const sql = `
INSERT INTO users(id,email,name,created_at,updated_at)
SELECT ${q(userId)},${q(email)},${q(input.name.trim())},${q(new Date(now).toISOString())},${q(new Date(now).toISOString())}
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email)=${q(email)});
INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password,created_at,updated_at)
SELECT ${q(accountId)},id,id,'credential',${q(passwordHash)},${now},${now} FROM users WHERE id=${q(userId)};
SELECT 1 AS provisioned FROM auth_accounts WHERE id=${q(accountId)};
`;
await mkdir(resolve(root, '.local'), { recursive: true });
const sqlPath = resolve(root, `.local/admin-${randomUUID()}.sql`);
try {
  await writeFile(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'apps/worker/node_modules/wrangler/bin/wrangler.js'),
      'd1',
      'execute',
      'capora-db',
      remote ? '--remote' : '--local',
      '--file',
      sqlPath,
      '--json',
    ],
    { cwd: resolve(root, 'apps/worker'), encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(
      'Account provisioning failed. Check migrations and database access. Credentials were not printed.',
    );
  const results = JSON.parse(result.stdout) as { results?: { provisioned: number }[] }[];
  if (!results.some((result) => result.results?.some((row) => row.provisioned === 1)))
    throw new Error('No account created: the email already exists. Existing credentials were preserved.');
  console.log(
    'Account provisioned. Access requires its exact email in ADMIN_EMAILS. Credentials were not printed.',
  );
} finally {
  await rm(sqlPath, { force: true });
}
