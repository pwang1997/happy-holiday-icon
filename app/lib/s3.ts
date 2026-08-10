import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | undefined;

export function getS3Client() {
  if (client) {
    return client;
  }

  const region = process.env.AWS_REGION;

  if (!region) {
    throw new Error("AWS_REGION is not configured");
  }

  client = new S3Client({ region });
  return client;
}

function getS3Bucket() {
  const bucket = process.env.AWS_S3_BUCKET?.trim();

  if (!bucket) {
    throw new Error("AWS_S3_BUCKET is not configured");
  }

  return bucket;
}

export async function uploadImage({
  key,
  body,
  contentType,
}: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getImageDownloadUrl(key: string, expiresIn = 3600) {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
    }),
    { expiresIn },
  );
}
