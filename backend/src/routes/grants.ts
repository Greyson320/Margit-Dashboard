import { Router } from 'express';
import { z } from 'zod';
import { FieldType, Prisma, Role, Visibility } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../lib/async';
import { jsonSafe, slugify, toBigInt } from '../lib/serialize';
import { badRequest, notFound } from '../lib/errors';
import { AuthedRequest, isStaff, optionalAuth, requireAuth } from '../middleware/auth';
import { recordAudit } from '../services/audit';

const router = Router();

const requirementSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  key: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
  label: z.string().min(1).max(200),
  field_type: z.nativeEnum(FieldType),
  help_text: z.string().max(1000).nullish(),
  required: z.boolean().default(true),
  options: z.array(z.string().min(1)).nullish(),
  validations: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
      regex: z.string().optional(),
      requiredIf: z.object({ key: z.string(), equals: z.unknown() }).optional(),
    })
    .nullish(),
  file_constraints: z
    .object({ mimetypes: z.array(z.string()).optional(), maxMB: z.number().positive().optional() })
    .nullish(),
  order_index: z.number().int().default(0),
});

const grantSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10),
  slug: z.string().max(80).optional(),
  max_amount: z.number().nonnegative().nullish(),
  currency: z.string().length(3).default('EUR'),
  deadline: z.string().datetime().nullish(),
  open_at: z.string().datetime().nullish(),
  target_groups: z.array(z.string()).nullish(),
  eligibility: z.string().nullish(),
  expected_impact: z.string().nullish(),
  visibility: z.nativeEnum(Visibility).default(Visibility.public),
  requirements: z.array(requirementSchema).optional(),
});

const jsonOrNull = (value: unknown) =>
  value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);

function requirementData(input: z.infer<typeof requirementSchema>) {
  return {
    key: input.key,
    label: input.label,
    fieldType: input.field_type,
    helpText: input.help_text ?? null,
    required: input.required,
    optionsJson: jsonOrNull(input.options),
    validationsJson: jsonOrNull(input.validations),
    fileConstraintsJson: jsonOrNull(input.file_constraints),
    orderIndex: input.order_index,
  };
}

async function uniqueSlug(title: string, provided?: string, excludeId?: bigint): Promise<string> {
  const base = slugify(provided || title) || `grant-${Date.now()}`;
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.grant.findUnique({ where: { slug: candidate } });
    if (!existing || (excludeId && existing.id === excludeId)) return candidate;
    candidate = `${base}-${++n}`;
  }
}

const grantInclude = {
  requirements: { orderBy: { orderIndex: 'asc' } },
  _count: { select: { applications: true } },
} satisfies Prisma.GrantInclude;

/** Adds the derived open/closed state the catalogue filters on. */
function decorate(grant: Prisma.GrantGetPayload<{ include: typeof grantInclude }>) {
  const now = new Date();
  const notYetOpen = grant.openAt ? grant.openAt > now : false;
  const closed = grant.deadline ? grant.deadline < now : false;
  return jsonSafe({
    ...grant,
    application_count: grant._count.applications,
    is_open: !notYetOpen && !closed && grant.visibility !== Visibility.archived,
    state: grant.visibility === Visibility.archived ? 'archived' : notYetOpen ? 'upcoming' : closed ? 'closed' : 'open',
  });
}

router.get(
  '/',
  optionalAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = z
      .object({
        q: z.string().optional(),
        status: z.enum(['open', 'upcoming', 'closed', 'archived', 'all']).default('open'),
        target_group: z.string().optional(),
        take: z.coerce.number().int().min(1).max(100).default(50),
        skip: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);

    const staff = req.user ? isStaff(req.user.role) : false;
    const now = new Date();
    const where: Prisma.GrantWhereInput = {};

    if (!staff) where.visibility = Visibility.public;
    else if (query.status === 'archived') where.visibility = Visibility.archived;
    else if (query.status !== 'all') where.visibility = { not: Visibility.archived };

    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        { eligibility: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.status === 'open') {
      where.AND = [
        { OR: [{ deadline: null }, { deadline: { gte: now } }] },
        { OR: [{ openAt: null }, { openAt: { lte: now } }] },
      ];
    }
    if (query.status === 'closed') where.deadline = { lt: now };
    if (query.status === 'upcoming') where.openAt = { gt: now };

    const [items, total] = await Promise.all([
      prisma.grant.findMany({
        where,
        include: grantInclude,
        orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
        take: query.take,
        skip: query.skip,
      }),
      prisma.grant.count({ where }),
    ]);

    let result = items.map(decorate);
    if (query.target_group) {
      const needle = query.target_group.toLowerCase();
      result = result.filter((g) => {
        const groups = ((g as { target_groups?: unknown }).target_groups ?? []) as string[];
        return Array.isArray(groups) && groups.some((t) => t.toLowerCase() === needle);
      });
    }

    res.json({ items: result, total, take: query.take, skip: query.skip });
  }),
);

router.get(
  '/:id',
  optionalAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    const grant = await prisma.grant.findFirst({
      where: id ? { id } : { slug: req.params.id },
      include: grantInclude,
    });
    if (!grant) throw notFound('Grant not found');

    const staff = req.user ? isStaff(req.user.role) : false;
    if (!staff && grant.visibility !== Visibility.public) throw notFound('Grant not found');

    let myApplication = null;
    if (req.user) {
      const application = await prisma.application.findUnique({
        where: { userId_grantId: { userId: req.user.id, grantId: grant.id } },
        select: { id: true, status: true, submittedAt: true },
      });
      myApplication = application ? jsonSafe(application) : null;
    }

    res.json({ ...(decorate(grant) as object), my_application: myApplication });
  }),
);

