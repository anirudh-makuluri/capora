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

- [x] Refresh Cloudflare authentication, provision resources, and verify deployed hosting, authentication, storage, and MCP.
- [x] Configure verified GitHub Actions releases and enforce conservative R2 usage budgets.
- [x] Verify actual PayPal Sandbox authentication, saved-wallet setup initiation, and order creation.
- [x] Complete Sandbox buyer wallet authorization and verify capture records for both demo purchases.

The default local setup simulates payments. The configured local workspace now uses PayPal Sandbox; the official MCP demo completed a saved-wallet $0.20 DataPulse purchase and the dashboard-approved $3.00 SecureScan purchase with a completed queued job. Both captures were independently verified through PayPal. The hosted Cloudflare app passed authentication, storage, catalog, and MCP checks; remote PayPal capture and paid Queue execution remain separate end-to-end checks.
