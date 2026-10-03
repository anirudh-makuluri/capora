import { Hono } from 'hono';
import { drizzle, billingSetups, users } from '@capora/db';
import { and, eq } from 'drizzle-orm';
import { DomainError } from '@capora/types';
import { PayPalSandbox } from '../services/payments';
import { id, seal } from '../lib/crypto';
import type { AppEnv } from '../env';

export const billingRoutes = new Hono<AppEnv>();
billingRoutes.post('/setup', async (c) => {
  if (c.env.PAYMENT_MODE !== 'sandbox')
    throw new DomainError('SANDBOX_REQUIRED', 'Switch to PayPal Sandbox mode to connect a payment method.');
  const setupId = id('billing');
  const db = drizzle(c.env.DB);
  await db
    .insert(billingSetups)
    .values({ id: setupId, userId: c.get('userId'), status: 'pending', createdAt: new Date().toISOString() });
  const setup = await new PayPalSandbox(c.env).createSetup(c.get('userId'), setupId);
  await db.update(billingSetups).set({ setupTokenId: setup.id }).where(eq(billingSetups.id, setupId));
  const approvalUrl = setup.links.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href;
  if (
    !approvalUrl ||
    !['www.sandbox.paypal.com', 'sandbox.paypal.com'].includes(new URL(approvalUrl).hostname)
  )
    throw new DomainError('PAYMENT_FAILED', 'PayPal did not return a sandbox approval URL.', 502);
  return c.json({ setupId, approvalUrl });
});
billingRoutes.post('/setup/:id/confirm', async (c) => {
  const db = drizzle(c.env.DB);
  const setup = await db
    .select()
    .from(billingSetups)
    .where(and(eq(billingSetups.id, c.req.param('id')), eq(billingSetups.userId, c.get('userId'))))
    .get();
  if (!setup?.setupTokenId) throw new DomainError('NOT_FOUND', 'Billing setup not found.', 404);
  if (setup.status === 'completed') return c.json({ ok: true });
  const vault = await new PayPalSandbox(c.env).confirmSetup(setup.setupTokenId, setup.id);
  await db.batch([
    db
      .update(users)
      .set({ vaultEncrypted: await seal(vault.id, c.env.ENCRYPTION_KEY) })
      .where(eq(users.id, c.get('userId'))),
    db.update(billingSetups).set({ status: 'completed' }).where(eq(billingSetups.id, setup.id)),
  ]);
  return c.json({ ok: true });
});
