import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import sharp from "sharp";

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const OUTPUT_SIZES = [32, 48, 512];

function decodeS3Key(key) {
  return decodeURIComponent(key.replace(/\+/g, " "));
}

async function bodyToBuffer(body) {
  if (!body) {
    throw new Error("S3 returned an empty object body");
  }

  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }

  const chunks = [];

  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function outputKey(sourceKey, size) {
  const fileName = sourceKey.split("/").pop() || "image";
  const baseName = fileName.replace(/\.[^/.]+$/, "") || "image";

  return `images/${baseName}/${size}.webp`;
}

function jobIdFromSourceKey(sourceKey) {
  const fileName = sourceKey.split("/").pop() || "";
  const match = fileName.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-holiday-icon\./i,
  );

  return match?.[1] ?? null;
}

async function updateJob(jobId, { status, derivativeKeys, error }) {
  const tableName = process.env.DYNAMODB_JOBS_TABLE;

  if (!jobId || !tableName) {
    return;
  }

  const expressionAttributeNames = {
    "#status": "status",
    "#updatedAt": "updated_at",
  };
  const expressionAttributeValues = {
    ":status": { S: status },
    ":updatedAt": { N: String(Math.floor(Date.now() / 1000)) },
  };
  const assignments = ["#status = :status", "#updatedAt = :updatedAt"];

  if (derivativeKeys) {
    expressionAttributeNames["#derivativeKeys"] = "derivative_keys";
    expressionAttributeValues[":derivativeKeys"] = {
      L: derivativeKeys.map((key) => ({ S: key })),
    };
    assignments.push("#derivativeKeys = :derivativeKeys");
  }

  if (error) {
    expressionAttributeNames["#error"] = "error";
    expressionAttributeValues[":error"] = { S: error.slice(0, 500) };
    assignments.push("#error = :error");
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: { job_id: { S: jobId } },
      ConditionExpression: "attribute_exists(job_id)",
      UpdateExpression: `SET ${assignments.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
}

async function jobIdForRecord(record) {
  const sourceBucket = record.s3?.bucket?.name;
  const sourceKey = decodeS3Key(record.s3?.object?.key ?? "");

  if (!sourceBucket || !sourceKey) {
    return null;
  }

  try {
    const object = await s3.send(
      new HeadObjectCommand({ Bucket: sourceBucket, Key: sourceKey }),
    );
    return object.Metadata?.jobid ?? jobIdFromSourceKey(sourceKey);
  } catch {
    return jobIdFromSourceKey(sourceKey);
  }
}

async function processRecord(record, destinationBucket) {
  const sourceBucket = record.s3?.bucket?.name;
  const encodedKey = record.s3?.object?.key;

  if (!sourceBucket || !encodedKey) {
    throw new Error("S3 event record does not contain a bucket and object key");
  }

  if (sourceBucket !== process.env.SOURCE_BUCKET) {
    console.warn("Skipping an object from an unexpected source bucket", {
      sourceBucket,
      key: encodedKey,
    });
    return { key: encodedKey, skipped: true, reason: "unexpected-source" };
  }

  const sourceKey = decodeS3Key(encodedKey);

  if (!sourceKey.startsWith("images/")) {
    console.info("Skipping an object outside the image prefix", { sourceKey });
    return { key: sourceKey, skipped: true, reason: "outside-image-prefix" };
  }

  const object = await s3.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: sourceKey,
    }),
  );
  const input = await bodyToBuffer(object.Body);
  const jobId = object.Metadata?.jobid ?? jobIdFromSourceKey(sourceKey);
  const metadata = await sharp(input).rotate().metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const eligibleSizes = OUTPUT_SIZES.filter(
    (size) => width >= size && height >= size,
  );

  if (eligibleSizes.length === 0) {
    console.info("Skipping an image smaller than every output size", {
      sourceKey,
      width,
      height,
    });
    const result = {
      key: sourceKey,
      jobId,
      skipped: true,
      reason: "smaller-than-all-output-sizes",
      width,
      height,
    };
    await updateJob(jobId, { status: "READY", derivativeKeys: [] });
    return result;
  }

  const outputs = await Promise.all(
    eligibleSizes.map(async (size) => {
      const body = await sharp(input)
        .rotate()
        .resize(size, size, {
          fit: "cover",
          position: "centre",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
      const key = outputKey(sourceKey, size);

      await s3.send(
        new PutObjectCommand({
          Bucket: destinationBucket,
          Key: key,
          Body: body,
          ContentType: "image/webp",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );

      return { key, size, bytes: body.length };
    }),
  );

  console.info("Created image derivatives", {
    sourceKey,
    width,
    height,
    outputs,
  });

  const derivativeKeys = outputs.map((output) => output.key);
  await updateJob(jobId, { status: "READY", derivativeKeys });

  return { key: sourceKey, jobId, outputs };
}

export async function handler(event) {
  const destinationBucket = process.env.DESTINATION_BUCKET;

  if (!process.env.SOURCE_BUCKET || !destinationBucket || !process.env.DYNAMODB_JOBS_TABLE) {
    throw new Error(
      "SOURCE_BUCKET, DESTINATION_BUCKET, and DYNAMODB_JOBS_TABLE environment variables are required",
    );
  }

  const results = [];

  for (const record of event.Records ?? []) {
    try {
      results.push(await processRecord(record, destinationBucket));
    } catch (error) {
      const jobId = await jobIdForRecord(record);

      try {
        await updateJob(jobId, {
          status: "FAILED",
          error: error instanceof Error ? error.message : "Image reshaping failed",
        });
      } catch (jobError) {
        console.error("Unable to mark image job as failed", jobError);
      }

      throw error;
    }
  }

  return { results };
}
