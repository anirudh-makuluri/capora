# Deploy Capora to Cloudflare Workers

The source is deployable as one Worker with static web assets, D1, R2, a queue producer/consumer, and a scheduled handler. Local `.dev.vars` are not deployment secrets.

## 1. Authenticate and provision

Run from the repository root:

```sh
pnpm --filter @capora/worker exec wrangler login
pnpm --filter @capora/worker exec wrangler whoami
pnpm --filter @capora/worker exec wrangler d1 create capora-db
pnpm --filter @capora/worker exec wrangler r2 bucket create capora-artifacts
pnpm --filter @capora/worker exec wrangler queues create capora-invocations
pnpm --filter @capora/worker exec wrangler queues create capora-invocations-dlq
```

Use your intended account. Check account availability/billing for R2 and Queues before provisioning. Capora does not call paid model APIs or need a VM/Kubernetes cluster.

## 2. Configure the deployed Worker

Edit `apps/worker/wrangler.jsonc`:

- Replace the all-zero local `database_id` with the ID returned by `d1 create`.
- Set `CAPORA_BASE_URL` to the final HTTPS Worker/custom-domain URL, without a trailing slash.
- Keep `DEV_MODE=false`, `PAYMENT_MODE=sandbox`, and `PAYPAL_ENVIRONMENT=sandbox`.
- Set `DASHBOARD_USER_ID=user_demo` for the seeded workspace.
- Populate `PROVIDER_ALLOWED_HOSTS` only with exact, trusted public HTTPS provider hostnames. Empty means only protected built-in demos and owned R2 datasets can execute.

The root configuration is the canonical sandbox deployment. For multiple environments, duplicate bindings/vars using Wrangler environments and provision distinct D1/R2/Queue resources; Wrangler does not inherit these bindings across environments.

## 3. Configure secrets

Use interactive prompts; never put secret values in commands, source files, or frontend variables:

```sh
pnpm --filter @capora/worker exec wrangler secret put DASHBOARD_PASSWORD
pnpm --filter @capora/worker exec wrangler secret put SESSION_SECRET
pnpm --filter @capora/worker exec wrangler secret put ENCRYPTION_KEY
pnpm --filter @capora/worker exec wrangler secret put DEMO_PROVIDER_SECRET
pnpm --filter @capora/worker exec wrangler secret put PAYPAL_CLIENT_ID
pnpm --filter @capora/worker exec wrangler secret put PAYPAL_CLIENT_SECRET
```

Use a unique workspace password with at least 16 characters and independently generated random secrets with at least 32 characters for session/encryption/provider authentication. `ENCRYPTION_KEY` protects stored provider credentials and saved PayPal tokens; keep it stable and securely backed up. Rotating it without re-encryption makes existing credentials unreadable. Rotate `SESSION_SECRET` to invalidate human sessions.

## 4. Migrate, seed, build, deploy

```sh
pnpm --filter @capora/worker exec wrangler d1 migrations apply capora-db --remote
pnpm db:seed -- --remote
pnpm cf:types
pnpm typecheck
pnpm lint
pnpm test
pnpm deploy
```

Remote seeding generates a separate random seeded-agent token under ignored `.local/remote-seed-credentials.json`. It preserves existing records. For the deployed demo, create/regenerate a token in My agents and set it in your MCP client’s secret storage. Do not reuse the local agent token or local human credentials remotely.

`pnpm build` includes `wrangler deploy --dry-run`: it checks bundling and asset configuration but cannot confirm remote resources, account permissions, secrets, or PayPal access. `pnpm deploy` performs the actual publication after building.

## 5. Verify the actual deployment

1. Visit `/api/health` and confirm `paymentMode: sandbox`.
2. Open the dashboard. A remote request must require the configured workspace password.
3. Confirm the seeded marketplace loads from remote D1.
4. Create an agent and connect an official MCP client with its token to `https://YOUR_HOST/mcp`.
5. Complete saved PayPal Wallet setup if the merchant supports it, or use standard Sandbox checkout.
6. Make a $0.20 purchase. Confirm the capture ID in both Capora and the PayPal Sandbox merchant dashboard.
7. Invoke DataPulse and inspect the synthetic result and transaction details.
8. Request a $3.00 SecureScan purchase, approve it as the workspace owner, complete payment, and poll the queue job.
9. Confirm $3.20 spent, no leftover reservation, and both provider invocation records.
10. Revoke the agent token and confirm subsequent MCP calls return 401.

Scheduled recovery runs every five minutes in Cloudflare. Wrangler does not auto-trigger cron locally; invoke the local scheduled handler if testing recovery. Use `wrangler tail` for structured events/correlation IDs without payloads or credentials.

Do not describe the deployment or Sandbox transactions as verified until these checks succeed. An expired Cloudflare login or missing PayPal credentials is an external setup requirement, not proof that a configured integration has run.
