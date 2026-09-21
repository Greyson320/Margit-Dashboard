import { Router } from 'express';
import { z } from 'zod';
import { ApplicationStatus, Role, Visibility } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../lib/async';
import { jsonSafe, toBigInt } from '../lib/serialize';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { STATUS_LABELS } from '../services/applications';

const router = Router();

/** Numbers behind the admin dashboard. */
router.get(
  '/overview',
  requireAuth([Role.admin, Role.reviewer]),
  asyncHandler(async (_req: AuthedRequest, res) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const [byStatus, grantTotal, openGrants, applicants, recent, awardedAgg, closingSoon, perGrantRaw] =
      await Promise.all([
        prisma.application.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.grant.count({ where: { visibility: { not: Visibility.archived } } }),
        prisma.grant.count({
          where: {
            visibility: Visibility.public,
            AND: [
              { OR: [{ deadline: null }, { deadline: { gte: now } }] },
              { OR: [{ openAt: null }, { openAt: { lte: now } }] },
            ],
          },
        }),
        prisma.user.count({ where: { role: Role.applicant } }),
        prisma.application.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
        prisma.grant.aggregate({ _sum: { maxAmount: true } }),
        prisma.grant.findMany({
          where: { deadline: { gte: now, lte: new Date(now.getTime() + 14 * 86_400_000) } },
          select: { id: true, title: true, deadline: true, _count: { select: { applications: true } } },
          orderBy: { deadline: 'asc' },
          take: 5,
        }),
        prisma.application.groupBy({ by: ['grantId', 'status'], _count: { _all: true } }),
      ]);

    const statusCounts = Object.fromEntries(
      (Object.keys(STATUS_LABELS) as ApplicationStatus[]).map((status) => [
        status,
        byStatus.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    );

    const grantIds = Array.from(new Set(perGrantRaw.map((row) => row.grantId)));
    const grants = await prisma.grant.findMany({
      where: { id: { in: grantIds } },
      select: { id: true, title: true },
    });
    const grantTitles = new Map(grants.map((g) => [g.id.toString(), g.title]));

    const perGrant = grantIds.map((grantId) => {
      const rows = perGrantRaw.filter((row) => row.grantId === grantId);
      return {
        grant_id: grantId.toString(),
        title: grantTitles.get(grantId.toString()) ?? 'Unknown',
        total: rows.reduce((sum, row) => sum + row._count._all, 0),
        by_status: Object.fromEntries(rows.map((row) => [row.status, row._count._all])),
      };
    }).sort((a, b) => b.total - a.total);

    const decided = statusCounts.approved + statusCounts.rejected;

    res.json(
      jsonSafe({
        applications: {
          total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
          last_30_days: recent,
          by_status: statusCounts,
          approval_rate: decided === 0 ? null : Math.round((statusCounts.approved / decided) * 100),
          awaiting_decision: statusCounts.submitted + statusCounts.under_review,
        },
        grants: {
          total: grantTotal,
          open: openGrants,
          total_budget: awardedAgg._sum.maxAmount,
          closing_soon: closingSoon.map((g) => ({
            id: g.id,
            title: g.title,
            deadline: g.deadline,
            application_count: g._count.applications,
          })),
        },
        applicants,
        per_grant: perGrant.slice(0, 10),
      }),
    );
  }),
);

/** Application volume per day, for the dashboard trend chart. */
router.get(
  '/timeline',
  requireAuth([Role.admin, Role.reviewer]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = z
      .object({ days: z.coerce.number().int().min(7).max(365).default(30), grant_id: z.string().optional() })
      .parse(req.query);

    const since = new Date(Date.now() - query.days * 86_400_000);
    const grantId = query.grant_id ? toBigInt(query.grant_id) : null;

    const applications = await prisma.application.findMany({
      where: { createdAt: { gte: since }, ...(grantId ? { grantId } : {}) },
      select: { createdAt: true, submittedAt: true },
    });

    const buckets = new Map<string, { date: string; created: number; submitted: number }>();
    for (let i = query.days; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      buckets.set(date, { date, created: 0, submitted: 0 });
    }
    for (const application of applications) {
      const created = buckets.get(application.createdAt.toISOString().slice(0, 10));
      if (created) created.created += 1;
      if (application.submittedAt) {
        const submitted = buckets.get(application.submittedAt.toISOString().slice(0, 10));
        if (submitted) submitted.submitted += 1;
      }
    }

    res.json({ items: Array.from(buckets.values()) });
  }),
);

router.get(
  '/audit',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = z
      .object({
        entity_type: z.string().optional(),
        take: z.coerce.number().int().min(1).max(200).default(50),
        skip: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);

    const where = query.entity_type ? { entityType: query.entity_type } : {};
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: query.take,
        skip: query.skip,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ items: jsonSafe(items), total });
  }),
);

export default router;
