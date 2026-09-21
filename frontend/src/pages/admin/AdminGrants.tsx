import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDate, formatMoney } from '../../lib/format';
import { EmptyState, Loading } from '../../components/ui';
import { StateBadge } from '../GrantsCatalog';
import type { Grant, Paginated } from '../../lib/types';

export default function AdminGrants() {
  const toast = useToast();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Paginated<Grant>>(`/grants?status=${showArchived ? 'archived' : 'all'}&take=100`);
      setGrants(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load grants');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (grant: Grant) => {
    const message =
      grant.application_count > 0
        ? `"${grant.title}" has ${grant.application_count} application(s) and will be archived instead of deleted. Continue?`
        : `Delete "${grant.title}"? This cannot be undone.`;
    if (!window.confirm(message)) return;
    try {
      const result = await api.del<{ archived?: boolean } | null>(`/grants/${grant.id}`);
      toast.success(result?.archived ? 'Grant archived' : 'Grant deleted');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove the grant');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Grants</h1>
          <p className="mt-1 text-sm text-slate-600">Define the calls, their deadlines and the requirements applicants must meet.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Archived only
          </label>
          <Link to="/admin/grants/new" className="btn-primary">
            New grant
          </Link>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : grants.length === 0 ? (
        <EmptyState
          title={showArchived ? 'No archived grants' : 'No grants yet'}
          description="Create your first call and define what applicants need to submit."
          action={
            <Link to="/admin/grants/new" className="btn-primary mt-2">
              New grant
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Grant</th>
                  <th className="th">State</th>
                  <th className="th">Deadline</th>
                  <th className="th">Maximum</th>
                  <th className="th">Requirements</th>
                  <th className="th">Applications</th>
                  <th className="th sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grants.map((grant) => (
                  <tr key={grant.id} className="hover:bg-slate-50">
                    <td className="td">
                      <Link to={`/admin/grants/${grant.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {grant.title}
                      </Link>
                      <p className="text-xs text-slate-500">/{grant.slug}</p>
                    </td>
                    <td className="td">
                      <StateBadge state={grant.state} />
                    </td>
                    <td className="td whitespace-nowrap">{formatDate(grant.deadline)}</td>
                    <td className="td whitespace-nowrap">{formatMoney(grant.maxAmount, grant.currency)}</td>
                    <td className="td tabular-nums">{grant.requirements.length}</td>
                    <td className="td tabular-nums">{grant.application_count}</td>
                    <td className="td">
                      <div className="flex justify-end gap-2">
                        <Link to={`/admin/grants/${grant.id}`} className="btn-secondary btn-sm">
                          Edit
                        </Link>
                        <button type="button" className="btn-danger btn-sm" onClick={() => remove(grant)}>
                          {grant.application_count > 0 ? 'Archive' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
