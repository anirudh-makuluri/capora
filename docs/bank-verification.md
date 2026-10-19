# Capora Bank verification and handoff

Verified locally on October 19, 2026 (America/Phoenix).

## Passing checks

| Check                       | Result                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| `pnpm typecheck`            | Pass: Worker, web and tests                                                |
| `pnpm lint`                 | Pass                                                                       |
| `pnpm bank:build`           | Pass: Solidity 0.8.30, generated shared ABIs, no contract size warnings    |
| `pnpm bank:test`            | 18 Solidity tests pass, including 256 randomized escrow conservation cases |
| `pnpm build`                | Pass: Vite production build and Wrangler deployment dry-run                |
| `pnpm exec vitest run`      | 224 tests pass across 17 suites                                            |
| `pnpm exec playwright test` | 32 Chromium tests pass                                                     |
| `pnpm db:generate`          | No schema changes after the checked-in migrations/snapshots                |
| `git diff --check`          | Pass                                                                       |

The Solidity suite covers exact-once minting, wallet identity/replay/revocation, escrow release/refund/authority/pause/disputes/rounding, actual token swaps, stale prices, fund share accounting and donation resistance, fee recipients, investor cash-flow adjustment of the trading-loss budget, operating expenses, backed borrowing/partial repayment/collateral return/liquidation/insolvency, and public chit full-cycle/default/bond/security/cancellation behavior.

## Actual local EVM integration proof

`tests/bank-chain.test.ts` deploys the real contracts to a fresh Hardhat EVM on loopback port 8546 with chain ID 84532. Authenticated requests execute through the actual built Cloudflare Worker, D1 database and Queue consumer. It verifies:

1. Two distinct agent wallets; a $20 capture produces exactly 20 cUSD despite repeated requests and signed event replay; unauthenticated provisioning fails.
2. An actual Document Fingerprint computation is paid through escrow, executes once and delivers the full price to the Bank revenue wallet with a zero marketplace fee. A user-created dataset separately delivers its provider's exact net tokens and the treasury's exact fee; choosing the display name “Capora Bank” does not grant a fee exemption. Neither purchase causes another PayPal capture.
3. Recipient restrictions and owner approval for financial-policy changes.
4. Fund creation, deposits, shares, actual inventory swaps, token positions, NAV snapshots, unwind and redemption.
5. Lending liquidity deposits, collateralized borrowing, repayment and collateral return.
6. A complete two-agent commit/reveal auction chit, highest-discount winner, exact payout/commission/dividend accounting, second round, claims and returned security.
7. Provider earnings moved to an owned agent, a portion invested and another external capability purchased. A separate settlement check changes the saved marketplace fee after quoting: the old quote settles at 2.5%, the next at 5%, and a subsequent zero-fee quote sends the entire price to the provider.
8. An AI proposal selects an allowlisted analytics capability; its actual escrow payment comes from the vault under its on-chain expense budget, and repeated strategy triggering is rate limited.
9. Known provider failure refunds and forged webhook rejection.
10. Permissionless on-chain expiry refund reconciled into D1, canonical event replay without duplicates, and real wallet cash-flow indexing.

**PayPal and the planner are explicit isolated test doubles in this suite.** The EVM, contracts, token transfers, vault accounting, escrow, API authentication, D1 writes and Queue execution are real local execution. No hosted chain, live payment or real model-response claim follows from these tests.

## Capability ownership follow-up

The built-in registry now seeds and synchronizes under `provider_capora_bank`. Its provider smart wallet receives 100% of newly quoted built-in purchases after fulfillment. Independently registered providers retain their own wallets and the configured marketplace fee (default 2.5%). The configured platform-fee treasury remains separate from the Bank's capability revenue wallet.

`tests/bank-ownership.test.ts` exercises migration and catalog sync against real isolated D1 databases: existing bootstrap records, fresh listings, repeat application, cross-owner conflicts, changed endpoints, moderation/usage preservation, historical transactions, unresolved escrow deferral, and stale unfunded quotes. A controlled wallet-provisioning test double interleaves ownership migration with escrow creation to verify the atomic guard rejects the losing purchase before funding. Worker API coverage also checks that an ownership change invalidates an earlier quote. Browser coverage checks the displayed Bank provider on the actual capability purchase page.

Migration `0010_bank_capability_ownership.sql` and the updated catalog seed were applied locally. A direct local D1 query confirms every currently registered built-in is assigned to the Bank provider. No remote ownership migration or wallet deployment follows from this local verification.

## Browser proof

The admin fee editor accepts 0–10% in 0.01% increments and persists its setting in D1. Admin integration tests cover environment/default fallback, saved-zero precedence, update auditing, invalid input, authorization, concurrent-save conflicts and quote snapshots. The browser suite exercises fee edits, reload persistence, stale tabs and explicit reload recovery, non-admin denial, mobile layout and accessibility. Desktop/mobile screenshots of the new fee panel were visually inspected. See [admin.md](admin.md) for the setting and API contract.

The Bank browser test verifies desktop/mobile navigation, unmistakable simulated-funds labeling, disabled operations when contracts are unconfigured, explicit setup errors, financial-policy saving, all Bank sections, accessibility and absence of horizontal overflow. The other 31 browser tests also pass, including account isolation, live MCP onboarding against the disposable Worker, paid computation/approval, admin controls and visual regressions at eight viewport sizes. The long Bank capability names wrap correctly in the existing marketplace. Desktop and mobile Bank screenshots were visually inspected in addition to automated accessibility checks.

## Deployment boundary

No remote Worker release, remote D1 migration or hosted Base Sepolia deployment was performed. No public deployment address or explorer transaction is claimed. The checked-in deployment manifest explicitly says `not_deployed`.

The remaining external setup is documented in [bank.md](bank.md): an app-owned Privy executor, separate secured administrator, Base Sepolia RPC/test ETH, actual contract deployment and bindings, PayPal Sandbox app/buyer/webhook, and optional explicitly budgeted planner credentials. Real Sandbox minting, Privy policies, hosted swaps and a real model proposal must be verified after that setup. SD-Artifacts remains unchanged in the existing capability registry and still needs its own configured provider access.

The normal application fails closed for paid purchases until cUSD settlement is configured. Only the isolated legacy regression fixtures explicitly enable the old local payment double; that flag is not set by normal local setup or deployment.

See [bank.md](bank.md) for the local setup sequence, money flow, custody/attestor/oracle assumptions, explicit fee arithmetic, recovery procedure, limitations and judge demo script.
