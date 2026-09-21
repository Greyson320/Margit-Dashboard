import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Spinner } from '../components/ui';

const DEMO_ACCOUNTS = [
  { label: 'Administrator', email: 'admin@grant-portal.local', password: 'Admin12345!' },
  { label: 'Reviewer', email: 'reviewer@grant-portal.local', password: 'Review12345!' },
  { label: 'Applicant', email: 'applicant@grant-portal.local', password: 'Apply12345!' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? (user.role === 'applicant' ? '/grants' : '/admin'), { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Access your applications and grant dashboard.</p>

      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <label htmlFor="email" className="label">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            className="input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner className="h-4 w-4 text-white" />}
          Sign in
        </button>
        <p className="text-center text-sm text-slate-600">
          No account yet?{' '}
          <Link to="/register" className="font-semibold text-brand-600 hover:underline">
            Create one
          </Link>
        </p>
      </form>

      <div className="card mt-4 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Demo accounts</p>
        <div className="space-y-1.5">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              onClick={() => {
                setEmail(account.email);
                setPassword(account.password);
              }}
            >
              <span className="font-medium text-slate-700">{account.label}</span>
              <span className="text-xs text-slate-500">{account.email}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
