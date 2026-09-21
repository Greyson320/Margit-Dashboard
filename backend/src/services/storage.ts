import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';

export type StoredObject = {
  storageKey: string;
  checksum: string;
};

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.s3.region,
      endpoint: env.s3.endpoint,
      forcePathStyle: env.s3.forcePathStyle,
      credentials: { accessKeyId: env.s3.accessKey, secretAccessKey: env.s3.secretKey },
    });
  }
  return client;
}

/** Creates the bucket on first boot so a fresh MinIO container just works. */
export async function ensureBucket(): Promise<void> {
  if (env.storageProvider !== 's3') {
    await fs.mkdir(env.localStorageDir, { recursive: true });
    return;
  }
  try {
    await s3().send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
  } catch {
    try {
      await s3().send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[storage] could not create bucket, uploads may fail:', error);
    }
  }
}

export function buildStorageKey(userId: bigint, filename: string): string {
  const safe = path.basename(filename).replace(/[^\w.\-]+/g, '_').slice(-120);
  const stamp = new Date().toISOString().slice(0, 10);
  return `uploads/${userId}/${stamp}/${crypto.randomUUID()}-${safe}`;
}

export async function putObject(key: string, body: Buffer, mimetype: string): Promise<StoredObject> {
  const checksum = crypto.createHash('sha256').update(body).digest('hex');
  if (env.storageProvider === 'local') {
    const target = path.join(env.localStorageDir, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    return { storageKey: key, checksum };
  }
  await s3().send(
    new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: body, ContentType: mimetype }),
  );
  return { storageKey: key, checksum };
}

export async function getObject(key: string): Promise<Buffer> {
  if (env.storageProvider === 'local') {
    return fs.readFile(path.join(env.localStorageDir, key));
  }
  const result = await s3().send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  if (env.storageProvider === 'local') {
    await fs.rm(path.join(env.localStorageDir, key), { force: true });
    return;
  }
  await s3().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
}

/**
 * Pre-signed download URL. With local storage there is nothing to sign, so the
 * caller falls back to streaming the file through the API.
 */
export async function signedDownloadUrl(key: string, filename: string): Promise<string | null> {
  if (env.storageProvider === 'local') return null;
  const command = new GetObjectCommand({
    Bucket: env.s3.bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
  });
  const url = await getSignedUrl(s3(), command, { expiresIn: env.signedUrlTtlSeconds });
  // Inside Docker the API talks to `minio:9000`, but the browser needs a host-reachable URL.
  if (env.s3.publicEndpoint && env.s3.publicEndpoint !== env.s3.endpoint) {
    return url.replace(env.s3.endpoint, env.s3.publicEndpoint);
  }
  return url;
}
