import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { catalogStatements, seedCapabilities, sqlValue as q } from './seed-data';
import { hashPassword } from '../apps/worker/src/lib/password';

const root = resolve(import.meta.dirname, '..');
const remote = process.argv.includes('--remote');
const catalogOnly = process.argv.includes('--catalog-only');
await mkdir(resolve(root, '.local'), { recursive: true });
const now = new Date().toISOString();
const statements: string[] = [];
if (!catalogOnly) {
  const credentialPath = resolve(
    root,
    remote ? '.local/remote-seed-credentials.json' : '.local/credentials.json',
  );
  let credentials: { agentToken: string; dashboardPassword?: string };
  try {
    credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
  } catch {
    if (!remote) throw new Error('Run pnpm setup:local first to create local credentials.');
    credentials = { agentToken: `cap_${randomBytes(32).toString('base64url')}` };
    await writeFile(credentialPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  }
  statements.push(
    `INSERT INTO users (id,email,name,created_at) VALUES ('user_demo','demo@capora.local','Alex Morgan',${q(now)}) ON CONFLICT DO NOTHING;`,
    `INSERT INTO agents (id,user_id,name,token_hash,status,created_at) VALUES ('agent_research','user_demo','Acquisition Research Agent',${q(createHash('sha256').update(credentials.agentToken).digest('hex'))},'active',${q(now)}) ON CONFLICT DO NOTHING;`,
    `INSERT INTO spending_policies (agent_id,daily_budget_cents,auto_approve_cents,max_transaction_cents,autonomous_enabled) VALUES ('agent_research',2500,50,1000,1) ON CONFLICT DO NOTHING;`,
  );
  if (!remote) {
    if (!credentials.dashboardPassword)
      throw new Error('Local account password missing. Run pnpm setup:local.');
    const passwordHash = await hashPassword(credentials.dashboardPassword);
    statements.push(
      `INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password,created_at,updated_at) VALUES ('account_demo','user_demo','user_demo','credential',${q(passwordHash)},${Date.now()},${Date.now()}) ON CONFLICT DO NOTHING;`,
    );
  }
}
statements.push(...catalogStatements('user_demo', now));
// Keep the full seed used by disposable browser tests separate from catalog-only SQL.
const sqlFile = catalogOnly ? 'catalog.sql' : 'seed.sql';
await writeFile(resolve(root, '.local', sqlFile), statements.join('\n'));
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'apps/worker/node_modules/wrangler/bin/wrangler.js'),
    'd1',
    'execute',
    'capora-db',
    remote ? '--remote' : '--local',
    '--file',
    resolve(root, '.local', sqlFile),
  ],
  { cwd: resolve(root, 'apps/worker'), stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  catalogOnly
    ? `Synced ${seedCapabilities.length} registered capabilities. Users, credentials and usage records preserved.`
    : `Seeded ${seedCapabilities.length} real capabilities, a workspace, and a buyer agent. Existing accounts preserved.`,
);
