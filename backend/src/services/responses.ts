import { ApplicationResponse, FieldType, Prisma, Requirement } from '@prisma/client';
import { badRequest } from '../lib/errors';

export type RawValue = string | number | boolean | string[] | null | undefined;

export type ResponseInput = {
  requirement_id?: string | number;
  key?: string;
  value?: RawValue;
  file_id?: string | number | null;
};

export type ValidationIssue = { key: string; label: string; message: string };

export type Validations = {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  regex?: string;
  requiredIf?: { key: string; equals: unknown };
};

export type FileConstraints = { mimetypes?: string[]; maxMB?: number };

export const FIELD_TYPES = Object.values(FieldType) as FieldType[];

export function parseValidations(requirement: Requirement): Validations {
  return (requirement.validationsJson as Validations | null) ?? {};
}

export function parseOptions(requirement: Requirement): string[] {
  const raw = requirement.optionsJson;
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

export function parseFileConstraints(requirement: Requirement): FileConstraints {
  return (requirement.fileConstraintsJson as FileConstraints | null) ?? {};
}

const TEXTUAL: FieldType[] = [FieldType.text, FieldType.textarea, FieldType.url, FieldType.select];
const NUMERIC: FieldType[] = [FieldType.number, FieldType.currency];

export type ResponseColumns = {
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueDate: Date | null;
  valueJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
  fileId: bigint | null;
};

/** Maps an incoming value onto the typed column that matches the field type. */
export function toColumns(requirement: Requirement, value: RawValue, fileId: bigint | null): ResponseColumns {
  const empty: ResponseColumns = {
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueJson: Prisma.DbNull,
    fileId: null,
  };

  if (requirement.fieldType === FieldType.file) {
    return { ...empty, fileId };
  }
  if (value === null || value === undefined || value === '') return empty;

  if (TEXTUAL.includes(requirement.fieldType) || requirement.fieldType === FieldType.textarea) {
    return { ...empty, valueText: String(value) };
  }
  if (NUMERIC.includes(requirement.fieldType)) {
    const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (Number.isNaN(num)) throw badRequest(`"${requirement.label}" must be a number`);
    return { ...empty, valueNumber: new Prisma.Decimal(num) };
  }
  if (requirement.fieldType === FieldType.date) {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw badRequest(`"${requirement.label}" must be a valid date`);
    return { ...empty, valueDate: date };
  }
  if (requirement.fieldType === FieldType.checkbox) {
    return { ...empty, valueJson: Boolean(value) };
  }
  if (requirement.fieldType === FieldType.multiselect) {
    const list = Array.isArray(value) ? value.map(String) : [String(value)];
    return { ...empty, valueJson: list };
  }
  return { ...empty, valueText: String(value) };
}

/** Reverses `toColumns` so the frontend receives one plain value per field. */
export function fromColumns(requirement: Requirement, row: ApplicationResponse | undefined): RawValue {
  if (!row) return requirement.fieldType === FieldType.checkbox ? false : null;
  if (requirement.fieldType === FieldType.file) return row.fileId ? row.fileId.toString() : null;
  if (NUMERIC.includes(requirement.fieldType)) return row.valueNumber === null ? null : Number(row.valueNumber);
  if (requirement.fieldType === FieldType.date) {
    return row.valueDate ? row.valueDate.toISOString().slice(0, 10) : null;
  }
  if (requirement.fieldType === FieldType.checkbox) return Boolean(row.valueJson);
  if (requirement.fieldType === FieldType.multiselect) {
    return Array.isArray(row.valueJson) ? (row.valueJson as string[]) : [];
  }
  return row.valueText;
}

function isEmpty(requirement: Requirement, value: RawValue): boolean {
  if (requirement.fieldType === FieldType.checkbox) return value !== true;
  if (requirement.fieldType === FieldType.multiselect) return !Array.isArray(value) || value.length === 0;
  return value === null || value === undefined || value === '';
}

function conditionMet(validations: Validations, values: Record<string, RawValue>): boolean {
  if (!validations.requiredIf) return true;
  const other = values[validations.requiredIf.key];
  return String(other) === String(validations.requiredIf.equals);
}

/**
 * Server-side validation of a whole application against the requirements the
 * admin defined. The same rules run in the browser, but this is the authority.
 */
export function validateResponses(
  requirements: Requirement[],
  values: Record<string, RawValue>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (r: Requirement, message: string) => issues.push({ key: r.key, label: r.label, message });

  for (const requirement of requirements) {
    const value = values[requirement.key];
    const rules = parseValidations(requirement);
    const mustBeFilled = requirement.required && conditionMet(rules, values);

    if (isEmpty(requirement, value)) {
      if (mustBeFilled) {
        add(
          requirement,
          requirement.fieldType === FieldType.checkbox
            ? `"${requirement.label}" must be checked`
            : `"${requirement.label}" is required`,
        );
      }
      continue;
    }

    if (NUMERIC.includes(requirement.fieldType)) {
      const num = Number(value);
      if (Number.isNaN(num)) add(requirement, `"${requirement.label}" must be a number`);
      else {
        if (rules.min !== undefined && num < rules.min) {
          add(requirement, `"${requirement.label}" must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && num > rules.max) {
          add(requirement, `"${requirement.label}" must be at most ${rules.max}`);
        }
      }
    }

    if (TEXTUAL.includes(requirement.fieldType) || requirement.fieldType === FieldType.textarea) {
      const text = String(value);
      if (rules.minLength !== undefined && text.length < rules.minLength) {
        add(requirement, `"${requirement.label}" must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && text.length > rules.maxLength) {
        add(requirement, `"${requirement.label}" must be at most ${rules.maxLength} characters`);
      }
      if (rules.regex) {
        try {
          if (!new RegExp(rules.regex).test(text)) {
            add(requirement, `"${requirement.label}" has an invalid format`);
          }
        } catch {
          /* an invalid stored pattern should not block the applicant */
        }
      }
    }

    if (requirement.fieldType === FieldType.url) {
      try {
        // eslint-disable-next-line no-new
        new URL(String(value));
      } catch {
        add(requirement, `"${requirement.label}" must be a valid URL (including https://)`);
      }
    }

    if (requirement.fieldType === FieldType.select) {
      const options = parseOptions(requirement);
      if (options.length > 0 && !options.includes(String(value))) {
        add(requirement, `"${requirement.label}" must be one of: ${options.join(', ')}`);
      }
    }

    if (requirement.fieldType === FieldType.multiselect) {
      const options = parseOptions(requirement);
      const chosen = Array.isArray(value) ? value : [];
      const invalid = chosen.filter((c) => options.length > 0 && !options.includes(String(c)));
      if (invalid.length > 0) {
        add(requirement, `"${requirement.label}" contains invalid options: ${invalid.join(', ')}`);
      }
    }
  }

  return issues;
}

export type Progress = {
  total: number;
  completed: number;
  requiredTotal: number;
  requiredCompleted: number;
  percent: number;
  missing: string[];
};

/** Drives the applicant's "how far am I?" progress bar. */
export function computeProgress(
  requirements: Requirement[],
  values: Record<string, RawValue>,
): Progress {
  const required = requirements.filter((r) => r.required);
  const filled = requirements.filter((r) => !isEmpty(r, values[r.key]));
  const requiredFilled = required.filter((r) => !isEmpty(r, values[r.key]));
  const percent = required.length === 0
    ? (requirements.length === 0 ? 100 : Math.round((filled.length / requirements.length) * 100))
    : Math.round((requiredFilled.length / required.length) * 100);

  return {
    total: requirements.length,
    completed: filled.length,
    requiredTotal: required.length,
    requiredCompleted: requiredFilled.length,
    percent,
    missing: required.filter((r) => isEmpty(r, values[r.key])).map((r) => r.label),
  };
}
