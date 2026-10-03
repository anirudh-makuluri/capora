import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Mark } from '../components/brand';
import { Badge, Button, ErrorNotice } from '../components/ui';
import { api, useSession } from '../lib/api';

export function AuthPage({ signup = false }: { signup?: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const requested = location.state?.from;
  const destination =
    typeof requested === 'string' &&
    requested.startsWith('/') &&
    !requested.startsWith('//') &&
    !/^\/(login|signup)(?:[/?#]|$)/.test(requested)
      ? requested
      : '/overview';

  if (session.data) return <Navigate to={destination} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api(signup ? '/auth/sign-up/email' : '/auth/sign-in/email', {
        method: 'POST',
        body: { email: email.trim(), password, ...(signup ? { name: name.trim() } : {}) },
      });
      client.clear();
      await client.fetchQuery({ queryKey: ['session'], queryFn: () => api('/auth/session') });
      navigate(destination, { replace: true });
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
        Capora
      </Link>
      <form className="login-card" onSubmit={submit}>
        <Badge tone="green">YOUR CAPABILITY WORKSPACE</Badge>
        <h1>{signup ? 'Create your account.' : 'Welcome back.'}</h1>
        <p>
          {signup
            ? 'Give your agents a workspace of their own.'
            : 'Sign in to manage the capabilities your agents acquire.'}
        </p>
        {signup && (
          <label className="field">
            <span>Name</span>
            <input
              autoComplete="name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            aria-label="Password"
            aria-describedby={signup ? 'password-help' : undefined}
            autoComplete={signup ? 'new-password' : 'current-password'}
            required
            minLength={signup ? 12 : undefined}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signup && <small id="password-help">Use at least 12 characters.</small>}
        </label>
        <ErrorNotice error={error} />
        <Button busy={busy}>
          {signup ? 'Create account' : 'Sign in'}
          <ArrowRight size={17} />
        </Button>
        <p className="auth-switch">
          {signup ? 'Already have an account? ' : 'New to Capora? '}
          <Link to={signup ? '/login' : '/signup'} state={location.state}>
            {signup ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </form>
    </div>
  );
}
