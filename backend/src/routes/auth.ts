import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../lib/async';
import { jsonSafe } from '../lib/serialize';
import { badRequest, unauthorized } from '../lib/errors';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import {
  consumeRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  signAccessToken,
} from '../services/tokens';
import { recordAudit } from '../services/audit';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  organization: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
});

const publicUser = (user: { id: bigint; name: string; email: string; role: Role; organization: string | null }) =>
  jsonSafe({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organization: user.organization,
  });

async function authPayload(user: { id: bigint; name: string; email: string; role: Role; organization: string | null }) {
  return {
    user: publicUser(user),
    access_token: signAccessToken(user),
    refresh_token: await issueRefreshToken(user.id),
  };
}

router.post(
  '/register',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw badRequest('An account with this e-mail already exists');

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email,
        passwordHash: await bcrypt.hash(body.password, 12),
        role: Role.applicant,
        organization: body.organization ?? null,
        phone: body.phone ?? null,
      },
    });

    await recordAudit({ userId: user.id, entityType: 'user', entityId: user.id, action: 'register' });
    res.status(201).json(await authPayload(user));
  }),
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user || !user.isActive) throw unauthorized('Invalid e-mail or password');

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw unauthorized('Invalid e-mail or password');

    await recordAudit({ userId: user.id, entityType: 'user', entityId: user.id, action: 'login' });
    res.json(await authPayload(user));
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = z.object({ refresh_token: z.string().min(10) }).parse(req.body);
    const user = await consumeRefreshToken(body.refresh_token);
    if (!user) throw unauthorized('Invalid or expired refresh token');
    res.json(await authPayload(user));
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = z.object({ refresh_token: z.string().optional() }).parse(req.body ?? {});
    if (body.refresh_token) await revokeRefreshToken(body.refresh_token);
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    res.json(publicUser(user));
  }),
);

router.patch(
  '/me',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        name: z.string().min(2).max(120).optional(),
        organization: z.string().max(200).nullable().optional(),
        phone: z.string().max(50).nullable().optional(),
      })
      .parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
    res.json(publicUser(user));
  }),
);

router.post(
  '/change-password',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({ current_password: z.string().min(1), new_password: z.string().min(8).max(200) })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(body.current_password, user.passwordHash))) {
      throw unauthorized('Current password is incorrect');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.new_password, 12) },
    });
    await revokeAllRefreshTokens(user.id);
    await recordAudit({ userId: user.id, entityType: 'user', entityId: user.id, action: 'change_password' });
    res.status(204).end();
  }),
);

export default router;
