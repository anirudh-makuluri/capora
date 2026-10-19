# Capora Bank verification and handoff

Verified locally and against the hosted Base Sepolia application on October 19, 2026 (America/Phoenix). Hosted checks below use simulated testnet assets and actual PayPal Sandbox funds.

## Passing checks

| Check                       | Result                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| `pnpm typecheck`            | Pass: Worker, web and tests                                                |
| `pnpm lint`                 | Pass                                                                       |
| `pnpm bank:build`           | Pass: Solidity 0.8.30, generated shared ABIs, no contract size warnings    |
| `pnpm bank:test`            | 18 Solidity tests pass, including 256 randomized escrow conservation cases |
| `pnpm build`                | Pass: Vite production build and Wrangler deployment dry-run                |
| `pnpm exec vitest run`      | 261 tests pass across 20 suites                                            |
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

Migrations `0008`–`0010` and the updated catalog seed were applied to hosted D1 after exporting a private pre-release backup. The hosted catalog reports the built-in provider as `provider_capora_bank`.

## Browser proof

The admin fee editor accepts 0–10% in 0.01% increments and persists its setting in D1. Admin integration tests cover environment/default fallback, saved-zero precedence, update auditing, invalid input, authorization, concurrent-save conflicts and quote snapshots. The browser suite exercises fee edits, reload persistence, stale tabs and explicit reload recovery, non-admin denial, mobile layout and accessibility. Desktop/mobile screenshots of the new fee panel were visually inspected. See [admin.md](admin.md) for the setting and API contract.

The Bank browser test verifies desktop/mobile navigation, unmistakable simulated-funds labeling, disabled operations when contracts are unconfigured, explicit setup errors, financial-policy saving, all Bank sections, accessibility and absence of horizontal overflow. The other 31 browser tests also pass, including account isolation, live MCP onboarding against the disposable Worker, paid computation/approval, admin controls and visual regressions at eight viewport sizes. The long Bank capability names wrap correctly in the existing marketplace. Desktop and mobile Bank screenshots were visually inspected in addition to automated accessibility checks.

## Deployment boundary

On October 19, 2026, all seven Bank contracts were deployed to hosted Base Sepolia using the app-managed Privy executor. The checked-in [deployment manifest](../packages/bank/deployments/base-sepolia.json) contains actual addresses and all 34 deployment/configuration transaction hashes. Independent chain reads verified successful canonical receipts with at least three confirmations, contract bytecode, immutable references, the administrator's roles, executor administrator renunciations, retained minter/attestor roles, lending guardian, wallet method allowlists, treasury and artificial market inventory.

