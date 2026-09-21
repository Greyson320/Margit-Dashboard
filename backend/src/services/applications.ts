import { ApplicationStatus, Prisma, Requirement, Role } from '@prisma/client';
import { prisma } from '../db';
import { forbidden, notFound } from '../lib/errors';
import { AuthUser, isStaff } from '../middleware/auth';
import { RawValue, computeProgress, fromColumns } from './responses';

export const applicationInclude = {
  grant: { include: { requirements: { orderBy: { orderIndex: 'asc' } } } },
  user: { select: { id: true, name: true, email: true, organization: true } },
  responses: { include: { file: true } },
  reviews: { include: { reviewer: { select: { id: true, name: true, email: true } } } },
} satisfies Prisma.ApplicationInclude;

export type FullApplication = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>;

/** Loads an application and enforces that the caller may see it. */
export async function loadApplication(id: bigint, user: AuthUser): Promise<FullApplication> {
  const application = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
  if (!application) throw notFound('Application not found');
  if (!isStaff(user.role) && application.userId !== user.id) throw forbidden();
  return application;
}

/** Flattens stored responses into the `{ requirement_key: value }` shape the form uses. */
export function valuesOf(application: FullApplication): Record<string, RawValue> {
  const byRequirement = new Map(application.responses.map((r) => [r.requirementId.toString(), r]));
  const values: Record<string, RawValue> = {};
  for (const requirement of application.grant.requirements) {
    values[requirement.key] = fromColumns(requirement, byRequirement.get(requirement.id.toString()));
  }
  return values;
}

export function filesOf(application: FullApplication) {
  const byRequirement = new Map(application.responses.map((r) => [r.requirementId.toString(), r]));
  const files: Record<string, { id: string; filename: string; size_bytes: string; mimetype: string } | null> = {};
  for (const requirement of application.grant.requirements) {
    const row = byRequirement.get(requirement.id.toString());
    files[requirement.key] = row?.file
      ? {
          id: row.file.id.toString(),
          filename: row.file.filename,
          size_bytes: row.file.sizeBytes.toString(),
          mimetype: row.file.mimetype,
        }
      : null;
  }
  return files;
}

export function progressOf(application: FullApplication) {
  return computeProgress(application.grant.requirements as Requirement[], valuesOf(application));
}

const APPLICANT_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  [ApplicationStatus.draft]: [ApplicationStatus.submitted, ApplicationStatus.withdrawn],
  [ApplicationStatus.submitted]: [ApplicationStatus.withdrawn],
  [ApplicationStatus.under_review]: [ApplicationStatus.withdrawn],
};

const STAFF_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  [ApplicationStatus.draft]: [ApplicationStatus.withdrawn],
  [ApplicationStatus.submitted]: [
    ApplicationStatus.under_review,
    ApplicationStatus.approved,
    ApplicationStatus.rejected,
    ApplicationStatus.withdrawn,
  ],
  [ApplicationStatus.under_review]: [
    ApplicationStatus.approved,
    ApplicationStatus.rejected,
    ApplicationStatus.submitted,
    ApplicationStatus.withdrawn,
  ],
  [ApplicationStatus.approved]: [ApplicationStatus.under_review],
  [ApplicationStatus.rejected]: [ApplicationStatus.under_review],
  [ApplicationStatus.withdrawn]: [ApplicationStatus.draft],
};

export function allowedTransitions(from: ApplicationStatus, role: Role): ApplicationStatus[] {
  const table = role === Role.applicant ? APPLICANT_TRANSITIONS : STAFF_TRANSITIONS;
  return table[from] ?? [];
}

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export async function averageScore(applicationId: bigint): Promise<number | null> {
  const result = await prisma.review.aggregate({
    where: { applicationId, score: { not: null } },
    _avg: { score: true },
  });
  return result._avg.score === null ? null : Number(result._avg.score);
}
