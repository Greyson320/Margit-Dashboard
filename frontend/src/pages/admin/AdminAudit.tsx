import { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { formatDate, relativeTime } from '../../lib/format';
import { EmptyState, Loading, Pill } from '../../components/ui';
import type { AuditEntry, Paginated } from '../../lib/types';

const ENTITY_TYPES = ['', 'grant', 'application', 'user', 'review', 'file_upload', 'requirement', 'notification'];

export default function AdminAudit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.get<Paginated<AuditEntry>>(
          `/stats/audit${qs({ entity_type: entityType || undefined, take: 50, skip: page * 50 })}`,
        );
        if (!cancelled) {
          setEntries(data.items);
          setTotal(data.total);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityType, page]);

  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">Every change to grants, applications, users and files.</p>
      </div>

      <div className="card p-4">
        <label htmlFor="entity" className="sr-only">
          Filter by entity
        </label>
        <select
          id="entity"
          className="input sm:w-64"
          value={entityType}
          onChange={(event) => {
            setEntityType(event.target.value);
            setPage(0);
          }}
        >
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type === '' ? 'All entity types' : type.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loading />
      ) : entries.length === 0 ? (
        <EmptyState title="No entries" description="Nothing has been logged for this filter yet." />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Pill>{entry.entityType.replace(/_/g, ' ')}</Pill>
                <span className="text-sm font-medium text-slate-800">{entry.action}</span>
                {entry.entityId && <span className="text-xs text-slate-400">#{entry.entityId}</span>}
                <span className="text-sm text-slate-600">{entry.user ? entry.user.name : 'system'}</span>
                <span className="ml-auto whitespace-nowrap text-xs text-slate-400" title={formatDate(entry.createdAt, true)}>
                  {relativeTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
              <span className="text-slate-600">
                Page {page + 1} of {pages} · {total} entries
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
