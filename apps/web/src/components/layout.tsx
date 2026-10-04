import { useState } from 'react';
import { NavLink, Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import {
  ArrowUpRight,
  ArrowRight,
  Bot,
  Blocks,
  ChartNoAxesCombined,
  CircleHelp,
  Code2,
  Command,
  CreditCard,
  Inbox,
  Menu,
  Plus,
  ShieldCheck,
  X,
  ExternalLink,
  LogOut,
} from 'lucide-react';
import { Mark } from './brand';
import { Button, Dialog, CodeBlock, ErrorNotice, Skeleton } from './ui';
import { api, ApiError, useDashboard, useSession } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';

export function AppLayout() {
  const location = useLocation();
  const session = useSession();
  if (session.isPending)
    return (
      <div className="loading-page">
        <Mark size={44} />
        <Skeleton className="loading-line" />
      </div>
    );
  if (!session.data) {
    if (session.error instanceof ApiError && session.error.status === 401)
      return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
    return (
      <div className="loading-page">
        <ErrorNotice error={session.error} />
      </div>
    );
  }
  return <WorkspaceLayout />;
}
function WorkspaceLayout() {
  const { data: session } = useSession();
  const { data } = useDashboard();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [connect, setConnect] = useState(false);
  const client = useQueryClient();
  const location = useLocation();
  const nav = [
    { to: '/marketplace', label: 'Marketplace', icon: Blocks },
    { to: '/overview', label: 'Overview', icon: ChartNoAxesCombined },
    { to: '/agents', label: 'My agents', icon: Bot },
    { to: '/transactions', label: 'Transactions', icon: CreditCard },
    { to: '/approvals', label: 'Approvals', icon: Inbox, count: data?.approvals.length },
  ];
  const pageName =
    [
      ...nav,
      { to: '/providers', label: 'Provider console' },
      { to: '/developers', label: 'Developers' },
      { to: '/demo', label: 'Agent playground' },
    ].find((n) => location.pathname.startsWith(n.to))?.label ?? 'Marketplace';
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Link to="/" className="brand">
            <Mark size={33} />
            Capora<span className="brand-period">.</span>
          </Link>
          <button
            className="mobile-close icon-button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>
        <div className="sidebar-scroll">
          <button className="workspace-switch" onClick={() => setConnect(true)}>
            <span className="workspace-avatar">A</span>
            <span>
              Acme workspace<small>Sandbox workspace</small>
            </span>
            <Command size={15} />
          </button>
          <div className="nav-caption">WORKSPACE</div>
          <nav>
            {nav.map(({ to, label, icon: Icon, count }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={18} />
                <span>{label}</span>
                {Boolean(count) && <span className="nav-count">{count}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="nav-caption nav-caption-second">BUILD WITH CAPORA</div>
          <nav>
            <NavLink to="/providers" onClick={() => setMobileOpen(false)} className="nav-link">
              <Plus size={18} />
              <span>Provider console</span>
            </NavLink>
            <NavLink to="/developers" onClick={() => setMobileOpen(false)} className="nav-link">
              <Code2 size={18} />
              <span>Developers</span>
              <ArrowUpRight size={14} />
            </NavLink>
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-promo">
              <span className="promo-symbol">
                <ShieldCheck size={22} />
              </span>
              <h3>Your agents. Your limits.</h3>
              <p>Every purchase stays within the guardrails you set.</p>
              <Link to="/agents">
                Manage spending policies <ArrowRight size={14} />
              </Link>
            </div>
            <Link to="/developers" className="sidebar-help">
              <CircleHelp size={17} /> Documentation <ExternalLink size={13} />
            </Link>
          </div>
        </div>
        <div className="sidebar-account">
          <div className="user-row">
            <span className="user-avatar">
              {session?.user.name
                .split(/\s+/)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
            <span className="user-details">
              <span className="user-name" title={session?.user.name}>
                {session?.user.name}
              </span>
              <small>Workspace owner</small>
            </span>
          </div>
          {!session?.localDemo && (
            <button
              className="sign-out-button"
              onClick={async () => {
                await api('/auth/sign-out', { method: 'POST', body: {} });
                client.clear();
                window.location.assign('/login');
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          )}
        </div>
      </aside>
      {mobileOpen && <div className="nav-scrim" onClick={() => setMobileOpen(false)} />}
      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span> <strong>{pageName}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <span className="status-dot" />
              {data?.paymentMode === 'demo' ? 'Local demo' : 'PayPal sandbox'}
            </span>
            <span className="topbar-divider" />
            <Button variant="ghost" size="sm" onClick={() => setConnect(true)}>
              <Code2 size={16} /> Connect an agent <ArrowUpRight size={15} />
            </Button>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>
            <span className="status-dot" /> Capora · source-backed data and tools
          </span>
          <Link to="/developers">
            Built for what comes next <ArrowUpRight size={12} />
          </Link>
        </footer>
      </div>
      <Dialog
        open={connect}
        onOpenChange={setConnect}
        title="One connection. New capabilities."
        description="Connect your agent to Capora through Streamable HTTP."
      >
        <div className="dialog-body">
          <CodeBlock>
            {JSON.stringify(
              {
                mcpServers: {
                  capora: {
                    url: `${window.location.origin}/mcp`,
                    headers: { Authorization: 'Bearer YOUR_CAPORA_AGENT_TOKEN' },
                  },
                },
              },
              null,
              2,
            )}
          </CodeBlock>
          <p className="muted">
            Create or regenerate a token under My agents. Credentials are displayed once.
          </p>
          <Button asChild>
            <Link to="/agents" onClick={() => setConnect(false)}>
              Manage agents <ArrowRight size={16} />
            </Link>
          </Button>
          <Link className="text-link dialog-docs" to="/developers" onClick={() => setConnect(false)}>
            Read connection guide <ArrowUpRight size={14} />
          </Link>
        </div>
      </Dialog>
    </div>
  );
}
