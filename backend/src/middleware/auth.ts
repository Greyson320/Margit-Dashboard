import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../env';
import { forbidden, unauthorized } from '../lib/errors';

export type AuthUser = {
  id: bigint;
  email: string;
  role: Role;
  name: string;
};

export type AuthedRequest = Request & { user?: AuthUser };

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: Role;
  name: string;
};

function readToken(req: Request): string | null {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim() || null;
  return null;
}

function verify(token: string): AuthUser {
  const payload = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
  return {
    id: BigInt(payload.sub),
    email: payload.email,
    role: payload.role,
    name: payload.name,
  };
}

/** Requires a valid access token, optionally restricted to a set of roles. */
export function requireAuth(roles?: Role[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (!token) return next(unauthorized('Missing token'));
    try {
      req.user = verify(token);
    } catch {
      return next(unauthorized('Invalid or expired token'));
    }
    if (roles && roles.length > 0 && !roles.includes(req.user.role)) {
      return next(forbidden());
    }
    return next();
  };
}

/** Attaches the user when a token is present, but never rejects the request. */
export function optionalAuth() {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (token) {
      try {
        req.user = verify(token);
      } catch {
        /* anonymous */
      }
    }
    next();
  };
}

export const isStaff = (role: Role) => role === Role.admin || role === Role.reviewer;
