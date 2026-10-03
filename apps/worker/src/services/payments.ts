import { z } from 'zod';
import { DomainError } from '@capora/types';
import { hash } from '../lib/crypto';
import type { Env } from '../env';

const orderSchema = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        amount: z.object({ currency_code: z.string(), value: z.string() }).optional(),
        payments: z
          .object({
            captures: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                  amount: z.object({ currency_code: z.string(), value: z.string() }),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
export type PayPalOrder = z.infer<typeof orderSchema>;
export interface PaymentReceipt {
  orderId: string;
  captureId: string | null;
  status: 'completed' | 'pending';
  approvalUrl: string | null;
}
export class PaymentError extends DomainError {
  constructor(
    message: string,
    public uncertain: boolean,
  ) {
    super('PAYMENT_FAILED', message, 502);
  }
}

export class PayPalSandbox {
  private readonly base = 'https://api-m.sandbox.paypal.com';
  constructor(
    private env: Env,
    private fetcher: typeof fetch = fetch.bind(globalThis),
  ) {}
  private async accessToken(ignoreCache = false): Promise<string> {
    if (this.env.PAYPAL_ENVIRONMENT !== 'sandbox')
      throw new DomainError('SANDBOX_ONLY', 'Capora only supports PayPal Sandbox.', 503);
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET)
      throw new DomainError(
        'PAYPAL_NOT_CONFIGURED',
        'Configure PayPal Sandbox client credentials before purchasing.',
        503,
      );
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${this.env.PAYPAL_CLIENT_ID}:${this.env.PAYPAL_CLIENT_SECRET}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `grant_type=client_credentials${ignoreCache ? '&ignoreCache=true' : ''}`,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentError('PayPal authentication is temporarily unavailable. Retry safely.', false);
    }
    if (!response.ok) throw new PaymentError('PayPal rejected the sandbox credentials.', false);
    const body = z.object({ access_token: z.string() }).parse(await response.json());
    return body.access_token;
  }
  async request(path: string, method: string, body?: unknown, requestId?: string): Promise<unknown> {
    const idempotencyKey = requestId ? (await hash(requestId)).slice(0, 32) : undefined;
    const send = async (accessToken: string): Promise<Response> => {
      try {
        return await this.fetcher(`${this.base}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
            ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new PaymentError(
          'PayPal did not confirm the outcome. Funds remain reserved; reconcile this purchase.',
          true,
        );
      }
    };
    let response = await send(await this.accessToken());
    if (response.status === 403) {
      // PayPal can reuse a token issued before an app permission was enabled.
      // An authorization rejection has no payment effect; refresh once using the same request ID.
      await response.body?.cancel();
      response = await send(await this.accessToken(true));
    }
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: 'paypal_error',
          status: response.status,
          debugId: response.headers.get('paypal-debug-id'),
        }),
      );
      throw new PaymentError(
        `PayPal returned HTTP ${response.status}. Check the sandbox dashboard.`,
        response.status >= 500 || response.status === 409,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new PaymentError('PayPal returned an unreadable response. Reconcile this purchase.', true);
    }
  }
  async createOrder(purchaseId: string, amountCents: number, vaultId: string | null): Promise<PayPalOrder> {
    const result = await this.request(
      '/v2/checkout/orders',
      'POST',
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: purchaseId,
            description: 'Capora machine capability — sandbox',
            amount: { currency_code: 'USD', value: (amountCents / 100).toFixed(2) },
          },
        ],
        payment_source: {
          paypal: vaultId
            ? { vault_id: vaultId }
            : {
                experience_context: {
                  brand_name: 'Capora',
                  shipping_preference: 'NO_SHIPPING',
                  user_action: 'PAY_NOW',
                  return_url: `${this.env.CAPORA_BASE_URL}/transactions?payment=${purchaseId}`,
                  cancel_url: `${this.env.CAPORA_BASE_URL}/transactions?cancel=${purchaseId}`,
                },
              },
        },
      },
      `${purchaseId}:create`,
    );
    return orderSchema.parse(result);
  }
  async getOrder(orderId: string) {
    return orderSchema.parse(await this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'GET'));
  }
  async captureOrder(orderId: string, purchaseId: string) {
    return orderSchema.parse(
      await this.request(
        `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        'POST',
        {},
        `${purchaseId}:capture`,
      ),
    );
  }
  async refund(captureId: string, purchaseId: string) {
    return z
      .object({ id: z.string(), status: z.string() })
      .parse(
        await this.request(
          `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
          'POST',
          {},
          `${purchaseId}:refund`,
        ),
      );
  }
  async createSetup(userId: string, setupId: string) {
    return z
      .object({ id: z.string(), links: z.array(z.object({ rel: z.string(), href: z.string() })) })
      .parse(
        await this.request(
          '/v3/vault/setup-tokens',
          'POST',
          {
            customer: { merchant_customer_id: userId },
            payment_source: {
              paypal: {
                description: 'Capora sandbox purchases within your agent budget',
                permit_multiple_payment_tokens: false,
                usage_type: 'MERCHANT',
                customer_type: 'CONSUMER',
                experience_context: {
                  brand_name: 'Capora',
                  shipping_preference: 'NO_SHIPPING',
                  return_url: `${this.env.CAPORA_BASE_URL}/agents?billing=${setupId}`,
                  cancel_url: `${this.env.CAPORA_BASE_URL}/agents?billing_cancelled=1`,
                },
              },
            },
          },
          `${setupId}:setup`,
        ),
      );
  }
  async confirmSetup(setupTokenId: string, setupId: string) {
    return z
      .object({ id: z.string() })
      .parse(
        await this.request(
          '/v3/vault/payment-tokens',
          'POST',
          { payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } },
          `${setupId}:confirm`,
        ),
      );
  }
}

export function receiptFromOrder(
  order: PayPalOrder,
  purchaseId: string,
  amountCents: number,
): PaymentReceipt {
  const unit = order.purchase_units?.find((u) => u.reference_id === purchaseId);
  const capture = unit?.payments?.captures?.find((c) => c.status === 'COMPLETED');
  if (capture) {
    if (
      capture.amount.currency_code !== 'USD' ||
      Math.round(Number(capture.amount.value) * 100) !== amountCents
    )
      throw new PaymentError(
        'Payment amount does not match the quote. Manual reconciliation is required.',
        true,
      );
    return { orderId: order.id, captureId: capture.id, status: 'completed', approvalUrl: null };
  }
  if (order.status === 'COMPLETED')
    throw new PaymentError(
      'Order completed without a matching capture. Manual reconciliation is required.',
      true,
    );
  const link = order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  if (
    link &&
    new URL(link).hostname !== 'www.sandbox.paypal.com' &&
    new URL(link).hostname !== 'sandbox.paypal.com'
  )
    throw new PaymentError('Unexpected PayPal approval URL.', true);
  return { orderId: order.id, captureId: null, status: 'pending', approvalUrl: link ?? null };
}
