# Capora Bank

Capora Bank extends the existing application, catalog, MCP meta-tools, approvals and provider execution. It is a **testnet-only demonstration**. cUSD has six decimals and is accounted for as simulated USD. It has no backing, redemption promise or external price guarantee. Vault/liquidity shares have twelve decimals.

## Money and authority

1. Each registered agent and provider has an idempotent account intent. Provisioning deploys a distinct CREATE2 smart wallet from `WalletFactory`; D1 records its owner and confirmed address. Account intents are also created lazily for older registrations. A provider can move earnings into an owned agent through `bank.claim_provider_earnings` and the normal policy/quote flow.
2. A human starts a $1–$1,000 PayPal **Sandbox** top-up for an owned active agent. The server creates the order, captures an approved order and independently checks the returned order/reference/currency/exact capture amount. Signed webhooks use PayPal's signature verification endpoint. A browser callback only asks the server to reconcile.
3. The unique capture is bound to an immutable mint intent. `CaporaUSD.mintOnce` binds that intent to a recipient and exact integer amount on chain. The UI reports availability only after a successful canonical receipt, required confirmations and matching token commitment. Concurrent/replayed requests cannot mint twice.
4. Paid capabilities reserve the existing integer-cent daily budget, then fund `PurchaseEscrow` from the buyer's wallet. A provider's wallet receives the net cUSD and the treasury receives the snapshotted fee after Capora attests fulfillment. **PayPal is never charged for new capability purchases.** Old PayPal receipt identifiers remain historical data.
5. Bank capabilities have no extra catalog service charge. Their quote's amount is the policy exposure of the proposed transfer/investment/loan/chit commitment. The actual principal moves only through that bank operation. Contract management fees, market spreads, loan interest and chit commission are separate disclosed terms. Bank reads have zero service fee and no chain transaction.
6. Funds hold investor assets on chain. ERC-4626 shares use OpenZeppelin's virtual asset/share defense. NAV values actual cUSD cash plus actual cRISK positions at the controlled test-market price. Redemptions are limited to available cUSD; the manager must unwind positions before larger withdrawals. Management fees issue shares to the configured recipient.
7. Lending uses deposited cUSD, never borrow-triggered minting. Debt, collateral and repayment are on chain. Chits hold bonds, installments, collateral and claimable payouts on chain. D1 is an index and workflow store, not a token ledger.

The trusted executor constructs typed calls from owned, policy-checked requests. Models never receive signing keys or a raw transaction tool. Privy holds the executor key; Workers uses app credentials from secret bindings. Per-agent wallets are custodial smart accounts controlled by this executor, rather than independently exportable user keys. Capora's account/session ownership is the user authorization boundary. `AgentWallet` prohibits delegatecall and only permits registered contract methods; its own operation IDs are single use.

This MVP trusts Capora's settlement attestor to verify provider fulfillment and its price administrator to maintain the disclosed artificial test-market price. It does not claim decentralized verification or production-grade oracle economics. The administrator can pause escrow, the lending guardian can pause new borrowing, and an owner-approved fund control action can pause trading/subscriptions. Existing investors retain withdrawal rights subject to liquidity.

## Contracts and economics

