import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download, qs } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { STATUS_LABELS, formatDate, relativeTime } from '../../lib/format';
import { EmptyState, Loading, StatusBadge } from '../../components/ui';
import type { ApplicationStatus, ApplicationSummary, Grant, Paginated } from '../../lib/types';

const PAGE_SIZE = 25;

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  ...(Object.keys(STATUS_LABELS) as ApplicationStatus[]).map((status) => ({
    value: status,
    label: STATUS_LABELS[status],
  })),
];

export default function AdminApplications() {
  const toast = useToast();
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [grantId, setGrantId] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'updated_at' | 'created_at' | 'submitted_at' | 'status'>('updated_at');
  const [grants, setGrants] = useState<Grant[]>([]);

  useEffect(() => {
    api
      .get<Paginated<Grant>>('/grants?status=all&take=100')
      .then((data) => setGrants(data.items))
      .catch(() => setGrants([]));
  }, []);

  const query = useMemo(
    () =>
      qs({
        status,
        grant_id: grantId || undefined,
        q: search || undefined,
        sort,
        order: 'desc',
        take: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      }),
    [status, grantId, search, sort, page],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Paginated<ApplicationSummary>>(`/applications${query}`);
      setApplications(data.items);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load applications');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    setPage(0);
  }, [status, grantId, search, sort]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Applications</h1>
          <p className="mt-1 text-sm text-slate-600">{total} application{total === 1 ? '' : 's'} match your filters.</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            download(`/applications/export.csv${query}`, `applications-${new Date().toISOString().slice(0, 10)}.csv`).catch(
              () => toast.error('Export failed'),
            )
          }
        >
          Export CSV
        </button>
      </div>

      <div className="card grid gap-3 p-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <label htmlFor="search" className="sr-only">
            Search
          </label>
          <input
            id="search"
            type="search"
            className="input"
            placeholder="Search applicant, organization or grant…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="grant" className="sr-only">
            Grant
          </label>
          <select id="grant" className="input" value={grantId} onChange={(event) => setGrantId(event.target.value)}>
            <option value="">All grants</option>
            {grants.map((grant) => (
              <option key={grant.id} value={grant.id}>
                {grant.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="sr-only">
            Sort
          </label>
          <select
            id="sort"
            className="input"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
          >
            <option value="updated_at">Most recently updated</option>
            <option value="submitted_at">Most recently submitted</option>
            <option value="created_at">Newest first</option>
            <option value="status">By status</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1 md:col-span-4">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                status === filter.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : applications.length === 0 ? (
        <EmptyState title="No applications found" description="Adjust the filters to widen your search." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Applicant</th>
                  <th className="th">Grant</th>
                  <th className="th">Status</th>
                  <th className="th">Submitted</th>
                  <th className="th">Reviews</th>
                  <th className="th sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {applications.map((application) => (
                  <tr key={application.id} className="hover:bg-slate-50">
                    <td className="td">
                      <p className="font-medium text-slate-900">{application.applicant.name}</p>
                      <p className="text-xs text-slate-500">
                        {application.applicant.organization ?? application.applicant.email}
                      </p>
                    </td>
                    <td className="td">{application.grant.title}</td>
                    <td className="td">
                      <StatusBadge status={application.status} />
                    </td>
                    <td className="td whitespace-nowrap">
                      {application.submitted_at ? (
                        formatDate(application.submitted_at)
                      ) : (
                        <span className="text-slate-400">edited {relativeTime(application.updated_at)}</span>
                      )}
                    </td>
                    <td className="td tabular-nums">{application.review_count}</td>
                    <td className="td text-right">
                      <Link to={`/admin/applications/${application.id}`} className="btn-secondary btn-sm">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
              <span className="text-slate-600">
                Page {page + 1} of {pages}
              </span>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
