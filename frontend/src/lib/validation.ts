import type { FieldValue, Progress, Requirement, ValidationIssue } from './types';

const TEXTUAL = ['text', 'textarea', 'url', 'select'];
const NUMERIC = ['number', 'currency'];

export function isEmpty(requirement: Requirement, value: FieldValue): boolean {
  if (requirement.fieldType === 'checkbox') return value !== true;
  if (requirement.fieldType === 'multiselect') return !Array.isArray(value) || value.length === 0;
  return value === null || value === undefined || value === '';
}

function conditionMet(requirement: Requirement, values: Record<string, FieldValue>): boolean {
  const condition = requirement.validationsJson?.requiredIf;
  if (!condition) return true;
  return String(values[condition.key]) === String(condition.equals);
}

/**
 * Mirrors the server's rules so the applicant gets instant feedback. The API
 * runs the same checks again before accepting a submission.
 */
export function validate(
  requirements: Requirement[],
  values: Record<string, FieldValue>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (r: Requirement, message: string) => issues.push({ key: r.key, label: r.label, message });

  for (const requirement of requirements) {
    const value = values[requirement.key];
    const rules = requirement.validationsJson ?? {};

    if (isEmpty(requirement, value)) {
      if (requirement.required && conditionMet(requirement, values)) {
        add(
          requirement,
          requirement.fieldType === 'checkbox'
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

    if (TEXTUAL.includes(requirement.fieldType) || requirement.fieldType === 'textarea') {
      const text = String(value);
      if (rules.minLength !== undefined && text.length < rules.minLength) {
        add(requirement, `"${requirement.label}" must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && text.length > rules.maxLength) {
        add(requirement, `"${requirement.label}" must be at most ${rules.maxLength} characters`);
      }
      if (rules.regex) {
        try {
          if (!new RegExp(rules.regex).test(text)) add(requirement, `"${requirement.label}" has an invalid format`);
        } catch {
          /* ignore an invalid stored pattern */
        }
      }
    }

    if (requirement.fieldType === 'url') {
      try {
        new URL(String(value));
      } catch {
        add(requirement, `"${requirement.label}" must be a valid URL (including https://)`);
      }
    }
  }

  return issues;
}

export function computeProgress(
  requirements: Requirement[],
  values: Record<string, FieldValue>,
): Progress {
  const required = requirements.filter((r) => r.required);
  const filled = requirements.filter((r) => !isEmpty(r, values[r.key]));
  const requiredFilled = required.filter((r) => !isEmpty(r, values[r.key]));
  const percent =
    required.length === 0
      ? requirements.length === 0
        ? 100
        : Math.round((filled.length / requirements.length) * 100)
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

export function issuesByKey(issues: ValidationIssue[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) if (!map[issue.key]) map[issue.key] = issue.message;
  return map;
}
