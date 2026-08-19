import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
const SOURCE_UPLOAD_EXPIRATION_SECONDS = 60;
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

export function getTemporaryImageBucket() {
  return getS3Bucket("AWS_S3_BUCKET");
}

export type ImageUploadPost = {
  url: string;
  fields: Record<string, string>;
  maxBytes: number;
};

export function getMaxSourceImageBytes() {
  const configuredValue = process.env.IMAGE_MAX_UPLOAD_BYTES?.trim();

  if (!configuredValue) {
    return DEFAULT_MAX_SOURCE_IMAGE_BYTES;
  }

  const maxBytes = Number(configuredValue);

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("IMAGE_MAX_UPLOAD_BYTES must be a positive integer");
  }

  return maxBytes;
}

export async function getTemporaryImageUploadPost(
  key: string,
  contentType: string,
  expiresIn = SOURCE_UPLOAD_EXPIRATION_SECONDS,
): Promise<ImageUploadPost> {
  const maxBytes = getMaxSourceImageBytes();
  const upload = await createPresignedPost(
    getS3Client(),
    {
      Bucket: getTemporaryImageBucket(),
      Key: key,
      Conditions: [
        ["content-length-range", 1, maxBytes],
        { "Content-Type": contentType },
      ],
      Fields: {
        "Content-Type": contentType,
      },
      Expires: expiresIn,
    },
  );

  return { ...upload, maxBytes };
}

export async function uploadImage({
  key,
  body,
  contentType,
  metadata,
}: {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}) {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket("AWS_S3_BUCKET"),
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    }),
  );
}

async function bodyToBuffer(body: GetObjectCommandOutput["Body"]) {
  if (!body) {
    throw new Error("S3 returned an empty object body");
  }

  return Buffer.from(await body.transformToByteArray());
}

export async function getTemporaryImage(key: string) {
  const object = await getS3Client().send(
    new GetObjectCommand({
      Bucket: getTemporaryImageBucket(),
      Key: key,
    }),
  );

  return {
    body: await bodyToBuffer(object.Body),
    contentType: object.ContentType,
  };
}

type ImageDownloadOptions = {
  expiresIn?: number;
  fileName?: string;
};

export async function getImageDownloadUrl(
  key: string,
  { expiresIn = 3600, fileName }: ImageDownloadOptions = {},
) {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: getS3Bucket("AWS_S3_FINAL_BUCKET"),
      Key: key,
      ...(fileName
        ? {
            ResponseContentDisposition: `attachment; filename="${fileName}"`,
          }
        : {}),
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
  options?: ImageDownloadOptions,
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

  return getImageDownloadUrl(key, options);
}
