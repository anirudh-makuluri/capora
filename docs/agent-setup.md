# Connect with an agent prompt

Open **Connect an agent** in the workspace header or visit **Developers**, then choose **Copy setup prompt**.
Paste it into a coding agent that can run local commands and configure MCP (for example, Codex).

The prompt asks for the agent name, daily budget, auto-approval threshold and maximum per purchase.
All amounts are USD, at most two decimal places, from $0 to $1,000. Auto-approval must not exceed
the maximum per purchase, which must not exceed the daily budget. Daily budgets reset at midnight UTC.
It does not pick defaults without your answers.

The downloaded `connect.mjs` helper requires Node.js 22+. Your AI client inspects and runs it locally:

```sh
node /path/to/connect.mjs start --base-url https://capora.anirudh-makuluri.workers.dev --name "Research assistant" --daily-budget 5 --auto-approve 0.50 --max-transaction 3
```

The helper generates agent and setup secrets on your computer and sends only SHA-256 hashes to Capora.
Its output contains a connection handle, a browser verification URL and a code, with no secrets.
Open the URL yourself, sign in or create an account, compare the code, review the name and limits,
and choose **Create and connect agent**. This creates an agent and its policy atomically in your account.
Your AI client never needs your account password or browser session. You do not need to create an
agent in the dashboard first. Requests expire after ten minutes; a declined request creates no agent.

After authorization:

```sh
node /path/to/connect.mjs finish --connection CONNECTION_HANDLE
```

This checks the actual MCP tool list and reads the created budget without purchases. It copies the
helper into a stable directory in `~/.capora/connections/`, and returns an endpoint, a distinct server
name and the helper's stable path. For Codex, the prompt runs that helper with
`configure-codex --connection CONNECTION_HANDLE`. It appends a distinct authenticated MCP entry to
the user-level `config.toml`, preserving existing settings and connections, and never prints the token.
This uses the supported static Authorization header setting, without requiring the user to export an
environment variable or relying on a newer credential-helper feature. The config also contains the
token, so keep it private. `--config-file` selects an isolated config for tests. Other clients may
require a different credential mechanism; the prompt checks current client docs.
Local files use private file modes on POSIX; on Windows they inherit the user's home-directory ACLs.
`CAPORA_HOME` overrides the credential directory for isolated testing. Never commit that directory.

Repeating `start` with the same origin and answers resumes the same connection. `finish` can also be
retried without creating another agent or rotating its token. For an expired request, delete only that
connection's local state directory before restarting. Revoke a previously created agent first if you
no longer want it. The helper's `headers` mode outputs the token for the MCP client only; do not run
it into a chat transcript. Disconnect/revoke access under **My agents**.

A fresh client session or restart may be needed to load the tools. A successful helper check does not
prove tools are loaded into the AI chat; verify `get_budget` through the client's actual MCP tools too.
PayPal Sandbox wallet setup remains separate. Connecting does not authorize a wallet or make purchases.

This is Capora's account-linking bootstrap, not an OAuth implementation or a published plugin.
See [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) for current client settings.

## Deployment

Migration `0005_agent_setup.sql`, the Worker routes, the web UI and `connect.mjs` must ship together.
Local tests use disposable D1 and simulated payments. Hosted connection and PayPal end-to-end checks
remain separate verification steps.
