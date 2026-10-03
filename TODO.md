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
- [ ] Supply PayPal Sandbox credentials and an eligible buyer-authorized payment method; verify actual order/capture records for both demo purchases.

Local payments are explicitly simulated. These external checks are required before claiming the requested live deployment and PayPal definition of done.
