import { Router } from 'express';
import { z } from 'zod';
import { ApplicationStatus, FieldType, Prisma, Role, Visibility } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../lib/async';
import { jsonSafe, toBigInt } from '../lib/serialize';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { AuthedRequest, isStaff, requireAuth } from '../middleware/auth';
import { recordAudit } from '../services/audit';
import { notify, templates } from '../services/notifications';
import {
  STATUS_LABELS,
  allowedTransitions,
  applicationInclude,
  averageScore,
  filesOf,
  loadApplication,
  progressOf,
  valuesOf,
} from '../services/applications';
import { ResponseInput, toColumns, validateResponses } from '../services/responses';
import { renderApplicationPdf } from '../services/pdf';
import { toCsv } from '../services/csv';

const router = Router();

async function present(application: Awaited<ReturnType<typeof loadApplication>>) {
  return {
    ...(jsonSafe({
      id: application.id,
      status: application.status,
      status_label: STATUS_LABELS[application.status],
      submitted_at: application.submittedAt,
      decided_at: application.decidedAt,
      decision_note: application.decisionNote,
      created_at: application.createdAt,
      updated_at: application.updatedAt,
      applicant: application.user,
      grant: {
        id: application.grant.id,
        title: application.grant.title,
        slug: application.grant.slug,
        description: application.grant.description,
        deadline: application.grant.deadline,
        currency: application.grant.currency,
        max_amount: application.grant.maxAmount,
        requirements: application.grant.requirements,
      },
      reviews: application.reviews,
    }) as object),
    values: jsonSafe(valuesOf(application)),
    files: filesOf(application),
    progress: progressOf(application),
    average_score: await averageScore(application.id),
  };
}

/** Trimmed shape for list views. */
function summarize(row: Prisma.ApplicationGetPayload<{
  include: { grant: { select: { id: true; title: true; slug: true; deadline: true } }; user: { select: { id: true; name: true; email: true; organization: true } }; _count: { select: { reviews: true } } };
}>) {
  return jsonSafe({
    id: row.id,
    status: row.status,
    status_label: STATUS_LABELS[row.status],
    submitted_at: row.submittedAt,
    updated_at: row.updatedAt,
    created_at: row.createdAt,
    grant: row.grant,
    applicant: row.user,
    review_count: row._count.reviews,
  });
}

const listInclude = {
  grant: { select: { id: true, title: true, slug: true, deadline: true } },
  user: { select: { id: true, name: true, email: true, organization: true } },
  _count: { select: { reviews: true } },
} satisfies Prisma.ApplicationInclude;

function listWhere(req: AuthedRequest, query: { status?: string; grant_id?: string; q?: string }): Prisma.ApplicationWhereInput {
  const staff = isStaff(req.user!.role);
  const where: Prisma.ApplicationWhereInput = staff ? {} : { userId: req.user!.id };

  if (query.status && query.status !== 'all') {
    where.status = query.status as ApplicationStatus;
  }
  if (query.grant_id) {
    const grantId = toBigInt(query.grant_id);
    if (grantId) where.grantId = grantId;
  }
  if (query.q && staff) {
    where.OR = [
      { user: { name: { contains: query.q, mode: 'insensitive' } } },
      { user: { email: { contains: query.q, mode: 'insensitive' } } },
      { user: { organization: { contains: query.q, mode: 'insensitive' } } },
      { grant: { title: { contains: query.q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

const listQuerySchema = z.object({
  status: z.string().optional(),
  grant_id: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(['created_at', 'updated_at', 'submitted_at', 'status']).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  take: z.coerce.number().int().min(1).max(200).default(25),
  skip: z.coerce.number().int().min(0).default(0),
});

const SORT_COLUMNS = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  submitted_at: 'submittedAt',
  status: 'status',
} as const;

router.get(
  '/',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = listWhere(req, query);
    const [items, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: listInclude,
        orderBy: { [SORT_COLUMNS[query.sort]]: query.order },
        take: query.take,
        skip: query.skip,
      }),
      prisma.application.count({ where }),
    ]);
    res.json({ items: items.map(summarize), total, take: query.take, skip: query.skip });
  }),
);

