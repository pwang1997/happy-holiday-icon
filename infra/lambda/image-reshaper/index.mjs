import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import sharp from "sharp";
import { reshapingRetryClaim } from "./retry-policy.mjs";

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const OUTPUT_SIZES = [32, 48, 512];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function requiredPositiveIntegerEnvironment(name) {
  const value = Number(requiredEnvironment(name));

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

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

function outputKey(jobId, size) {
  return `images/${jobId}-holiday-icon/${size}.webp`;
}

function jobIdFromSourceKey(sourceKey) {
  const fileName = sourceKey.split("/").pop() || "";
  const match = fileName.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-holiday-icon\./i,
  );

  return match?.[1] ?? null;
}

function isConditionalCheckFailed(error) {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function metadataPositiveInteger(metadata, name) {
  const value = Number(metadata?.[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function updateJob(
  jobId,
  { status, derivativeKeys, error },
  reshapingClaim,
) {
  const tableName = requiredEnvironment("DYNAMODB_JOBS_TABLE");

  const expressionAttributeNames = {
    "#status": "status",
    "#updatedAt": "updated_at",
    "#reshapingAttempt": "reshaping_attempt",
    "#retryAt": "generation_retry_at",
  };
  const expressionAttributeValues = {
    ":status": { S: status },
    ":updatedAt": { N: String(nowInSeconds()) },
    ":reshaping": { S: "RESHAPING" },
    ":reshapingAttempt": { N: String(reshapingClaim.reshapingAttempt) },
    ":retryAt": { N: String(reshapingClaim.reshapingRetryAt) },
  };
  const assignments = ["#status = :status", "#updatedAt = :updatedAt"];

  if (derivativeKeys) {
    expressionAttributeNames["#derivativeKeys"] = "derivative_keys";
    expressionAttributeValues[":derivativeKeys"] = {
      L: derivativeKeys.map((key) => ({ S: key })),
    };
    assignments.push("#derivativeKeys = :derivativeKeys");
  }

  if (error !== undefined) {
    expressionAttributeNames["#error"] = "error";
    expressionAttributeValues[":error"] =
      error === null ? { NULL: true } : { S: error.slice(0, 500) };
    assignments.push("#error = :error");
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: { job_id: { S: jobId } },
      ConditionExpression:
        "attribute_exists(job_id) AND #status = :reshaping AND #reshapingAttempt = :reshapingAttempt AND #retryAt = :retryAt",
      UpdateExpression: `SET ${assignments.join(", ")} REMOVE #retryAt`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
}

async function claimInitialReshaping({
  generatedKey,
  generatedVersionId,
  generationAttempt,
  generationRetryAt,
  jobId,
}) {
  const now = nowInSeconds();
  const reshapingRetryAt =
    now + requiredPositiveIntegerEnvironment("RESHAPING_LEASE_SECONDS");

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      Key: { job_id: { S: jobId } },
      ConditionExpression:
        "attribute_exists(job_id) AND #status = :generating AND #generationAttempt = :generationAttempt AND #retryAt = :generationRetryAt",
      UpdateExpression:
        "SET #status = :reshaping, #reshapingAttempt = :reshapingAttempt, #retryAt = :reshapingRetryAt, #generatedKey = :generatedKey, #generatedVersionId = :generatedVersionId, #updatedAt = :now, #error = :null",
      ExpressionAttributeNames: {
        "#error": "error",
        "#generatedKey": "generated_key",
        "#generatedVersionId": "generated_version_id",
        "#generationAttempt": "generation_attempt",
        "#reshapingAttempt": "reshaping_attempt",
        "#retryAt": "generation_retry_at",
        "#status": "status",
        "#updatedAt": "updated_at",
      },
      ExpressionAttributeValues: {
        ":generatedKey": { S: generatedKey },
        ":generatedVersionId": { S: generatedVersionId },
        ":generationAttempt": { N: String(generationAttempt) },
        ":generationRetryAt": { N: String(generationRetryAt) },
        ":now": { N: String(now) },
        ":null": { NULL: true },
        ":reshaping": { S: "RESHAPING" },
        ":reshapingAttempt": { N: "1" },
        ":reshapingRetryAt": { N: String(reshapingRetryAt) },
      },
    }),
  );

  return { reshapingAttempt: 1, reshapingRetryAt };
}

async function claimRetryReshaping({
  expectedAttempt,
  expectedReshapingRetryAt,
  generatedKey,
  generatedVersionId,
  jobId,
}) {
  const now = nowInSeconds();
  const claim = reshapingRetryClaim(
    expectedAttempt,
    expectedReshapingRetryAt,
    now,
    requiredPositiveIntegerEnvironment("RESHAPING_LEASE_SECONDS"),
  );

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      Key: { job_id: { S: jobId } },
      ConditionExpression:
        "attribute_exists(job_id) AND #status = :reshaping AND #reshapingAttempt = :previousAttempt AND #retryAt = :expectedRetryAt AND #generatedKey = :generatedKey AND #generatedVersionId = :generatedVersionId",
      UpdateExpression:
        "SET #reshapingAttempt = :expectedAttempt, #retryAt = :renewedRetryAt, #updatedAt = :now, #error = :null",
      ExpressionAttributeNames: {
        "#error": "error",
        "#generatedKey": "generated_key",
        "#generatedVersionId": "generated_version_id",
        "#reshapingAttempt": "reshaping_attempt",
        "#retryAt": "generation_retry_at",
        "#status": "status",
        "#updatedAt": "updated_at",
      },
      ExpressionAttributeValues: {
        ":expectedAttempt": { N: String(expectedAttempt) },
        ":expectedRetryAt": { N: String(claim.expectedReshapingRetryAt) },
        ":generatedKey": { S: generatedKey },
        ":generatedVersionId": { S: generatedVersionId },
        ":now": { N: String(now) },
        ":null": { NULL: true },
        ":previousAttempt": { N: String(claim.previousAttempt) },
        ":renewedRetryAt": { N: String(claim.renewedReshapingRetryAt) },
        ":reshaping": { S: "RESHAPING" },
      },
    }),
  );

  return {
    reshapingAttempt: expectedAttempt,
    reshapingRetryAt: claim.renewedReshapingRetryAt,
  };
}

