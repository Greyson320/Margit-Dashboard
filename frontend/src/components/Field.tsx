import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import type { FieldValue, Requirement, UploadedFile } from '../lib/types';

type FieldProps = {
  requirement: Requirement;
  value: FieldValue;
  file?: UploadedFile | null;
  error?: string;
  disabled?: boolean;
  onChange: (key: string, value: FieldValue) => void;
  onFileChange?: (key: string, file: UploadedFile | null) => void;
};

/** Renders one requirement as the input its field_type calls for. */
export default function Field({
  requirement,
  value,
  file,
  error,
  disabled = false,
  onChange,
  onFileChange,
}: FieldProps) {
  const id = `field-${requirement.key}`;
  const describedBy = [requirement.helpText ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  const options = requirement.optionsJson ?? [];
  const rules = requirement.validationsJson ?? {};
  const inputClass = `input ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`;

  const set = (next: FieldValue) => onChange(requirement.key, next);

  return (
    <div className="py-1">
      <label htmlFor={id} className="label">
        {requirement.label}
        {requirement.required && <span className="ml-1 text-red-600" aria-hidden="true">*</span>}
      </label>

      {requirement.fieldType === 'text' && (
        <input
          id={id}
          type="text"
          className={inputClass}
          value={(value as string) ?? ''}
          disabled={disabled}
          maxLength={rules.maxLength}
          aria-describedby={describedBy || undefined}
          aria-invalid={Boolean(error)}
          onChange={(event) => set(event.target.value)}
        />
      )}

      {requirement.fieldType === 'textarea' && (
        <>
          <textarea
            id={id}
            rows={6}
            className={inputClass}
            value={(value as string) ?? ''}
            disabled={disabled}
            aria-describedby={describedBy || undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => set(event.target.value)}
          />
          {(rules.minLength || rules.maxLength) && (
            <p className="mt-1 text-right text-xs text-slate-500">
              {String(value ?? '').length}
              {rules.maxLength ? ` / ${rules.maxLength}` : ''} characters
              {rules.minLength ? ` (minimum ${rules.minLength})` : ''}
            </p>
          )}
        </>
      )}

      {(requirement.fieldType === 'number' || requirement.fieldType === 'currency') && (
        <div className="relative">
          {requirement.fieldType === 'currency' && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              €
            </span>
          )}
          <input
            id={id}
            type="number"
            inputMode="decimal"
            className={`${inputClass} ${requirement.fieldType === 'currency' ? 'pl-7' : ''}`}
            value={value === null || value === undefined ? '' : String(value)}
            min={rules.min}
            max={rules.max}
            disabled={disabled}
            aria-describedby={describedBy || undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => set(event.target.value === '' ? null : Number(event.target.value))}
          />
        </div>
      )}

      {requirement.fieldType === 'date' && (
        <input
          id={id}
          type="date"
          className={inputClass}
          value={(value as string) ?? ''}
          disabled={disabled}
          aria-describedby={describedBy || undefined}
          onChange={(event) => set(event.target.value || null)}
        />
      )}

      {requirement.fieldType === 'url' && (
        <input
          id={id}
          type="url"
          placeholder="https://"
          className={inputClass}
          value={(value as string) ?? ''}
          disabled={disabled}
          aria-describedby={describedBy || undefined}
          aria-invalid={Boolean(error)}
          onChange={(event) => set(event.target.value)}
        />
      )}

      {requirement.fieldType === 'select' && (
        <select
          id={id}
          className={inputClass}
          value={(value as string) ?? ''}
          disabled={disabled}
          aria-describedby={describedBy || undefined}
          onChange={(event) => set(event.target.value || null)}
        >
          <option value="">Select…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}

      {requirement.fieldType === 'multiselect' && (
        <div className="flex flex-wrap gap-2" role="group" aria-describedby={describedBy || undefined}>
          {options.map((option) => {
            const selected = Array.isArray(value) && value.includes(option);
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => {
                  const current = Array.isArray(value) ? [...value] : [];
                  set(selected ? current.filter((o) => o !== option) : [...current, option]);
                }}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  selected
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}

      {requirement.fieldType === 'checkbox' && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-300 bg-white p-3">
          <input
            id={id}
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={value === true}
            disabled={disabled}
            aria-describedby={describedBy || undefined}
            onChange={(event) => set(event.target.checked)}
          />
          <span className="text-sm text-slate-700">{requirement.helpText ?? 'I confirm the statement above'}</span>
        </label>
      )}

      {requirement.fieldType === 'file' && onFileChange && (
        <FileField
          id={id}
          requirement={requirement}
          file={file ?? null}
          disabled={disabled}
          onFileChange={onFileChange}
          describedBy={describedBy || undefined}
        />
      )}

      {requirement.helpText && requirement.fieldType !== 'checkbox' && (
        <p id={`${id}-help`} className="mt-1.5 text-xs text-slate-500">
          {requirement.helpText}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function FileField({
  id,
  requirement,
  file,
  disabled,
  onFileChange,
  describedBy,
}: {
  id: string;
  requirement: Requirement;
  file: UploadedFile | null;
  disabled: boolean;
  onFileChange: (key: string, file: UploadedFile | null) => void;
  describedBy?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const constraints = requirement.fileConstraintsJson ?? {};

  const handleFile = async (selected: File) => {
    setUploadError(null);
    if (constraints.maxMB && selected.size > constraints.maxMB * 1024 * 1024) {
      setUploadError(`File is larger than the ${constraints.maxMB} MB limit`);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', selected);
      const result = await api.upload<{ file_id: string; filename: string; size_bytes: string; mimetype: string }>(
        '/uploads',
        form,
      );
      onFileChange(requirement.key, {
        id: result.file_id,
        filename: result.filename,
        size_bytes: result.size_bytes,
        mimetype: result.mimetype,
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">{file.filename}</p>
          <p className="text-xs text-slate-500">{formatBytes(file.size_bytes)}</p>
        </div>
        {!disabled && (
          <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => onFileChange(requirement.key, null)}>
            Remove
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        className="sr-only"
        disabled={disabled || busy}
        aria-describedby={describedBy}
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected) void handleFile(selected);
        }}
      />
      <label
        htmlFor={id}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          disabled ? 'cursor-not-allowed border-slate-200 bg-slate-50' : 'border-slate-300 hover:border-brand-400 hover:bg-brand-50/40'
        }`}
      >
        <span className="text-sm font-medium text-slate-700">{busy ? 'Uploading…' : 'Choose a file'}</span>
        <span className="text-xs text-slate-500">
          {constraints.maxMB ? `Up to ${constraints.maxMB} MB` : 'PDF, Word, Excel, images or plain text'}
        </span>
      </label>
      {uploadError && <p className="mt-1.5 text-xs font-medium text-red-600">{uploadError}</p>}
    </div>
  );
}
