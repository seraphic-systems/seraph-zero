import { createHash } from 'node:crypto';
import { S3Client, CreateBucketCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export function r2Config(env = process.env) {
  const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  if (!names.some((name) => env[name])) return null;
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing R2 configuration: ${missing.join(', ')}. Set these in .env.r2.local.`);
  if (!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID)) throw new Error('R2_ACCOUNT_ID must be the 32-character Cloudflare account ID.');
  const endpoint = env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !new RegExp(`^${env.R2_ACCOUNT_ID}(?:\\.eu|\\.fedramp)?\\.r2\\.cloudflarestorage\\.com$`).test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('R2_ENDPOINT must be an HTTPS Cloudflare R2 S3 endpoint for this account.');
  return { endpoint, bucket: env.R2_BUCKET, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } };
}

// Media may use a separate bucket-scoped key without affecting fragments.
export function mediaR2Config(env = process.env) {
  if (!env.R2_MEDIA_BUCKET) return null;
  if (Boolean(env.R2_MEDIA_ACCESS_KEY_ID) !== Boolean(env.R2_MEDIA_SECRET_ACCESS_KEY)) throw new Error('Set both R2_MEDIA_ACCESS_KEY_ID and R2_MEDIA_SECRET_ACCESS_KEY.');
  return r2Config({ ...env, R2_BUCKET: env.R2_MEDIA_BUCKET,
    R2_ACCESS_KEY_ID: env.R2_MEDIA_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_MEDIA_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY });
}

export function createR2Store(config) {
  if (!config) return null;
  const client = new S3Client({ region: 'auto', endpoint: config.endpoint, credentials: config.credentials,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  return {
    bucket: config.bucket,
    async createBucket() {
      try { await client.send(new CreateBucketCommand({ Bucket: config.bucket })); }
      catch (error) { if (error.name !== 'BucketAlreadyOwnedByYou') throw error; }
    },
    head: (key) => client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key })),
    put: (key, body, metadata, contentType = 'audio/mp4') => client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body,
      ...(Buffer.isBuffer(body) ? { ContentMD5: createHash('md5').update(body).digest('base64') } : {}),
      ContentType: contentType, CacheControl: 'private, max-age=3600', Metadata: metadata })),
    async audio(preview, { range, head = false } = {}) {
      if (preview.bucket !== config.bucket) throw new Error('Preview bucket does not match the configured R2 bucket.');
      const command = head ? new HeadObjectCommand({ Bucket: config.bucket, Key: preview.key, ...(range ? { Range: range } : {}) })
        : new GetObjectCommand({ Bucket: config.bucket, Key: preview.key, ...(range ? { Range: range } : {}) });
      return client.send(command);
    },
    close: () => client.destroy(),
  };
}