| Contract                        | Role and limits                                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CaporaUSD`                     | Six-decimal demo token, role-restricted replay-safe minting, 1,000 cUSD maximum per mint intent.                                                                                         |
| `TestCollateral`                | Separate six-decimal cRISK test token; not redeemable cUSD.                                                                                                                              |
| `WalletFactory` / `AgentWallet` | One identity per account; method allowlists; bounded per-action approvals; transaction replay defense.                                                                                   |
| `PurchaseEscrow`                | Immutable purchase terms; fee capped at 1,000 bps; explicit funded/executing/released/refunded/disputed states; no duplicate release.                                                    |
| `TestMarket`                    | Actual two-token inventory transfers; disclosed artificial price; 30 bps swap fee; one-hour price expiry; maximum 20% price change per admin update.                                     |
| `ManagedFund`                   | Annual management fee up to 500 bps; maximum allocation up to 80%; per-trade/daily trading/loss limits; on-chain daily analytics expense limit; slippage/deadline checks.                |
| `LendingPool`                   | Initial LTV ≤50%; liquidation threshold 65%; 8% simple annual interest; Bank spread 20% of paid interest; liquidation incentive ≤5%; one-day maturity grace; 128-loan demo lifetime cap. |
| `PublicChit`                    | Public groups of 2–24 distinct registered wallets; one round per member; commit/reveal highest discount auction; discount cap ≤40%, commission ≤5%; no repeated winners.                 |
| `BankFactory`                   | Registered agents create funds/chits; deployer contracts keep all runtime bytecode below the EVM contract size limit.                                                                    |

Lending NAV includes net accrued interest and outstanding principal. In a collateral shortfall, liquidation recognizes the bad debt against depositor assets; it does not invent replacement liquidity. Fresh prices are required for borrowing, health-sensitive collateral withdrawal and liquidation. Repaying debt and retrieving collateral after full repayment remain possible with a stale oracle. A bounded loop over at most 128 loan records keeps the demo's interest accounting auditable.

A chit requires one installment as a cUSD participation bond. An early winner must post cRISK worth **150% of the remaining installments** before receiving a prize. Immutable terms include group size, installment, maximum discount, commission, contribution/commit/reveal/grace durations and join deadline. There is no extra default penalty (0 bps); the enforceable obligation is the missed installment. Durations can be minutes.

Round arithmetic is exact: `pool = members × installment`; `payout = pool − winning discount − commission`; `dividend per member = floor(discount / members)`. The organizer earns the commission and the disclosed platform treasury earns the integer remainder. Highest discount wins; equal discounts use join order. If no valid bid is revealed, the first non-winning adequately secured member receives the zero-discount prize. Missing installments or security pause finalization. After the contribution grace period, permissionless recovery uses the member's bond, then only enough collateral to cover the missed installment through the test market. Partial recovery remains bond credit until the obligation can be completed; residual shortfall remains visible. No administrator can confiscate arbitrary member assets. Bonds/security can exit only after all rounds complete or an unfilled group is canceled after its join deadline.

## Local setup and verification

Requires Node 22.12+ and pnpm. No blockchain private key is required locally. The local RPC wrapper deliberately avoids Hardhat CLI key printing.

```sh
pnpm install
pnpm setup:local
pnpm bank:build
```

In terminal 1:

```sh
pnpm bank:node
```

In terminal 2:

```sh
pnpm bank:deploy:local
pnpm bank:configure:local
pnpm dev
```

The last configuration command updates only the local Bank bindings and preserves existing local secrets. Sign in using the existing local account setup, open `/bank`, provision an agent wallet, set the desired financial limits, then use the action forms. The normal local application has **no fake PayPal capture endpoint**. Its top-up form needs actual Sandbox credentials and a Sandbox buyer approval. For repeatable credential-free integration proof, use the isolated automated suite below, which explicitly replaces PayPal and the planner with test doubles while executing the actual contracts.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:browser
```

`pnpm test` builds contracts/ABIs, runs Solidity tests (including 256 escrow fuzz cases), builds the web app/Worker and runs all Vitest suites. `tests/bank-chain.test.ts` starts its own fresh local EVM on port 8546, deploys the actual contracts, creates an isolated Miniflare D1/Queue environment and exercises authenticated APIs through the deployed bytecode. It does not reuse developer balances, credentials or the local database. PayPal capture/signature verification and AI responses are explicit isolated test doubles. These results are local proof, not hosted Base Sepolia or real PayPal Sandbox proof.

The generated TypeScript ABIs in `packages/bank/src/abis.ts` are checked in; regenerate with `pnpm bank:build`. D1 migrations `0008` and `0009`, matching Drizzle models/snapshots and the existing catalog seed are included. `pnpm db:generate` should find no schema changes.

## Base Sepolia setup

No Base Sepolia addresses are checked in as if deployed. `packages/bank/deployments/base-sepolia.json` explicitly starts as `not_deployed`. Local deployment addresses and receipts go into ignored `.local/bank-local.json`; local EVM hashes do not get misleading Base Sepolia explorer links.

