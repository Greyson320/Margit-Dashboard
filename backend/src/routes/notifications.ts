import { Router } from 'express';
import { z } from 'zod';
import { ApplicationStatus, Role } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../lib/async';
import { jsonSafe, toBigInt } from '../lib/serialize';
import { badRequest } from '../lib/errors';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { notify, templates } from '../services/notifications';
import { recordAudit } from '../services/audit';

const router = Router();

router.get(
  '/',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const query = z
      .object({ unread: z.coerce.boolean().optional(), take: z.coerce.number().int().min(1).max(100).default(30) })
      .parse(req.query);

    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.id, ...(query.unread ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: query.take,
      }),
      prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    ]);

    res.json({ items: jsonSafe(items), unread });
  }),
);

router.post(
  '/:id/read',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid notification id');
    await prisma.notification.updateMany({
      where: { id, userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(204).end();
  }),
);

router.post(
  '/read-all',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(204).end();
  }),
);

/**
 * Sends a deadline reminder to everyone holding a draft for grants closing
 * within `days`. Run it from a cron job (or trigger it from the admin UI).
 */
router.post(
  '/deadline-reminders',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ days: z.number().int().min(1).max(60).default(7) }).parse(req.body ?? {});
    const until = new Date(Date.now() + body.days * 86_400_000);

    const drafts = await prisma.application.findMany({
      where: {
        status: ApplicationStatus.draft,
        grant: { deadline: { gte: new Date(), lte: until } },
      },
      include: { grant: { select: { title: true, deadline: true } } },
    });

    for (const draft of drafts) {
      if (!draft.grant.deadline) continue;
      const t = templates.deadlineReminder(draft.grant.title, draft.grant.deadline);
      await notify({ userId: draft.userId, ...t });
    }

    await recordAudit({
      userId: req.user!.id,
      entityType: 'notification',
      action: 'deadline_reminders',
      payload: { sent: drafts.length, days: body.days },
    });
    res.json({ sent: drafts.length });
  }),
);

export default router;
