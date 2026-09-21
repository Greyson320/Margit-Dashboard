import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: int('PORT', 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/grantsdb'),

  jwtSecret: required('JWT_SECRET', nodeEnv === 'production' ? undefined : 'dev_only_change_me'),
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES ?? '7d',

  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  storageProvider: (process.env.STORAGE_PROVIDER ?? 's3') as 's3' | 'local',
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'grant-uploads',
    accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
  },
  localStorageDir: process.env.LOCAL_STORAGE_DIR ?? path.resolve(__dirname, '..', 'uploads'),

  maxUploadMb: int('MAX_UPLOAD_MB', 20),
  signedUrlTtlSeconds: int('SIGNED_URL_TTL_SECONDS', 300),

  // The MVP ships a console "mail" transport so notification flows are
  // observable in development without wiring a real SMTP provider.
  mailFrom: process.env.MAIL_FROM ?? 'no-reply@grant-portal.local',
  mailTransport: (process.env.MAIL_TRANSPORT ?? 'console') as 'console' | 'none',
};

export type Env = typeof env;
