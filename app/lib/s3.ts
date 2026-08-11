import {
  GetObjectCommand,
  HeadObjectCommand,
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

function getS3Bucket(environmentVariable: "AWS_S3_BUCKET" | "AWS_S3_FINAL_BUCKET") {
  const bucket = process.env[environmentVariable]?.trim();

  if (!bucket) {
    throw new Error(`${environmentVariable} is not configured`);
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
      Bucket: getS3Bucket("AWS_S3_BUCKET"),
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
      Bucket: getS3Bucket("AWS_S3_FINAL_BUCKET"),
      Key: key,
    }),
    { expiresIn },
  );
}

function isMissingS3Object(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: number };
  };

  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export async function getImageDownloadUrlIfExists(
  key: string,
  expiresIn = 3600,
) {
  try {
    await getS3Client().send(
      new HeadObjectCommand({
        Bucket: getS3Bucket("AWS_S3_FINAL_BUCKET"),
        Key: key,
      }),
    );
  } catch (error) {
    if (isMissingS3Object(error)) {
      return null;
    }

    throw error;
  }

  return getImageDownloadUrl(key, expiresIn);
}
