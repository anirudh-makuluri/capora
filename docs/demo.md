# Demonstrate real capabilities

Run `pnpm setup:local`, then `pnpm dev`. Sign in with the existing local owner credential. Local payments are simulated; hosted payments remain PayPal Sandbox.

1. Open Marketplace. The six listings describe actual sources and tools, schemas, prices and limits. Open Company Registry Search and inspect its input/output schemas. Its $0.20 price covers live public-data retrieval and normalization.
2. Open Playground and click **Run the research flow**. The scripted client discovers the registry capability, quotes `{"company":"Microsoft","limit":5}`, purchases under the default $0.50 automatic threshold and invokes the live GLEIF adapter.
3. Inspect the returned entity records. Results include actual legal names and LEIs, registration status, source links and retrieval time. Search matches require further identity resolution and do not imply private employment knowledge. No hardcoded research conclusion is displayed.
4. Click **Request code pattern scan**. Its $3.00 price requires human approval under the default policy. Approve in the playground or Approvals. The queued tool scans the supplied code and returns line-level findings. Explain its three-rule scope and limitations.
5. Open Transactions to inspect receipts and persisted results. Each purchase grants one execution of its quoted input; repeated calls retrieve the same result. A source failure is recorded explicitly and does not fabricate an answer or refund.

If approval/payment is pending for the registry purchase, complete it in Transactions and invoke the existing purchase there. Starting a new run creates a new purchase. Real Sandbox autonomous capture requires an authorized saved PayPal payment method; see [PayPal setup](paypal.md).

For the official MCP client:

```sh
pnpm demo
# Local simulated payments only; auto-approves the second purchase for presentation:
pnpm demo -- --approve
# Creates its own local agent, checks the live source and queue results, then revokes it:
pnpm test:e2e
# Read-only source checks, without purchases or payments:
pnpm exec tsx scripts/verify-real-providers.ts
```

The CLI reads the seeded token from ignored local credentials. After rotating it, set `CAPORA_AGENT_TOKEN` instead. Repeated demos spend the agent's simulated/Sandbox budget. See [real capabilities](real-capabilities.md) for additional examples, licensing and source limits.
