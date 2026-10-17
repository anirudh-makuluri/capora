// Capora's dependency-free connection helper. Requires Node.js 22+.
// Credentials stay in the user's home directory; only hashes are sent during setup.
/* global fetch, AbortSignal */
import process from 'node:process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, appendFile, chmod, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
export function cents(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error('Enter USD amounts with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount > 100_000)
    throw new Error('Each limit must be between $0 and $1,000.');
  return amount;
}
export function setupInput(values) {
  const name = values.name?.trim();
  if (!name || name.length < 2 || name.length > 80) throw new Error('Use an agent name of 2–80 characters.');
  const input = {
    name,
    dailyBudgetCents: cents(values['daily-budget']),
    autoApproveCents: cents(values['auto-approve']),
    maxTransactionCents: cents(values['max-transaction']),
  };
  if (
    input.autoApproveCents > input.maxTransactionCents ||
    input.maxTransactionCents > input.dailyBudgetCents
  )
    throw new Error('Limits must satisfy: auto-approval <= maximum per purchase <= daily budget.');
  return input;
}
export function baseUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use the Capora origin without a path, credentials, query or fragment.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use HTTPS, or HTTP on localhost for development.');
  return url.origin;
}
export async function configureCodex(state, connection, configFile) {
  const serverName = `capora_${connection.slice(0, 8)}`;
  const section = `[mcp_servers.${serverName}]`;
  const block = `${section}\nurl = ${JSON.stringify(`${state.base}/mcp`)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${state.token}`)} }\n`;
  await mkdir(dirname(configFile), { recursive: true, mode: 0o700 });
  const lockFile = `${configFile}.capora-lock`;
  const lock = await open(lockFile, 'wx', 0o600);
  try {
    let existing = '';
    try {
      existing = await readFile(configFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing.includes(section)) {
      if (!existing.replaceAll('\r\n', '\n').includes(block))
        throw new Error(
          'A connection with this name already exists with different settings. Keep it and choose a new agent name.',
        );
    } else {
      await appendFile(configFile, `\n# Capora connection ${connection}\n${block}`, { mode: 0o600 });
    }
    await chmod(configFile, 0o600);
    return {
      status: 'configured',
      serverName,
      configFile,
      next: 'Restart Codex or start a fresh session, then call get_budget through its Capora MCP tools. No purchases were made.',
    };
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}
async function api(base, path, body, headers = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error?.message ?? `Connection request failed (${response.status}).`);
  return result;
}
async function readState(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
async function save(path, state, exclusive = false) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
}
async function verify(state) {
  async function rpc(method, params) {
    const response = await fetch(`${state.base}/mcp`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${state.token}`,
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const result = await response.json();
    if (!response.ok || result.error || result.result?.isError)
      throw new Error('MCP verification failed. Check the connection or revoke this agent in Capora.');
    return result.result;
  }
  await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'capora-connect', version: '1.0.0' },
  });
  const tools = await rpc('tools/list', {});
  const expected = [
    'search_capabilities',
    'get_capability',
    'get_quote',
    'purchase_capability',
    'invoke_capability',
    'get_job',
    'get_budget',
    'get_purchase_status',
  ];
  if (!expected.every((name) => tools.tools?.some((tool) => tool.name === name)))
    throw new Error('Capora did not expose the expected marketplace tools.');
  const result = await rpc('tools/call', { name: 'get_budget', arguments: {} });
  const budget = result.structuredContent?.result ?? JSON.parse(result.content[0].text);
  const input = state.input;
  if (
    budget.dailyBudgetCents !== input.dailyBudgetCents ||
    budget.autoApproveCents !== input.autoApproveCents ||
    budget.maxTransactionCents !== input.maxTransactionCents ||
    !budget.autonomousEnabled
  )
    throw new Error('The created policy does not match your requested limits.');
  return { tools: tools.tools.map((tool) => tool.name), budget };
}

export async function main(args = process.argv.slice(2)) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'base-url': { type: 'string' },
      name: { type: 'string' },
      'daily-budget': { type: 'string' },
      'auto-approve': { type: 'string' },
      'max-transaction': { type: 'string' },
      connection: { type: 'string' },
      'config-file': { type: 'string' },
    },
  });
  const command = positionals[0];
  const home = resolve(process.env.CAPORA_HOME ?? join(homedir(), '.capora'));
  if (command === 'start') {
    const base = baseUrl(values['base-url']);
    const input = setupInput(values);
    // Repeating setup with the same answers resumes it, including after a lost HTTP response.
    const connection = sha(JSON.stringify({ base, input })).slice(0, 24);
    const path = join(home, 'connections', connection, 'state.json');
    let state;
    try {
      state = await readState(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = {
        base,
        input,
        token: `cap_${randomBytes(32).toString('base64url')}`,
        deviceCode: `setup_${randomBytes(32).toString('base64url')}`,
      };
      await save(path, state, true);
    }
    if (state.agentId) {
      output({
        status: 'connected',
        connection,
        agentId: state.agentId,
        next: 'This agent already exists. Run finish with this connection to verify and configure it.',
      });
      return;
    }
    const request = await api(base, '/connect', {
      ...input,
      tokenHash: sha(state.token),
      deviceCodeHash: sha(state.deviceCode),
    });
    state.request = request;
    await save(path, state);
    output({
      connection,
      ...request,
      next: 'Ask the user to open verificationUrl and compare userCode. Then run finish with this connection.',
    });
    return;
  }
  if (
    !['finish', 'headers', 'configure-codex'].includes(command) ||
    !/^[a-f0-9]{24}$/.test(values.connection ?? '')
  )
    throw new Error('Use start with the four preferences, or finish/headers --connection CONNECTION.');
  const path = join(home, 'connections', values.connection, 'state.json');
  const state = await readState(path);
  if (command === 'configure-codex') {
    if (!state.agentId) throw new Error('Finish the connection before configuring Codex.');
    const configFile = resolve(
      values['config-file'] ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'),
    );
    output(await configureCodex(state, values.connection, configFile));
    return;
  }
  if (command === 'headers') {
    if (!state.agentId) throw new Error('Finish the connection before using its credentials.');
    // This mode is for the MCP client's credential helper, never for chat output.
    output({ Authorization: `Bearer ${state.token}` });
    return;
  }
  const status = state.agentId
    ? { status: 'approved', agentId: state.agentId }
    : await api(state.base, '/connect/status', {}, { Authorization: `Bearer ${state.deviceCode}` });
  if (status.status !== 'approved') {
    output({
      status: status.status,
      connection: values.connection,
      message:
        status.status === 'denied'
          ? 'The user declined this connection. No agent was created.'
          : 'Awaiting account authorization. Do not create another request.',
    });
    return;
  }
  const verification = await verify(state);
  state.agentId = status.agentId;
  await save(path, state);
  const helper = join(dirname(path), 'connect.mjs');
  const source = fileURLToPath(import.meta.url);
  if (resolve(source) !== resolve(helper)) await copyFile(source, helper);
  output({
    status: 'connected',
    connection: values.connection,
    name: state.input.name,
    agentId: state.agentId,
    endpoint: `${state.base}/mcp`,
    serverName: `capora_${values.connection.slice(0, 8)}`,
    credentialsFile: path,
    helperPath: helper,
    ...verification,
    next: 'Configure this MCP connection in your client. No purchases were made. A client restart may be required.',
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Capora: ${error.message}\n`);
    process.exitCode = 1;
  });
}
