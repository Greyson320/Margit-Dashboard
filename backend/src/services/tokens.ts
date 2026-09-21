import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Role, User } from '@prisma/client';
import { env } from '../env';
import { prisma } from '../db';
import { AccessTokenPayload } from '../middleware/auth';

/** Rough "15m" / "7d" / "3600" -> milliseconds, used for refresh-token expiry. */
export function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1000;
  return amount * factor;
}

export function signAccessToken(user: Pick<User, 'id' | 'email' | 'role' | 'name'>): string {
  const payload: AccessTokenPayload = {
    sub: user.id.toString(),
    email: user.email,
    role: user.role as Role,
    name: user.name,
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtAccessExpires } as SignOptions);
}

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export async function issueRefreshToken(userId: bigint): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + durationToMs(env.jwtRefreshExpires)),
    },
  });
  return token;
}

export async function consumeRefreshToken(token: string) {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date()) return null;
  // Rotate: a refresh token is single-use.
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });
  if (!record.user.isActive) return null;
  return record.user;
}

export async function revokeAllRefreshTokens(userId: bigint): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