router.post(
  '/',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = grantSchema.parse(req.body);
    const keys = (body.requirements ?? []).map((r) => r.key);
    if (new Set(keys).size !== keys.length) throw badRequest('Requirement keys must be unique within a grant');

    const grant = await prisma.grant.create({
      data: {
        title: body.title,
        slug: await uniqueSlug(body.title, body.slug),
        description: body.description,
        maxAmount: body.max_amount === null || body.max_amount === undefined ? null : new Prisma.Decimal(body.max_amount),
        currency: body.currency,
        deadline: body.deadline ? new Date(body.deadline) : null,
        openAt: body.open_at ? new Date(body.open_at) : null,
        targetGroups: jsonOrNull(body.target_groups),
        eligibility: body.eligibility ?? null,
        expectedImpact: body.expected_impact ?? null,
        visibility: body.visibility,
        createdById: req.user!.id,
        requirements: { create: (body.requirements ?? []).map(requirementData) },
      },
      include: grantInclude,
    });

    await recordAudit({
      userId: req.user!.id,
      entityType: 'grant',
      entityId: grant.id,
      action: 'create',
      payload: { title: grant.title },
    });
    res.status(201).json(decorate(grant));
  }),
);

router.patch(
  '/:id',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid grant id');
    const existing = await prisma.grant.findUnique({ where: { id } });
    if (!existing) throw notFound('Grant not found');

    const body = grantSchema.partial().parse(req.body);

    const data: Prisma.GrantUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.slug !== undefined || body.title !== undefined) {
      data.slug = await uniqueSlug(body.title ?? existing.title, body.slug, id);
    }
    if (body.max_amount !== undefined) {
      data.maxAmount = body.max_amount === null ? null : new Prisma.Decimal(body.max_amount);
    }
    if (body.currency !== undefined) data.currency = body.currency;
    if (body.deadline !== undefined) data.deadline = body.deadline ? new Date(body.deadline) : null;
    if (body.open_at !== undefined) data.openAt = body.open_at ? new Date(body.open_at) : null;
    if (body.target_groups !== undefined) data.targetGroups = jsonOrNull(body.target_groups);
    if (body.eligibility !== undefined) data.eligibility = body.eligibility ?? null;
    if (body.expected_impact !== undefined) data.expectedImpact = body.expected_impact ?? null;
    if (body.visibility !== undefined) data.visibility = body.visibility;

    // A full `requirements` array replaces the set: new keys are created,
    // known keys updated, and anything left out is removed together with its
    // responses. Keys are stable, so applicant answers survive relabelling.
    if (body.requirements) {
      const keys = body.requirements.map((r) => r.key);
      if (new Set(keys).size !== keys.length) throw badRequest('Requirement keys must be unique within a grant');
      const current = await prisma.requirement.findMany({ where: { grantId: id } });
      const removed = current.filter((r) => !keys.includes(r.key));

      await prisma.$transaction([
        ...(removed.length
          ? [prisma.requirement.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } })]
          : []),
        ...body.requirements.map((r) =>
          prisma.requirement.upsert({
            where: { grantId_key: { grantId: id, key: r.key } },
            create: { grantId: id, ...requirementData(r) },
            update: requirementData(r),
          }),
        ),
      ]);
    }

    const grant = await prisma.grant.update({ where: { id }, data, include: grantInclude });
    await recordAudit({ userId: req.user!.id, entityType: 'grant', entityId: id, action: 'update' });
    res.json(decorate(grant));
  }),
);

router.delete(
  '/:id',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid grant id');
    const count = await prisma.application.count({ where: { grantId: id } });
    if (count > 0) {
      // Grants with applications are archived rather than deleted so the
      // audit trail and applicant history stay intact.
      await prisma.grant.update({ where: { id }, data: { visibility: Visibility.archived } });
      await recordAudit({ userId: req.user!.id, entityType: 'grant', entityId: id, action: 'archive' });
      return res.json({ archived: true, reason: 'Grant has applications and was archived instead of deleted' });
    }
    await prisma.grant.delete({ where: { id } });
    await recordAudit({ userId: req.user!.id, entityType: 'grant', entityId: id, action: 'delete' });
    return res.status(204).end();
  }),
);

router.get(
  '/:id/requirements',
  asyncHandler(async (req, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid grant id');
    const requirements = await prisma.requirement.findMany({
      where: { grantId: id },
      orderBy: { orderIndex: 'asc' },
    });
    res.json(jsonSafe(requirements));
  }),
);

router.post(
  '/:id/requirements',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid grant id');
    const body = requirementSchema.parse(req.body);
    const requirement = await prisma.requirement.create({ data: { grantId: id, ...requirementData(body) } });
    await recordAudit({ userId: req.user!.id, entityType: 'requirement', entityId: requirement.id, action: 'create' });
    res.status(201).json(jsonSafe(requirement));
  }),
);

router.patch(
  '/:id/requirements/:requirementId',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const requirementId = toBigInt(req.params.requirementId);
    if (!requirementId) throw badRequest('Invalid requirement id');
    const body = requirementSchema.parse(req.body);
    const requirement = await prisma.requirement.update({
      where: { id: requirementId },
      data: requirementData(body),
    });
    res.json(jsonSafe(requirement));
  }),
);

router.delete(
  '/:id/requirements/:requirementId',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const requirementId = toBigInt(req.params.requirementId);
    if (!requirementId) throw badRequest('Invalid requirement id');
    await prisma.requirement.delete({ where: { id: requirementId } });
    res.status(204).end();
  }),
);

export default router;
