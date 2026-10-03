# Capora build checklist

- [x] Foundation: monorepo, Cloudflare bindings, D1 migrations, seeds
- [x] Marketplace: discovery, details, schemas, provider registration
- [x] Identity: dashboard sessions, hashed agent tokens, ownership
- [x] Commerce: immutable quotes, atomic budget reservations, approvals
- [x] Payments: PayPal Sandbox adapter, checkout, and saved-payment setup implemented
- [x] Execution: secure gateway, validated inputs/outputs, R2 artifacts, Queues
- [x] MCP: authenticated Streamable HTTP and shared service layer
- [x] Product: marketplace, agents, approvals, transactions, provider console, docs
- [x] Verification: policy tests, Worker integration, real MCP client flow, browser QA
- [x] Delivery: README, deployment guide, environment example, demo script

## External verification still required

- [ ] Refresh expired Cloudflare authentication, provision resources, and verify the deployed Worker.
- [x] Verify actual PayPal Sandbox authentication, saved-wallet setup initiation, and order creation.
- [ ] Complete Sandbox buyer wallet authorization and verify capture records for both demo purchases.

The default local setup simulates payments. The configured local workspace now uses PayPal Sandbox; a $0.20 USD purchase was captured and its DataPulse invocation completed using US Sandbox accounts. Saved-wallet authorization is blocked by the new app's vaulting permission (HTTP 403 `NOT_AUTHORIZED`), and the $3.00 Sandbox purchase remains to be checked. These external checks are required before claiming the requested live deployment and PayPal definition of done.
