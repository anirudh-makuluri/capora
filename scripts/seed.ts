import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { seedCapabilities, builtinOutputSchema } from './seed-data';
import { hashPassword } from '../apps/worker/src/lib/password';

const root = resolve(import.meta.dirname, '..');
const remote = process.argv.includes('--remote');
await mkdir(resolve(root, '.local'), { recursive: true });
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
const q = (v: unknown) =>
  v === null ? 'NULL' : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/'/g, "''")}'`;
const now = new Date().toISOString();
const statements = [
  `INSERT INTO users (id,email,name,created_at) VALUES ('user_demo','demo@capora.local','Alex Morgan',${q(now)}) ON CONFLICT DO NOTHING;`,
  `INSERT INTO agents (id,user_id,name,token_hash,status,created_at) VALUES ('agent_research','user_demo','Acquisition Research Agent',${q(createHash('sha256').update(credentials.agentToken).digest('hex'))},'active',${q(now)}) ON CONFLICT DO NOTHING;`,
  `INSERT INTO spending_policies (agent_id,daily_budget_cents,auto_approve_cents,max_transaction_cents,autonomous_enabled) VALUES ('agent_research',2500,50,1000,1) ON CONFLICT DO NOTHING;`,
];
if (!remote) {
  if (!credentials.dashboardPassword)
    throw new Error('Local account password missing. Run pnpm setup:local.');
  const passwordHash = await hashPassword(credentials.dashboardPassword);
  statements.push(
    `INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password,created_at,updated_at) VALUES ('account_demo','user_demo','user_demo','credential',${q(passwordHash)},${Date.now()},${Date.now()}) ON CONFLICT DO NOTHING;`,
  );
}
for (const cap of seedCapabilities) {
  const providerId = `provider_${cap.id}`;
  statements.push(
    `INSERT INTO providers (id,user_id,name,description,reputation,created_at) VALUES (${q(providerId)},'user_demo','Capora',${q(cap.description)},0,${q(now)}) ON CONFLICT DO NOTHING;`,
  );
  statements.push(`INSERT INTO capabilities (id,provider_id,name,description,type,category,price_cents,pricing_unit,input_schema,output_schema,endpoint,expected_latency_ms,baseline_reliability,tags,async,synthetic,created_at)
    VALUES (${[cap.id, providerId, cap.name, cap.description, cap.type, cap.category].map(q).join(',')},${cap.priceCents},'query',${q(cap.schema)},${q(builtinOutputSchema(cap))},${q(`builtin://${cap.id}`)},${cap.latency},0,${q(cap.tags)},${cap.async ? 1 : 0},0,${q(now)}) ON CONFLICT DO NOTHING;`);
  statements.push(
    `UPDATE capabilities SET documentation_url=${q(cap.documentationUrl)},availability=0 WHERE id=${q(cap.id)} AND endpoint=${q(`builtin://${cap.id}`)};`,
  );
}
const seedPath = resolve(root, '.local/seed.sql');
await writeFile(seedPath, statements.join('\n'));
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
    '../../.local/seed.sql',
  ],
  { cwd: root, shell: process.platform === 'win32', stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  `Seeded ${seedCapabilities.length} real capabilities, a workspace, and a buyer agent. Existing records preserved.`,
);