/** CSV export of the filtered application list (staff only). */
router.get(
  '/export.csv',
  requireAuth([Role.admin, Role.reviewer]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = listQuerySchema.parse(req.query);
    const where = listWhere(req, query);
    const applications = await prisma.application.findMany({
      where,
      include: applicationInclude,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    // When the export is scoped to one grant, add a column per requirement.
    const grantIds = new Set(applications.map((a) => a.grantId.toString()));
    const singleGrant = grantIds.size === 1 ? applications[0]?.grant : undefined;
    const requirementKeys = singleGrant ? singleGrant.requirements.map((r) => r.key) : [];

    const rows = applications.map((application) => {
      const values = valuesOf(application);
      const filesByKey = filesOf(application);
      const base: Record<string, unknown> = {
        id: application.id.toString(),
        grant: application.grant.title,
        applicant: application.user.name,
        email: application.user.email,
        organization: application.user.organization ?? '',
        status: STATUS_LABELS[application.status],
        submitted_at: application.submittedAt?.toISOString() ?? '',
        created_at: application.createdAt.toISOString(),
        reviews: application.reviews.length,
        average_score:
          application.reviews.filter((r) => r.score !== null).length === 0
            ? ''
            : (
                application.reviews.reduce((sum, r) => sum + Number(r.score ?? 0), 0) /
                application.reviews.filter((r) => r.score !== null).length
              ).toFixed(2),
      };
      for (const key of requirementKeys) {
        const file = filesByKey[key];
        if (file) {
          // File answers export as the original filename, not the internal id.
          base[key] = file.filename;
          continue;
        }
        const value = values[key];
        base[key] = Array.isArray(value) ? value.join('; ') : (value ?? '');
      }
      return base;
    });

    const csv = toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${Date.now()}.csv"`);
    await recordAudit({ userId: req.user!.id, entityType: 'application', action: 'export_csv', payload: { count: rows.length } });
    res.send(csv);
  }),
);

router.post(
  '/',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ grant_id: z.union([z.string(), z.number()]) }).parse(req.body);
    const grantId = toBigInt(body.grant_id);
    if (!grantId) throw badRequest('Invalid grant id');

    const grant = await prisma.grant.findUnique({ where: { id: grantId } });
    if (!grant) throw notFound('Grant not found');
    if (grant.visibility === Visibility.archived) throw badRequest('This grant is archived');
    if (grant.openAt && grant.openAt > new Date()) throw badRequest('This grant has not opened yet');
    if (grant.deadline && grant.deadline < new Date()) throw badRequest('The deadline for this grant has passed');

    const existing = await prisma.application.findUnique({
      where: { userId_grantId: { userId: req.user!.id, grantId } },
    });
    if (existing) {
      // One application per applicant per grant; hand back the existing draft.
      return res.status(200).json(jsonSafe({ id: existing.id, status: existing.status, existing: true }));
    }

    const application = await prisma.application.create({
      data: { userId: req.user!.id, grantId, status: ApplicationStatus.draft },
    });
    await recordAudit({
      userId: req.user!.id,
      entityType: 'application',
      entityId: application.id,
      action: 'create',
      payload: { grant: grant.title },
    });
    return res.status(201).json(jsonSafe({ id: application.id, status: application.status, existing: false }));
  }),
);

router.get(
  '/:id',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid application id');
    const application = await loadApplication(id, req.user!);
    const payload = await present(application);
    res.json({
      ...payload,
      allowed_transitions: allowedTransitions(application.status, req.user!.role),
      validation_issues: validateResponses(application.grant.requirements, valuesOf(application)),
    });
  }),
);

/** Upsert answers. Called by the autosave loop and by "Save draft". */
router.put(
  '/:id/responses',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid application id');
    const application = await loadApplication(id, req.user!);

    if (application.userId !== req.user!.id) throw forbidden('Only the applicant can edit the answers');
    if (application.status !== ApplicationStatus.draft) {
      throw conflict('This application has been submitted and can no longer be edited');
    }
    if (application.grant.deadline && application.grant.deadline < new Date()) {
      throw conflict('The deadline for this grant has passed');
    }

    const inputs = z
      .array(
        z.object({
          requirement_id: z.union([z.string(), z.number()]).optional(),
          key: z.string().optional(),
          value: z.any().optional(),
          file_id: z.union([z.string(), z.number()]).nullish(),
        }),
      )
      .parse(Array.isArray(req.body) ? req.body : req.body?.responses ?? []);

    const byId = new Map(application.grant.requirements.map((r) => [r.id.toString(), r]));
    const byKey = new Map(application.grant.requirements.map((r) => [r.key, r]));

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    for (const input of inputs as ResponseInput[]) {
      const requirement =
        (input.requirement_id !== undefined ? byId.get(String(input.requirement_id)) : undefined) ??
        (input.key ? byKey.get(input.key) : undefined);
      if (!requirement) throw badRequest(`Unknown requirement: ${input.key ?? input.requirement_id}`);

      let fileId: bigint | null = null;
      if (requirement.fieldType === FieldType.file && input.file_id !== null && input.file_id !== undefined) {
        fileId = toBigInt(input.file_id);
        if (fileId === null) throw badRequest(`Invalid file id for "${requirement.label}"`);
        const file = await prisma.fileUpload.findUnique({ where: { id: fileId } });
        if (!file) throw badRequest(`Unknown upload for "${requirement.label}"`);
        if (file.userId !== req.user!.id) throw forbidden('You can only attach your own uploads');
      }

      const columns = toColumns(requirement, input.value as never, fileId);
      operations.push(
        prisma.applicationResponse.upsert({
          where: { applicationId_requirementId: { applicationId: id, requirementId: requirement.id } },
          create: { applicationId: id, requirementId: requirement.id, ...columns },
          update: columns,
        }),
      );
    }

    if (operations.length > 0) await prisma.$transaction(operations);
    await prisma.application.update({ where: { id }, data: { updatedAt: new Date() } });

    const refreshed = await loadApplication(id, req.user!);
    const values = valuesOf(refreshed);
    res.json({
      saved: operations.length,
      progress: progressOf(refreshed),
      validation_issues: validateResponses(refreshed.grant.requirements, values),
    });
  }),
);

