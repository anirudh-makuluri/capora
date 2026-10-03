# PayPal Sandbox setup and payment semantics

Capora has two deliberately separate modes:

- `demo`: loopback-only, local simulator. `DEMO-…` order/capture IDs are not PayPal records.
- `sandbox`: real calls to `https://api-m.sandbox.paypal.com`. Credentials and funding sources must come from PayPal Sandbox. Live endpoints are never used.

## Standard sandbox checkout

1. Create a Sandbox REST application and separate merchant/buyer Sandbox accounts in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Add `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` to ignored `apps/worker/.dev.vars`. Keep the generated session/encryption/provider secrets. Change `PAYMENT_MODE=sandbox`; retain `PAYPAL_ENVIRONMENT=sandbox`. Restart the Worker.
3. Buy a capability. Capora creates an Orders v2 order and persists its ID. A policy approval does not itself authorize a new PayPal Wallet.
4. Open Transactions, select the purchase, and follow **Continue with PayPal**. Sign in with the Sandbox buyer account.
5. Return to Capora. The authenticated UI reconciles/captures the order. **Check payment** can be retried safely. Only a matching `COMPLETED` capture in USD for the exact quote amount permits execution.
6. Cancellation through the return page cancels the local entitlement only when PayPal has no completed/approved capture. Orders that need reconciliation keep their reservation.

## Autonomous sandbox payments

Ordinary checkout needs buyer interaction. For the $0.20 automatic-purchase demo, establish a buyer-authorized saved Wallet first:

1. Ensure the Sandbox merchant supports PayPal payment-method saving / billing agreement reference transactions. Availability depends on the merchant’s PayPal account configuration.
2. In My agents, choose **Connect PayPal**.
3. Capora creates a Payment Method Tokens v3 setup token with same-origin return/cancel URLs. The human signs in and authorizes the Wallet on PayPal.
4. The authenticated return UI exchanges that owned setup token for a permanent payment token. Capora stores the token encrypted on the human user record, never on the agent or browser.
5. Orders for that user include the saved `vault_id`. Capora creates/captures the Sandbox order under the agent’s policy. PayPal can still return a pending or payer-action state, which must be completed before invocation.

Capora is the single Sandbox merchant in this MVP. It records provider-attributed revenue, but does not distribute payouts or implement a multi-merchant PayPal platform.

## Retry and failure behavior

- Create/capture requests each have a separate, stable, 32-character `PayPal-Request-Id` derived from the purchase ID.
- A D1 lease serializes payment operations. Other callers see the pending purchase while work is active.
- Credential/configuration errors before an order can exist fail the purchase and release its reservation.
- Network errors, unreadable responses, or errors involving an existing order preserve the `payment_pending` reservation. Reconcile rather than guessing the outcome.
- An unconfirmed order-create request older than five hours needs manual reconciliation; Capora does not assume PayPal retains idempotency keys forever.
- Completed purchases cannot be cancelled to release spend. Provider failure does not automatically refund a completed payment.
- The adapter includes a Sandbox capture-refund method. An operator workflow and refund UI are intentionally not implemented.
- Webhooks are not required for the MVP: explicit reconciliation and MCP polling drive payment completion. Operators must reconcile abandoned or externally changed orders.

Official references: [Orders API](https://developer.paypal.com/api/orders/v2), [save a PayPal Wallet with payment tokens](https://developer.paypal.com/platforms/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/), [API idempotency](https://developer.paypal.com/api/rest/reference/idempotency/).
