import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Spinner } from '../components/ui';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', organization: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setError('The two passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        organization: form.organization || undefined,
        phone: form.phone || undefined,
      });
      navigate('/grants', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">One account lets you apply to every open grant.</p>

      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <label htmlFor="name" className="label">
            Full name
          </label>
          <input id="name" required className="input" value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label htmlFor="email" className="label">
            E-mail
          </label>
          <input id="email" type="email" autoComplete="email" required className="input" value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label htmlFor="organization" className="label">
            Organization <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input id="organization" className="input" value={form.organization} onChange={set('organization')} />
        </div>
        <div>
          <label htmlFor="phone" className="label">
            Phone <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input id="phone" className="input" value={form.phone} onChange={set('phone')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="input"
              value={form.password}
              onChange={set('password')}
            />
          </div>
          <div>
            <label htmlFor="confirm" className="label">
              Repeat password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="input"
              value={form.confirm}
              onChange={set('confirm')}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">Use at least 8 characters.</p>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner className="h-4 w-4 text-white" />}
          Create account
        </button>
        <p className="text-center text-sm text-slate-600">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
