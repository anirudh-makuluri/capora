# Three-minute Capora demo

## Prepare before presenting

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

Open `http://localhost:5173/demo`. Confirm the seeded Acquisition Research Agent is active, has a $25 daily budget, a $0.50 auto threshold, a $10 transaction ceiling, and autonomy enabled. Repeated presentations consume budget; check remaining funds beforehand. Seeding preserves history and does not reset payments.

The local demo uses labeled simulated payments. To demonstrate actual PayPal involvement, configure Sandbox credentials and buyer-authorized saved-wallet billing **before** presenting, then verify the flow in [paypal.md](paypal.md). Standard checkout is supported when saved billing is unavailable, but adds human checkout steps. Never represent local `DEMO-` receipts as PayPal evidence.

## 0:00 — Explain the missing capability

“Our agent is evaluating whether Acme Robotics is expanding into Arizona. Public research does not give it verified private-company employment history. Capora is where it acquires access.”

Show Marketplace: DataPulse costs $0.20, CompanyIntel costs $1.50, with explicit price, schema, latency, and trust signals. Open DataPulse's input schema. Explain that the agent learns an unfamiliar capability at runtime through one MCP broker.

## 0:30 — Buy and execute

In the playground, click **Run the acquisition demo**. The visible trace discovers options, reads the capability, quotes the company/region input, purchases DataPulse under the $0.50 threshold, and invokes it.

Show the result: Acme's Arizona headcount rose from 21 to 38 and the fixture includes 12 open roles. The answer incorporates these signals with the synthetic-data disclaimer. On a real Sandbox setup, inspect the order and capture IDs; locally, point out the simulator badge.

“The agent acquired information it could not manufacture by changing its prompt. Policy permitted the purchase, and provider credentials stayed on Capora.”

## 1:20 — Require the human

Click **Request security analysis**. SecureScan costs $3.00, so the purchase reserves funds and enters `pending_approval`. Show the reason, provider, expected latency, and trust metadata. Click **Approve $3.00**, or approve from Approvals in another tab to demonstrate owner control.

After payment confirmation, the invocation enters the real Cloudflare local queue. The job moves to completed and returns findings from the supplied code fixture, including unsafe `eval` usage. Explain that this is a small demo scanner, not a comprehensive repository audit.

## 2:10 — Show the audit

Open Transactions. Inspect both purchases, payment identifiers, invocation state, latency, and result. My agents shows spending and policy. A fresh agent has **$3.20 spent**, **$21.80 available**, and **$0 reserved**. An agent reused across presentations has its cumulative daily total.

“MCP powers discovery and execution, PayPal Sandbox powers configured payments, and Cloudflare runs the broker, ledger, object storage, and jobs.”

## Official MCP client demonstration

The playground is a scripted REST client of the same services. For protocol evidence, use:

```sh
pnpm demo
```

This connects the official MCP SDK client to `/mcp`, searches, quotes, purchases, invokes DataPulse, then waits for the human to approve SecureScan through the dashboard. `get_purchase_status` and `get_job` poll pending states.

```sh
pnpm demo -- --approve
```

The second command automatically approves only the local simulator scenario. For an isolated assertion-based smoke check that creates and revokes its own agent, run `pnpm test:e2e`. Both scripts read the local seeded token unless `CAPORA_AGENT_TOKEN` is supplied. A regenerated token requires that environment override.

## Recovery

- **Pending payment:** complete Sandbox checkout in Transactions and click Check payment. Unknown outcomes retain reservations until confirmed.
- **Pending approval:** approve/reject as the workspace owner; repeat tool calls return the same purchase.
- **Provider failure:** inspect the failed invocation; a captured purchase is not automatically refunded or replayed.
- **Budget blocked:** use a fresh agent or change policy knowingly before the demo. The broker will not bypass financial limits.
- **Revoked token:** regenerate under My agents and update the MCP client's secret configuration.