router.patch(
  '/:id',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid application id');
    const application = await loadApplication(id, req.user!);
    const body = z
      .object({ status: z.nativeEnum(ApplicationStatus), note: z.string().max(4000).optional() })
      .parse(req.body);

    const isOwner = application.userId === req.user!.id;
    const staff = isStaff(req.user!.role);
    if (!isOwner && !staff) throw forbidden();

    const role = staff && !isOwner ? req.user!.role : Role.applicant;
    if (!allowedTransitions(application.status, role).includes(body.status)) {
      throw conflict(
        `Cannot move an application from "${STATUS_LABELS[application.status]}" to "${STATUS_LABELS[body.status]}"`,
      );
    }
    if (staff && !isOwner && req.user!.role === Role.reviewer && body.status !== ApplicationStatus.under_review) {
      throw forbidden('Reviewers can start a review but only an admin can decide');
    }

    const data: Prisma.ApplicationUpdateInput = { status: body.status };

    if (body.status === ApplicationStatus.submitted && isOwner) {
      if (application.grant.deadline && application.grant.deadline < new Date()) {
        throw conflict('The deadline for this grant has passed');
      }
      const issues = validateResponses(application.grant.requirements, valuesOf(application));
      if (issues.length > 0) {
        throw badRequest('The application is not complete yet', issues);
      }
      data.submittedAt = new Date();
    }
    if (body.status === ApplicationStatus.approved || body.status === ApplicationStatus.rejected) {
      data.decidedAt = new Date();
      data.decisionNote = body.note ?? null;
    }

    const updated = await prisma.application.update({ where: { id }, data });

    await recordAudit({
      userId: req.user!.id,
      entityType: 'application',
      entityId: id,
      action: `status:${body.status}`,
      payload: { from: application.status, to: body.status, note: body.note },
    });

    if (body.status === ApplicationStatus.submitted) {
      const t = templates.applicationSubmitted(application.grant.title);
      await notify({ userId: application.userId, ...t });
      const admins = await prisma.user.findMany({ where: { role: Role.admin, isActive: true }, select: { id: true } });
      await Promise.all(
        admins.map((admin) =>
          notify({
            userId: admin.id,
            subject: `New application: ${application.grant.title}`,
            body: `${application.user.name} (${application.user.email}) submitted an application.`,
          }),
        ),
      );
    } else if (!isOwner) {
      const t = templates.statusChanged(application.grant.title, body.status, body.note);
      await notify({ userId: application.userId, ...t });
    }

    res.json(jsonSafe({ id: updated.id, status: updated.status, submitted_at: updated.submittedAt }));
  }),
);

/** Nudges an applicant about items that are still missing. */
router.post(
  '/:id/remind',
  requireAuth([Role.admin, Role.reviewer]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid application id');
    const application = await loadApplication(id, req.user!);
    const progress = progressOf(application);
    const missing = progress.missing.length > 0 ? progress.missing : ['(nothing outstanding — general reminder)'];
    const t = templates.missingDocuments(application.grant.title, missing);
    await notify({ userId: application.userId, ...t });
    await recordAudit({ userId: req.user!.id, entityType: 'application', entityId: id, action: 'remind' });
    res.json({ sent: true, missing: progress.missing });
  }),
);

router.get(
  '/:id/pdf',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid application id');
    const application = await loadApplication(id, req.user!);
    const pdf = await renderApplicationPdf(application);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="application-${id}.pdf"`);
    res.send(pdf);
  }),
);

export default router;
