import type { Env } from '../env';

export function isAdminEmail(env: Pick<Env, 'ADMIN_EMAILS'>, email: string): boolean {
  return (env.ADMIN_EMAILS ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .some((admin) => admin.toLowerCase() === email.trim().toLowerCase());
}
