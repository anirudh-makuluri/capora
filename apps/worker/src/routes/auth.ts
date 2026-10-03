import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { requireHuman, isLocalDemo, rateLimit } from '../services/auth';
import { signSession, equalSecret } from '../lib/crypto';
import { DomainError } from '@capora/types';
import type { AppEnv } from '../env';

export const authRoutes = new Hono<AppEnv>();
authRoutes.get('/session', async (c) => {
  const user = await requireHuman(c);
  return c.json({
    user: { id: user.id, name: user.name, email: user.email },
    localDemo: isLocalDemo(c.req.raw, c.env),
    paymentMode: c.env.PAYMENT_MODE,
  });
});
authRoutes.post('/login', async (c) => {
  await rateLimit(c.env, `login:${c.req.header('CF-Connecting-IP') ?? 'local'}`, 10, 300);
  const { password } = z.object({ password: z.string().min(1).max(256) }).parse(await c.req.json());
  if (!c.env.DASHBOARD_PASSWORD || c.env.DASHBOARD_PASSWORD.length < 16)
    throw new DomainError(
      'CONFIGURATION_REQUIRED',
      'Configure a workspace password of at least 16 characters.',
      503,
    );
  if (!(await equalSecret(password, c.env.DASHBOARD_PASSWORD)))
    throw new DomainError('UNAUTHORIZED', 'Incorrect workspace password.', 401);
  setCookie(c, 'capora_session', await signSession(c.env.DASHBOARD_USER_ID, c.env.SESSION_SECRET), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.env.CAPORA_BASE_URL).protocol === 'https:',
    path: '/',
    maxAge: 12 * 3600,
  });
  return c.json({ ok: true });
});
authRoutes.post('/logout', (c) => {
  deleteCookie(c, 'capora_session', { path: '/' });
  return c.json({ ok: true });
});
