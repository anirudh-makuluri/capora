# Verification record

Verified locally on Windows with the bundled Node runtime on October 3, 2026.

| Check                   | Result                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`        | Passed: strict Worker, web, scripts, and test TypeScript                                                                                                                           |
| `pnpm lint`             | Passed                                                                                                                                                                             |
| `pnpm test`             | Passed: production SPA build, Wrangler Worker dry-run, 48 tests across four files                                                                                                  |
| Worker integration      | 22 tests using isolated workerd, real D1/R2 bindings, Queue consumer, and official MCP transport                                                                                   |
| `pnpm test:e2e`         | Passed against running Wrangler/Vite: real HTTP MCP discovery, quote, simulated payment, provider invocation, owner approval, queued job, correct $3.20 spend and $21.80 remaining |
| `pnpm test:browser`     | Three Chromium tests passed: discovery/schema, complete two-purchase demo/transaction result, desktop/mobile navigation without overflow                                           |
| Automated accessibility | Zero axe WCAG A/AA violations on marketplace, agents, transactions, provider console, developers, playground, and landing page                                                     |
| Visual inspection       | Desktop marketplace, capability details, approval state, landing page, and mobile marketplace screenshots                                                                          |

Screenshots and detailed accessibility output are in ignored `.local/`. The live MCP verifier creates its own agent and revokes it after checking; it preserves the audit trail. Browser demo purchases belong to the seeded agent and remain in its local ledger.

The tests include concurrent duplicate purchase/payment attempts, competing purchases near a daily budget limit, expired or edited quotes, policy changes before approval, owner isolation, schema validation, input binding, failure recording, large results stored in R2, and real MCP/Queue completion. They do not prove every failure mode of external PayPal or HTTP providers.

## Required external checks

Cloudflare authentication was expired and could not refresh noninteractively. Actual Sandbox OAuth, order creation, buyer approval, and a completed $0.20 USD capture have now been verified through the running Worker using separate US Sandbox merchant and buyer accounts. Capora recorded order `7KC69115588725355` and capture `96G346231E3103743`; the paid DataPulse invocation completed and returned its synthetic fixture. The earlier currency-blocked order was cancelled without a capture and its reservation released. Therefore:

- No remote Cloudflare resources were provisioned or deployed.
- One actual PayPal Sandbox capture and paid invocation are verified. The $3.00 human-approved Sandbox purchase remains to be checked.
- Saved-wallet setup-token creation worked for the earlier app, but the new US merchant app returns HTTP 403 `NOT_AUTHORIZED` from the Payment Method Tokens API. Completed saved-wallet authorization and autonomous Sandbox purchases remain unverified until that app has vaulting permission.
- Local `DEMO-` receipts are simulated; mocked PayPal adapter tests check API contracts only.
- The first GitHub Actions run failed during Linux seeding because the file-path argument contained literal quotes. The fix was pushed in `6778505`; its GitHub Actions rerun passed, including type checking, linting, builds, 48 isolated tests, local seeding, and all three Chromium browser tests.
- Automated accessibility checks and screenshot review do not establish complete manual accessibility conformance.

Complete the account setup and actual end-to-end checks in [deployment.md](deployment.md) and [paypal.md](paypal.md) before claiming the live definition of done.
