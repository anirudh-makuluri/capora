import { useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { type AgentSetupRequest, money } from '@capora/types';
import { Mark } from '../components/brand';
import { Badge, Button, ErrorNotice, Skeleton } from '../components/ui';
import { api, ApiError, useSession } from '../lib/api';

export function ConnectAgent() {
  const { id } = useParams();
  const location = useLocation();
  const session = useSession();
  const [decision, setDecision] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const request = useQuery({
    queryKey: ['agent-setup', id],
    queryFn: () => api<AgentSetupRequest>(`/connect/${id}`),
    enabled: !!session.data,
    retry: false,
  });
  if (session.error instanceof ApiError && session.error.status === 401)
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  const setup = request.data;
  const status = decision ?? setup?.status;
  async function decide(approve: boolean) {
    if (!setup) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<{ status: string }>(`/connect/${id}/decision`, {
        method: 'POST',
        body: { approve, userCode: setup.userCode },
      });
      setDecision(result.status);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <Link to="/" className="brand">
        <Mark />
        Capora<span className="brand-period">.</span>
      </Link>
      <section className="login-card connect-card">
        <Badge tone="green">CONNECT YOUR AGENT</Badge>
        <h1>
          {status === 'approved'
            ? 'Your agent is ready.'
            : status === 'denied'
              ? 'Connection declined.'
              : 'Authorize your agent.'}
        </h1>
        <ErrorNotice error={session.error ?? request.error ?? error} />
        {(session.isPending || (!!session.data && request.isPending)) && (
          <Skeleton className="loading-line" />
        )}
        {setup && (
          <>
            {status === 'pending' && (
              <>
                <p>
                  Check that this code matches the one in your AI chat. Only authorize a connection you
                  started.
                </p>
                <div className="setup-code" aria-label="Connection code">
                  {setup.userCode}
                </div>
                <dl className="setup-limits">
                  <div>
                    <dt>Agent name</dt>
                    <dd>{setup.name}</dd>
                  </div>
                  <div>
                    <dt>Daily budget</dt>
                    <dd>{money(setup.dailyBudgetCents)}</dd>
                  </div>
                  <div>
                    <dt>Auto-approval threshold</dt>
                    <dd>{money(setup.autoApproveCents)}</dd>
                  </div>
                  <div>
                    <dt>Maximum per purchase</dt>
                    <dd>{money(setup.maxTransactionCents)}</dd>
                  </div>
                </dl>
                <p>
                  Signed in as {session.data?.user.email}. Daily limits reset at midnight UTC. Purchases above
                  the auto-approval threshold need your approval. This connection can spend automatically
                  within these limits using your saved Sandbox payment method.
                </p>
                <div className="action-row">
                  <Button busy={busy} onClick={() => void decide(true)}>
                    Create and connect agent
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void decide(false)}>
                    Decline
                  </Button>
                </div>
                <p className="muted">
                  Expires {new Date(setup.expiresAt).toLocaleTimeString()}. Connecting makes no purchases.
                </p>
              </>
            )}
            {status === 'approved' && (
              <>
                <p>
                  Return to your AI chat to finish connecting {setup.name}. Your chosen spending limits are
                  active. Payment setup is separate.
                </p>
                <Link className="text-link" to="/agents">
                  View your agents
                </Link>
              </>
            )}
            {status === 'denied' && <p>No agent was created. Return to your AI chat to end setup.</p>}
          </>
        )}
      </section>
    </div>
  );
}
