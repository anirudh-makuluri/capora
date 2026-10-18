# Admin dashboard

Sign in normally and open **Admin dashboard** in the sidebar, or visit `/admin`.
The Worker checks the signed-in account's email against server-only `ADMIN_EMAILS` on every admin API request. Matching ignores case and surrounding whitespace; comma, semicolon and whitespace separators are supported. Missing or empty configuration grants nobody admin access. Agent tokens cannot administer the marketplace. The browser receives only its own `isAdmin` flag, never the configured email list.

## Accounts and configuration

Keep `ADMIN_EMAILS` in `apps/worker/.dev.vars` locally. For the hosted Worker, set a secret named `ADMIN_EMAILS` separately; local `.dev.vars` is not deployed. Only approve accounts whose ownership you have checked. Removing an email revokes its admin access on subsequent API requests, including requests from an existing session.

Public signup reserves configured admin addresses because email verification is not enabled. Existing approved accounts can sign in with their current passwords. For an unused address, create an ignored `.local/admin-account.json` file with `email`, `name` and a password of 12–128 characters. Run:

```sh
pnpm auth:provision-admin -- --file .local/admin-account.json
```

Use `--remote` only when provisioning the deployed database is intended. This creates a new account without changing existing users or passwords. Delete the credential file after provisioning. The existing `auth:bootstrap-owner` command remains the way to claim the seeded owner's workspace and data.

## Approved hostnames

Enter exact public DNS hostnames, one per line, and save. URLs, wildcard domains, paths, ports, IP literals and private hostname suffixes are rejected. Verify provider ownership and public DNS before granting approval. Approval is operator trust; this feature does not automatically verify domain ownership.

Until the first save, the Worker uses `PROVIDER_ALLOWED_HOSTS` from its environment. Saving creates an authoritative D1 setting that survives deployments. A saved empty list blocks all external providers, even if the environment still contains hosts. Built-in capabilities, protected demos and owned R2 datasets use their existing validation paths. Both provider registration and invocation read the current setting without an in-memory cache. Revocation blocks subsequent validation; it cannot cancel a request already sent upstream.

Removing hosts requires confirmation because existing capabilities on them will fail execution. Concurrent saves use a revision check; reload the list after a conflict before reapplying changes.

## Capabilities

Admins can list capabilities across all providers, add a capability under an existing provider and remove or restore a listing. Create a provider profile in the Provider console if needed. Registration uses the same schema, endpoint and encrypted-credential checks as provider registration; R2 datasets must belong to the selected provider's workspace. Credentials are never returned in the listing.

Removal disables discovery, quoting, purchases and new execution while preserving records, receipts and results. Provider updates cannot bypass an admin removal, and catalog synchronization preserves removal state. Restoring revalidates the endpoint and increments the capability version; old quotes are invalidated. Removing or restoring listings does not refund payments. Resolve any already-paid, unexecuted purchases through operator support.

Host changes, capability additions, removals and restorations record the acting admin in activity history. Apply migration `0007_admin_dashboard.sql` before running the updated Worker.
