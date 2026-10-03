# Verification record

Verified locally on Windows with the bundled Node runtime on October 3, 2026.

| Check                   | Result                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`        | Passed: strict Worker, web, scripts, and test TypeScript                                                                                                                           |
| `pnpm lint`             | Passed                                                                                                                                                                             |
| `pnpm test`             | Passed: production SPA build, Wrangler Worker dry-run, 69 tests                                                                                                                    |
| Worker integration      | Isolated workerd, real D1/R2 bindings, Queue consumer, official MCP transport, and concurrent R2 budget checks                                                                     |
| `pnpm test:e2e`         | Passed against running Wrangler/Vite: real HTTP MCP discovery, quote, simulated payment, provider invocation, owner approval, queued job, correct $3.20 spend and $21.80 remaining |
| `pnpm test:browser`     | Three Chromium tests passed: discovery/schema, complete two-purchase demo/transaction result, desktop/mobile navigation without overflow                                           |
| Automated accessibility | Zero axe WCAG A/AA violations on marketplace, agents, transactions, provider console, developers, playground, and landing page                                                     |
| Visual inspection       | Desktop marketplace, capability details, approval state, landing page, and mobile marketplace screenshots                                                                          |

Screenshots and detailed accessibility output are in ignored `.local/`. The live MCP verifier creates its own agent and revokes it after checking; it preserves the audit trail. Browser demo purchases belong to the seeded agent and remain in its local ledger.

The tests include concurrent duplicate purchase/payment attempts, competing purchases near a daily budget limit, expired or edited quotes, policy changes before approval, owner isolation, schema validation, input binding, failure recording, large results stored in R2, and real MCP/Queue completion. They do not prove every failure mode of external PayPal or HTTP providers.

## Cloudflare deployment

Deployed October 3, 2026 at [capora.anirudh-makuluri.workers.dev](https://capora.anirudh-makuluri.workers.dev). The frontend, API, and MCP share one Worker; D1, private R2, both Queues, and the scheduled handler are provisioned. Workers Free was verified in the account dashboard. The deployment uses real workspace authentication and PayPal Sandbox; the local payment simulator is disabled.

Live checks passed for health, remote D1 catalog, SPA deep links/assets, unauthenticated access rejection, password login with a Secure/HttpOnly session cookie, official MCP discovery of eight tools, and agent budget retrieval. A synthetic 81-byte dataset upload reserved bytes before writing; its actual remote R2 content was downloaded and verified, then the test object was removed. Byte reservations deliberately remain. Temporarily enabling the storage kill switch rejected a new upload without changing usage counters; the switch was restored afterward. No live payment or provider invocation was made during these deployment checks.

GitHub Actions verifies each commit before the `production` deployment job applies migrations, publishes the frontend/API/MCP together, and runs read-only smoke checks. See [Actions](https://github.com/anirudh-makuluri/capora/actions) for release results and [usage safeguards](usage-limits.md) for the enforced storage ceilings.

## PayPal Sandbox verification

Actual Sandbox OAuth, order creation, buyer approval, and a completed $0.20 USD capture were verified through the locally running Worker using separate US Sandbox merchant and buyer accounts. Capora recorded order `7KC69115588725355` and capture `96G346231E3103743`; the paid DataPulse invocation completed and returned its synthetic fixture. The earlier currency-blocked order was cancelled without a capture and its reservation released.

After enabling Save payment methods on the exact Sandbox app, PayPal continued issuing a cached token without the new scopes. An OAuth request with `ignoreCache=true` restored access. The adapter now refreshes once after a definite HTTP 403, preserves the original idempotency key/body, and stops if the refreshed request is also rejected. Two regression tests cover that behavior.

The US buyer subsequently authorized the saved Wallet. The official MCP demo then completed the full flow through the running Worker:

| Capability | Payment and execution                                                                                     | PayPal order        | Completed USD capture |
| ---------- | --------------------------------------------------------------------------------------------------------- | ------------------- | --------------------- |
| DataPulse  | Autonomous $0.20 purchase and completed invocation                                                        | `6DM71094E00077048` | `4JK59941KV984092U`   |
| SecureScan | $3.00 purchase stopped for owner approval; approval submitted through the dashboard; queued job completed | `3JV58836GS1187728` | `0R675297TH0017217`   |

Both capture IDs, amounts, currencies, and `COMPLETED` statuses were independently checked against PayPal's Orders API. The new verifier agent spent $3.20, retained $21.80 of its $25.00 daily budget, and had no reserved funds. Proof JSON and screenshots are in ignored `.local/`. Therefore:

- Actual PayPal Sandbox checkout, saved-wallet authorization, autonomous payment, owner approval gating, and both paid executions are verified locally. This does not prove behavior in a remote deployment.
- Local `DEMO-` receipts are simulated; mocked PayPal adapter tests check API contracts only.
- The first GitHub Actions run failed during Linux seeding because the file-path argument contained literal quotes. The fix was pushed in `6778505`; its GitHub Actions rerun passed, including type checking, linting, builds, 48 isolated tests, local seeding, and all three Chromium browser tests.
- Automated accessibility checks and screenshot review do not establish complete manual accessibility conformance.

Remote payment/capture and paid Queue execution still require the end-to-end checks in [deployment.md](deployment.md) and [paypal.md](paypal.md). Hosting/authentication/storage/MCP checks do not prove those external payment flows.
