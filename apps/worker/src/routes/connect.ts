import { Hono } from 'hono';
import { z } from 'zod';
import { agentSetupSchema, DomainError, type AgentSetupRequest } from '@capora/types';
import { hash, id } from '../lib/crypto';
import { rateLimit } from '../services/auth';
import type { AppEnv, Env } from '../env';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const startSchema = agentSetupSchema.and(z.object({ tokenHash: digest, deviceCodeHash: digest }));
type SetupRow = AgentSetupRequest & { agentId: string; userId: string | null };

async function getSetup(env: Env, setupId: string): Promise<SetupRow> {
  const row = await env.DB.prepare(
    `SELECT id,name,user_code AS userCode,status,expires_at AS expiresAt,
      daily_budget_cents AS dailyBudgetCents,auto_approve_cents AS autoApproveCents,
      max_transaction_cents AS maxTransactionCents,agent_id AS agentId,user_id AS userId
      FROM agent_setups WHERE id=?`,
  )
    .bind(setupId)
    .first<SetupRow>();
  if (!row) throw new DomainError('NOT_FOUND', 'Connection request not found.', 404);
  if (row.expiresAt <= new Date().toISOString())
    throw new DomainError('SETUP_EXPIRED', 'Connection request expired. Start setup again.', 410);
  return row;
}

// These two endpoints do not grant account access. Only a signed-in owner can create the agent.
export const publicConnectRoutes = new Hono<AppEnv>();
publicConnectRoutes.post('/', async (c) => {
  await rateLimit(c.env, `setup-start:${c.req.header('CF-Connecting-IP') ?? 'local'}`, 10);
  const input = startSchema.parse(await c.req.json());
  const setupId = id('setup');
  const userCode = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO agent_setups
      (id,device_code_hash,token_hash,user_code,name,daily_budget_cents,auto_approve_cents,
       max_transaction_cents,agent_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(token_hash) DO NOTHING`,
  )
    .bind(
      setupId,
      input.deviceCodeHash,
      input.tokenHash,
      userCode,
      input.name,
      input.dailyBudgetCents,
      input.autoApproveCents,
      input.maxTransactionCents,
      id('agent'),
      new Date().toISOString(),
      expiresAt,
    )
    .run();
  const existing = await c.env.DB.prepare(
    'SELECT id FROM agent_setups WHERE token_hash=? AND device_code_hash=?',
  )
    .bind(input.tokenHash, input.deviceCodeHash)
    .first<{ id: string }>();
  if (!existing) throw new DomainError('SETUP_CONFLICT', 'Start a new connection request.', 409);
  const setup = await getSetup(c.env, existing.id);
  if (
    setup.name !== input.name ||
    setup.dailyBudgetCents !== input.dailyBudgetCents ||
    setup.autoApproveCents !== input.autoApproveCents ||
    setup.maxTransactionCents !== input.maxTransactionCents
  )
    throw new DomainError('SETUP_CONFLICT', 'A connection request cannot change its spending limits.', 409);
  return c.json(
    {
      id: setup.id,
      userCode: setup.userCode,
      expiresAt: setup.expiresAt,
      intervalSeconds: 3,
      verificationUrl: `${c.env.CAPORA_BASE_URL}/connect/${setup.id}`,
    },
    201,
  );
});
publicConnectRoutes.post('/status', async (c) => {
  await rateLimit(c.env, `setup-status:${c.req.header('CF-Connecting-IP') ?? 'local'}`, 120);
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer setup_'))
    throw new DomainError('UNAUTHORIZED', 'Provide the private setup credential.', 401);
  const row = await c.env.DB.prepare('SELECT id FROM agent_setups WHERE device_code_hash=?')
    .bind(await hash(authorization.slice(7)))
    .first<{ id: string }>();
  if (!row) throw new DomainError('UNAUTHORIZED', 'Invalid setup credential.', 401);
  const setup = await getSetup(c.env, row.id);
  return c.json({
    status: setup.status,
    ...(setup.status === 'approved'
      ? { agentId: setup.agentId, endpoint: `${c.env.CAPORA_BASE_URL}/mcp` }
      : {}),
  });
});

export const connectRoutes = new Hono<AppEnv>();
connectRoutes.get('/:id', async (c) => {
  const setup = await getSetup(c.env, c.req.param('id'));
  if (setup.userId && setup.userId !== c.get('userId'))
    throw new DomainError('NOT_FOUND', 'Connection request not found.', 404);
  const { agentId: _agentId, userId: _userId, ...details } = setup;
  return c.json(details);
});
connectRoutes.post('/:id/decision', async (c) => {
  const { approve, userCode } = z
    .object({ approve: z.boolean(), userCode: z.string() })
    .parse(await c.req.json());
  const setup = await getSetup(c.env, c.req.param('id'));
  const userId = c.get('userId');
  if (setup.userId && setup.userId !== userId)
    throw new DomainError('NOT_FOUND', 'Connection request not found.', 404);
  if (userCode !== setup.userCode)
    throw new DomainError('INVALID_SETUP_CODE', 'The connection code does not match.', 400);
  await rateLimit(c.env, `agent-create:${userId}`, 20);
  const now = new Date().toISOString();
  const db = c.env.DB;
  // The decision, agent and exact spending policy commit together. Retries never rotate a token
  // or create a duplicate agent, and competing accounts cannot claim an approved request.
  await db.batch([
    db
      .prepare(`UPDATE agent_setups SET status=?,user_id=? WHERE id=? AND status='pending' AND expires_at>?`)
      .bind(approve ? 'approved' : 'denied', userId, setup.id, now),
    db
      .prepare(
        `INSERT INTO agents (id,user_id,name,token_hash,created_at)
      SELECT agent_id,user_id,name,token_hash,? FROM agent_setups
      WHERE id=? AND user_id=? AND status='approved' AND expires_at>?
      AND NOT EXISTS (SELECT 1 FROM agents WHERE id=agent_setups.agent_id)`,
      )
      .bind(now, setup.id, userId, now),
    db
      .prepare(
        `INSERT INTO spending_policies
      (agent_id,daily_budget_cents,auto_approve_cents,max_transaction_cents,autonomous_enabled)
      SELECT agent_id,daily_budget_cents,auto_approve_cents,max_transaction_cents,1 FROM agent_setups
      WHERE id=? AND user_id=? AND status='approved' AND expires_at>?
      AND NOT EXISTS (SELECT 1 FROM spending_policies WHERE agent_id=agent_setups.agent_id)`,
      )
      .bind(setup.id, userId, now),
    db
      .prepare(
        `INSERT INTO activity (id,user_id,kind,message,entity_id,created_at)
      SELECT id,user_id,'agent_connected','Agent created through the connection prompt',agent_id,?
      FROM agent_setups WHERE id=? AND user_id=? AND status='approved'
      AND NOT EXISTS (SELECT 1 FROM activity WHERE id=agent_setups.id)`,
      )
      .bind(now, setup.id, userId),
  ]);
  const result = await getSetup(c.env, setup.id);
  if (result.userId !== userId)
    throw new DomainError('SETUP_ALREADY_DECIDED', 'This connection was completed in another account.', 409);
  return c.json({ status: result.status });
});
