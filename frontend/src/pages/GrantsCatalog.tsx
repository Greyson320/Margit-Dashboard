import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { daysUntil, formatDate, formatMoney } from '../lib/format';
import { EmptyState, Loading, Pill } from '../components/ui';
import type { Grant, Paginated } from '../lib/types';

const FILTERS = [
  { value: 'open', label: 'Open now' },
  { value: 'upcoming', label: 'Opening soon' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
] as const;

export default function GrantsCatalog() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<(typeof FILTERS)[number]['value']>('open');
  const [search, setSearch] = useState('');
  const [targetGroup, setTargetGroup] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.get<Paginated<Grant>>(
          `/grants${qs({ status, q: search || undefined, target_group: targetGroup || undefined })}`,
          controller.signal,
        );
        setGrants(data.items);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setGrants([]);
      } finally {
        setLoading(false);
      }
    }, search ? 300 : 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [status, search, targetGroup]);

  const targetGroups = useMemo(() => {
    const set = new Set<string>();
    grants.forEach((grant) => (grant.targetGroups ?? []).forEach((group) => set.add(group)));
    return Array.from(set).sort();
  }, [grants]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Grant opportunities</h1>
        <p className="mt-1 text-sm text-slate-600">
          Browse the open calls, check the eligibility criteria and start an application.
        </p>
      </div>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="search" className="sr-only">
            Search grants
          </label>
          <input
            id="search"
            type="search"
            placeholder="Search by title, description or eligibility…"
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {targetGroups.length > 0 && (
          <div className="sm:w-52">
            <label htmlFor="target" className="sr-only">
              Target group
            </label>
            <select id="target" className="input" value={targetGroup} onChange={(event) => setTargetGroup(event.target.value)}>
              <option value="">All target groups</option>
              {targetGroups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                status === filter.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Loading label="Loading grants…" />
      ) : grants.length === 0 ? (
        <EmptyState
          title="No grants match your filters"
          description="Try a different search term, or switch the filter to “All” to see closed and upcoming rounds."
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {grants.map((grant) => (
            <GrantCard key={grant.id} grant={grant} />
          ))}
        </div>
      )}
    </div>
  );
}

function GrantCard({ grant }: { grant: Grant }) {
  const remaining = daysUntil(grant.deadline);
  const urgent = remaining !== null && remaining >= 0 && remaining <= 14;

  return (
    <article className="card flex flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <StateBadge state={grant.state} />
        {urgent && grant.state === 'open' && <Pill tone="amber">{remaining === 0 ? 'Closes today' : `${remaining} days left`}</Pill>}
      </div>

      <h2 className="text-lg font-semibold leading-snug text-slate-900">
        <Link to={`/grants/${grant.id}`} className="hover:text-brand-700">
          {grant.title}
        </Link>
      </h2>
      <p className="mt-2 line-clamp-3 flex-1 text-sm text-slate-600">{grant.description}</p>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Maximum</dt>
          <dd className="font-semibold text-slate-900">{formatMoney(grant.maxAmount, grant.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Deadline</dt>
          <dd className="font-semibold text-slate-900">{formatDate(grant.deadline)}</dd>
        </div>
      </dl>

      {(grant.targetGroups ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(grant.targetGroups ?? []).map((group) => (
            <Pill key={group}>{group}</Pill>
          ))}
        </div>
      )}

      <Link to={`/grants/${grant.id}`} className="btn-primary mt-5 w-full">
        View details
      </Link>
    </article>
  );
}

export function StateBadge({ state }: { state: Grant['state'] }) {
  const map = {
    open: { label: 'Open', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    upcoming: { label: 'Opens later', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
    closed: { label: 'Closed', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
    archived: { label: 'Archived', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
  } as const;
  const entry = map[state];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${entry.className}`}>
      {entry.label}
    </span>
  );
}