async function markJobFailed(jobId, error, reshapingClaim) {
  if (!jobId || !reshapingClaim) {
    return false;
  }

  try {
    await updateJob(
      jobId,
      {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Image reshaping failed",
      },
      reshapingClaim,
    );
    return true;
  } catch (updateError) {
    if (isConditionalCheckFailed(updateError)) {
      return false;
    }

    throw updateError;
  }
}

async function readGeneratedImage({ sourceBucket, sourceKey, sourceVersionId }) {
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: sourceKey,
      VersionId: sourceVersionId,
    }),
  );
  const input = await bodyToBuffer(object.Body);
  const jobId = object.Metadata?.jobid ?? jobIdFromSourceKey(sourceKey);

  if (!jobId) {
    throw new Error("Generated image does not identify an image job");
  }

  return { input, jobId, metadata: object.Metadata ?? {} };
}

async function reshapeClaimedImage({
  destinationBucket,
  input,
  jobId,
  reshapingClaim,
  sourceKey,
}) {
  try {
    const metadata = await sharp(input).rotate().metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const eligibleSizes = OUTPUT_SIZES.filter(
      (size) => width >= size && height >= size,
    );

    if (eligibleSizes.length === 0) {
      const result = {
        key: sourceKey,
        jobId,
        skipped: true,
        reason: "smaller-than-all-output-sizes",
        width,
        height,
      };
      await updateJob(
        jobId,
        { status: "READY", derivativeKeys: [], error: null },
        reshapingClaim,
      );
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
        const key = outputKey(jobId, size);

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

    const derivativeKeys = outputs.map((output) => output.key);
    await updateJob(
      jobId,
      { status: "READY", derivativeKeys, error: null },
      reshapingClaim,
    );

    return { key: sourceKey, jobId, outputs };
  } catch (error) {
    const failed = await markJobFailed(jobId, error, reshapingClaim);

    if (!failed) {
      return { key: sourceKey, jobId, skipped: true, reason: "job-not-reshaping" };
    }

    return { key: sourceKey, jobId, status: "FAILED" };
  }
}

async function processS3Record(record, destinationBucket) {
  const sourceBucket = record.s3?.bucket?.name;
  const encodedKey = record.s3?.object?.key;
  const sourceVersionId = record.s3?.object?.versionId;

  if (!sourceBucket || !encodedKey || !sourceVersionId) {
    throw new Error("S3 event record does not contain a versioned generated image");
  }

  if (sourceBucket !== requiredEnvironment("SOURCE_BUCKET")) {
    return { key: encodedKey, skipped: true, reason: "unexpected-source" };
  }

  const sourceKey = decodeS3Key(encodedKey);

  if (!sourceKey.startsWith("images/")) {
    return { key: sourceKey, skipped: true, reason: "outside-image-prefix" };
  }

  const generated = await readGeneratedImage({
    sourceBucket,
    sourceKey,
    sourceVersionId,
  });
  const generationAttempt = metadataPositiveInteger(
    generated.metadata,
    "generationattempt",
  );
  const generationRetryAt = metadataPositiveInteger(
    generated.metadata,
    "generationlease",
  );

  if (!generationAttempt || !generationRetryAt) {
    return { key: sourceKey, jobId: generated.jobId, skipped: true, reason: "missing-generation-claim" };
  }

  let reshapingClaim;

  try {
    reshapingClaim = await claimInitialReshaping({
      generatedKey: sourceKey,
      generatedVersionId: sourceVersionId,
      generationAttempt,
      generationRetryAt,
      jobId: generated.jobId,
    });
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { key: sourceKey, jobId: generated.jobId, skipped: true, reason: "job-not-generating" };
    }

    throw error;
  }

  return reshapeClaimedImage({
    destinationBucket,
    input: generated.input,
    jobId: generated.jobId,
    reshapingClaim,
    sourceKey,
  });
}

