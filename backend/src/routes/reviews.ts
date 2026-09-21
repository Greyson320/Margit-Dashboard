import { Router } from 'express';
import { z } from 'zod';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../lib/async';
import { jsonSafe, toBigInt } from '../lib/serialize';
import { badRequest, notFound } from '../lib/errors';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { recordAudit } from '../services/audit';

const router = Router();

const reviewSchema = z.object({
  application_id: z.union([z.string(), z.number()]),
  score: z.number().min(0).max(100).nullish(),
  notes: z.string().max(8000).nullish(),
  recommendation: z.enum(['approve', 'reject', 'needs_more_info']).nullish(),
});

/** One review per reviewer per application — posting again updates it. */
router.post(
  '/',
  requireAuth([Role.admin, Role.reviewer]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = reviewSchema.parse(req.body);
    const applicationId = toBigInt(body.application_id);
    if (!applicationId) throw badRequest('Invalid application id');

    const application = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) throw notFound('Application not found');

    const data = {
      score: body.score === null || body.score === undefined ? null : new Prisma.Decimal(body.score),
      notes: body.notes ?? null,
      recommendation: body.recommendation ?? null,
    };

    const review = await prisma.review.upsert({
      where: { applicationId_reviewerId: { applicationId, reviewerId: req.user!.id } },
      create: { applicationId, reviewerId: req.user!.id, ...data },
      update: data,
      include: { reviewer: { select: { id: true, name: true, email: true } } },
    });

    await recordAudit({
      userId: req.user!.id,
      entityType: 'review',
      entityId: review.id,
      action: 'upsert',
      payload: { applicationId: applicationId.toString(), score: body.score },
    });

    res.status(201).json(jsonSafe(review));
  }),
);

router.get(
  '/',
  requireAuth([Role.admin, Role.reviewer]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = z.object({ application_id: z.string().optional() }).parse(req.query);
    const applicationId = query.application_id ? toBigInt(query.application_id) : null;
    const reviews = await prisma.review.findMany({
      where: applicationId ? { applicationId } : {},
      include: {
        reviewer: { select: { id: true, name: true, email: true } },
        application: { select: { id: true, grant: { select: { title: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    res.json(jsonSafe(reviews));
  }),
);

router.delete(
  '/:id',
  requireAuth([Role.admin, Role.reviewer]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid review id');
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw notFound('Review not found');
    if (review.reviewerId !== req.user!.id && req.user!.role !== Role.admin) {
      throw badRequest('You can only remove your own review');
    }
    await prisma.review.delete({ where: { id } });
    res.status(204).end();
  }),
);

export default router;
