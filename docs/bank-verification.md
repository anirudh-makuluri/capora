# Capora Bank verification and handoff

Verified locally on October 18, 2026 (America/Phoenix).

## Passing checks

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass: Worker, web and tests |
| `pnpm lint` | Pass |
| `pnpm bank:build` | Pass: Solidity 0.8.30, generated shared ABIs, no contract size warnings |
| `pnpm bank:test` | 18 Solidity tests pass, including 256 randomized escrow conservation cases |
| `pnpm build` | Pass: Vite production build and Wrangler deployment dry-run |
| `pnpm exec vitest run` | 208 tests pass across 16 suites |
| `pnpm test:browser` | 31 Chromium tests pass |
| `pnpm db:generate` | No schema changes after the checked-in migrations/snapshots |
| `git diff --check` | Pass |

The Solidity suite covers exact-once minting, wallet identity/replay/revocation, escrow release/refund/authority/pause/disputes/rounding, actual token swaps, stale prices, fund share accounting and donation resistance, fee recipients, investor cash-flow adjustment of the trading-loss budget, operating expenses, backed borrowing/partial repayment/collateral return/liquidation/insolvency, and public chit full-cycle/default/bond/security/cancellation behavior.

## Actual local EVM integration proof

`tests/bank-chain.test.ts` deploys the real contracts to a fresh Hardhat EVM on loopback port 8546 with chain ID 84532. Authenticated requests execute through the actual built Cloudflare Worker, D1 database and Queue consumer. It verifies:

1. Two distinct agent wallets; a $20 capture produces exactly 20 cUSD despite repeated requests and signed event replay; unauthenticated provisioning fails.
2. An actual Document Fingerprint computation is paid through escrow, executes once, delivers the provider's exact net tokens and the treasury's exact fee, without another PayPal capture.
3. Recipient restrictions and owner approval for financial-policy changes.
4. Fund creation, deposits, shares, actual inventory swaps, token positions, NAV snapshots, unwind and redemption.
5. Lending liquidity deposits, collateralized borrowing, repayment and collateral return.
6. A complete two-agent commit/reveal auction chit, highest-discount winner, exact payout/commission/dividend accounting, second round, claims and returned security.
7. Provider earnings moved to an owned agent, a portion invested and another external capability purchased.
8. An AI proposal selects an allowlisted analytics capability; its actual escrow payment comes from the vault under its on-chain expense budget, and repeated strategy triggering is rate limited.
9. Known provider failure refunds and forged webhook rejection.
10. Permissionless on-chain expiry refund reconciled into D1, canonical event replay without duplicates, and real wallet cash-flow indexing.

**PayPal and the planner are explicit isolated test doubles in this suite.** The EVM, contracts, token transfers, vault accounting, escrow, API authentication, D1 writes and Queue execution are real local execution. No hosted chain, live payment or real model-response claim follows from these tests.

## Browser proof

The new Bank browser test verifies desktop/mobile navigation, unmistakable simulated-funds labeling, disabled operations when contracts are unconfigured, explicit setup errors, financial-policy saving, all Bank sections, accessibility and absence of horizontal overflow. The existing 30 browser tests also pass, including account isolation, live MCP onboarding against the disposable Worker, paid computation/approval, admin controls and visual regressions at eight viewport sizes. The long Bank capability names wrap correctly in the existing marketplace. Desktop and mobile Bank screenshots were visually inspected in addition to automated accessibility checks.

## Deployment boundary

No remote Worker release, remote D1 migration or hosted Base Sepolia deployment was performed. No public deployment address or explorer transaction is claimed. The checked-in deployment manifest explicitly says `not_deployed`.

The remaining external setup is documented in [bank.md](bank.md): an app-owned Privy executor, separate secured administrator, Base Sepolia RPC/test ETH, actual contract deployment and bindings, PayPal Sandbox app/buyer/webhook, and optional explicitly budgeted planner credentials. Real Sandbox minting, Privy policies, hosted swaps and a real model proposal must be verified after that setup. SD-Artifacts remains unchanged in the existing capability registry and still needs its own configured provider access.

The normal application fails closed for paid purchases until cUSD settlement is configured. Only the isolated legacy regression fixtures explicitly enable the old local payment double; that flag is not set by normal local setup or deployment.

See [bank.md](bank.md) for the local setup sequence, money flow, custody/attestor/oracle assumptions, explicit fee arithmetic, recovery procedure, limitations and judge demo script.
