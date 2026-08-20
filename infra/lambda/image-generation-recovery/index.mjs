import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  generationRecoveryAction,
} from "./retry-policy.mjs";

const dynamodb = new DynamoDBClient({});
const sqs = new SQSClient({});
const RECOVERY_BATCH_SIZE = 25;

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

function valueAsString(item, name) {
  const value = item?.[name]?.S;
  return typeof value === "string" ? value : null;
}

function valueAsNumber(item, name) {
  const value = Number(item?.[name]?.N);
  return Number.isSafeInteger(value) ? value : null;
}

function expiredGenerationJob(item) {
  const job = {
    generationAttempt: valueAsNumber(item, "generation_attempt"),
    generationRetryAt: valueAsNumber(item, "generation_retry_at"),
    jobId: valueAsString(item, "job_id"),
    sourceBucket: requiredEnvironment("SOURCE_BUCKET"),
    sourceKey: valueAsString(item, "source_key"),
    sourceVersionId: valueAsString(item, "source_version_id"),
  };

  return Object.values(job).every((value) => value !== null) ? job : null;
}

async function getExpiredGenerationJobs(now) {
  const result = await dynamodb.send(
    new QueryCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      IndexName: requiredEnvironment("GENERATION_RECOVERY_INDEX"),
      KeyConditionExpression: "#status = :generating AND #retryAt <= :now",
      ExpressionAttributeNames: {
        "#status": "status",
        "#retryAt": "generation_retry_at",
      },
      ExpressionAttributeValues: {
        ":generating": { S: "GENERATING" },
        ":now": { N: String(now) },
      },
      Limit: RECOVERY_BATCH_SIZE,
    }),
  );

  return (result.Items ?? []).map(expiredGenerationJob).filter(Boolean);
}

async function scheduleRetry(job, now, delaySeconds) {
  const nextRetryAt =
    now + delaySeconds + requiredPositiveIntegerEnvironment("GENERATION_LEASE_SECONDS");

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      Key: { job_id: { S: job.jobId } },
      ConditionExpression:
        "attribute_exists(job_id) AND #status = :generating AND #generationAttempt = :attempt AND #generationRetryAt <= :now",
      UpdateExpression: "SET #generationRetryAt = :nextRetryAt, #updatedAt = :now",
      ExpressionAttributeNames: {
        "#generationAttempt": "generation_attempt",
        "#generationRetryAt": "generation_retry_at",
        "#status": "status",
        "#updatedAt": "updated_at",
      },
      ExpressionAttributeValues: {
        ":attempt": { N: String(job.generationAttempt) },
        ":generating": { S: "GENERATING" },
        ":nextRetryAt": { N: String(nextRetryAt) },
        ":now": { N: String(now) },
      },
    }),
  );

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: requiredEnvironment("IMAGE_GENERATION_QUEUE_URL"),
      DelaySeconds: delaySeconds,
      MessageBody: JSON.stringify({
        expectedAttempt: job.generationAttempt + 1,
        jobId: job.jobId,
        sourceBucket: job.sourceBucket,
        sourceKey: job.sourceKey,
        sourceVersionId: job.sourceVersionId,
        type: "generation-retry",
      }),
    }),
  );

  return { delaySeconds, jobId: job.jobId, status: "RETRY_SCHEDULED" };
}

async function markJobFailed(job, now) {
  await dynamodb.send(
    new UpdateItemCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      Key: { job_id: { S: job.jobId } },
      ConditionExpression:
        "attribute_exists(job_id) AND #status = :generating AND #generationAttempt = :attempt AND #generationRetryAt <= :now",
      UpdateExpression:
        "SET #status = :failed, #error = :error, #updatedAt = :now REMOVE #generationRetryAt",
      ExpressionAttributeNames: {
        "#error": "error",
        "#generationAttempt": "generation_attempt",
        "#generationRetryAt": "generation_retry_at",
        "#status": "status",
        "#updatedAt": "updated_at",
      },
      ExpressionAttributeValues: {
        ":attempt": { N: String(job.generationAttempt) },
        ":error": {
          S: `Image generation did not complete before its lease expired after ${requiredPositiveIntegerEnvironment("GENERATION_MAX_RETRIES")} retries.`,
        },
        ":failed": { S: "FAILED" },
        ":generating": { S: "GENERATING" },
        ":now": { N: String(now) },
      },
    }),
  );

  return { jobId: job.jobId, status: "FAILED" };
}

function isConditionalCheckFailed(error) {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

async function recoverJob(job, now) {
  try {
    const recovery = generationRecoveryAction(
      job.generationAttempt,
      requiredPositiveIntegerEnvironment("GENERATION_MAX_RETRIES"),
      requiredPositiveIntegerEnvironment("GENERATION_RETRY_BASE_DELAY_SECONDS"),
    );

    if (recovery.action === "fail") {
      return await markJobFailed(job, now);
    }

    return await scheduleRetry(job, now, recovery.delaySeconds);
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { jobId: job.jobId, status: "SKIPPED" };
    }

    throw error;
  }
}

export async function handler() {
  requiredEnvironment("DYNAMODB_JOBS_TABLE");
  requiredPositiveIntegerEnvironment("GENERATION_LEASE_SECONDS");
  requiredPositiveIntegerEnvironment("GENERATION_MAX_RETRIES");
  requiredEnvironment("GENERATION_RECOVERY_INDEX");
  requiredPositiveIntegerEnvironment("GENERATION_RETRY_BASE_DELAY_SECONDS");
  requiredEnvironment("IMAGE_GENERATION_QUEUE_URL");
  requiredEnvironment("SOURCE_BUCKET");

  const now = nowInSeconds();
  const jobs = await getExpiredGenerationJobs(now);
  const results = await Promise.all(jobs.map((job) => recoverJob(job, now)));

  console.info("Recovered expired image-generation leases", {
    recovered: results.length,
    results,
  });
}
