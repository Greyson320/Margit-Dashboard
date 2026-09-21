import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { Alert } from '../components/ui';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setOrganization(user.organization ?? '');
    }
  }, [user]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await updateProfile({ name, organization: organization || null });
      toast.success('Profile updated');
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not save');
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (passwords.next !== passwords.confirm) {
      setError('The two new passwords do not match');
      return;
    }
    try {
      await api.post('/auth/change-password', {
        current_password: passwords.current,
        new_password: passwords.next,
      });
      setPasswords({ current: '', next: '', confirm: '' });
      toast.success('Password changed — other devices were signed out');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the password');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Your profile</h1>
        <p className="mt-1 text-sm text-slate-600">
          Signed in as {user?.email} · role <span className="capitalize">{user?.role}</span>
        </p>
      </div>

      <form onSubmit={saveProfile} className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-slate-900">Details</h2>
        <div>
          <label htmlFor="name" className="label">
            Full name
          </label>
          <input id="name" className="input" value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div>
          <label htmlFor="organization" className="label">
            Organization
          </label>
          <input
            id="organization"
            className="input"
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary">
          Save changes
        </button>
      </form>

      <form onSubmit={changePassword} className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-slate-900">Change password</h2>
        {error && <Alert tone="error">{error}</Alert>}
        <div>
          <label htmlFor="current" className="label">
            Current password
          </label>
          <input
            id="current"
            type="password"
            className="input"
            required
            value={passwords.current}
            onChange={(event) => setPasswords((p) => ({ ...p, current: event.target.value }))}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="next" className="label">
              New password
            </label>
            <input
              id="next"
              type="password"
              minLength={8}
              className="input"
              required
              value={passwords.next}
              onChange={(event) => setPasswords((p) => ({ ...p, next: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="confirm" className="label">
              Repeat new password
            </label>
            <input
              id="confirm"
              type="password"
              minLength={8}
              className="input"
              required
              value={passwords.confirm}
              onChange={(event) => setPasswords((p) => ({ ...p, confirm: event.target.value }))}
            />
          </div>
        </div>
        <button type="submit" className="btn-secondary">
          Change password
        </button>
      </form>
    </div>
  );
}
