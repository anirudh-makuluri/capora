import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/layout';
import { Skeleton } from './components/ui';
import { Landing } from './pages/landing';
import './styles.css';

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5000, refetchOnWindowFocus: true } },
});
const Marketplace = React.lazy(() => import('./pages/marketplace').then((m) => ({ default: m.Marketplace })));
const CapabilityDetail = React.lazy(() =>
  import('./pages/capability').then((m) => ({ default: m.CapabilityDetail })),
);
const Overview = React.lazy(() => import('./pages/overview').then((m) => ({ default: m.Overview })));
const Agents = React.lazy(() => import('./pages/agents').then((m) => ({ default: m.Agents })));
const Transactions = React.lazy(() =>
  import('./pages/transactions').then((m) => ({ default: m.Transactions })),
);
const Approvals = React.lazy(() => import('./pages/approvals').then((m) => ({ default: m.Approvals })));
const Providers = React.lazy(() => import('./pages/providers').then((m) => ({ default: m.Providers })));
const Developers = React.lazy(() => import('./pages/developers').then((m) => ({ default: m.Developers })));
const Demo = React.lazy(() => import('./pages/demo').then((m) => ({ default: m.Demo })));
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="loading-page">
        <h1>Let’s reconnect.</h1>
        <p>The workspace encountered a display error.</p>
        <button className="button button-primary" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <React.Suspense
            fallback={
              <div className="page-content">
                <Skeleton className="detail-skeleton" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route element={<AppLayout />}>
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/marketplace/:id" element={<CapabilityDetail />} />
                <Route path="/overview" element={<Overview />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/providers" element={<Providers />} />
                <Route path="/developers" element={<Developers />} />
                <Route path="/demo" element={<Demo />} />
                <Route
                  path="*"
                  element={
                    <div className="empty-state">
                      <h1>This page isn’t here.</h1>
                      <Link to="/marketplace">Back to marketplace</Link>
                    </div>
                  }
                />
              </Route>
            </Routes>
          </React.Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