async function processReshapingRetry(event, destinationBucket) {
  if (
    typeof event.jobId !== "string" ||
    typeof event.generatedKey !== "string" ||
    typeof event.generatedVersionId !== "string" ||
    !Number.isSafeInteger(event.expectedAttempt) ||
    !Number.isSafeInteger(event.expectedReshapingRetryAt)
  ) {
    return { skipped: true, reason: "invalid-reshaping-retry" };
  }

  const generated = await readGeneratedImage({
    sourceBucket: requiredEnvironment("SOURCE_BUCKET"),
    sourceKey: event.generatedKey,
    sourceVersionId: event.generatedVersionId,
  });

  if (generated.jobId !== event.jobId) {
    return { skipped: true, reason: "generated-image-job-mismatch" };
  }

  let reshapingClaim;

  try {
    reshapingClaim = await claimRetryReshaping({
      expectedAttempt: event.expectedAttempt,
      expectedReshapingRetryAt: event.expectedReshapingRetryAt,
      generatedKey: event.generatedKey,
      generatedVersionId: event.generatedVersionId,
      jobId: event.jobId,
    });
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { jobId: event.jobId, skipped: true, reason: "reshaping-retry-not-claimable" };
    }

    throw error;
  }

  return reshapeClaimedImage({
    destinationBucket,
    input: generated.input,
    jobId: event.jobId,
    reshapingClaim,
    sourceKey: event.generatedKey,
  });
}

export async function handler(event) {
  const destinationBucket = requiredEnvironment("DESTINATION_BUCKET");
  requiredEnvironment("SOURCE_BUCKET");
  requiredEnvironment("DYNAMODB_JOBS_TABLE");
  requiredPositiveIntegerEnvironment("RESHAPING_LEASE_SECONDS");

  if (event?.type === "reshaping-retry") {
    return processReshapingRetry(event, destinationBucket);
  }

  const results = [];

  for (const record of event.Records ?? []) {
    results.push(await processS3Record(record, destinationBucket));
  }

  return { results };
}
