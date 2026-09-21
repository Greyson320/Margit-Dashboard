import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { STATUS_LABELS, formatBytes, formatDate, formatMoney, relativeTime } from '../../lib/format';
import { Alert, Loading, Modal, ProgressBar, StatusBadge } from '../../components/ui';
import type { ApplicationDetail, ApplicationStatus, FieldValue, Requirement } from '../../lib/types';

export default function AdminApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, hasRole } = useAuth();
  const toast = useToast();

  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<ApplicationStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const [score, setScore] = useState('');
  const [notes, setNotes] = useState('');
  const [recommendation, setRecommendation] = useState<'approve' | 'reject' | 'needs_more_info' | ''>('');

  const load = useCallback(async () => {
    const data = await api.get<ApplicationDetail>(`/applications/${id}`);
    setApplication(data);
    const mine = data.reviews.find((review) => review.reviewerId === user?.id);
    setScore(mine?.score !== null && mine?.score !== undefined ? String(mine.score) : '');
    setNotes(mine?.notes ?? '');
    setRecommendation(mine?.recommendation ?? '');
  }, [id, user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Could not load the application');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const changeStatus = async (status: ApplicationStatus, withNote?: string) => {
    setBusy(true);
    try {
      await api.patch(`/applications/${id}`, { status, note: withNote });
      toast.success(`Status changed to “${STATUS_LABELS[status]}” — the applicant has been notified`);
      setDecision(null);
      setNote('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change the status');
    } finally {
      setBusy(false);
    }
  };

  const saveReview = async () => {
    setBusy(true);
    try {
      await api.post('/reviews', {
        application_id: id,
        score: score === '' ? null : Number(score),
        notes: notes || null,
        recommendation: recommendation || null,
      });
      toast.success('Review saved');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the review');
    } finally {
      setBusy(false);
    }
  };

  const sendReminder = async () => {
    try {
      const result = await api.post<{ missing: string[] }>(`/applications/${id}/remind`);
      toast.success(
        result.missing.length > 0
          ? `Reminder sent about ${result.missing.length} missing item${result.missing.length === 1 ? '' : 's'}`
          : 'Reminder sent',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the reminder');
    }
  };

  if (loading) return <Loading />;
  if (!application) return <Alert tone="error">This application could not be loaded.</Alert>;

  const decisionStatuses = application.allowed_transitions.filter((status) =>
    ['approved', 'rejected'].includes(status),
  );

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <Link to="/admin/applications" className="text-sm font-medium text-brand-600 hover:underline">
            ← All applications
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{application.grant.title}</h1>
            <StatusBadge status={application.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {application.applicant.name} ·{' '}
            <a href={`mailto:${application.applicant.email}`} className="text-brand-600 hover:underline">
              {application.applicant.email}
            </a>
            {application.applicant.organization ? ` · ${application.applicant.organization}` : ''}
          </p>
        </div>

        {application.decision_note && (
          <Alert tone={application.status === 'approved' ? 'success' : 'info'} title="Decision note">
            <p className="whitespace-pre-line">{application.decision_note}</p>
          </Alert>
        )}

        <section className="card p-6">
          <h2 className="text-base font-semibold text-slate-900">Answers</h2>
          <dl className="mt-4 divide-y divide-slate-100">
            {application.grant.requirements.map((requirement) => (
              <AnswerRow
                key={requirement.id}
                requirement={requirement}
                value={application.values[requirement.key] ?? null}
                file={application.files[requirement.key] ?? null}
                currency={application.grant.currency}
                onDownload={(fileId, filename) =>
                  download(`/uploads/${fileId}`, filename).catch(() => toast.error('Download failed'))
                }
              />
            ))}
          </dl>
        </section>

        <section className="card p-6">
          <h2 className="text-base font-semibold text-slate-900">Your review</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="score" className="label">
                Score (0–100)
              </label>
              <input
                id="score"
                type="number"
                min={0}
                max={100}
                className="input"
                value={score}
                onChange={(event) => setScore(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="recommendation" className="label">
                Recommendation
              </label>
              <select
                id="recommendation"
                className="input"
                value={recommendation}
                onChange={(event) => setRecommendation(event.target.value as typeof recommendation)}
              >
                <option value="">No recommendation</option>
                <option value="approve">Approve</option>
                <option value="needs_more_info">Needs more information</option>
                <option value="reject">Reject</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label htmlFor="notes" className="label">
              Notes
            </label>
            <textarea
              id="notes"
              rows={4}
              className="input"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Strengths, risks, conditions…"
            />
          </div>
          <button type="button" className="btn-primary mt-4" onClick={saveReview} disabled={busy}>
            Save review
          </button>

          {application.reviews.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-800">
                All reviews ({application.reviews.length})
                {application.average_score !== null && (
                  <span className="ml-2 font-normal text-slate-500">average {application.average_score.toFixed(1)}</span>
                )}
              </h3>
              <ul className="mt-3 space-y-3">
                {application.reviews.map((review) => (
                  <li key={review.id} className="rounded-xl bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">{review.reviewer.name}</span>
                      <span className="text-xs text-slate-500">
                        {review.score !== null ? `Score ${review.score}` : 'No score'} · {relativeTime(review.updatedAt)}
                      </span>
                    </div>
                    {review.recommendation && (
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {review.recommendation.replace(/_/g, ' ')}
                      </p>
                    )}
                    {review.notes && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{review.notes}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <div className="card sticky top-20 space-y-5 p-6">
          <div>
            <ProgressBar percent={application.progress.percent} label="Completeness" />
            {application.progress.missing.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                Missing: {application.progress.missing.join(', ')}
              </p>
            )}
          </div>

          <dl className="space-y-3 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Submitted</dt>
              <dd className="font-medium text-slate-800">{formatDate(application.submitted_at, true)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Deadline</dt>
              <dd className="font-medium text-slate-800">{formatDate(application.grant.deadline)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Maximum</dt>
              <dd className="font-medium text-slate-800">
                {formatMoney(application.grant.max_amount, application.grant.currency)}
              </dd>
            </div>
          </dl>

          <div className="space-y-2 border-t border-slate-100 pt-4">
            {application.allowed_transitions.includes('under_review') && (
              <button
                type="button"
                className="btn-secondary w-full"
                disabled={busy}
                onClick={() => changeStatus('under_review')}
              >
                Start review
              </button>
            )}
            {hasRole('admin') &&
              decisionStatuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={status === 'approved' ? 'btn-primary w-full' : 'btn-danger w-full'}
                  disabled={busy}
                  onClick={() => setDecision(status)}
                >
                  {status === 'approved' ? 'Approve' : 'Reject'}
                </button>
              ))}
            <button type="button" className="btn-secondary w-full" onClick={sendReminder}>
              Send reminder
            </button>
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() =>
                download(`/applications/${application.id}/pdf`, `application-${application.id}.pdf`).catch(() =>
                  toast.error('Download failed'),
                )
              }
            >
              Download PDF
            </button>
          </div>
        </div>
      </aside>

      <Modal
        open={decision !== null}
        title={decision === 'approved' ? 'Approve this application?' : 'Reject this application?'}
        onClose={() => setDecision(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDecision(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={decision === 'approved' ? 'btn-primary' : 'btn-danger'}
              disabled={busy}
              onClick={() => decision && changeStatus(decision, note || undefined)}
            >
              Confirm
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          The applicant receives a notification with this decision. Anything you write below is included in the message.
        </p>
        <label htmlFor="decision-note" className="label">
          Note to the applicant <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="decision-note"
          rows={4}
          className="input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Modal>
    </div>
  );
}

function AnswerRow({
  requirement,
  value,
  file,
  currency,
  onDownload,
}: {
  requirement: Requirement;
  value: FieldValue;
  file: { id: string; filename: string; size_bytes: string } | null;
  currency: string;
  onDownload: (fileId: string, filename: string) => void;
}) {
  let rendered: React.ReactNode;

  if (requirement.fieldType === 'file') {
    rendered = file ? (
      <button type="button" className="text-brand-600 hover:underline" onClick={() => onDownload(file.id, file.filename)}>
        {file.filename} <span className="text-slate-400">({formatBytes(file.size_bytes)})</span>
      </button>
    ) : (
      <span className="text-slate-400">Not uploaded</span>
    );
  } else if (requirement.fieldType === 'checkbox') {
    rendered = value === true ? 'Yes' : <span className="text-slate-400">No</span>;
  } else if (requirement.fieldType === 'currency') {
    rendered = value === null || value === '' ? <span className="text-slate-400">—</span> : formatMoney(Number(value), currency);
  } else if (Array.isArray(value)) {
    rendered = value.length > 0 ? value.join(', ') : <span className="text-slate-400">—</span>;
  } else if (value === null || value === undefined || value === '') {
    rendered = <span className="text-slate-400">—</span>;
  } else if (requirement.fieldType === 'url') {
    rendered = (
      <a href={String(value)} target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:underline">
        {String(value)}
      </a>
    );
  } else {
    rendered = <span className="whitespace-pre-line">{String(value)}</span>;
  }

  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-slate-600">{requirement.label}</dt>
      <dd className="text-sm text-slate-900 sm:col-span-2">{rendered}</dd>
    </div>
  );
}
