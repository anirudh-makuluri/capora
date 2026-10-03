import { describe, it, expect, vi } from 'vitest';
import { PayPalSandbox, receiptFromOrder } from '../apps/worker/src/services/payments';
import type { Env } from '../apps/worker/src/env';
const env = {
  PAYPAL_CLIENT_ID: 'test-id',
  PAYPAL_CLIENT_SECRET: 'test-secret',
  PAYPAL_ENVIRONMENT: 'sandbox',
  CAPORA_BASE_URL: 'https://capora.example',
} as Env;
describe('PayPal Sandbox adapter', () => {
  it('uses sandbox endpoints, vaulted source, cents, and stable idempotency keys', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify(
          String(url).includes('oauth2')
            ? { access_token: 'test-access' }
            : { id: 'ORDER-TEST', status: 'APPROVED' },
        ),
        { status: 200 },
      );
    });
    const paypal = new PayPalSandbox(env, fetcher);
    await paypal.createOrder('purchase-test', 20, 'vault-test');
    await paypal.createOrder('purchase-test', 20, 'vault-test');
    const orders = requests.filter((r) => r.url.includes('checkout/orders'));
    expect(orders).toHaveLength(2);
    expect(orders.every((r) => r.url.startsWith('https://api-m.sandbox.paypal.com/'))).toBe(true);
    expect(JSON.parse(String(orders[0].init?.body))).toMatchObject({
      intent: 'CAPTURE',
      payment_source: { paypal: { vault_id: 'vault-test' } },
      purchase_units: [{ amount: { value: '0.20', currency_code: 'USD' } }],
    });
    expect(new Headers(orders[0].init?.headers).get('PayPal-Request-Id')).toBe(
      new Headers(orders[1].init?.headers).get('PayPal-Request-Id'),
    );
  });
  it('does not accept real-money configuration', async () =>
    await expect(
      new PayPalSandbox({ ...env, PAYPAL_ENVIRONMENT: 'live' }).createOrder('p', 20, null),
    ).rejects.toMatchObject({ code: 'SANDBOX_ONLY' }));
  it('keeps an uncertain network result pending', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test' })))
      .mockRejectedValueOnce(new Error('network'));
    await expect(
      new PayPalSandbox(env, fetcher).createOrder('purchase-test', 20, null),
    ).rejects.toMatchObject({ uncertain: true });
  });
  it('requires a matching capture and amount before fulfillment', () => {
    const order = {
      id: 'ORDER',
      status: 'COMPLETED',
      purchase_units: [
        {
          reference_id: 'purchase-test',
          payments: {
            captures: [
              { id: 'CAPTURE', status: 'COMPLETED', amount: { value: '0.20', currency_code: 'USD' } },
            ],
          },
        },
      ],
    };
    expect(receiptFromOrder(order, 'purchase-test', 20).status).toBe('completed');
    expect(() => receiptFromOrder(order, 'purchase-test', 300)).toThrow('amount');
    expect(() => receiptFromOrder(order, 'other-purchase', 20)).toThrow('matching capture');
  });
  it('does not fulfill a pending capture', () =>
    expect(
      receiptFromOrder(
        {
          id: 'ORDER',
          status: 'APPROVED',
          purchase_units: [
            {
              reference_id: 'purchase-test',
              payments: {
                captures: [
                  { id: 'CAPTURE', status: 'PENDING', amount: { currency_code: 'USD', value: '0.20' } },
                ],
              },
            },
          ],
        },
        'purchase-test',
        20,
      ).status,
    ).toBe('pending'));
  it('rejects an approval link outside the sandbox', () =>
    expect(() =>
      receiptFromOrder(
        {
          id: 'ORDER',
          status: 'PAYER_ACTION_REQUIRED',
          links: [{ rel: 'approve', href: 'https://www.paypal.com/checkout' }],
        },
        'purchase-test',
        20,
      ),
    ).toThrow('approval URL'));
});
