# Capora

**The marketplace for machine capabilities.**

Capora lets an AI agent acquire access it does not already have: proprietary datasets, privileged APIs, and specialized tools. The agent connects to one MCP server, inspects schemas and economic tradeoffs, gets a quote, purchases under a human-controlled spending policy, and invokes a secure execution gateway.

A collection of generic LLM personas is not the product. Changing a prompt cannot reproduce licensed data, company permissions, private infrastructure, or exclusive tools. Capora brokers access to those capabilities.

## Run locally

Requires Node.js 22.12+ and pnpm 10.32.1 (Corepack can supply the pinned version).

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- Marketplace: [http://localhost:5173/marketplace](http://localhost:5173/marketplace)
- Playground: [http://localhost:5173/demo](http://localhost:5173/demo)
- Worker / MCP: `http://127.0.0.1:8787/mcp`

`setup:local` generates random credentials in ignored `.local/credentials.json`, writes ignored `apps/worker/.dev.vars`, migrates local D1, and seeds ten synthetic capabilities and the Acquisition Research Agent. It preserves existing configuration and seed records. Local storage persists across restarts in `apps/worker/.wrangler/state`.

The local dashboard uses a loopback-only demo identity. **Local payments are simulated**, labeled in the UI, and have `DEMO-` identifiers. They are not PayPal transactions. Deployment defaults disable the local identity and simulator and require PayPal Sandbox. No live PayPal payment mode is implemented.

## What is included

| Area             | Working behavior                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace      | Ten demo capabilities; keyword search; type, category, price, reliability, reputation, and latency filters; sorting; schema detail pages                         |
| Agent management | Creation, rename, hashed tokens, token regeneration/revocation, spending policies, purchase/invocation histories                                                 |
| Commerce         | Immutable five-minute input-bound quotes; idempotent purchases; atomic budget reservations; owner approval/rejection; cancellation and payment reconciliation    |
| Payments         | PayPal Sandbox OAuth, Orders creation/capture, saved-payment setup through the Payment Method Tokens API, persisted order/capture IDs; explicit local simulator  |
| Execution        | Protected demo provider endpoints; approved HTTPS providers; schema validation; one invocation per purchase; structured errors; latency and reliability tracking |
| Async / storage  | Cloudflare Queues consumer; duplicate-delivery guards; persisted job polling; R2 datasets and large result artifacts; scheduled outbox recovery                  |
| Audit            | Live dashboard polling, transaction details, result inspection, spending totals, activity timeline, CSV export, provider usage/revenue                           |
| Product          | Landing page, marketplace, workspace overview, approvals, agent playground, provider console, in-app MCP connection guide                                        |

The browser playground is a deterministic scripted client of the shared REST services; it is not an LLM or a public-web researcher. The CLI demo and automated verifier use the **official MCP client** against the actual Streamable HTTP endpoint.

## Architecture

```mermaid
flowchart LR
  Agent[Purchasing AI agent] -->|Bearer token / MCP| MCP[Capora MCP broker]
  Human[Human dashboard] -->|Signed session / REST| Services[Shared domain services]
  MCP --> Services
  Services --> Policy[Spending policy + atomic reservation]
  Policy --> Approval[Human approval when required]
  Policy --> PayPal[PayPal Sandbox]
  Approval --> PayPal
  PayPal --> Gateway[Secure provider gateway]
  Gateway --> Provider[Approved API / dataset / specialized agent]
  Services --> D1[(D1 + Drizzle)]
  Gateway --> R2[(R2 datasets + artifacts)]
  Gateway --> Queue[Cloudflare Queues]
  Queue --> Provider
```

```text
apps/web             React + Vite + Tailwind + shadcn-style Radix UI + React Query
apps/worker          Hono Worker, REST routes, auth, policies, commerce, gateway, jobs
packages/db          Drizzle schema and tracked D1 SQL migrations
packages/types       Shared DTOs, status models, Zod request validation
packages/mcp         Official SDK server, eight stable marketplace tools
packages/provider-sdk JSON Schema validation, provider metadata/request/error types
packages/config      Policy defaults and bounded execution limits
scripts              Setup, seed, official MCP demo/verifier, visual/accessibility checks
tests                Policy/payment/security tests, isolated workerd integration, browser tests
```

Workers serves the Vite build as same-origin static assets in deployment. Locally Vite proxies `/api` and `/mcp` to Wrangler. Separate frontend Vite and Worker Wrangler processes keep queue consumers and D1 migrations predictable; a Cloudflare Vite plugin is unnecessary for this SPA.

## Financial controls

Defaults: $25/day, auto-approval **at or below $0.50**, $10 maximum transaction, autonomous purchasing enabled. Turning autonomy off requires human approval for all purchases; transaction and daily limits still apply.

Amounts are stored and returned as **integer USD cents**. Budget days use UTC. Pending approval, approved, payment-pending, and purchased records consume available budget. Failed pre-payment requests and rejections release reservations. A purchase belongs to the UTC day on which it was requested, even when approved the next day.

A single conditional SQLite insert checks current policy and reserves funds, so concurrent purchases cannot overspend through a read/write race. The quote has a unique purchase constraint. Payment operations use stable PayPal idempotency keys and a D1 lease; invocation records have a unique purchase constraint. Repeating a purchase or invocation returns the same record.

An uncertain payment result stays `payment_pending` with funds reserved. Reconciliation checks PayPal before fulfillment. An old unconfirmed order-create request is not automatically replayed beyond five hours. Approval requests expire after 24 hours via the scheduled handler. Provider failure consumes the single execution entitlement, records a failed invocation, and does **not** fabricate a refund. A PayPal refund adapter exists, but customer refunds and provider payouts are outside this MVP’s UI.

## PayPal Sandbox

See [the PayPal guide](docs/paypal.md). Set `PAYMENT_MODE=sandbox`, `PAYPAL_ENVIRONMENT=sandbox`, and sandbox client credentials in `apps/worker/.dev.vars` (local) or Worker secrets (deployed). Never put credentials in frontend environment variables.

Autonomous payments require a buyer-authorized saved PayPal Wallet and a merchant account enabled for the relevant billing agreement/vault features. Use **My agents → Connect PayPal**. Without a saved method, the Orders integration returns `payment_pending` and a sandbox checkout URL; complete checkout in Transactions and click **Check payment**.

This repository was verified locally with the explicit payment simulator and mocked Sandbox adapter tests. Actual Sandbox OAuth, saved-wallet setup initiation, and order creation have also been verified through the Worker. Buyer authorization and completed captures remain to be verified. Real Sandbox calls require your credentials/account configuration. Provider demo intelligence is synthetic. SecureScan runs a small deterministic code rule scanner; repository URLs alone use a fixture, and this is not a comprehensive security audit.

## MCP connection

Create or regenerate an agent token under My agents. The token is displayed once. Use the deployed URL or the local Worker URL with a Bearer authorization header:

```json
{
  "mcpServers": {
    "capora": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "Authorization": "Bearer YOUR_CAPORA_AGENT_TOKEN" }
    }
  }
}
```

Client configuration formats vary; this is the generic remote-HTTP shape. See [the connection guide](docs/mcp.md) for an official SDK example. Tools:

```text
search_capabilities → get_capability → get_quote → purchase_capability
→ get_purchase_status (when approval/payment is pending)
→ invoke_capability → get_job (when execution is asynchronous)
get_budget
```

Provider credentials and endpoints are omitted from the public capability DTO. The agent invokes Capora, not the provider.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test                       # builds then tests isolated workerd/D1/R2/Queues + units
pnpm test:e2e                   # requires pnpm dev; real MCP/HTTP, local simulator only
pnpm exec playwright install chromium
pnpm test:browser               # starts dev if needed; seeded demo policy required
pnpm exec tsx scripts/accessibility.ts  # requires dev; writes a WCAG A/AA automated report
```

Unit and Worker integration tests use isolated storage and make no real payments. The live verifier creates and revokes its own agent, preserving its audit records in the local dashboard. Browser demo tests create purchases for the seeded Research Agent. Screenshots and test artifacts are ignored by Git under `.local/`, `test-results/`, and `playwright-report/`.

See [the verification record](docs/verification.md) for observed results and the remaining external checks.

## Demonstrate it

Open the playground, run the acquisition task, request the security analysis, approve $3.00, and inspect the transaction/result trail. For the real MCP flow:

```sh
pnpm demo
# For a fully automated smoke demo using only local simulated payments:
pnpm demo -- --approve
```

The CLI reads the seeded token from ignored local credentials. After rotating that token, set `CAPORA_AGENT_TOKEN` in your shell instead. See [the three-minute demo script](docs/demo.md).

## Deploy / operate

Follow [the deployment guide](docs/deployment.md): authenticate Cloudflare, provision D1/R2/Queues, replace the local database ID, configure your public base URL and secrets, apply remote migrations, seed, and deploy. A Wrangler dry-run validates the bundle and asset configuration without publishing.

See [architecture and security decisions](docs/architecture.md) and [provider creation](docs/providers.md). This MVP is a single operator-controlled human workspace, with many agents and providers. It does not implement multi-user signup, live-money billing, escrow, payout settlement, arbitrary code execution, or automatic refunds. Real integrations may need stricter payload-retention controls, stronger human identity, and operator-managed payment reconciliation.
