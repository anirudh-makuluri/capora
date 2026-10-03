import { Hono } from 'hono';
import { requireHuman } from '../services/auth';
import { createAuth } from '../lib/auth';
import type { AppEnv } from '../env';

export const authRoutes = new Hono<AppEnv>();
authRoutes.get('/session', async (c) => {
  const user = await requireHuman(c);
  return c.json({
    user: { id: user.id, name: user.name, email: user.email },
    localDemo: false,
    paymentMode: c.env.PAYMENT_MODE,
  });
});
authRoutes.all('/*', (c) => createAuth(c.env).handler(c.req.raw));
