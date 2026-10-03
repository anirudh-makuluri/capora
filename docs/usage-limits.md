# Cloudflare usage safeguards

Capora runs on Workers Free. Do not upgrade the Workers plan or add paid services without the operator's approval. Workers, D1, and Queues have free-plan limits; exceeding them can make requests or jobs fail. R2 is a usage-billed subscription even when the Worker is on the Free plan, so the application has separate safeguards.

## Enforced R2 limits

| Resource    | Application cutoff                                                                         | Cloudflare's Standard-storage free allowance |
| ----------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Stored data | 100,000,000 bytes (100 MB) reserved across all writes, for the lifetime of this deployment | 10 GB-month per month                        |
| Writes      | 1,000 per UTC day                                                                          | 1 million Class A operations per month       |
| Reads       | 10,000 per UTC day                                                                         | 10 million Class B operations per month      |
| One object  | 256 KiB of UTF-8 JSON                                                                      | Application payload limit                    |

Over a 31-day cycle, the application allows at most 31,000 writes and 310,000 reads. Even an operation that reserves immediately before midnight and finishes just after it leaves substantial headroom. The bucket is private: no public `r2.dev` access, no public custom domain, no CORS policy, no multipart uploads, no migration or replication service, and no transition to Infrequent Access. Writes explicitly select Standard storage.

Every R2 read/write goes through `apps/worker/src/services/storage.ts`. A conditional D1 `UPDATE ... RETURNING` reserves the operation and UTF-8 byte size **before** calling R2. Concurrent requests cannot overrun the budget; the day cannot move backwards during midnight races. If the budget row is missing, blocked, exhausted, or D1 is unavailable, no R2 call is made. ESLint rejects direct bucket access outside this service, so CI blocks accidental new paths that bypass it.

Daily operation counters reset on the first reservation on a new UTC day. **Byte reservations never reset automatically.** Failed/ambiguous writes keep their reservations. Overwriting or externally deleting an object does not release its reserved bytes. These choices overcount usage deliberately and stop earlier rather than risk hidden charges. Uploads, artifact reads, and executions needing R2 can fail when the budget is exhausted; there is no paid fallback or automatic plan upgrade. A provider execution may already have consumed its purchased entitlement before its large result is rejected.

## Inspect or stop storage access

After signing into the workspace, `GET /api/storage/usage` returns today's counts, lifetime byte reservations, the kill-switch state, and the enforced limits. It reads D1 and does not access R2.

For an operator CLI check:

```sh
pnpm --filter @capora/worker exec wrangler d1 execute capora-db --remote --command "SELECT * FROM resource_usage WHERE resource='r2'"
```

To stop **all application R2 access** immediately:

```sh
pnpm --filter @capora/worker exec wrangler d1 execute capora-db --remote --command "UPDATE resource_usage SET blocked=1 WHERE resource='r2'"
```

To resume, change `blocked` back to `0`. This does not clear byte/operation reservations. Never reset reservations to bypass a limit; first reconcile actual bucket storage and account-wide billed usage. Keep this table intact during migrations, seeding, redeployments, and rollbacks.

## Account-wide boundaries

R2's free allowances apply to the entire account. These guards cover Capora's Worker calls, not manual dashboard/CLI/S3 operations, other buckets, other Workers, or administrative changes that bypass this source. Such activity can consume the remaining account allowance. Cloudflare does not provide a documented R2 hard dollar cap; billing alerts are notifications, not shutdown mechanisms.

The Cloudflare account has a `Capora usage safety` budget alert at **$1 projected spend** as a supplementary warning to its configured account recipient. Cloudflare evaluates projections daily; this is not a promise that charges remain below $1 or that a notification arrives before usage is billed. Use the application cutoff as the primary guard and keep outside R2 usage within the shared allowance.

Sources checked October 3, 2026: [R2 pricing and billable operations](https://developers.cloudflare.com/r2/pricing/), [billing alerts](https://developers.cloudflare.com/billing/understand/usage-based-billing/), [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing and free-plan enforcement](https://developers.cloudflare.com/d1/platform/pricing/), and [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/).
