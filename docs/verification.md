# Verification record

Verified locally on Windows with the bundled Node runtime on October 3, 2026.

| Check                   | Result                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`        | Passed: strict Worker, web, scripts, and test TypeScript                                                                                                                           |
| `pnpm lint`             | Passed                                                                                                                                                                             |
| `pnpm test`             | Passed: production SPA build, Wrangler Worker dry-run, 47 tests across four files                                                                                                  |
| Worker integration      | 22 tests using isolated workerd, real D1/R2 bindings, Queue consumer, and official MCP transport                                                                                   |
| `pnpm test:e2e`         | Passed against running Wrangler/Vite: real HTTP MCP discovery, quote, simulated payment, provider invocation, owner approval, queued job, correct $3.20 spend and $21.80 remaining |
| `pnpm test:browser`     | Three Chromium tests passed: discovery/schema, complete two-purchase demo/transaction result, desktop/mobile navigation without overflow                                           |
| Automated accessibility | Zero axe WCAG A/AA violations on marketplace, agents, transactions, provider console, developers, playground, and landing page                                                     |
| Visual inspection       | Desktop marketplace, capability details, approval state, landing page, and mobile marketplace screenshots                                                                          |

Screenshots and detailed accessibility output are in ignored `.local/`. The live MCP verifier creates its own agent and revokes it after checking; it preserves the audit trail. Browser demo purchases belong to the seeded agent and remain in its local ledger.

The tests include concurrent duplicate purchase/payment attempts, competing purchases near a daily budget limit, expired or edited quotes, policy changes before approval, owner isolation, schema validation, input binding, failure recording, large results stored in R2, and real MCP/Queue completion. They do not prove every failure mode of external PayPal or HTTP providers.

## Required external checks

Cloudflare authentication was expired and could not refresh noninteractively. PayPal Sandbox credentials were unavailable. Therefore:

- No remote Cloudflare resources were provisioned or deployed.
- No actual PayPal Sandbox charge, capture, or saved-wallet setup was performed.
- Local `DEMO-` receipts are simulated; mocked PayPal adapter tests check API contracts only.
- The GitHub Actions workflow is supplied but has not run on GitHub.
- Automated accessibility checks and screenshot review do not establish complete manual accessibility conformance.

Complete the account setup and actual end-to-end checks in [deployment.md](deployment.md) and [paypal.md](paypal.md) before claiming the live definition of done.
