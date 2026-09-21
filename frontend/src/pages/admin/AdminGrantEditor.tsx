import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Field from '../../components/Field';
import { Alert, Loading, Pill } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { FIELD_TYPES, type FieldType, type FieldValue, type Grant, type Requirement, type Visibility } from '../../lib/types';

type DraftRequirement = {
  localId: string;
  key: string;
  label: string;
  field_type: FieldType;
  help_text: string;
  required: boolean;
  options: string[];
  validations: { min?: number; max?: number; minLength?: number; maxLength?: number };
  file_constraints: { maxMB?: number };
};

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
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

const newLocalId = () => Math.random().toString(36).slice(2, 10);

function toKey(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'field';
  let candidate = base;
  let n = 1;
  while (taken.includes(candidate)) candidate = `${base}_${++n}`;
  return candidate;
}

function fromApi(requirement: Requirement): DraftRequirement {
  return {
    localId: newLocalId(),
    key: requirement.key,
    label: requirement.label,
    field_type: requirement.fieldType,
    help_text: requirement.helpText ?? '',
    required: requirement.required,
    options: requirement.optionsJson ?? [],
    validations: requirement.validationsJson ?? {},
    file_constraints: requirement.fileConstraintsJson ?? {},
  };
}

/** The draft shape rendered by the live preview. */
function toPreview(draft: DraftRequirement, index: number): Requirement {
  return {
    id: draft.localId,
    key: draft.key,
    label: draft.label || 'Untitled field',
    fieldType: draft.field_type,
    helpText: draft.help_text || null,
    required: draft.required,
    optionsJson: draft.options.length > 0 ? draft.options : null,
    validationsJson: draft.validations,
    fileConstraintsJson: draft.file_constraints,
    orderIndex: index,
  };
}

