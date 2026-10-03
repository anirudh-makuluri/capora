import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bot,
  Plus,
  ArrowRight,
  KeyRound,
  ShieldCheck,
  Copy,
  Check,
  RotateCw,
  Ban,
  CreditCard,
  Activity,
} from 'lucide-react';
import { money, type Agent, type SpendingPolicy } from '@capora/types';
import { Button, Dialog, Field, CodeBlock, ErrorNotice, Status, Empty } from '../components/ui';
import { api, useAction, useDashboard } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';
export function Agents() {
  const { data, error } = useDashboard();
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Agent>();
  const [newToken, setNewToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [params, setParams] = useSearchParams();
  const billingHandled = useRef(false);
  const client = useQueryClient();
  const add = useAction(async () => {
    const response = await api<{ id: string; token: string }>('/agents', { method: 'POST', body: { name } });
    setCreate(false);
    setName('');
    setNewToken(response.token);
    return response;
  });
  const billing = useAction(async () => {
    const res = await api<{ approvalUrl: string }>('/billing/setup', { method: 'POST', body: {} });
    window.location.assign(res.approvalUrl);
  });
  const confirmBilling = useAction((setupId: string) =>
    api(`/billing/setup/${setupId}/confirm`, { method: 'POST', body: {} }),
  );
  useEffect(() => {
    const setup = params.get('billing');
    if (setup && !billingHandled.current) {
      billingHandled.current = true;
      confirmBilling.mutate(setup, {
        onSuccess: () => {
          setParams({});
          void client.invalidateQueries({ queryKey: ['dashboard'] });
        },
      });
    }
  }, [params, confirmBilling, setParams, client]);
  const currentSelected = data?.agents.find((a) => a.id === selected?.id) ?? selected;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AUTONOMY WITH ACCOUNTABILITY</div>
          <h1>My agents</h1>
          <p>A connection to the marketplace. A budget you control.</p>
        </div>
        <Button onClick={() => setCreate(true)}>
          <Plus size={17} /> Create agent
        </Button>
      </div>
      <ErrorNotice error={error ?? billing.error ?? confirmBilling.error} />
      <div className="billing-banner">
        <div className="paypal-mark">PayPal</div>
        <div>
          <strong>
            {data?.paymentMode === 'demo'
              ? 'Local demo payments are enabled'
              : data?.billingConnected
                ? 'Your sandbox payment method is connected'
                : 'Connect a sandbox payment method'}
          </strong>
          <p>
            {data?.paymentMode === 'demo'
              ? 'Payments are simulated locally. Configure PayPal Sandbox to demonstrate real sandbox orders.'
              : data?.billingConnected
                ? 'Agents can charge your saved method within their policy. No real money is used.'
                : 'Authorize a saved payment method once for autonomous purchases. Standard checkout also works.'}
          </p>
        </div>
        {data?.paymentMode === 'sandbox' && (
          <Button variant="secondary" busy={billing.isPending} onClick={() => billing.mutate()}>
            {data.billingConnected ? 'Reconnect' : 'Connect PayPal'} <ArrowRight size={15} />
          </Button>
        )}
      </div>
      <div className="agent-grid">
        {data?.agents.map((a) => (
          <article className="agent-card panel" key={a.id}>
            <div className="section-heading">
              <span className="agent-avatar">
                <Bot size={24} />
              </span>
              <Status status={a.status} />
            </div>
            <h2>{a.name}</h2>
            <span className="agent-id mono">{a.id}</span>
            <div className="agent-spending">
              <span>Daily budget</span>
              <div>
                <strong>{money(a.budget.spentTodayCents)}</strong>
                <span>of {money(a.budget.dailyBudgetCents)} spent</span>
              </div>
              <div className="progress-track">
                <span
                  style={{
                    width: `${Math.min(100, ((a.budget.spentTodayCents + a.budget.reservedCents) / Math.max(1, a.budget.dailyBudgetCents)) * 100)}%`,
                  }}
                />
              </div>
              <small>
                {money(a.budget.remainingCents)} available · {money(a.budget.reservedCents)} reserved
              </small>
            </div>
            <div className="agent-card-counts">
              <span>
                <CreditCard size={15} />
                {a.purchaseCount} purchases
              </span>
              <span>
                <Activity size={15} />
                {a.invocationCount} invocations
              </span>
            </div>
            <div className="agent-card-bottom">
              <span>
                <ShieldCheck size={14} />
                Auto-approve ≤ {money(a.budget.autoApproveCents)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(a)}>
                Manage <ArrowRight size={14} />
              </Button>
            </div>
          </article>
        ))}
      </div>
      {data && !data.agents.length && (
        <Empty icon={<Bot size={28} />} title="Create your first agent">
          <p>Give your agent a token and a spending policy to get started.</p>
          <Button onClick={() => setCreate(true)}>Create agent</Button>
        </Empty>
      )}
      <Dialog
        open={create}
        onOpenChange={setCreate}
        title="Give your agent new possibilities."
        description="Tokens are displayed once and stored only as a hash."
      >
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Agent name">
            <input
              autoFocus
              required
              minLength={2}
              maxLength={80}
              placeholder="Research Agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="info-callout">
            <p>
              Starts with a $25 daily budget, $0.50 auto-approval threshold, and $10 transaction limit. You
              can change these at any time.
            </p>
          </div>
          <ErrorNotice error={add.error} />
          <Button busy={add.isPending}>
            Create agent <ArrowRight size={16} />
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(newToken)}
        onOpenChange={(open) => {
          if (!open) {
            setNewToken('');
            setCopied(false);
          }
        }}
        title="Save your agent token."
        description="You won’t be able to view this token again. Keep it in your agent’s secret storage."
      >
        <div className="dialog-body">
          <CodeBlock>{newToken}</CodeBlock>
          <Button
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(newToken);
              setCopied(true);
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy token'}
          </Button>
          <p className="muted">
            Use Authorization: Bearer &lt;token&gt; when connecting to{' '}
            <span className="mono">{window.location.origin}/mcp</span>.
          </p>
        </div>
      </Dialog>
      {currentSelected && (
        <AgentSettings agent={currentSelected} onClose={() => setSelected(undefined)} onToken={setNewToken} />
      )}
    </>
  );
}
function AgentSettings({
  agent,
  onClose,
  onToken,
}: {
  agent: Agent;
  onClose: () => void;
  onToken: (token: string) => void;
}) {
  const [tab, setTab] = useState('Spending policy');
  const [name, setName] = useState(agent.name);
  const [policy, setPolicy] = useState<SpendingPolicy>({
    dailyBudgetCents: agent.budget.dailyBudgetCents,
    autoApproveCents: agent.budget.autoApproveCents,
    maxTransactionCents: agent.budget.maxTransactionCents,
    autonomousEnabled: agent.budget.autonomousEnabled,
  });
  const [saved, setSaved] = useState(false);
  const { data } = useDashboard();
  const save = useAction(async () => {
    await api(`/agents/${agent.id}/policy`, { method: 'PUT', body: policy });
    await api(`/agents/${agent.id}`, { method: 'PATCH', body: { name } });
    setSaved(true);
  });
  const rotate = useAction(async () => {
    const result = await api<{ token: string }>(`/agents/${agent.id}/token`, { method: 'POST', body: {} });
    onClose();
    onToken(result.token);
    return result;
  });
  const revoke = useAction(() => api(`/agents/${agent.id}/revoke`, { method: 'POST', body: {} }));
  const rows =
    tab === 'Purchases'
      ? data?.purchases.filter((p) => p.agentId === agent.id)
      : data?.invocations.filter((i) => i.agentId === agent.id);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={agent.name}
      description="Manage identity, financial controls, and activity."
      wide
    >
      <div className="dialog-body">
        <div className="type-tabs settings-tabs">
          {['Spending policy', 'Connection', 'Purchases', 'Invocations'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'Spending policy' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Agent name">
              <input
                value={name}
                minLength={2}
                maxLength={80}
                required
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
              />
            </Field>
            <div className="form-grid">
              {(
                [
                  ['dailyBudgetCents', 'Daily budget ($)'],
                  ['autoApproveCents', 'Auto-approval threshold ($)'],
                  ['maxTransactionCents', 'Maximum transaction ($)'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1000"
                    required
                    value={policy[key] / 100}
                    onChange={(e) => {
                      setPolicy({ ...policy, [key]: Math.round(Number(e.target.value) * 100) });
                      setSaved(false);
                    }}
                  />
                </Field>
              ))}
            </div>
            <label className="toggle-row">
              <div>
                <strong>Autonomous purchases</strong>
                <p>Automatically approve purchases at or below your threshold.</p>
              </div>
              <input
                type="checkbox"
                className="switch"
                checked={policy.autonomousEnabled}
                onChange={(e) => {
                  setPolicy({ ...policy, autonomousEnabled: e.target.checked });
                  setSaved(false);
                }}
              />
            </label>
            <div className="info-callout">
              <p>
                Daily budgets reset at 00:00 UTC. Pending approvals and payments reserve funds; each purchase
                stays charged to the day it was requested.
              </p>
            </div>
            <ErrorNotice error={save.error} />
            <Button busy={save.isPending}>
              {saved ? (
                <>
                  <Check size={16} /> Saved
                </>
              ) : (
                <>
                  <ShieldCheck size={16} /> Save policy
                </>
              )}
            </Button>
          </form>
        ) : tab === 'Connection' ? (
          <>
            <div className="section-heading">
              <h3>Agent token</h3>
              <Status status={agent.status} />
            </div>
            <p className="muted">
              The token is hashed at rest. Regenerating it immediately revokes the previous token.
            </p>
            <div className="action-row">
              <Button variant="secondary" busy={rotate.isPending} onClick={() => rotate.mutate()}>
                <RotateCw size={15} /> Regenerate token
              </Button>
              <Button
                variant="destructive"
                busy={revoke.isPending}
                disabled={agent.status === 'revoked'}
                onClick={() => revoke.mutate()}
              >
                <Ban size={15} /> Revoke access
              </Button>
            </div>
            <ErrorNotice error={rotate.error ?? revoke.error} />
            <h3 className="spaced-heading">
              <KeyRound size={16} /> MCP connection
            </h3>
            <CodeBlock>
              {JSON.stringify(
                {
                  mcpServers: {
                    capora: {
                      url: `${window.location.origin}/mcp`,
                      headers: { Authorization: 'Bearer YOUR_AGENT_TOKEN' },
                    },
                  },
                },
                null,
                2,
              )}
            </CodeBlock>
            <Link className="text-link" to="/developers" onClick={onClose}>
              Full MCP guide <ArrowRight size={14} />
            </Link>
          </>
        ) : (
          <div className="mini-history">
            {rows?.length ? (
              rows.map((row) => (
                <div key={row.id}>
                  <div>
                    <strong>{row.capabilityName}</strong>
                    <small className="mono">{row.id}</small>
                  </div>
                  <Status status={row.status} />
                </div>
              ))
            ) : (
              <Empty
                icon={tab === 'Purchases' ? <CreditCard /> : <Activity />}
                title={`No ${tab.toLowerCase()} yet`}
              >
                <p>Visit the marketplace to acquire your first capability.</p>
              </Empty>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
