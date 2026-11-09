// Optional: saves screenshots in Amazon S3 or in an S3-compatible store
// such as Cloudflare R2. Without S3_BUCKET, the service does not use it.
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export function createStorage(env = process.env, client = null) {
  if (!env.S3_BUCKET) return null;

  // The SDK reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from the environment.
  // R2: S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com and region "auto".
  const s3 = client ?? new S3Client({
    region: env.S3_REGION ?? 'auto',
    endpoint: env.S3_ENDPOINT,
  });

  return {
    async save(image, contentType, extension) {
      const key = `screenshots/${randomUUID()}.${extension}`;
      await s3.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: image,
        ContentType: contentType,
      }));
      return { bucket: env.S3_BUCKET, key };
    },
  };
}