1. Create a Privy server wallet owned by the application. This implementation uses Privy's HTTPS REST API because Workers can use it without loading a browser SDK or storing raw private keys. Configure the app's policy for **only `eip155:84532`**, zero native transfer value, the executor's deployed contracts and permitted selectors. A separate request-signature setup is necessary if you choose a wallet owner requiring authorization signatures; the app-owned server wallet path here uses app authentication.
2. Fund the executor with **test ETH** using the [Base testnet faucet guidance](https://docs.base.org/base-chain/tools/network-faucets). The backend explicitly reports `TEST_ETH_REQUIRED` when it cannot sponsor gas. It does not purchase gas or mainnet assets.
3. Set process environment variables `BANK_RPC_URL`, `BANK_EXECUTOR_ADDRESS`, `BANK_TREASURY_ADDRESS`, `BANK_ADMIN_ADDRESS`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID` and a unique `BANK_DEPLOY_RUN_ID`. Choose a separately secured administrator address, distinct from the runtime executor. The script uses temporary executor authority during deployment, then transfers administrator roles and renounces the bootstrap grants. Never paste key material into a command, prompt or repository.
4. Run `pnpm bank:build`, then `pnpm bank:deploy:sepolia`. Retry a deployment only with the **same run ID and inputs**. The script checks chain ID, deploys contracts, sets method allowlists, initializes the controlled test-market price and seeds its actual inventory. It writes real deployment addresses, transaction receipts and the start block to `.local/bank-sepolia.json`.
5. Verify the recorded configuration receipts: the script grants `DEFAULT_ADMIN_ROLE` on cUSD/cRISK, WalletFactory, TestMarket and PurchaseEscrow to `BANK_ADMIN_ADDRESS`, then the bootstrap executor renounces those admin roles. The executor keeps only its explicit minter/attestor/executor authority. The lending guardian is the separately secured administrator address. Check each `hasRole` result before enabling Bank; retain all transfer receipts. This is a demonstration custody scheme, not an audit.
6. Store `.env.example`'s named secrets through Wrangler secret bindings, never in checked-in vars. `BANK_DEPLOYMENT` is the deployment object from the receipt file; `BANK_RPC_URL` is the configured testnet RPC; `BANK_ENABLED=true` activates chain settlement. Set the explicit marketplace fee bps. Contract addresses can also be treated as non-secret configuration, but RPC credentials must remain secret. No frontend `VITE_*` secret is used.
7. Configure PayPal Sandbox app credentials, a Sandbox buyer and a webhook endpoint at `/api/bank/paypal/webhook`; save `PAYPAL_WEBHOOK_ID`. Subscribe to order/capture completion and capture refund/reversal events. Approve a real $20 Sandbox top-up in the UI, then reconcile it. Confirm the real capture ID, token commitment, successful mint receipt and **20 cUSD** on the actual Base Sepolia wallet.
8. Apply the existing remote release process only when release is authorized: migrate D1, deploy the Worker/web assets and sync the catalog. The Bank code has not automatically deployed or changed remote resources. Existing remote secrets are not proof that the new Bank secrets exist.

For collateral demos, mint cRISK to participating agent wallets using the authorized test-token minter. Such faucet allocations must be disclosed separately from PayPal-backed cUSD top-ups. Keep the artificial price fresh with the administrator's `TestMarket.setPrice` call; the runtime never silently refreshes or fabricates a market price. Public DEX depth is not assumed: this implementation deliberately deploys its own labeled inventory market for deterministic demo trading, rather than claiming public production liquidity.

Privy API details were checked against its [send transaction reference](https://docs.privy.io/api-reference/wallets/ethereum/eth-send-transaction) and [idempotency documentation](https://docs.privy.io/api-reference/idempotency-keys). Provider idempotency lasts 24 hours; the outbox stops uncertain automatic submissions after 23 hours. Broadcast acceptance is not treated as confirmation. The application waits for three canonical confirmations on Base Sepolia, one on the isolated local EVM.

## AI manager setup

Set server-only `BANK_PLANNER_API_KEY` and an explicitly selected `BANK_PLANNER_MODEL`. The Anthropic Messages API returns a typed proposal through a tool schema. No transaction or secret is included in the model's tool surface. An owner must enable each fund's schedule and explicitly choose its interval (at least five minutes), model-call cap (1–24 per UTC day) and analytics capability allowlist. These real model API calls may incur provider charges, separate from simulated cUSD. No calls occur while disabled or without configuration.

The planner may hold, propose a bounded rebalance or buy one allowed analytics capability. Rebalances go through `createQuote → purchaseQuote → invokeCapability`. Analytics use the same provider quote, purchase, execution and escrow path, but `ManagedFund.buyIntelligence` funds escrow directly from the vault under its immutable daily operating budget. That cash outflow reduces NAV; refunds return to the fund. Quotes still reserve the manager's overall daily/per-operation budget and above-threshold requests wait for owner approval. Contract trade, price, allocation, loss and expense limits remain authoritative. Reports include the proposal, explanation, purchase/invocation identifiers and transaction-linked result; malformed model output fails closed.

Manual eligible triggers and strategy configuration are available from the fund detail screen. The scheduled keeper executes at most three eligible strategies per tick. Revoked managers, interval exhaustion, exhausted call budgets and stale prices prevent execution. The local suite mocks model output; a live model-provider run remains a separate integration check.

## Failure handling and recovery

The existing public purchase status `purchased` remains the executable entitlement for compatibility. `bank_escrows` adds the detailed financial lifecycle: `approved → escrow_funded → executing → fulfilled → released`, or failure/refund/manual review. Provider results commit before release. A delayed release cannot repeat provider execution. At-least-once queue delivery uses a conditional invocation claim; ambiguous running-provider interruption consumes the invocation and goes to manual review instead of blindly rerunning a third party.

An uninvoked funded purchase can refund after its immutable one-hour deadline. A known provider failure refunds an executing escrow through the attestor. An unknown timeout/outcome becomes disputed/manual review. A successful result remains successful while settlement retries. The escrow administrator can return a disputed purchase to the attested resolution path; recipients and amounts cannot be changed. A partial external fulfillment is not automatically called a refund-worthy failure.

The transaction outbox persists the target, calldata and commitment before signing; its unique IDs, leases, contract operation IDs and chain state prevent duplicate money movement. Pending receipts never count as success. The keeper reconciles pending sends, top-ups, releases/refunds, expired escrows and eligible chit finalizations. An event indexer reads confirmed logs with an overlap, removes orphaned overlap events and audits canonical block hashes. Detected reorgs flag affected projections for manual review. Wallet balances are always read from the current chain.

An uncertain local RPC send is not automatically rebroadcast. To recover a known submitted transaction, the owner can POST `{ "txHash": "ACTUAL_HASH" }` to `/api/bank/transactions/INTENT_ID/recover`. The server checks chain, signer, target, exact calldata and zero native value against the stored intent, then reconciles its receipt. An arbitrary transaction hash cannot satisfy another signing intent. A managed-signature error with a cached response is preserved for investigation; no automatic switch to a fresh key risks a duplicate action.

A PayPal refund/reversal flags the top-up for manual reconciliation. Already transferred tokens are never silently unminted. A dispatched transaction may still confirm after an external reversal; that cross-system limitation is disclosed, preserved in the receipt/audit history and requires operator handling. There is no PayPal cash-out or real-money recovery promise.

## Judge demo script

1. Show the existing marketplace and SD-Artifacts entry, then filter **Capora Bank** to inspect machine-readable schemas through the same MCP tools.
2. Create two agents, show distinct wallet addresses and owner-controlled overall/financial limits. Copy an address. Show TESTNET / SIMULATED FUNDS.
3. Complete a $20 real PayPal Sandbox top-up when configured. Reconcile it twice and replay the signed event: show the same capture/mint intent and unchanged 20 cUSD balance. For credential-free presentation, explicitly label the automated PayPal double and show its exact once-mint assertion instead of claiming live payment proof.
4. Quote/purchase/invoke Document Fingerprint (real computation), or SD-Artifacts with configured provider credentials. Show buyer escrow, one invocation, seller net receipt and treasury fee. Demonstrate a known failure refund and an above-threshold owner approval.
5. Create a fund with disclosed risk/fee/expense terms, invest from the second agent and show shares. Make an actual controlled test-market swap; show cRISK position, current NAV and the transaction. Unwind and redeem; show a liquidity rejection if requesting more than cUSD cash.
6. Supply lending liquidity, post cRISK collateral, borrow cUSD, partially/fully repay, and return collateral. Show stale-price/undercollateralization rejection and the liquidation/insolvency tests.
7. Create a public two-member accelerated chit: 60-second contribution period, 30-second commit and reveal periods, 30-second grace. Join with bonds/security, contribute, commit two discounts with saved salts, reveal, finalize, and show the higher-discount winner plus exact dividend/commission arithmetic. Continue the second round, show the other winner, claim, then return bonds/security.
8. Show missing-contribution/security blocks and bond/collateral recovery tests. Complete the composed flow: claim provider earnings into an owned agent, invest a portion, and purchase another external capability with the remainder.
9. Enable a bounded AI strategy only with explicitly configured model credentials/call caps. Show a hold/rebalance proposal or permitted analytics purchase, operating expense, policy decision and traceable receipt. Use the automated proposal double when a live API key is unavailable, clearly labeled.

## Verification boundary and limitations

The implementation includes working local vertical slices and adversarial/fuzz tests, not an audit. Hosted Base Sepolia deployment, Privy custody/policies, actual Sandbox capture/webhook verification, public faucet funding and a real planner response require credentials and independent hosted checks. This task did not invent or publish deployment addresses. The external-provider implementations, especially SD-Artifacts, remain in the established registry and retain their existing credential requirements.

The artificial market is not a production oracle or AMM. Prices are operator controlled, non-cUSD allocations are bounded, and withdrawals require liquid cash. Loans deliberately have a small bounded demo capacity. Chit defaults with inadequate bond, collateral or market inventory pause the affected round and expose shortfall; there is no bailout, unsecured credit, private chit or lottery. Custody, oracle administration and settlement attestation are centralized trust assumptions. No production banking, insurance, market-return or real USD claim is made.
