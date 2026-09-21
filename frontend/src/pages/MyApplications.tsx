import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { daysUntil, formatDate, relativeTime } from '../lib/format';
import { EmptyState, Loading, Pill, StatusBadge } from '../components/ui';
import type { ApplicationSummary, Paginated } from '../lib/types';

export default function MyApplications() {
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<Paginated<ApplicationSummary>>('/applications?take=100');
        if (!cancelled) setApplications(data.items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(
    () => ({
      active: applications.filter((a) => ['draft', 'submitted', 'under_review'].includes(a.status)),
      closed: applications.filter((a) => ['approved', 'rejected', 'withdrawn'].includes(a.status)),
    }),
    [applications],
  );

  if (loading) return <Loading />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">My applications</h1>
        <p className="mt-1 text-sm text-slate-600">Drafts are saved automatically as you type.</p>
      </div>

      {applications.length === 0 ? (
        <EmptyState
          title="You have not applied yet"
          description="Browse the open calls and start your first application."
          action={
            <Link to="/grants" className="btn-primary mt-2">
              Browse grants
            </Link>
          }
        />
      ) : (
        <>
          <Section title="In progress" applications={groups.active} emptyText="Nothing in progress." />
          {groups.closed.length > 0 && <Section title="Completed" applications={groups.closed} />}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  applications,
  emptyText,
}: {
  title: string;
  applications: ApplicationSummary[];
  emptyText?: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {applications.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {applications.map((application) => {
            const remaining = daysUntil(application.grant.deadline);
            const urgent = application.status === 'draft' && remaining !== null && remaining >= 0 && remaining <= 7;
            return (
              <li key={application.id}>
                <Link
                  to={`/applications/${application.id}`}
                  className="card flex flex-col gap-3 p-5 transition-shadow hover:shadow-md sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{application.grant.title}</h3>
                      <StatusBadge status={application.status} />
                      {urgent && <Pill tone="amber">{remaining === 0 ? 'Closes today' : `${remaining} days left`}</Pill>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {application.submitted_at
                        ? `Submitted ${formatDate(application.submitted_at)}`
                        : `Last edited ${relativeTime(application.updated_at)}`}
                      {' · '}
                      Deadline {formatDate(application.grant.deadline)}
                    </p>
                  </div>
                  <span className="btn-secondary btn-sm shrink-0">
                    {application.status === 'draft' ? 'Continue' : 'View'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
