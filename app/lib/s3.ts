import { S3Client } from "@aws-sdk/client-s3";

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
