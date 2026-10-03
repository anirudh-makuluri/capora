import { agents, users, spendingPolicies, drizzle } from '@capora/db';
import { eq, and } from 'drizzle-orm';
import { DEFAULT_POLICY } from '@capora/config';
import { DomainError } from '@capora/types';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { hash, id, token, verifySession } from '../lib/crypto';
import type { Env, AppEnv } from '../env';

export function isLocalDemo(request: Request, env: Env): boolean {
  const ip = request.headers.get('CF-Connecting-IP');
  return (
    env.DEV_MODE === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname) &&
    (!ip || ['127.0.0.1', '::1'].includes(ip))
  );
}
export function originAllowed(origin: string, env: Env): boolean {
  const base = new URL(env.CAPORA_BASE_URL);
  if (origin === base.origin) return true;
  try {
    const url = new URL(origin);
    return (
      env.DEV_MODE === 'true' &&
      ['localhost', '127.0.0.1'].includes(base.hostname) &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.protocol === base.protocol &&
      url.port === base.port
    );
  } catch {
    return false;
  }
}
export async function rateLimit(env: Env, key: string, limit = 120, windowSeconds = 60): Promise<void> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const row = await env.DB.prepare(
    'INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count',
  )
    .bind(`${await hash(key)}:${bucket}`, (bucket + 1) * windowSeconds)
    .first<{ count: number }>();
  if (row && row.count > limit)
    throw new DomainError('RATE_LIMITED', 'Too many requests. Try again shortly.', 429);
}
export async function authenticateAgent(request: Request, env: Env) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer cap_'))
    throw new DomainError('UNAUTHORIZED', 'Provide your Capora agent token as a Bearer token.', 401);
  const agent = await drizzle(env.DB)
    .select()
    .from(agents)
    .where(and(eq(agents.tokenHash, await hash(authorization.slice(7))), eq(agents.status, 'active')))
    .get();
  if (!agent) throw new DomainError('UNAUTHORIZED', 'Invalid or revoked agent token.', 401);
  await rateLimit(env, `agent:${agent.id}`);
  return agent;
}
export async function requireHuman(c: Context<AppEnv>) {
  const userId = isLocalDemo(c.req.raw, c.env)
    ? c.env.DASHBOARD_USER_ID
    : await verifySession(getCookie(c, 'capora_session') ?? '', c.env.SESSION_SECRET);
  if (!userId) throw new DomainError('UNAUTHORIZED', 'Sign in to your Capora workspace.', 401);
  const user = await drizzle(c.env.DB).select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new DomainError('UNAUTHORIZED', 'Workspace user does not exist.', 401);
  c.set('userId', user.id);
  return user;
}
export async function ownAgent(env: Env, agentId: string, userId: string) {
  const agent = await drizzle(env.DB)
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .get();
  if (!agent) throw new DomainError('NOT_FOUND', 'Agent not found in your workspace.', 404);
  return agent;
}
export async function createAgent(env: Env, userId: string, name: string) {
  const agentId = id('agent');
  const rawToken = token();
  await drizzle(env.DB).batch([
    drizzle(env.DB)
      .insert(agents)
      .values({
        id: agentId,
        userId,
        name,
        tokenHash: await hash(rawToken),
        createdAt: new Date().toISOString(),
      }),
    drizzle(env.DB)
      .insert(spendingPolicies)
      .values({ agentId, ...DEFAULT_POLICY }),
  ]);
  return { id: agentId, token: rawToken };
}
