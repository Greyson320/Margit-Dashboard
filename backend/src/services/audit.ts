import { prisma } from '../db';
import { jsonSafe } from '../lib/serialize';

/** Fire-and-forget audit trail; a logging failure must never break a request. */
export async function recordAudit(params: {
  userId?: bigint | null;
  entityType: string;
  entityId?: bigint | null;
  action: string;
  payload?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        action: params.action,
        payloadJson: params.payload === undefined ? undefined : (jsonSafe(params.payload) as object),
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[audit] failed to write entry', error);
  }
}
