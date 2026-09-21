import { Router } from 'express';
import multer from 'multer';
import { VirusStatus } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { asyncHandler } from '../lib/async';
import { jsonSafe, toBigInt } from '../lib/serialize';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { AuthedRequest, isStaff, requireAuth } from '../middleware/auth';
import { buildStorageKey, getObject, putObject, signedDownloadUrl } from '../services/storage';
import { recordAudit } from '../services/audit';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
});

// Kept deliberately tight: these are the document types a grant application needs.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

router.post(
  '/',
  requireAuth(),
  upload.single('file'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const file = req.file;
    if (!file) throw badRequest('No file received');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw badRequest(`File type "${file.mimetype}" is not allowed`);
    }

    const key = buildStorageKey(req.user!.id, file.originalname);
    const stored = await putObject(key, file.buffer, file.mimetype);

    const record = await prisma.fileUpload.create({
      data: {
        userId: req.user!.id,
        storageKey: stored.storageKey,
        filename: file.originalname,
        mimetype: file.mimetype,
        sizeBytes: BigInt(file.size),
        checksum: stored.checksum,
        // Wire a real scanner here in production; the column is ready for it.
        virusScanned: false,
        virusStatus: VirusStatus.unknown,
      },
    });

    await recordAudit({
      userId: req.user!.id,
      entityType: 'file_upload',
      entityId: record.id,
      action: 'upload',
      payload: { filename: file.originalname, size: file.size },
    });

    res.status(201).json(
      jsonSafe({
        file_id: record.id,
        filename: record.filename,
        mimetype: record.mimetype,
        size_bytes: record.sizeBytes,
      }),
    );
  }),
);

/** Redirects to a short-lived signed URL, or streams the file for local storage. */
router.get(
  '/:id',
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = toBigInt(req.params.id);
    if (!id) throw badRequest('Invalid file id');
    const file = await prisma.fileUpload.findUnique({ where: { id } });
    if (!file) throw notFound('File not found');
    if (file.userId !== req.user!.id && !isStaff(req.user!.role)) throw forbidden();

    const url = await signedDownloadUrl(file.storageKey, file.filename);
    if (url) return res.redirect(url);

    const body = await getObject(file.storageKey);
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"`);
    return res.send(body);
  }),
);

export default router;
