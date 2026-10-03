import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Bot, Code2, ShieldCheck, Database, Zap, Check } from 'lucide-react';
import { Button, Badge } from '../components/ui';
import { Mark, NetworkArt } from '../components/brand';
export function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="brand">
          <Mark />
          Capora<span className="brand-period">.</span>
        </Link>
        <nav>
          <Link to="/marketplace">Marketplace</Link>
          <Link to="/developers">Developers</Link>
          <Button variant="secondary" size="sm" asChild>
            <Link to="/overview">
              Open workspace <ArrowUpRight size={15} />
            </Link>
          </Button>
        </nav>
      </header>
      <main>
        <section className="landing-hero">
          <Badge tone="green">
            <span className="status-dot" />
            THE MARKETPLACE FOR MACHINE CAPABILITIES
          </Badge>
          <h1>
            Your agent can think.
            <br />
            Now, let it <em>acquire.</em>
          </h1>
          <p>
            Give agents on-demand access to the proprietary data, APIs, and specialized tools they need to
            finish the job.
          </p>
          <div className="action-row">
            <Button asChild>
              <Link to="/marketplace">
                Explore the marketplace <ArrowRight size={17} />
              </Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/demo">
                <Bot size={17} /> See an agent in action
              </Link>
            </Button>
          </div>
          <div className="landing-partners">
            <span>
              <Code2 size={15} />
              MCP-native
            </span>
            <span>
              <ShieldCheck size={15} />
              Human-controlled budgets
            </span>
            <span>
              PayPal-powered <Badge>Sandbox</Badge>
            </span>
          </div>
        </section>
        <section className="landing-loop">
          <div>
            <div className="eyebrow">A NEW KIND OF AUTONOMY</div>
            <h2>
              Missing a capability?
              <br />
              Acquire the next step.
            </h2>
            <p>
              A general-purpose agent can reason about a company. It can’t conjure a licensed employment
              database by changing its prompt.
            </p>
            <p>
              Capora gives it a way to find the right provider, compare the tradeoffs, purchase access, and
              continue the original task.
            </p>
            <div className="landing-flow">
              <span>Discover</span>
              <ArrowRight size={16} />
              <span>Evaluate</span>
              <ArrowRight size={16} />
              <span>Purchase</span>
              <ArrowRight size={16} />
              <span>Invoke</span>
            </div>
          </div>
          <div className="landing-network">
            <NetworkArt />
            <span>ONE CONNECTION. REAL NEW ACCESS.</span>
          </div>
        </section>
        <section className="landing-values">
          {[
            {
              icon: Database,
              title: 'Capabilities with something behind them.',
              description:
                'Unique data, privileged APIs, licensed tools, and specialized infrastructure. Access your agent doesn’t already possess.',
            },
            {
              icon: ShieldCheck,
              title: 'Autonomy within your limits.',
              description:
                'Set daily budgets and transaction limits. Let small purchases flow automatically. Approve meaningful spend yourself.',
            },
            {
              icon: Zap,
              title: 'A complete, visible capability loop.',
              description:
                'Discovery, quoting, purchasing, and execution through one MCP server. Every purchase and result has an audit trail.',
            },
          ].map(({ icon: Icon, title, description }) => (
            <article key={title}>
              <span>
                <Icon size={24} />
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </section>
        <section className="landing-cta">
          <div>
            <h2>The next capability is out there.</h2>
            <p>Let your agent find it.</p>
          </div>
          <Button asChild>
            <Link to="/marketplace">
              Start exploring <ArrowRight size={17} />
            </Link>
          </Button>
        </section>
      </main>
      <footer className="landing-footer">
        <Link to="/" className="brand">
          <Mark size={25} />
          Capora
        </Link>
        <span>Capability + Agora. Built for what comes next.</span>
        <span>
          <Check size={14} /> Sandbox MVP
        </span>
      </footer>
    </div>
  );
}
