import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Check,
  Clock3,
  Play,
  ShieldCheck,
  Sparkles,
  Terminal,
  RotateCw,
  ArrowUpRight,
} from 'lucide-react';
import { money, type Capability, type Quote, type Purchase, type Invocation, type Job } from '@capora/types';
import { api, useDashboard, useAction, latency } from '../lib/api';
import { Button, Badge, CodeBlock, ErrorNotice, Status } from '../components/ui';
import { ProviderIcon } from '../components/brand';
import { ApprovalCard } from './approvals';
import { useQuery } from '@tanstack/react-query';
interface Step {
  name: string;
  tool: string;
  detail: string;
}
export function Demo() {
  const { data } = useDashboard();
  const [steps, setSteps] = useState<Step[]>([]);
  const [candidates, setCandidates] = useState<Capability[]>([]);
  const [employment, setEmployment] = useState<Invocation>();
  const [securityPurchase, setSecurityPurchase] = useState<Purchase>();
  const [securityInvocation, setSecurityInvocation] = useState<Invocation>();
  const securityClaim = useRef(false);
  const activeAgent =
    data?.agents.find((a) => a.id === 'agent_research' && a.status === 'active') ??
    data?.agents.find((a) => a.status === 'active');
  const addStep = (step: Step) => setSteps((s) => [...s, step]);
  const run = useAction(async () => {
    if (!activeAgent) throw new Error('Create an active agent first.');
    setSteps([]);
    setCandidates([]);
    setEmployment(undefined);
    setSecurityPurchase(undefined);
    setSecurityInvocation(undefined);
    securityClaim.current = false;
    addStep({
      name: 'A limitation becomes a possibility',
      tool: 'task',
      detail: 'The agent needs private employment intelligence to evaluate Arizona expansion.',
    });
    const options = await api<Capability[]>(
      '/capabilities?query=private%20company%20hiring%20headcount&sort=price',
    );
    setCandidates(options.filter((c) => ['datapulse_headcount', 'companyintel_premium'].includes(c.id)));
    addStep({
      name: 'Compare the cost of confidence',
      tool: 'search_capabilities',
      detail:
        'DataPulse costs $0.20; CompanyIntel costs $1.50. An exploratory task can use the lower-cost source.',
    });
    const input = { company: 'Acme Robotics', region: 'Arizona', timeRange: '2026-Q3' };
    const quote = await api<Quote>(`/agents/${activeAgent.id}/quotes`, {
      method: 'POST',
      body: {
        capability_id: 'datapulse_headcount',
        input,
        reason: 'Evaluate whether Acme Robotics is expanding into Arizona using private employment signals.',
      },
    });
    addStep({
      name: 'A fixed price for the missing intelligence',
      tool: 'get_quote',
      detail: `${money(quote.priceCents)} · five-minute quote · exact input locked`,
    });
    const purchase = await api<Purchase>(`/agents/${activeAgent.id}/purchases`, {
      method: 'POST',
      body: { quote_id: quote.id },
    });
    addStep({
      name: purchase.status === 'purchased' ? 'Purchased within the guardrails' : 'Purchase is waiting',
      tool: 'purchase_capability',
      detail: `${purchase.status.replaceAll('_', ' ')} · ${data?.paymentMode === 'demo' ? 'local simulated payment' : 'PayPal Sandbox'}`,
    });
    if (purchase.status !== 'purchased')
      throw new Error(
        'The employment purchase needs approval or payment. Complete it in Transactions, then run again.',
      );
    const result = await api<Invocation>(`/agents/${activeAgent.id}/invocations`, {
      method: 'POST',
      body: { purchase_id: purchase.id, input },
    });
    setEmployment(result);
    if (result.status === 'failed') throw new Error(result.error ?? 'Provider execution failed.');
    addStep({
      name: 'The capability actually runs',
      tool: 'invoke_capability',
      detail: `Employment intelligence returned in ${latency(result.latencyMs ?? 0)}. Provider credentials stayed inside Capora.`,
    });
    return result;
  });
  const requestSecurity = useAction(async () => {
    if (!activeAgent) throw new Error('No active agent.');
    const input = {
      repository: 'acme-robotics/control-plane',
      code: 'const query = `SELECT * FROM users WHERE id = ${req.query.id}`;\neval(req.body.code);',
    };
    const quote = await api<Quote>(`/agents/${activeAgent.id}/quotes`, {
      method: 'POST',
      body: {
        capability_id: 'securescan_advanced',
        input,
        reason:
          'Before evaluating the acquisition, I need specialized static analysis of the control-plane code. This exceeds my auto-approval threshold.',
      },
    });
    const purchase = await api<Purchase>(`/agents/${activeAgent.id}/purchases`, {
      method: 'POST',
      body: { quote_id: quote.id },
    });
    setSecurityPurchase(purchase);
    addStep({
      name: 'The human stays in control',
      tool: 'purchase_capability',
      detail: `$3.00 security analysis · ${purchase.status.replaceAll('_', ' ')} · exceeds the default $0.50 automatic threshold`,
    });
    return purchase;
  });
  const security = data?.purchases.find((p) => p.id === securityPurchase?.id) ?? securityPurchase;
  const executeSecurity = useAction(async (purchase: Purchase) => {
    const input = (
      await api<{ input: Record<string, unknown> }>(
        `/agents/${purchase.agentId}/purchases/${purchase.id}/input`,
      )
    ).input;
    const result = await api<Invocation>(`/agents/${purchase.agentId}/invocations`, {
      method: 'POST',
      body: { purchase_id: purchase.id, input },
    });
    setSecurityInvocation(result);
    addStep({
      name: 'Specialized tools, acquired on demand',
      tool: 'invoke_capability',
      detail: `Job ${result.jobId ?? result.id} is queued. The agent can continue by polling get_job.`,
    });
    return result;
  });
  useEffect(() => {
    if (security?.status === 'purchased' && !securityClaim.current) {
      securityClaim.current = true;
      executeSecurity.mutate(security);
    }
  }, [security, executeSecurity]);
  const job = useQuery({
    queryKey: ['demo-job', securityInvocation?.jobId],
    queryFn: () => api<Job>(`/agents/${security!.agentId}/jobs/${securityInvocation!.jobId}`),
    enabled: Boolean(securityInvocation?.jobId),
    refetchInterval: (q) => (['completed', 'failed'].includes(q.state.data?.status ?? '') ? false : 800),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WATCH THE CAPABILITY LOOP CLOSE</div>
          <h1>A task. A missing piece. A new capability.</h1>
          <p>Follow the acquisition demo, from discovery to a result your agent can use.</p>
        </div>
        <Button variant="secondary" asChild>
          <Link to="/developers">
            MCP connection <ArrowUpRight size={15} />
          </Link>
        </Button>
      </div>
      <div className="demo-disclosure">
        <Terminal size={17} />
        <span>
          Scripted playground · calls the same services as MCP · synthetic data ·{' '}
          {data?.paymentMode === 'demo' ? 'simulated local payments' : 'PayPal Sandbox'}
        </span>
      </div>
      <div className="demo-layout">
        <section className="panel demo-main">
          <div className="demo-task">
            <div className="section-heading">
              <Badge tone="green">
                <Bot size={13} /> {activeAgent?.name ?? 'No active agent'}
              </Badge>
              <span className="muted small">ACQUISITION RESEARCH</span>
            </div>
            <h2>
              “Evaluate whether Acme Robotics
              <br />
              is expanding into Arizona.”
            </h2>
            <p>
              Public research can surface announcements. It can’t reproduce a licensed, private employment
              panel.
            </p>
            <Button busy={run.isPending} disabled={!activeAgent} onClick={() => run.mutate()}>
              {steps.length ? <RotateCw size={15} /> : <Play size={15} />}{' '}
              {steps.length ? 'Start a new run' : 'Run the acquisition demo'} <ArrowRight size={16} />
            </Button>
          </div>
          <ErrorNotice error={run.error ?? requestSecurity.error ?? executeSecurity.error ?? job.error} />
          {Boolean(steps.length) && (
            <div className="demo-timeline">
              {steps.map((s, i) => (
                <div className="demo-step" key={`${s.tool}-${i}`}>
                  <div className="demo-step-icon">
                    <Check size={15} />
                  </div>
                  <div>
                    <div className="section-heading">
                      <h3>{s.name}</h3>
                      <code>{s.tool}</code>
                    </div>
                    <p>{s.detail}</p>
                  </div>
                </div>
              ))}
              {run.isPending && (
                <div className="demo-step demo-step-pending">
                  <div className="demo-step-icon">
                    <Clock3 size={15} />
                  </div>
                  <p>Acquiring the missing capability…</p>
                </div>
              )}
            </div>
          )}
          {Boolean(candidates.length) && (
            <div className="demo-options">
              <h3>The cost of confidence</h3>
              {candidates.map((c) => (
                <div className="demo-option" key={c.id}>
                  <ProviderIcon capability={c} />
                  <div>
                    <strong>{c.provider}</strong>
                    <small>
                      {c.reliability}% reliability · {latency(c.expectedLatencyMs)}
                    </small>
                  </div>
                  <strong>{money(c.priceCents)}</strong>
                  {c.id === 'datapulse_headcount' && <Badge tone="green">Selected</Badge>}
                </div>
              ))}
            </div>
          )}
          {employment?.status === 'completed' && (
            <div className="demo-answer">
              <div className="section-heading">
                <span>
                  <Sparkles size={17} /> A result the agent can use
                </span>
                <Badge tone="amber">Synthetic fixture</Badge>
              </div>
              <h3>The signals point to Arizona expansion.</h3>
              <p>
                The demo employment panel reports Arizona headcount growing from <strong>21 to 38</strong>{' '}
                over three months, with <strong>12 regional roles</strong> open. Those signals support the
                expansion thesis, subject to further diligence.
              </p>
              <details>
                <summary>Inspect the structured provider result</summary>
                <CodeBlock>{JSON.stringify(employment.result, null, 2)}</CodeBlock>
              </details>
            </div>
          )}
        </section>
        <aside>
          <section className="panel demo-policy">
            <div className="section-heading">
              <h2>Your guardrails</h2>
              <ShieldCheck size={20} />
            </div>
            <dl>
              <div>
                <dt>Auto-approve</dt>
                <dd>≤ {money(activeAgent?.budget.autoApproveCents ?? 50)}</dd>
              </div>
              <div>
                <dt>Transaction limit</dt>
                <dd>{money(activeAgent?.budget.maxTransactionCents ?? 1000)}</dd>
              </div>
              <div>
                <dt>Daily budget</dt>
                <dd>{money(activeAgent?.budget.dailyBudgetCents ?? 2500)}</dd>
              </div>
              <div>
                <dt>Available today</dt>
                <dd>{money(activeAgent?.budget.remainingCents ?? 0)}</dd>
              </div>
            </dl>
            <p>Small purchases flow automatically. Bigger decisions stay with you.</p>
          </section>
          <section className="panel demo-security">
            <Badge tone="amber">DEMO PART 02</Badge>
            <h2>Now, raise the stakes.</h2>
            <p>
              The agent needs a $3.00 security analysis. It crosses the approval threshold, so the human makes
              the call.
            </p>
            <Button
              variant="secondary"
              className="full-width"
              busy={requestSecurity.isPending}
              disabled={!employment || Boolean(securityPurchase)}
              onClick={() => requestSecurity.mutate()}
            >
              Request security analysis <ArrowRight size={15} />
            </Button>
            {security && (
              <div className="security-purchase-state">
                <Status status={security.status} />
                {security.status === 'payment_pending' && (
                  <Link to="/transactions" className="text-link">
                    Complete PayPal checkout <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            )}
          </section>
          {security?.status === 'pending_approval' && <ApprovalCard purchase={security} />}
          <div className="demo-audit-link">
            <Check size={17} />
            <p>
              Every step is recorded.
              <Link to="/transactions">
                See the transaction trail <ArrowRight size={14} />
              </Link>
            </p>
          </div>
        </aside>
      </div>
      {job.data && (
        <section className="panel job-result">
          <div className="panel-heading">
            <h2>Security analysis result</h2>
            <Status status={job.data.status} />
          </div>
          <div className="panel-padding">
            <CodeBlock>
              {JSON.stringify(
                job.data.result ?? {
                  status: job.data.status,
                  progress: job.data.progress,
                  error: job.data.error,
                },
                null,
                2,
              )}
            </CodeBlock>
          </div>
        </section>
      )}
    </>
  );
}
