# Deploy Capora to Cloudflare Workers

Capora deploys as one Worker with static web assets, D1, R2, a queue producer/consumer, and a scheduled handler. GitHub Actions verifies every push and pull request; once enabled, it deploys successful `main` builds automatically. Local `.dev.vars` are not deployment secrets.

| Application component                                | Cloudflare service                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| React/Vite frontend                                  | Worker static assets, on the same domain as the API                       |
| Hono REST API and authenticated `/mcp`               | Worker `capora`                                                           |
| Workspace, agents, catalog, purchases, audit records | D1 `capora-db`                                                            |
| Datasets and large execution results                 | Private R2 bucket `capora-artifacts`                                      |
| Asynchronous execution                               | Queue `capora-invocations` and dead-letter queue `capora-invocations-dlq` |
| Approval expiry and job recovery                     | Worker cron, every five minutes                                           |

All application hosting and storage run on Cloudflare. Payment processing remains an external PayPal Sandbox integration.

Keep Workers on the **Free** plan. Capora enforces R2 budgets before every app storage call: 100 MB of lifetime byte reservations, 1,000 writes and 10,000 reads per UTC day, and 256 KiB per object. Exhaustion pauses storage instead of increasing spend. See [usage safeguards](usage-limits.md) for the owner usage endpoint, kill switch, account-wide limitations, and supplementary $1 projected-spend alert.

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
- Set `CAPORA_BASE_URL` to the final HTTPS Worker/custom-domain origin, without a trailing slash. For a first launch, use `https://capora.YOUR_SUBDOMAIN.workers.dev`; find or register your Workers subdomain in the Cloudflare dashboard. You can add a custom domain later.
- Keep `DEV_MODE=false`, `PAYMENT_MODE=sandbox`, and `PAYPAL_ENVIRONMENT=sandbox`.
- Set `DASHBOARD_USER_ID=user_demo` for the seeded workspace.
- Populate `PROVIDER_ALLOWED_HOSTS` only with exact, trusted public HTTPS provider hostnames. Empty means only protected built-in demos and owned R2 datasets can execute.

The root configuration is the canonical sandbox deployment. For multiple environments, duplicate bindings/vars using Wrangler environments and provision distinct D1/R2/Queue resources; Wrangler does not inherit these bindings across environments.

Run `pnpm deploy:check` before remote operations. It rejects the placeholder database ID, local/invalid origins, local demo authentication, and non-Sandbox payment settings. Keep public settings in this version-controlled config: routine Wrangler deploys replace plain variables with the config values. The deployment checker and remote migration script currently target this root environment only.

To add a custom domain, configure a Workers Custom Domain for `capora`, update `CAPORA_BASE_URL` to that exact origin, and deploy. Use that origin for the dashboard, MCP clients, and PayPal return/cancel callbacks. Initial domain setup needs access to its Cloudflare zone; routine Worker deployments do not need to manage DNS.

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

Use deployment-specific secrets instead of copying the local demo credentials. These prompts can create the Worker before its first full deployment. `pnpm deploy:check -- --secrets` lists secret names to check presence; it cannot inspect their values or verify PayPal credentials. Future deployments preserve Worker secrets and do not rotate them.

## 4. Migrate, seed, build, deploy

```sh
pnpm deploy:check -- --secrets
pnpm db:migrate:remote
pnpm db:seed -- --remote
pnpm cf:types
pnpm typecheck
pnpm lint
pnpm test
pnpm deploy
```

Remote seeding generates a separate random seeded-agent token under ignored `.local/remote-seed-credentials.json`. It preserves existing records. For the deployed demo, create/regenerate a token in My agents and set it in your MCP client’s secret storage. Do not reuse the local agent token or local human credentials remotely.

`pnpm build` includes `wrangler deploy --dry-run`: it checks bundling and asset configuration but cannot confirm remote resources, account permissions, secrets, or PayPal access. `pnpm deploy` checks config and secret names, builds, publishes, and runs read-only smoke checks. Run `pnpm db:migrate:remote` separately before a manual deployment that introduces migrations.

Seeding is a one-time bootstrap step, never part of automated deployments. Keep seeded-agent credentials in secret storage, or revoke/regenerate the token through My agents once you sign in. Automated deployments preserve users, agent tokens, payment tokens, and history.

## 5. Enable automatic deployments

The workflow in `.github/workflows/ci.yml` runs type checks, lint, unit/Worker integration tests, and browser tests. The deployment job depends on the verification job for the **same commit**. Pull requests and non-`main` pushes never deploy.

After the first deployment and bootstrap succeed:

1. Create a GitHub environment named `production` in this repository's **Settings → Environments**. Limit its deployment branches to `main`. Leave required reviewers unset if you want deployments to run automatically after checks pass.
2. Create an account-scoped Cloudflare API token for CI. Cloudflare's **Edit Cloudflare Workers** template is a starting point; restrict it to the intended account. For an existing Worker, current Cloudflare roles allow Worker **Editor** access scoped to `capora`. The token also needs D1 write/edit permission because this workflow applies migrations. Queue consumer changes may require Queues edit permission. Provision D1/R2/Queues and configure domains during bootstrap using your login, rather than granting CI broad provisioning/DNS access.
3. Add the following **environment secrets** to GitHub's `production` environment:

   | Secret                  | Value                                               |
   | ----------------------- | --------------------------------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | The CI token, distinct from app/payment credentials |
   | `CLOUDFLARE_ACCOUNT_ID` | The account containing the Worker and resources     |

4. Commit and push the real D1 ID, public base URL, and workflow to `main`. These config values are not secrets.
5. Add a **repository Actions variable** named `CLOUDFLARE_DEPLOY_ENABLED` with value `true` under **Settings → Secrets and variables → Actions → Variables**. This explicit switch keeps deployments disabled until bootstrap is complete.
6. Open **Actions → Verify and deploy Capora → Run workflow**, select `main`, and run once. Every subsequent push/merge to `main` deploys automatically after verification succeeds.

The deploy job installs the locked dependencies, validates settings and Worker secret names, builds the SPA/Worker, applies pending remote D1 migrations, deploys both frontend and backend together, then checks the public site. Versions are tagged with the Git commit SHA. Deploy jobs are serialized and an in-progress deployment is not cancelled by a newer push.

Smoke checks require a successful `/api/health` in Sandbox mode, a nonempty D1 marketplace, 401 responses for unauthenticated dashboard/session/MCP calls, and a working SPA deep link and JavaScript asset. They retry briefly after publication and **do not purchase, capture payments, or invoke providers**. Run them manually with `pnpm deploy:smoke`. A smoke failure marks the workflow failed but does not roll back a published version automatically.

Use backward-compatible D1 migrations: they run before the new Worker is published while the old version still serves traffic. Rename/remove columns in later releases after compatibility has been established. Rolling back Worker code does not roll back database migrations; keep schema compatibility and use D1 recovery deliberately if data recovery is needed. Pause future automatic releases by setting `CLOUDFLARE_DEPLOY_ENABLED=false`.

Use this GitHub workflow as the deployment trigger; leave Cloudflare Workers Builds Git auto-deployment disabled for this same Worker to avoid competing deployments that bypass the verification job.

Sources: [Worker static assets](https://developers.cloudflare.com/workers/static-assets/), [Cloudflare's GitHub Actions setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [Worker roles and scopes](https://developers.cloudflare.com/workers/authorization/workers/), and [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).

## 6. Verify the actual deployment

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
