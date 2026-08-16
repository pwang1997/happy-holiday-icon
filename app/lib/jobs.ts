import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  IMAGE_JOB_STATUSES,
  type ImageJobStatus,
} from "./image-job-contract";

export const JOB_STATUSES = IMAGE_JOB_STATUSES;
export type JobStatus = ImageJobStatus;

export type ImageJob = {
  jobId: string;
  status: JobStatus;
  sourceKey: string;
  derivativeKeys: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

const JOB_TTL_SECONDS = 24 * 60 * 60;
let client: DynamoDBDocumentClient | undefined;

function getTableName() {
  const tableName = process.env.DYNAMODB_JOBS_TABLE?.trim();

  if (!tableName) {
    throw new Error("DYNAMODB_JOBS_TABLE is not configured");
  }

  return tableName;
}

function getClient() {
  if (client) {
    return client;
  }

  const region = process.env.AWS_REGION?.trim();

  if (!region) {
    throw new Error("AWS_REGION is not configured");
  }

  const config: DynamoDBClientConfig = { region };
  client = DynamoDBDocumentClient.from(new DynamoDBClient(config), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return client;
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function toImageJob(item: Record<string, unknown>): ImageJob | null {
  const jobId = item.job_id;
  const status = item.status;
  const sourceKey = item.source_key;
  const createdAt = item.created_at;
  const updatedAt = item.updated_at;
  const expiresAt = item.expires_at;

  if (
    typeof jobId !== "string" ||
    !JOB_STATUSES.includes(status as JobStatus) ||
    typeof sourceKey !== "string" ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number" ||
    typeof expiresAt !== "number"
  ) {
    return null;
  }

  return {
    jobId,
    status: status as JobStatus,
    sourceKey,
    derivativeKeys: asStringArray(item.derivative_keys),
    error: typeof item.error === "string" ? item.error : null,
    createdAt,
    updatedAt,
    expiresAt,
  };
}

export async function createImageJob(contentType: string, imageHash: string) {
  const jobId = crypto.randomUUID();
  const createdAt = nowInSeconds();
  const sourceKey = `uploads/${imageHash}/source.${extensionForContentType(contentType)}`;
  const job: ImageJob = {
    jobId,
    status: "UPLOADING",
    sourceKey,
    derivativeKeys: [],
    error: null,
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + JOB_TTL_SECONDS,
  };

  await getClient().send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        job_id: job.jobId,
        status: job.status,
        source_key: job.sourceKey,
        derivative_keys: job.derivativeKeys,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
        expires_at: job.expiresAt,
      },
      ConditionExpression: "attribute_not_exists(job_id)",
    }),
  );

  return job;
}

export async function getImageJob(jobId: string) {
  const result = await getClient().send(
    new GetCommand({
      TableName: getTableName(),
      Key: { job_id: jobId },
    }),
  );

  return result.Item ? toImageJob(result.Item) : null;
}

export async function updateImageJob(
  jobId: string,
  update: Pick<ImageJob, "status"> &
    Partial<Pick<ImageJob, "derivativeKeys" | "error">>,
  expectedStatus?: JobStatus,
) {
  const updatedAt = nowInSeconds();
  const names: Record<string, string> = {
    "#status": "status",
    "#updatedAt": "updated_at",
  };
  const values: Record<string, unknown> = {
    ":status": update.status,
    ":updatedAt": updatedAt,
  };
  const assignments = ["#status = :status", "#updatedAt = :updatedAt"];
  let conditionExpression = "attribute_exists(job_id)";

  if (expectedStatus) {
    names["#expectedStatus"] = "status";
    values[":expectedStatus"] = expectedStatus;
    conditionExpression += " AND #expectedStatus = :expectedStatus";
  }

  if (update.derivativeKeys) {
    names["#derivativeKeys"] = "derivative_keys";
    values[":derivativeKeys"] = update.derivativeKeys;
    assignments.push("#derivativeKeys = :derivativeKeys");
  }

  if (update.error !== undefined) {
    names["#error"] = "error";
    values[":error"] = update.error;
    assignments.push("#error = :error");
  }

  await getClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { job_id: jobId },
      ConditionExpression: conditionExpression,
      UpdateExpression: `SET ${assignments.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export function isExpired(job: ImageJob) {
  return job.expiresAt <= nowInSeconds();
}

export function extensionForContentType(contentType: string) {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      throw new Error("Unsupported image type");
  }
}

export function isImageHash(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

export function imageHashFromSourceKey(sourceKey: string) {
  const match = sourceKey.match(/^uploads\/([a-f0-9]{64})\/source\.[a-z]+$/);

  if (!match) {
    throw new Error("Image job has an invalid source key");
  }

  return match[1];
}
