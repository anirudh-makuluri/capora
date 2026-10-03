import { afterEach, describe, it, expect, vi } from 'vitest';
import { PayPalSandbox, receiptFromOrder } from '../apps/worker/src/services/payments';
import type { Env } from '../apps/worker/src/env';
const env = {
  PAYPAL_CLIENT_ID: 'test-id',
  PAYPAL_CLIENT_SECRET: 'test-secret',
  PAYPAL_ENVIRONMENT: 'sandbox',
  CAPORA_BASE_URL: 'https://capora.example',
} as Env;
describe('PayPal Sandbox adapter', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('preserves the global receiver required by the Worker fetch runtime', async () => {
    vi.stubGlobal('fetch', function (this: unknown, url: RequestInfo | URL) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        new Response(
          JSON.stringify(
            String(url).includes('oauth2')
              ? { access_token: 'test-access' }
              : { id: 'ORDER-TEST', status: 'PAYER_ACTION_REQUIRED' },
          ),
        ),
      );
    });
    expect((await new PayPalSandbox(env).createOrder('purchase-test', 20, null)).id).toBe('ORDER-TEST');
  });
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
  it('refreshes stale permissions once after a 403 and preserves the payment request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'old-scope' })))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-scope' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ORDER-TEST', status: 'APPROVED' })));
    expect((await new PayPalSandbox(env, fetcher).createOrder('purchase-test', 20, null)).id).toBe(
      'ORDER-TEST',
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
    const [, firstPayment, refreshedAuth, secondPayment] = fetcher.mock.calls;
    expect(String(refreshedAuth[1]?.body)).toContain('ignoreCache=true');
    expect(new Headers(firstPayment[1]?.headers).get('Authorization')).toBe('Bearer old-scope');
    expect(new Headers(secondPayment[1]?.headers).get('Authorization')).toBe('Bearer new-scope');
    expect(secondPayment[0]).toBe(firstPayment[0]);
    expect(secondPayment[1]?.body).toBe(firstPayment[1]?.body);
    expect(new Headers(secondPayment[1]?.headers).get('PayPal-Request-Id')).toBe(
      new Headers(firstPayment[1]?.headers).get('PayPal-Request-Id'),
    );
  });
  it('stops after a refreshed token is also rejected instead of retrying indefinitely', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'old-scope' })))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-scope' })))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(
      new PayPalSandbox(env, fetcher).createOrder('purchase-test', 20, null),
    ).rejects.toMatchObject({ code: 'PAYMENT_FAILED', uncertain: false });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
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
