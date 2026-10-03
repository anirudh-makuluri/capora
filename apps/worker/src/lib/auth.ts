import { betterAuth } from 'better-auth/minimal';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle, users, authSessions, authAccounts, authVerifications } from '@capora/db';
import { hash } from './crypto';
import type { Env } from '../env';

// D1 bindings and I/O belong to the current request, not a module-level singleton.
export function createAuth(env: Env) {
  return betterAuth({
    appName: 'Capora',
    baseURL: env.CAPORA_BASE_URL,
    basePath: '/api/auth',
    secret: env.SESSION_SECRET,
    trustedOrigins: [env.CAPORA_BASE_URL],
    database: drizzleAdapter(drizzle(env.DB), {
      provider: 'sqlite',
      transaction: false,
      schema: { user: users, session: authSessions, account: authAccounts, verification: authVerifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const name = user.name.trim();
            if (!name || name.length > 80 || user.email.length > 254)
              throw new APIError('BAD_REQUEST', {
                message: 'Provide a name of 1–80 characters and a valid email address.',
              });
            return { data: { ...user, name } };
          },
        },
      },
    },
    session: { expiresIn: 12 * 3600, updateAge: 3600, cookieCache: { enabled: false } },
    advanced: {
      cookiePrefix: 'capora',
      useSecureCookies: new URL(env.CAPORA_BASE_URL).protocol === 'https:',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 300, max: 10 },
        '/sign-up/email': { window: 3600, max: 5 },
      },
      customStorage: {
        async consume(key, rule) {
          const now = Math.floor(Date.now() / 1000);
          const bucket = Math.floor(now / rule.window);
          const expires = (bucket + 1) * rule.window;
          const row = await env.DB.prepare(
            'INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
          )
            .bind(`auth:${await hash(key)}:${rule.window}:${bucket}`, expires)
            .first<{ count: number }>();
          if (!row) throw new Error('Authentication rate limit unavailable.');
          return { allowed: row.count <= rule.max, retryAfter: row.count > rule.max ? expires - now : null };
        },
      },
    },
  });
}

export async function cleanupAuth(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(Math.floor(now / 1000)),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM auth_verifications WHERE expires_at <= ?').bind(now),
  ]);
}
