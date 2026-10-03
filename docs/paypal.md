# PayPal Sandbox setup and payment semantics

Capora has two deliberately separate modes:

- `demo`: loopback-only, local simulator. `DEMO-…` order/capture IDs are not PayPal records.
- `sandbox`: real calls to `https://api-m.sandbox.paypal.com`. Credentials and funding sources must come from PayPal Sandbox. Live endpoints are never used.

## Standard sandbox checkout

1. Create a Sandbox REST application and separate merchant/buyer Sandbox accounts in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Add `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` to ignored `apps/worker/.dev.vars`. Keep the generated session/encryption/provider secrets. Change `PAYMENT_MODE=sandbox`; retain `PAYPAL_ENVIRONMENT=sandbox`. Restart the Worker.

   Credentials saved only in the repository root `.env` do not override an existing Worker `.dev.vars`. Copy these two values into the Worker file; keep both files out of Git. Verify `/api/health` reports `paymentMode: sandbox` after restart.

3. Buy a capability. Capora creates an Orders v2 order and persists its ID. A policy approval does not itself authorize a new PayPal Wallet.
4. Open Transactions, select the purchase, and follow **Continue with PayPal**. Sign in with the Sandbox buyer account.
5. Return to Capora. The authenticated UI reconciles/captures the order. **Check payment** can be retried safely. Only a matching `COMPLETED` capture in USD for the exact quote amount permits execution.
6. Cancellation through the return page cancels the local entitlement only when PayPal has no completed/approved capture. Orders that need reconciliation keep their reservation.

## Autonomous sandbox payments

Ordinary checkout needs buyer interaction. For the $0.20 automatic-purchase demo, establish a buyer-authorized saved Wallet first:

1. Enable vaulting for the Sandbox REST app in the Developer Dashboard: select the app, then **Sandbox App Settings → App Feature Options → Accept payments → Advanced options → Vault**. Depending on the dashboard version, this feature may be labeled **Save payment methods**. Ensure the merchant supports PayPal Wallet saving; availability depends on account configuration. See [PayPal's setup instructions](https://developer.paypal.com/api/save-with-purchase/save-payment-methods/).
2. In My agents, choose **Connect PayPal**.
   Log in with a **Personal Sandbox account**, not your real PayPal account or the merchant's Business Sandbox account. Find the generated email/password under [Sandbox accounts](https://developer.paypal.com/dashboard/accounts) → View/Edit Account. If PayPal opens guest signup and asks for a card, return to login. If a card is required for the test account, use [PayPal's official test cards](https://developer.paypal.com/sandbox-testing/card-testing/), never real card details or arbitrary invented numbers.
3. Capora creates a Payment Method Tokens v3 setup token with same-origin return/cancel URLs. The human signs in and authorizes the Wallet on PayPal.
4. The authenticated return UI exchanges that owned setup token for a permanent payment token. Capora stores the token encrypted on the human user record, never on the agent or browser.
5. Orders for that user include the saved `vault_id`. Capora creates/captures the Sandbox order under the agent’s policy. PayPal can still return a pending or payer-action state, which must be completed before invocation.

Capora is the single Sandbox merchant in this MVP. It records provider-attributed revenue, but does not distribute payouts or implement a multi-merchant PayPal platform.

## Retry and failure behavior

### Sandbox account errors

- `CANNOT_PAY_SELF`: the browser must use a Personal Sandbox buyer distinct from the Business Sandbox merchant associated with the REST app. Sign out of a cached merchant session before retrying.
- `UNSUPPORTED_PAYEE_CURRENCY`: Capora prices and verifies payments in USD. The Business Sandbox merchant must accept USD. Review its payment receiving preferences and supported currencies, or use a USD-capable Sandbox merchant/app. Changing API credentials alone does not authorize a buyer wallet; reconnect the wallet after changing the merchant.
- HTTP 403 `NOT_AUTHORIZED` from `/v3/vault/setup-tokens`: ordinary Orders checkout can work while wallet saving is unavailable. Check the app's Vault / Save payment methods permission and merchant eligibility. Successful OAuth or checkout alone does not prove vaulting access.
- After enabling a permission, PayPal can reuse an access token issued with older scopes. The adapter retries a definite HTTP 403 once after requesting OAuth with `ignoreCache=true`, keeping the same payment body and idempotency key. A second rejection remains an error. This refresh restored wallet access for the verified US Sandbox app; it does not grant permissions that are disabled on the app.
- A generic error in the saved-wallet authorization page does not prove that a wallet was connected. Capora only marks billing connected after exchanging an approved setup token successfully.

See PayPal's [unsupported currency explanation](https://developer.paypal.com/api/errors/unsupported-payee-currency/) and [payment receiving preferences](https://www.paypal.com/au/cshelp/article/what-are-payment-receiving-preferences-and-how-can-i-set-them-help536).

### Payment retries

- Create/capture requests each have a separate, stable, 32-character `PayPal-Request-Id` derived from the purchase ID.
- A definite authorization rejection may be retried once with refreshed permissions; uncertain network/payment outcomes are never retried by this mechanism.
- A D1 lease serializes payment operations. Other callers see the pending purchase while work is active.
- Credential/configuration errors before an order can exist fail the purchase and release its reservation.
- Network errors, unreadable responses, or errors involving an existing order preserve the `payment_pending` reservation. Reconcile rather than guessing the outcome.
- An unconfirmed order-create request older than five hours needs manual reconciliation; Capora does not assume PayPal retains idempotency keys forever.
- Completed purchases cannot be cancelled to release spend. Provider failure does not automatically refund a completed payment.
- The adapter includes a Sandbox capture-refund method. An operator workflow and refund UI are intentionally not implemented.
- Webhooks are not required for the MVP: explicit reconciliation and MCP polling drive payment completion. Operators must reconcile abandoned or externally changed orders.

Official references: [Orders API](https://developer.paypal.com/api/orders/v2), [save a PayPal Wallet with payment tokens](https://developer.paypal.com/platforms/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/), [API idempotency](https://developer.paypal.com/api/rest/reference/idempotency/).
