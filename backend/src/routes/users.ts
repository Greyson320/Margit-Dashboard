import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../lib/async';
import { jsonSafe, toBigInt } from '../lib/serialize';
import { badRequest, conflict } from '../lib/errors';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { recordAudit } from '../services/audit';
import { revokeAllRefreshTokens } from '../services/tokens';

const router = Router();

router.get(
  '/',
  requireAuth([Role.admin]),
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        q: z.string().optional(),
        role: z.nativeEnum(Role).optional(),
        take: z.coerce.number().int().min(1).max(200).default(50),
        skip: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);

    const where: Prisma.UserWhereInput = {};
    if (query.role) where.role = query.role;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { organization: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          organization: true,
          isActive: true,
          createdAt: true,
          _count: { select: { applications: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: query.take,
        skip: query.skip,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ items: jsonSafe(items), total, take: query.take, skip: query.skip });
  }),
);

router.post(
  '/',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        name: z.string().min(2).max(120),
        email: z.string().email(),
        password: z.string().min(8).max(200),
        role: z.nativeEnum(Role),
        organization: z.string().max(200).optional(),
      })
      .parse(req.body);

    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw conflict('An account with this e-mail already exists');

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email,
        role: body.role,
        organization: body.organization ?? null,
        passwordHash: await bcrypt.hash(body.password, 12),
      },
      select: { id: true, name: true, email: true, role: true, organization: true, isActive: true },
    });

    await recordAudit({ userId: req.user!.id, entityType: 'user', entityId: user.id, action: 'create' });
    res.status(201).json(jsonSafe(user));
  }),
);

router.patch(
  '/:id',
  requireAuth([Role.admin]),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid user id');
    const body = z
      .object({
        name: z.string().min(2).max(120).optional(),
        role: z.nativeEnum(Role).optional(),
        organization: z.string().max(200).nullable().optional(),
        is_active: z.boolean().optional(),
        password: z.string().min(8).max(200).optional(),
      })
      .parse(req.body);

    if (id === req.user!.id && (body.role !== undefined || body.is_active === false)) {
      throw badRequest('You cannot change your own role or deactivate yourself');
    }

    const data: Prisma.UserUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) data.role = body.role;
    if (body.organization !== undefined) data.organization = body.organization;
    if (body.is_active !== undefined) data.isActive = body.is_active;
    if (body.password !== undefined) data.passwordHash = await bcrypt.hash(body.password, 12);

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, organization: true, isActive: true },
    });

    if (body.password !== undefined || body.is_active === false) await revokeAllRefreshTokens(id);
    await recordAudit({ userId: req.user!.id, entityType: 'user', entityId: id, action: 'update', payload: body });
    res.json(jsonSafe(user));
  }),
);

export default router;
