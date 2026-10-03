import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { DomainError, searchSchema } from '@capora/types';
import { handleMcp } from '@capora/mcp';
import { MAX_PAYLOAD_BYTES } from '@capora/config';
import { id } from './lib/crypto';
import { authenticateAgent, requireHuman, originAllowed } from './services/auth';
import { searchCapabilities, getCapability } from './services/catalog';
import {
  createQuote,
  getBudget,
  purchaseQuote,
  getPurchase,
  settlePayment,
  resolveApproval,
  expireApprovals,
} from './services/commerce';
import {
  invokeCapability,
  getJob,
  executeInvocation,
  recoverJobs,
  type JobMessage,
} from './services/execution';
import { getDashboard } from './services/dashboard';
import { getStorageUsage } from './services/storage';
import { demoProviders } from './providers/demo';
import { authRoutes } from './routes/auth';
import { agentRoutes } from './routes/agents';
import { providerRoutes } from './routes/providers';
import { billingRoutes } from './routes/billing';
import type { AppEnv, Env } from './env';

export const app = new Hono<AppEnv>();
app.use('*', secureHeaders());
app.use('*', async (c, next) => {
  c.set('correlationId', id('req'));
  c.header('X-Correlation-Id', c.get('correlationId'));
  await next();
});
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && !originAllowed(origin, c.env))
      throw new DomainError('ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.', 403);
    if (c.req.header('Sec-Fetch-Site') === 'cross-site')
      throw new DomainError('ORIGIN_NOT_ALLOWED', 'Cross-site mutations are not allowed.', 403);
    if (!c.req.header('Content-Type')?.startsWith('application/json'))
      throw new DomainError('INVALID_CONTENT_TYPE', 'Use application/json requests.', 415);
  }
  await next();
});
app.use(
  '*',
  bodyLimit({
    maxSize: MAX_PAYLOAD_BYTES,
    onError: (c) =>
      c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeds 256 KiB.' } }, 413),
  }),
);
app.onError((error, c) => {
  const correlationId = c.get('correlationId');
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          correlationId,
        },
      },
      400,
    );
  if (error instanceof DomainError)
    return c.json(
      { error: { code: error.code, message: error.message, correlationId } },
      error.status as 400,
    );
  console.error(JSON.stringify({ event: 'request_failed', correlationId, name: error.name }));
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The operation could not be completed. Check the workspace logs with this correlation ID.',
        correlationId,
      },
    },
    500,
  );
});
app.get('/api/health', (c) =>
  c.json({ name: 'Capora', status: 'ok', version: '0.1.0', paymentMode: c.env.PAYMENT_MODE }),
);
app.route('/api/auth', authRoutes);
app.get('/api/capabilities', async (c) => {
  const q = c.req.query();
  const input = searchSchema.parse({
    ...q,
    ...(q.max_budget ? { max_budget: Number(q.max_budget) } : {}),
    ...(q.min_reliability ? { min_reliability: Number(q.min_reliability) } : {}),
    ...(q.min_reputation ? { min_reputation: Number(q.min_reputation) } : {}),
    ...(q.max_latency_ms ? { max_latency_ms: Number(q.max_latency_ms) } : {}),
  });
  return c.json(await searchCapabilities(c.env, input));
});
app.get('/api/capabilities/:id', async (c) => c.json(await getCapability(c.env, c.req.param('id'))));
app.use('/api/*', async (c, next) => {
  await requireHuman(c);
  await next();
});
app.get('/api/dashboard', async (c) => c.json(await getDashboard(c.env, c.get('userId'))));
app.get('/api/storage/usage', async (c) => c.json(await getStorageUsage(c.env)));
app.route('/api/agents', agentRoutes);
app.route('/api/providers', providerRoutes);
app.route('/api/billing', billingRoutes);
app.post('/api/approvals/:purchaseId', async (c) => {
  const { approve } = z.object({ approve: z.boolean() }).parse(await c.req.json());
  return c.json(await resolveApproval(c.env, c.get('userId'), c.req.param('purchaseId'), approve));
});
app.all('/mcp', async (c) => {
  const origin = c.req.header('Origin');
  if (origin && !originAllowed(origin, c.env))
    throw new DomainError('ORIGIN_NOT_ALLOWED', 'MCP request origin is not allowed.', 403);
  const agent = await authenticateAgent(c.req.raw, c.env);
  console.log(
    JSON.stringify({ event: 'mcp_request', agentId: agent.id, correlationId: c.get('correlationId') }),
  );
  c.header('Cache-Control', 'no-store');
  return handleMcp(
    c.req.raw,
    {
      search: (input) => searchCapabilities(c.env, input, agent.id),
      capability: (capabilityId) => getCapability(c.env, capabilityId),
      quote: (capabilityId, input, reason) => createQuote(c.env, agent.id, capabilityId, input, reason),
      purchase: (quoteId) => purchaseQuote(c.env, agent.id, quoteId),
      invoke: (purchaseId, input) => invokeCapability(c.env, agent.id, purchaseId, input),
      job: (jobId) => getJob(c.env, jobId, agent.id),
      budget: () => getBudget(c.env, agent.id),
      purchaseStatus: async (purchaseId) => {
        const purchase = await getPurchase(c.env, purchaseId, agent.id);
        return ['approved', 'payment_pending'].includes(purchase.status)
          ? settlePayment(c.env, purchase.id, agent.id)
          : purchase;
      },
    },
    c.get('correlationId'),
  );
});
app.route('/providers/demo', demoProviders);
app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<JobMessage>, env: Env) {
    for (const message of batch.messages) {
      try {
        await executeInvocation(env, message.body.invocationId);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([expireApprovals(env), recoverJobs(env)]));
  },
} satisfies ExportedHandler<Env, JobMessage>;
