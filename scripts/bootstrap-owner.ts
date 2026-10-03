import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hashPassword } from '../apps/worker/src/lib/password';
import { root, readDeploymentConfig, validateDeploymentConfig } from './deployment-config';

// Operator-only provisioning. Public signup never claims an existing user's data.
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const fileIndex = args.indexOf('--file');
if (fileIndex < 0 || !args[fileIndex + 1])
  throw new Error('Provide --file .local/owner-account.json containing email, name, and password.');
const remote = args.includes('--remote');
if (remote) validateDeploymentConfig(await readDeploymentConfig());
let input;
try {
  input = JSON.parse(await readFile(resolve(root, args[fileIndex + 1]), 'utf8'));
} catch {
  throw new Error('Could not read the owner credential JSON file. Its contents were not printed.');
}
if (
  typeof input.email !== 'string' ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
  input.email.length > 254 ||
  typeof input.name !== 'string' ||
  !input.name.trim() ||
  input.name.length > 80 ||
  typeof input.password !== 'string' ||
  input.password.length < 12 ||
  input.password.length > 128
)
  throw new Error('Provide a valid email, name (1–80 characters), and password (12–128 characters).');
const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const accountId = `account_${randomUUID()}`;
const now = Date.now();
const passwordHash = await hashPassword(input.password);
const sql = `
INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password,created_at,updated_at)
SELECT ${q(accountId)},id,id,'credential',${q(passwordHash)},${now},${now} FROM users
WHERE id='user_demo' AND NOT EXISTS (SELECT 1 FROM auth_accounts WHERE user_id='user_demo' AND provider_id='credential')
AND NOT EXISTS (SELECT 1 FROM users WHERE email=${q(input.email.trim().toLowerCase())} AND id<>'user_demo');
UPDATE users SET email=${q(input.email.trim().toLowerCase())},name=${q(input.name.trim())},updated_at=${q(new Date(now).toISOString())}
WHERE id='user_demo' AND EXISTS (SELECT 1 FROM auth_accounts WHERE id=${q(accountId)});
SELECT 1 AS provisioned FROM auth_accounts a JOIN users u ON a.user_id=u.id
WHERE a.id=${q(accountId)} AND u.email=${q(input.email.trim().toLowerCase())};
`;
await mkdir(resolve(root, '.local'), { recursive: true });
const sqlPath = resolve(root, `.local/owner-${randomUUID()}.sql`);
try {
  await writeFile(sqlPath, sql, { mode: 0o600 });
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    [
      '--filter',
      '@capora/worker',
      'exec',
      'wrangler',
      'd1',
      'execute',
      'capora-db',
      remote ? '--remote' : '--local',
      '--file',
      sqlPath,
      '--json',
    ],
    { cwd: root, shell: process.platform === 'win32', encoding: 'utf8' },
  );
  if (result.status !== 0)
    throw new Error(
      'Owner provisioning failed. Check the migration and email uniqueness; SQL and credentials were not printed.',
    );
  const results = JSON.parse(result.stdout) as { results?: { provisioned: number }[] }[];
  if (!results.some((result) => result.results?.some((row) => row.provisioned === 1)))
    throw new Error(
      'No owner was provisioned: user_demo is missing, already has credentials, or the email is in use.',
    );
  console.log(
    'Seeded owner account provisioned. Existing agent, provider, purchase, and billing ownership preserved.',
  );
} finally {
  await rm(sqlPath, { force: true });
}