const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '');
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export default function AdminGrantEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, FieldValue>>({});

  const [form, setForm] = useState({
    title: '',
    description: '',
    eligibility: '',
    expected_impact: '',
    max_amount: '',
    currency: 'EUR',
    deadline: '',
    open_at: '',
    target_groups: '',
    visibility: 'public' as Visibility,
  });
  const [requirements, setRequirements] = useState<DraftRequirement[]>([]);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      try {
        const grant = await api.get<Grant>(`/grants/${id}`);
        if (cancelled) return;
        setForm({
          title: grant.title,
          description: grant.description,
          eligibility: grant.eligibility ?? '',
          expected_impact: grant.expectedImpact ?? '',
          max_amount: grant.maxAmount === null ? '' : String(grant.maxAmount),
          currency: grant.currency,
          deadline: toLocalInput(grant.deadline),
          open_at: toLocalInput(grant.openAt),
          target_groups: (grant.targetGroups ?? []).join(', '),
          visibility: grant.visibility,
        });
        setRequirements(grant.requirements.map(fromApi));
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load the grant');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const updateRequirement = (localId: string, patch: Partial<DraftRequirement>) =>
    setRequirements((current) => current.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));

  const addRequirement = () =>
    setRequirements((current) => [
      ...current,
      {
        localId: newLocalId(),
        key: toKey('new field', current.map((r) => r.key)),
        label: 'New field',
        field_type: 'text',
        help_text: '',
        required: true,
        options: [],
        validations: {},
        file_constraints: {},
      },
    ]);

  const move = (index: number, direction: -1 | 1) =>
    setRequirements((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const previewRequirements = useMemo(() => requirements.map(toPreview), [requirements]);

  const save = async () => {
    setError(null);

    if (!form.title.trim() || form.description.trim().length < 10) {
      setError('A title and a description of at least 10 characters are required.');
      return;
    }
    const keys = requirements.map((r) => r.key);
    if (new Set(keys).size !== keys.length) {
      setError('Every field needs a unique key.');
      return;
    }
    const emptyOptions = requirements.find(
      (r) => (r.field_type === 'select' || r.field_type === 'multiselect') && r.options.length === 0,
    );
    if (emptyOptions) {
      setError(`"${emptyOptions.label}" is a choice field, so it needs at least one option.`);
      return;
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      eligibility: form.eligibility.trim() || null,
      expected_impact: form.expected_impact.trim() || null,
      max_amount: form.max_amount === '' ? null : Number(form.max_amount),
      currency: form.currency,
      deadline: toIso(form.deadline),
      open_at: toIso(form.open_at),
      target_groups: form.target_groups
        .split(',')
        .map((group) => group.trim())
        .filter(Boolean),
      visibility: form.visibility,
      requirements: requirements.map((requirement, index) => ({
        key: requirement.key,
        label: requirement.label,
        field_type: requirement.field_type,
        help_text: requirement.help_text || null,
        required: requirement.required,
        options: requirement.options.length > 0 ? requirement.options : null,
        validations: Object.keys(requirement.validations).length > 0 ? requirement.validations : null,
        file_constraints:
          requirement.field_type === 'file' && requirement.file_constraints.maxMB
            ? requirement.file_constraints
            : null,
        order_index: index + 1,
      })),
    };

    setSaving(true);
    try {
      if (isNew) {
        const created = await api.post<Grant>('/grants', payload);
        toast.success('Grant created');
        navigate(`/admin/grants/${created.id}`, { replace: true });
      } else {
        await api.patch(`/grants/${id}`, payload);
        toast.success('Grant saved');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the grant');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/admin/grants" className="text-sm font-medium text-brand-600 hover:underline">
            ← All grants
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {isNew ? 'New grant' : form.title || 'Edit grant'}
          </h1>
        </div>
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create grant' : 'Save changes'}
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <section className="card space-y-4 p-6">
            <h2 className="text-base font-semibold text-slate-900">Basics</h2>
            <div>
              <label htmlFor="title" className="label">
                Title
              </label>
              <input id="title" className="input" value={form.title} onChange={set('title')} />
            </div>
            <div>
              <label htmlFor="description" className="label">
                Description
              </label>
              <textarea id="description" rows={5} className="input" value={form.description} onChange={set('description')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="max_amount" className="label">
                  Maximum amount
                </label>
                <input id="max_amount" type="number" min={0} className="input" value={form.max_amount} onChange={set('max_amount')} />
              </div>
              <div>
                <label htmlFor="currency" className="label">
                  Currency
                </label>
                <select id="currency" className="input" value={form.currency} onChange={set('currency')}>
                  {['EUR', 'USD', 'GBP'].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="open_at" className="label">
                  Opens at
                </label>
                <input id="open_at" type="datetime-local" className="input" value={form.open_at} onChange={set('open_at')} />
              </div>
              <div>
                <label htmlFor="deadline" className="label">
                  Deadline
                </label>
                <input id="deadline" type="datetime-local" className="input" value={form.deadline} onChange={set('deadline')} />
              </div>
            </div>
            <div>
              <label htmlFor="target_groups" className="label">
                Target groups <span className="font-normal text-slate-400">(comma separated)</span>
              </label>
              <input id="target_groups" className="input" value={form.target_groups} onChange={set('target_groups')} />
            </div>
            <div>
              <label htmlFor="eligibility" className="label">
                Eligibility
              </label>
              <textarea id="eligibility" rows={3} className="input" value={form.eligibility} onChange={set('eligibility')} />
            </div>
            <div>
              <label htmlFor="expected_impact" className="label">
                Expected impact
              </label>
              <textarea
                id="expected_impact"
                rows={3}
                className="input"
                value={form.expected_impact}
                onChange={set('expected_impact')}
              />
            </div>
            <div>
              <label htmlFor="visibility" className="label">
                Visibility
              </label>
              <select id="visibility" className="input" value={form.visibility} onChange={set('visibility')}>
                <option value="public">Public — visible in the catalogue</option>
                <option value="internal">Internal — staff only</option>
                <option value="archived">Archived — closed and hidden</option>
              </select>
            </div>
          </section>

          <section className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Requirements</h2>
                <p className="text-xs text-slate-500">These become the application form, in this order.</p>
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={addRequirement}>
                + Add field
              </button>
            </div>

            {requirements.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No fields yet. Add the first one.</p>
            ) : (
              <ul className="space-y-3">
                {requirements.map((requirement, index) => (
                  <RequirementEditor
                    key={requirement.localId}
                    requirement={requirement}
                    index={index}
                    total={requirements.length}
                    otherKeys={requirements.filter((r) => r.localId !== requirement.localId).map((r) => r.key)}
                    onChange={(patch) => updateRequirement(requirement.localId, patch)}
                    onMove={(direction) => move(index, direction)}
                    onRemove={() =>
                      setRequirements((current) => current.filter((r) => r.localId !== requirement.localId))
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <section className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Applicant preview</h2>
              <Pill tone="brand">Live</Pill>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Exactly what an applicant sees. Try it out — nothing here is saved.
            </p>
            {previewRequirements.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">Add a field to see the form.</p>
            ) : (
              <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto pr-1">
                {previewRequirements.map((requirement) => (
                  <div key={requirement.id} className="py-4 first:pt-0">
                    <Field
                      requirement={requirement}
                      value={previewValues[requirement.key] ?? null}
                      onChange={(key, value) => setPreviewValues((current) => ({ ...current, [key]: value }))}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function RequirementEditor({
  requirement,
  index,
  total,
  otherKeys,
  onChange,
  onMove,
  onRemove,
}: {
  requirement: DraftRequirement;
  index: number;
  total: number;
  otherKeys: string[];
  onChange: (patch: Partial<DraftRequirement>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isChoice = requirement.field_type === 'select' || requirement.field_type === 'multiselect';
  const isNumeric = requirement.field_type === 'number' || requirement.field_type === 'currency';
  const isTextual = ['text', 'textarea', 'url'].includes(requirement.field_type);
  const duplicateKey = otherKeys.includes(requirement.key);

  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label text-xs">Label</label>
              <input
                className="input"
                value={requirement.label}
                onChange={(event) => {
                  const label = event.target.value;
                  // Keys stay stable once touched; only auto-fill from the default label.
                  const autoKey = requirement.key === 'new_field' || requirement.key.startsWith('new_field');
                  onChange({ label, ...(autoKey ? { key: toKey(label, otherKeys) } : {}) });
                }}
              />
            </div>
            <div>
              <label className="label text-xs">Field type</label>
              <select
                className="input"
                value={requirement.field_type}
                onChange={(event) => onChange({ field_type: event.target.value as FieldType })}
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {FIELD_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isChoice && (
            <div>
              <label className="label text-xs">Options (comma separated)</label>
              <input
                className="input"
                value={requirement.options.join(', ')}
                onChange={(event) =>
                  onChange({
                    options: event.target.value
                      .split(',')
                      .map((option) => option.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={requirement.required}
                onChange={(event) => onChange({ required: event.target.checked })}
              />
              Required
            </label>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setExpanded((value) => !value)}>
              {expanded ? 'Hide advanced' : 'Advanced'}
            </button>
            <div className="ml-auto flex gap-1">
              <button type="button" className="btn-ghost btn-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
                ↑
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={index === total - 1}
                onClick={() => onMove(1)}
                aria-label="Move down"
              >
                ↓
              </button>
              <button type="button" className="btn-ghost btn-sm text-red-600" onClick={onRemove}>
                Delete
              </button>
            </div>
          </div>

          {expanded && (
            <div className="space-y-3 rounded-lg bg-slate-50 p-3">
              <div>
                <label className="label text-xs">Help text</label>
                <input
                  className="input"
                  value={requirement.help_text}
                  onChange={(event) => onChange({ help_text: event.target.value })}
                />
              </div>
              <div>
                <label className="label text-xs">Key (used in exports and the API)</label>
                <input
                  className={`input ${duplicateKey ? 'border-red-400' : ''}`}
                  value={requirement.key}
                  onChange={(event) => onChange({ key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                />
                {duplicateKey && <p className="mt-1 text-xs font-medium text-red-600">This key is already used.</p>}
              </div>

              {isNumeric && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Minimum</label>
                    <input
                      type="number"
                      className="input"
                      value={requirement.validations.min ?? ''}
                      onChange={(event) =>
                        onChange({
                          validations: {
                            ...requirement.validations,
                            min: event.target.value === '' ? undefined : Number(event.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Maximum</label>
                    <input
                      type="number"
                      className="input"
                      value={requirement.validations.max ?? ''}
                      onChange={(event) =>
                        onChange({
                          validations: {
                            ...requirement.validations,
                            max: event.target.value === '' ? undefined : Number(event.target.value),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {(isTextual || requirement.field_type === 'textarea') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Minimum length</label>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={requirement.validations.minLength ?? ''}
                      onChange={(event) =>
                        onChange({
                          validations: {
                            ...requirement.validations,
                            minLength: event.target.value === '' ? undefined : Number(event.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Maximum length</label>
                    <input
                      type="number"
                      min={1}
                      className="input"
                      value={requirement.validations.maxLength ?? ''}
                      onChange={(event) =>
                        onChange({
                          validations: {
                            ...requirement.validations,
                            maxLength: event.target.value === '' ? undefined : Number(event.target.value),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {requirement.field_type === 'file' && (
                <div>
                  <label className="label text-xs">Maximum file size (MB)</label>
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={requirement.file_constraints.maxMB ?? ''}
                    onChange={(event) =>
                      onChange({
                        file_constraints: {
                          maxMB: event.target.value === '' ? undefined : Number(event.target.value),
                        },
                      })
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
