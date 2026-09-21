import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Field from '../components/Field';
import { Alert, Loading, Modal, ProgressBar, Spinner, StatusBadge } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { ApiError, api, download } from '../lib/api';
import { daysUntil, formatDate, relativeTime } from '../lib/format';
import { computeProgress, issuesByKey, validate } from '../lib/validation';
import type { ApplicationDetail, FieldValue, UploadedFile } from '../lib/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 1500;

export default function ApplicationForm() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [files, setFiles] = useState<Record<string, UploadedFile | null>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverIssues, setServerIssues] = useState<string[]>([]);

  const dirtyKeys = useRef<Set<string>>(new Set());
  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const data = await api.get<ApplicationDetail>(`/applications/${id}`);
    setApplication(data);
    setValues(data.values);
    setFiles(data.files);
    setLastSaved(data.updated_at);
  }, [id]);

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

  const requirements = useMemo(() => application?.grant.requirements ?? [], [application]);
  const issues = useMemo(() => validate(requirements, values), [requirements, values]);
  const errorMap = useMemo(() => issuesByKey(issues), [issues]);
  const progress = useMemo(() => computeProgress(requirements, values), [requirements, values]);

  const editable = application?.status === 'draft';
  const deadlinePassed = application?.grant.deadline ? new Date(application.grant.deadline) < new Date() : false;

  const flush = useCallback(async () => {
    if (!application || dirtyKeys.current.size === 0) return;
    const keys = Array.from(dirtyKeys.current);
    dirtyKeys.current.clear();

    const payload = keys
      .map((key) => {
        const requirement = requirements.find((r) => r.key === key);
        if (!requirement) return null;
        return requirement.fieldType === 'file'
          ? { key, file_id: files[key]?.id ?? null }
          : { key, value: values[key] };
      })
      .filter(Boolean);

    if (payload.length === 0) return;

    setSaveState('saving');
    try {
      await api.put(`/applications/${application.id}/responses`, payload);
      setSaveState('saved');
      setLastSaved(new Date().toISOString());
    } catch (error) {
      setSaveState('error');
      keys.forEach((key) => dirtyKeys.current.add(key));
      toast.error(error instanceof Error ? error.message : 'Autosave failed');
    }
  }, [application, requirements, values, files, toast]);

  // Debounced autosave: every change restarts the timer, so typing is not chatty.
  useEffect(() => {
    if (!editable || dirtyKeys.current.size === 0) return undefined;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [values, files, editable, flush]);

  // Do not lose the last keystrokes when the tab is closed.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirtyKeys.current.size > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const onChange = (key: string, value: FieldValue) => {
    setValues((current) => ({ ...current, [key]: value }));
    dirtyKeys.current.add(key);
    setSaveState('idle');
  };

  const onFileChange = (key: string, file: UploadedFile | null) => {
    setFiles((current) => ({ ...current, [key]: file }));
    setValues((current) => ({ ...current, [key]: file?.id ?? null }));
    dirtyKeys.current.add(key);
    setSaveState('idle');
  };

  const saveNow = async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    await flush();
    if (dirtyKeys.current.size === 0) toast.success('Draft saved');
  };

  const submit = async () => {
    if (!application) return;
    setSubmitting(true);
    setServerIssues([]);
    try {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      await flush();
      await api.patch(`/applications/${application.id}`, { status: 'submitted' });
      setConfirmSubmit(false);
      toast.success('Application submitted — a confirmation is on its way');
      await load();
    } catch (error) {
      if (error instanceof ApiError && Array.isArray(error.details)) {
        setServerIssues((error.details as { message: string }[]).map((issue) => issue.message));
      }
      toast.error(error instanceof Error ? error.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (!application) return;
    if (!window.confirm('Withdraw this application? You can no longer edit it afterwards.')) return;
    try {
      await api.patch(`/applications/${application.id}`, { status: 'withdrawn' });
      toast.success('Application withdrawn');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not withdraw');
    }
  };

  if (loading) return <Loading label="Loading your application…" />;
  if (!application) {
    return (
      <Alert tone="error" title="Application not found">
        <Link to="/applications" className="font-semibold underline">
          Back to your applications
        </Link>
      </Alert>
    );
  }

  const remaining = daysUntil(application.grant.deadline);

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <Link to="/applications" className="text-sm font-medium text-brand-600 hover:underline">
            ← My applications
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{application.grant.title}</h1>
            <StatusBadge status={application.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Deadline {formatDate(application.grant.deadline, true)}
            {remaining !== null && remaining >= 0 ? ` · ${remaining} days left` : ''}
          </p>
        </div>

        {!editable && (
          <Alert tone={application.status === 'approved' ? 'success' : 'info'}>
            This application is <strong>{application.status_label.toLowerCase()}</strong> and can no longer be edited.
            {application.decision_note && (
              <p className="mt-2 whitespace-pre-line border-t border-current/10 pt-2">{application.decision_note}</p>
            )}
          </Alert>
        )}
        {editable && deadlinePassed && (
          <Alert tone="error" title="The deadline has passed">
            This application can no longer be submitted.
          </Alert>
        )}

        {showErrors && issues.length > 0 && (
          <Alert tone="error" title={`${issues.length} item${issues.length === 1 ? '' : 's'} still need attention`}>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {issues.map((issue) => (
                <li key={issue.key}>{issue.message}</li>
              ))}
            </ul>
          </Alert>
        )}
        {serverIssues.length > 0 && (
          <Alert tone="error" title="The server rejected the submission">
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {serverIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Alert>
        )}

        <form className="card divide-y divide-slate-100 p-6" onSubmit={(event) => event.preventDefault()}>
          {requirements.map((requirement) => (
            <div key={requirement.id} className="py-4 first:pt-0 last:pb-0">
              <Field
                requirement={requirement}
                value={values[requirement.key] ?? null}
                file={files[requirement.key]}
                error={showErrors ? errorMap[requirement.key] : undefined}
                disabled={!editable || deadlinePassed}
                onChange={onChange}
                onFileChange={onFileChange}
              />
            </div>
          ))}
        </form>
      </div>

      <aside className="space-y-4">
        <div className="card sticky top-20 space-y-5 p-6">
          <ProgressBar percent={progress.percent} label="Completed" />
          <p className="text-xs text-slate-500">
            {progress.requiredCompleted} of {progress.requiredTotal} required items filled in
            {progress.total > progress.requiredTotal &&
              ` · ${progress.completed}/${progress.total} including optional`}
          </p>

          {progress.missing.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Still missing</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {progress.missing.slice(0, 6).map((label) => (
                  <li key={label} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    {label}
                  </li>
                ))}
                {progress.missing.length > 6 && (
                  <li className="text-xs text-slate-400">and {progress.missing.length - 6} more…</li>
                )}
              </ul>
            </div>
          )}

          {editable && (
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="flex h-5 items-center gap-2 text-xs text-slate-500">
                {saveState === 'saving' && (
                  <>
                    <Spinner className="h-3.5 w-3.5" /> Saving…
                  </>
                )}
                {saveState === 'saved' && <span className="text-emerald-600">All changes saved</span>}
                {saveState === 'error' && <span className="text-red-600">Saving failed — retry below</span>}
                {saveState === 'idle' && lastSaved && <span>Last saved {relativeTime(lastSaved)}</span>}
              </div>
              <button type="button" className="btn-secondary w-full" onClick={saveNow}>
                Save draft
              </button>
              <button
                type="button"
                className="btn-primary w-full"
                disabled={deadlinePassed}
                onClick={() => {
                  setShowErrors(true);
                  if (issues.length === 0) setConfirmSubmit(true);
                  else toast.error('Complete the highlighted fields first');
                }}
              >
                Submit application
              </button>
            </div>
          )}

          <div className="space-y-2 border-t border-slate-100 pt-4">
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
            {application.allowed_transitions.includes('withdrawn') && (
              <button type="button" className="btn-danger w-full" onClick={withdraw}>
                Withdraw
              </button>
            )}
          </div>
        </div>
      </aside>

      <Modal
        open={confirmSubmit}
        title="Submit this application?"
        onClose={() => setConfirmSubmit(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmSubmit(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
              {submitting && <Spinner className="h-4 w-4 text-white" />}
              Yes, submit
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          After submitting you can no longer change your answers. You will receive a confirmation, and you can download
          a PDF copy at any time.
        </p>
      </Modal>
    </div>
  );
}
