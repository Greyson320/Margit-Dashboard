import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { daysUntil, formatDate, formatMoney } from '../lib/format';
import { Alert, Loading, Pill, StatusBadge } from '../components/ui';
import { StateBadge } from './GrantsCatalog';
import type { Grant } from '../lib/types';

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  currency: 'Amount',
  date: 'Date',
  select: 'Single choice',
  multiselect: 'Multiple choice',
  checkbox: 'Confirmation',
  file: 'File upload',
  url: 'Link',
};

export default function GrantDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [grant, setGrant] = useState<Grant | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.get<Grant>(`/grants/${id}`);
        if (!cancelled) setGrant(data);
      } catch {
        if (!cancelled) setGrant(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const start = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/grants/${id}` } });
      return;
    }
    setStarting(true);
    try {
      const result = await api.post<{ id: string; existing: boolean }>('/applications', { grant_id: id });
      if (result.existing) toast.info('Continuing your existing application');
      navigate(`/applications/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the application');
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <Loading />;
  if (!grant) {
    return (
      <Alert tone="error" title="Grant not found">
        This grant may have been archived. <Link to="/grants" className="font-semibold underline">Back to the catalogue</Link>.
      </Alert>
    );
  }

  const remaining = daysUntil(grant.deadline);
  const canApply = grant.is_open && (!user || user.role === 'applicant' || user.role === 'admin');

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <Link to="/grants" className="text-sm font-medium text-brand-600 hover:underline">
            ← All grants
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StateBadge state={grant.state} />
            {(grant.targetGroups ?? []).map((group) => (
              <Pill key={group}>{group}</Pill>
            ))}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{grant.title}</h1>
        </div>

        <section className="card p-6">
          <h2 className="text-base font-semibold text-slate-900">About this grant</h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{grant.description}</p>

          {grant.eligibility && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-slate-900">Who can apply</h3>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{grant.eligibility}</p>
            </>
          )}
          {grant.expectedImpact && (
            <>
              <h3 className="mt-6 text-sm font-semibold text-slate-900">Expected impact</h3>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{grant.expectedImpact}</p>
            </>
          )}
        </section>

        <section className="card p-6">
          <h2 className="text-base font-semibold text-slate-900">What you will be asked for</h2>
          <p className="mt-1 text-sm text-slate-600">
            {grant.requirements.length} item{grant.requirements.length === 1 ? '' : 's'}, of which{' '}
            {grant.requirements.filter((r) => r.required).length} required.
          </p>
          <ol className="mt-4 divide-y divide-slate-100">
            {grant.requirements.map((requirement, index) => (
              <li key={requirement.id} className="flex items-start gap-3 py-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {requirement.label}
                    {requirement.required && <span className="ml-1 text-red-600">*</span>}
                  </p>
                  {requirement.helpText && <p className="mt-0.5 text-xs text-slate-500">{requirement.helpText}</p>}
                </div>
                <Pill>{FIELD_TYPE_LABELS[requirement.fieldType] ?? requirement.fieldType}</Pill>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="space-y-4">
        <div className="card sticky top-20 p-6">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Maximum amount</dt>
              <dd className="mt-0.5 text-xl font-bold text-slate-900">{formatMoney(grant.maxAmount, grant.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Deadline</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {formatDate(grant.deadline, true)}
                {remaining !== null && remaining >= 0 && (
                  <span className="ml-2 text-xs font-normal text-slate-500">({remaining} days left)</span>
                )}
              </dd>
            </div>
            {grant.openAt && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Opens</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{formatDate(grant.openAt)}</dd>
              </div>
            )}
          </dl>

          <div className="mt-6 border-t border-slate-100 pt-5">
            {grant.my_application ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Your application</span>
                  <StatusBadge status={grant.my_application.status} />
                </div>
                <Link to={`/applications/${grant.my_application.id}`} className="btn-primary w-full">
                  {grant.my_application.status === 'draft' ? 'Continue application' : 'View application'}
                </Link>
              </div>
            ) : canApply ? (
              <button type="button" className="btn-primary w-full" onClick={start} disabled={starting}>
                {starting ? 'Starting…' : user ? 'Start application' : 'Sign in to apply'}
              </button>
            ) : (
              <Alert tone="warning">
                {grant.state === 'upcoming'
                  ? `This call opens on ${formatDate(grant.openAt)}.`
                  : 'This call is closed for new applications.'}
              </Alert>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
