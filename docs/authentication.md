# Email and password accounts

Capora uses Better Auth in the Hono Worker with its Drizzle adapter and the existing D1 database. React signs up at `/api/auth/sign-up/email`, signs in at `/api/auth/sign-in/email`, and signs out at `/api/auth/sign-out`. `/api/auth/session` supplies the current Capora user and payment mode.

Passwords require 12–128 characters and use Better Auth's salted scrypt hashing. Sessions live in D1, expire after 12 hours, and use HttpOnly, SameSite=Lax cookies with Secure enabled on HTTPS. Logout deletes the session; an old cookie no longer authorizes requests. Auth rate limits use atomic D1 counters, not isolate memory. Scheduled recovery removes expired auth sessions, verification records, and rate counters.

Each signup creates a new user with an empty workspace. Existing ownership checks scope agents, approvals, purchases, providers, datasets, and saved billing to that user's ID. Agent/MCP bearer tokens continue to work independently. No localhost human-login bypass remains; `DEV_MODE` only controls local demo/provider behavior.

Email verification, recovery email delivery, social login, and shared team memberships are not configured in this version. Email is a login identifier, not a verified ownership claim. Do not use it as proof of ownership or automatically associate new signups with existing user data.

## Local development

Run `pnpm setup:local`, then `pnpm dev`. Sign in at `/login` with `demo@capora.local` and the `dashboardPassword` in ignored `.local/credentials.json`. That legacy credential-file field now represents this individual account's password. Local seeding creates a credential for the existing seeded owner without overwriting an existing credential. Browser tests sign in normally; new signup accounts do not inherit demo data.

## Preserve the existing deployed owner

Migration `0003` adds authentication tables and user metadata without deleting or reassigning existing data. It does not turn the old shared password into a public account. Existing `capora_session` cookies are invalid after upgrading. Normal signup cannot claim an existing user's ID or email.

To give the existing `user_demo` owner an account, create an ignored `.local/owner-account.json` containing `email`, `name`, and a unique `password` of 12–128 characters. After the remote migration, run:

```sh
pnpm auth:bootstrap-owner -- --file .local/owner-account.json --remote
```

This operator-only CLI adds a credential to `user_demo` and updates its email/name, preserving its agents, providers, purchases, and encrypted billing method. It refuses to overwrite an existing credential. Without `--remote`, it targets local D1. Credentials and SQL are not printed; temporary SQL is deleted. Store or remove the input file securely after provisioning. Use an email that has not already signed up.

New accounts can sign up immediately after deployment without owner provisioning. `SESSION_SECRET` is reused as Better Auth's server secret; `DASHBOARD_PASSWORD` and `DASHBOARD_USER_ID` are no longer used. Keep `ENCRYPTION_KEY` stable to preserve existing encrypted credentials.

## Workers Free verification

The Worker bundle uses Better Auth's native `node:crypto` scrypt implementation with `nodejs_compat`. Local workerd tests verify the hash, sessions, logout, expiry, rate limits, and account isolation. A separate hosted Worker with an isolated D1 database passed signup, five consecutive logins, session/dashboard reads, and logout revocation on October 3, 2026; the temporary resources were then deleted. No plan upgrade or reduced hash cost was configured.

The hosted trace reported 86–141 ms CPU for hashing requests, above the documented Workers Free 10 ms limit, despite successful responses. This smoke test establishes functionality, not reliable behavior under sustained Free-tier load. Account subscription details were unavailable to the CLI credentials. Do not weaken password hashing to meet a CPU limit; evaluate deployed resource-limit errors before expanding traffic.

Sources: [Better Auth Hono/Workers integration](https://better-auth.com/docs/integrations/hono), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [email/password authentication](https://better-auth.com/docs/authentication/email-password), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