The Bank capability revenue wallet is `0x345D0cB01a60FAE852C7D92f17d6d295790318DD`, created from the stable `provider_capora_bank` identity through WalletFactory. Its [provisioning transaction](https://sepolia.basescan.org/tx/0x38cfefc6743472bdedd8b1ed585fbe738081c7ad2035118e2fbfcb7bcc1fc90a) confirmed successfully, and its registered status and factory authority were checked. This is separate from the marketplace fee treasury.

The temporary deployment policy was replaced with a Privy runtime policy restricted to Base Sepolia, zero native transfer value, specific destinations and permitted functions. A [zero-amount approval through the Bank smart wallet](https://sepolia.basescan.org/tx/0x15dd3df3a56c1ba77b01458625a0af2ad52b4a64dc8a294239195b8cc55882e4) confirmed on chain. Independent negative requests for an unlisted destination and a disallowed method returned `policy_violation` without a transaction hash. The Worker now automatically enrolls registered wallets and keeper chit destinations in separate signed condition sets. It verifies confirmed factory registration, authority and identity before appending one destination. Existing entries are accepted only after exact membership verification, including pagination; other rejected requests remain pending. Rotation revalidates registration, while cached enrollment does not silently undo an operator's removal. Interoperability tests independently verify the P-256 DER request signatures.

The hosted Worker is released with `BANK_ENABLED=true`, configured managed signing, automatic enrollment and PayPal Sandbox webhook verification. Ignored local configuration retains `BANK_ENABLED=false`; a local flag is not evidence of the hosted setting. Deployment preflight checks all required Bank, enrollment and PayPal secret names without exposing their values. Hosted smoke checks verify authentication gates and rejection of unsigned webhooks.

## Actual hosted Sandbox top-up

The user approved Sandbox order `9AK21206RB900902V`. Actual capture `3GS77103W8892970A` produced [one confirmed 20 cUSD mint](https://sepolia.basescan.org/tx/0xb048d32d2f05c6272c9b724bf2a4b3ecfa28cb5978483ba3053aa2aa3c7ae905) to a newly provisioned isolated agent wallet. Repeated top-up creation and reconciliation preserved the same capture/mint commitment. The actual signed `PAYMENT.CAPTURE.COMPLETED` event was verified and recorded by the hosted webhook. This was an actual PayPal Sandbox approval/capture, with no real USD or mainnet transfer.

The executor and administrator remain separate. The administrator received a bounded 0.001 test ETH gas allocation through a temporary exact-recipient rule; that rule was removed immediately and the zero-native-value runtime policy verified again. `pnpm bank:price -- --price 2` refreshes the explicitly selected artificial test-market price using the separately protected administrator key. The key stays outside Worker secrets; prices expire after one hour and are not external market prices.

## Actual hosted payments and fund cycle

Hosted capability settlement was checked against canonical token transfer receipts with at least three confirmations:

| Flow                      | Actual result                                                                               | Receipt                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Document Fingerprint      | Actual SHA-256 computation; full 0.10 cUSD to the Bank revenue wallet; zero marketplace fee | [Release](https://sepolia.basescan.org/tx/0xe693703ccd701f05b6bd88bcbea928ae7a20d030e81d04887b80507008cb9623) |
| Independent owned dataset | Actual dataset result; 0.0975 cUSD to its provider and 0.0025 cUSD to the fee treasury      | [Release](https://sepolia.basescan.org/tx/0x53a1d2c00ab4c87b612084ba910818211daafa28bcc86f0b5a902272689b8a22) |
| Known missing dataset     | Provider failure; full 0.10 cUSD returned to the buyer, restoring its preceding balance     | [Refund](https://sepolia.basescan.org/tx/0xbc2b886f219d809aea08926c989734500ba7dcf6b4c6b0178788093daec2945f)  |

Both temporary provider listings were disabled after verification. The hosted administrator dashboard was visually checked: its fee editor displays the current 2.5% default, the Bank exemption and immutable quote behavior. Save/reload/concurrency and changed-rate settlement remain covered by the isolated integration/browser suites; the hosted global fee was not changed for testing.

Fund `0xca647c2D2723ac91a711b6b7eB7D0827868d693b` accepted an actual 5 cUSD investment, issued shares, bought 0.997 cRISK for 2 cUSD in the disclosed artificial market, unwound the position and redeemed the investor's entire share balance. Confirmed transactions: [investment](https://sepolia.basescan.org/tx/0x818e9a86d520258663d875883e5861b391668b76a6921ad3c80d79c1e71fbf86), [buy](https://sepolia.basescan.org/tx/0x832ff07d9935c7e568baec561aca9d01c14f166e55957186daadbb31fdc8bcef), [sell](https://sepolia.basescan.org/tx/0xcd0a3f657aa8691cabbb75f9e7db51afbd1dc1aa6127fd03db9f4a6f2060314c), [redemption](https://sepolia.basescan.org/tx/0x4c50507487a22a49f67a8ce857aa3caed0e7864bce3ffc32b235ad379a845d28). The investor holds zero shares and the fund holds zero cRISK; small accrued management-fee shares remain, as disclosed by its terms.

The first swap test supplied a deadline beyond the market's ten-minute limit and was rejected without a broadcast. Quote validation and a managed pre-sign simulation now catch deterministic reverts before creating a cached signer rejection. Retrying unknown signing outcomes preserves the original request/idempotency key and does not re-simulate an action that may already have executed. Temporary enrollment/RPC failures remain pending; synchronous retries are queued after ten seconds, with the scheduled keeper as fallback.

Hosted browser verification also exposed CPU exhaustion on the overview and Bank requests. The overview now reads only the capability counters needed for provider totals, and unprovisioned wallet balances skip unnecessary RPC-client creation. Both authenticated APIs returned JSON after release and the browser rendered the wallet and public auction ledger, but continued sampling still showed intermittent `exceededCpu` failures under the Free plan's 10 ms CPU allowance. Cloudflare explicitly rejected configuring a higher CPU cap on Free (`100328`). The user chose to remain on Workers Free. No billing upgrade or higher CPU setting was applied. This is a known hosting limitation: the passing local suites and completed financial transactions do not establish reliable hosted dashboard operation under sustained use.

The original public RPC rejected log ranges over 200 blocks. The indexer now reads at most five 200-block pages per run with canonical overlap; integration coverage checks both the page limit and catch-up progress. Runtime reads were switched to PublicNode's Base Sepolia endpoint after verifying chain ID, a canonical block hash and factory bytecode against the original RPC. Actual chain events are now indexed. This remains shared public RPC infrastructure, so sustained production traffic requires appropriate capacity planning.

An earlier wallet provisioning intent had no stored receipt despite its wallet already existing. Its unique `WalletCreated` event supplied the actual creation hash; the owner recovery endpoint verified signer, target, calldata and zero native value, then confirmed the original receipt without broadcasting another transaction.

## Actual hosted lending cycle

The buyer supplied 3 cUSD of liquidity. The second agent locked 2 cRISK, borrowed 1 cUSD, repaid its accrued debt and retrieved all collateral. The liquidity supplier then redeemed all shares. Direct contract reads verified zero outstanding debt, zero loan collateral, zero remaining repayment allowance and zero supplier shares. Receipts: [liquidity](https://sepolia.basescan.org/tx/0x01f1b74cc7b08c52bcac05eaee17cad17e5d88f13a0ef4772b4458fccda4cb02), [borrowing](https://sepolia.basescan.org/tx/0xd9243fd5f5f90069d0cbebe8a5560238430c59fd8d5c4f3b679afb8b25753747), [repayment](https://sepolia.basescan.org/tx/0x2b34f3524b206e048c0abd8b9a0816bf516be18569cde0cec53d4dad8e4f8193), [collateral return](https://sepolia.basescan.org/tx/0x4b7d8b80f1a0ad48bf78945bc14152f9bb7f6172fd3e351b707e76ae0bd06198), [redemption](https://sepolia.basescan.org/tx/0x4fa411f681779b30f9ddce2bf3c467e3634392b8aebb8ad713377c16326f7408).

Each test agent received a separately disclosed faucet allocation of 5 cRISK using deterministic mint commitments. These are test collateral allocations, not cUSD top-ups or PayPal receipts. All cUSD used by the test agents came from the approved Sandbox top-up and subsequent on-chain transfers.

## Actual hosted public auction chit

Public chit `0xe0699657D67942a9CD3333983e64c8F233Ed441d` completed both rounds using actual Base Sepolia time. Two distinct registered agents posted 1 cUSD bonds and 1 cRISK security each, then contributed 1 cUSD per round. Both sealed bids were committed and revealed within their respective windows. The 0.30 cUSD discount beat 0.20: the first winner received 1.68 cUSD, each member received a 0.15 cUSD dividend, and the organizer earned 0.02 cUSD commission. The other member won round two, with a 1.98 cUSD payout and 0.02 cUSD commission. No member won twice.

The scheduled keeper finalized the first round. An owner-triggered keeper reconciliation finalized the second after its deadline. Both were direct registered-chit transactions, exercising automatic signed enrollment in the separate chit condition set: [round one](https://sepolia.basescan.org/tx/0x6f4da89b4e72e781c1c0944d9f10abd4f44dfe6ea29f726578a4fe1244302cac), [round two](https://sepolia.basescan.org/tx/0x73060d002771bd9e8b4ffb2987bcc61b63c15933960aed9c3d3d2829063afb35). Both members claimed their complete credits and exited, returning bonds and security. Direct reads verified zero remaining credits, zero bonded/security balances and zero cUSD or cRISK left in the completed chit. The hosted public ledger was visually checked showing two members, round two and `completed: true`.

A live planner response still requires explicitly budgeted model-provider setup. No planner credentials were configured or paid model calls made during these checks. SD-Artifacts remains in the existing capability registry and retains its provider credential requirements.

## Closing audit

The final hosted audit independently re-read all 60 confirmed outbox receipts, checked successful status, canonical block hashes and at least three confirmations, and found no unresolved transaction intents. At one confirmed block, all known holder balances summed exactly to the total supply of both cUSD and cRISK. That includes the explicitly seeded artificial-market inventory, separately disclosed collateral faucet allocations, Sandbox-funded wallets and the protocol contracts. The completed chit retained zero tokens. The verification fund was paused and closed to new subscriptions after its investor redeemed; the disabled provider probes and completed transactions remain as audit history. These hosted checks and local results are separate from GitHub CI.

The normal application fails closed for paid purchases until cUSD settlement is configured. Only the isolated legacy regression fixtures explicitly enable the old local payment double; that flag is not set by normal local setup or deployment.

See [bank.md](bank.md) for the local setup sequence, money flow, custody/attestor/oracle assumptions, explicit fee arithmetic, recovery procedure, limitations and judge demo script.
