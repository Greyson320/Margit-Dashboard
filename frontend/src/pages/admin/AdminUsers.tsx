import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatDate } from '../../lib/format';
import { Loading, Modal, Pill } from '../../components/ui';
import type { AdminUser, Paginated, Role } from '../../lib/types';

const ROLE_TONES: Record<Role, 'brand' | 'amber' | 'slate'> = {
  admin: 'brand',
  reviewer: 'amber',
  applicant: 'slate',
};

export default function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'reviewer' as Role });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Paginated<AdminUser>>(`/users${qs({ q: search || undefined, role: role || undefined })}`);
      setUsers(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load users');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const update = async (id: string, patch: Record<string, unknown>) => {
    try {
      await api.patch(`/users/${id}`, patch);
      toast.success('User updated');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the user');
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/users', newUser);
      toast.success('User created');
      setCreating(false);
      setNewUser({ name: '', email: '', password: '', role: 'reviewer' });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the user');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-600">Manage accounts, roles and access.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          New user
        </button>
      </div>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row">
        <input
          type="search"
          className="input flex-1"
          placeholder="Search by name, e-mail or organization…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search users"
        />
        <select
          className="input sm:w-48"
          value={role}
          onChange={(event) => setRole(event.target.value as Role | '')}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          <option value="applicant">Applicants</option>
          <option value="reviewer">Reviewers</option>
          <option value="admin">Administrators</option>
        </select>
      </div>

      {loading ? (
        <Loading />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Role</th>
                  <th className="th">Applications</th>
                  <th className="th">Registered</th>
                  <th className="th">Status</th>
                  <th className="th sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="td">
                      <p className="font-medium text-slate-900">{entry.name}</p>
                      <p className="text-xs text-slate-500">
                        {entry.email}
                        {entry.organization ? ` · ${entry.organization}` : ''}
                      </p>
                    </td>
                    <td className="td">
                      {entry.id === me?.id ? (
                        <Pill tone={ROLE_TONES[entry.role]}>{entry.role} (you)</Pill>
                      ) : (
                        <select
                          className="input py-1.5 text-xs"
                          value={entry.role}
                          onChange={(event) => update(entry.id, { role: event.target.value })}
                          aria-label={`Role for ${entry.name}`}
                        >
                          <option value="applicant">applicant</option>
                          <option value="reviewer">reviewer</option>
                          <option value="admin">admin</option>
                        </select>
                      )}
                    </td>
                    <td className="td tabular-nums">{entry._count.applications}</td>
                    <td className="td whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                    <td className="td">
                      {entry.isActive ? <Pill tone="emerald">Active</Pill> : <Pill tone="red">Deactivated</Pill>}
                    </td>
                    <td className="td text-right">
                      {entry.id !== me?.id && (
                        <button
                          type="button"
                          className={entry.isActive ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
                          onClick={() => update(entry.id, { is_active: !entry.isActive })}
                        >
                          {entry.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={creating} title="Create a user" onClose={() => setCreating(false)}>
        <form onSubmit={create} className="space-y-4">
          <div>
            <label htmlFor="new-name" className="label">
              Name
            </label>
            <input
              id="new-name"
              className="input"
              required
              value={newUser.name}
              onChange={(event) => setNewUser((u) => ({ ...u, name: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="new-email" className="label">
              E-mail
            </label>
            <input
              id="new-email"
              type="email"
              className="input"
              required
              value={newUser.email}
              onChange={(event) => setNewUser((u) => ({ ...u, email: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="new-password" className="label">
              Temporary password
            </label>
            <input
              id="new-password"
              type="text"
              minLength={8}
              className="input"
              required
              value={newUser.password}
              onChange={(event) => setNewUser((u) => ({ ...u, password: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="new-role" className="label">
              Role
            </label>
            <select
              id="new-role"
              className="input"
              value={newUser.role}
              onChange={(event) => setNewUser((u) => ({ ...u, role: event.target.value as Role }))}
            >
              <option value="applicant">applicant</option>
              <option value="reviewer">reviewer</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
