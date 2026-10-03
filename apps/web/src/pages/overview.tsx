import { Link } from 'react-router-dom';
import { ArrowRight, Bot, CheckCheck, CreditCard, Play, Activity, Inbox, Clock3 } from 'lucide-react';
import { money } from '@capora/types';
import { useDashboard, time, latency } from '../lib/api';
import { Button, Badge, Empty, ErrorNotice, Skeleton, Status } from '../components/ui';
export function Overview() {
  const { data, error, isPending } = useDashboard();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR ECONOMIC CONTROL PLANE</div>
          <h1>Workspace overview</h1>
          <p>Everything your agents acquire. All in your control.</p>
        </div>
        <Button asChild>
          <Link to="/demo">
            <Play size={15} /> Open agent playground
          </Link>
        </Button>
      </div>
      <ErrorNotice error={error} />
      {isPending ? (
        <Skeleton className="detail-skeleton" />
      ) : (
        data && (
          <>
            <div className="stats-grid">
              <Stat
                icon={<CreditCard size={19} />}
                label="Spent today"
                value={money(data.stats.spentTodayCents)}
                note={`${money(data.stats.totalSpendCents)} lifetime spending`}
              />
              <Stat
                icon={<Bot size={19} />}
                label="Active agents"
                value={String(data.agents.filter((a) => a.status === 'active').length)}
                note="Connected to your workspace"
              />
              <Stat
                icon={<CheckCheck size={19} />}
                label="Capability executions"
                value={String(data.stats.executions)}
                note={
                  data.stats.executions
                    ? `${data.stats.successRate}% completed successfully`
                    : 'Ready for your first execution'
                }
              />
              <Stat
                icon={<Clock3 size={19} />}
                label="Average latency"
                value={data.stats.avgLatencyMs ? latency(data.stats.avgLatencyMs) : '—'}
                note="Measured successful executions"
              />
            </div>
            {Boolean(data.approvals.length) && (
              <Link className="approval-banner" to="/approvals">
                <Inbox size={23} />
                <div>
                  <strong>
                    {data.approvals.length} purchase {data.approvals.length === 1 ? 'needs' : 'requests need'}{' '}
                    your approval
                  </strong>
                  <span>Your agents are waiting before spending beyond their threshold.</span>
                </div>
                <ArrowRight size={20} />
              </Link>
            )}
            <div className="overview-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>Recent activity</h2>
                  <Badge tone="green">
                    <span className="status-dot" />
                    Live
                  </Badge>
                </div>
                {data.activity.length ? (
                  <div className="activity-list">
                    {data.activity.slice(0, 9).map((a) => (
                      <div className="activity-row" key={a.id}>
                        <span
                          className={`activity-icon ${a.kind.includes('completed') ? 'activity-success' : ''}`}
                        >
                          <Activity size={15} />
                        </span>
                        <div>
                          <strong>{a.message}</strong>
                          <span>
                            {a.kind.replaceAll('_', ' ')} · {time(a.createdAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty icon={<Activity size={24} />} title="Your next capability starts here">
                    <p>
                      Run the agent playground to see discovery, purchasing, and execution in your activity
                      feed.
                    </p>
                    <Button variant="secondary" asChild>
                      <Link to="/demo">
                        Run a demo <ArrowRight size={15} />
                      </Link>
                    </Button>
                  </Empty>
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Agent budgets</h2>
                  <Link className="text-link" to="/agents">
                    Manage <ArrowRight size={14} />
                  </Link>
                </div>
                {data.agents.map((a) => (
                  <div className="budget-card" key={a.id}>
                    <div className="section-heading">
                      <strong>{a.name}</strong>
                      <Status status={a.status} />
                    </div>
                    <div className="budget-numbers">
                      <strong>{money(a.budget.spentTodayCents + a.budget.reservedCents)}</strong>
                      <span>of {money(a.budget.dailyBudgetCents)} committed</span>
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
                ))}
                <div className="policy-callout">
                  <CheckCheck size={20} />
                  <p>
                    Quotes expire after 5 minutes. Pending purchases reserve budget so your agents can’t
                    overspend together.
                  </p>
                </div>
              </section>
            </div>
          </>
        )
      )}
    </>
  );
}
export function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
