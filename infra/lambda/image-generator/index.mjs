import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import sharp from "sharp";

const dynamodb = new DynamoDBClient({});
const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SOURCE_KEY_PATTERN = new RegExp(
  `^uploads/(${UUID_PATTERN})/source\\.(png|jpe?g|webp)$`,
  "i",
);

const STYLE_INSTRUCTIONS = {
  playful: "Use a playful, hand-drawn illustration style with warm, friendly shapes.",
  minimal: "Use a minimal, clean style with simple geometry and plenty of negative space.",
  vintage: "Use a vintage holiday postcard style with softly textured, nostalgic colors.",
  festive: "Use a bright, festive style with joyful colors and celebratory details.",
};

let openAiApiKey;

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

function sourceDetailsFromKey(key) {
  const match = key.match(SOURCE_KEY_PATTERN);

  if (!match) {
    return null;
  }

  return { jobId: match[1], extension: match[2].toLowerCase() };
}

function sourceContentType(extension) {
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      throw new Error(`Unsupported source extension: ${extension}`);
  }
}

function sourceFormat(extension) {
  switch (extension) {
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "webp":
      return "webp";
    default:
      throw new Error(`Unsupported source extension: ${extension}`);
  }
}

function styleInstruction(style) {
  const instruction = STYLE_INSTRUCTIONS[style];

  if (!instruction) {
    throw new Error(`Unsupported image style: ${style}`);
  }

  return instruction;
}

function valueAsString(item, name) {
  const value = item?.[name]?.S;
  return typeof value === "string" ? value : null;
}

function valueAsNumber(item, name) {
  const value = Number(item?.[name]?.N);
  return Number.isSafeInteger(value) ? value : null;
}

function isConditionalCheckFailed(error) {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

async function bodyToBuffer(body, maxBytes) {
  if (!body) {
    throw new Error("S3 returned an empty source image");
  }

  const chunks = [];
  let byteLength = 0;

  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;

    if (byteLength > maxBytes) {
      throw new Error(`Source image exceeds the ${maxBytes}-byte limit`);
    }

    chunks.push(bytes);
  }

  if (byteLength === 0) {
    throw new Error("S3 returned an empty source image");
  }

  return Buffer.concat(chunks, byteLength);
}

async function getValidatedSourceImage({
  bucket,
  extension,
  key,
  maxBytes,
  maxDimension,
  maxPixels,
  versionId,
}) {
  const expectedContentType = sourceContentType(extension);
  const expectedFormat = sourceFormat(extension);
  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: versionId,
    }),
  );
  const contentLength = head.ContentLength;

  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new Error("Source image has an invalid content length");
  }

  if (contentLength > maxBytes) {
    throw new Error(`Source image exceeds the ${maxBytes}-byte limit`);
  }

  if (head.ContentType !== expectedContentType) {
    throw new Error(`Source image content type must be ${expectedContentType}`);
  }

  const source = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: versionId,
    }),
  );
  const input = await bodyToBuffer(source.Body, maxBytes);

  if (input.length !== contentLength) {
    throw new Error("Source image length did not match its object metadata");
  }

  let metadata;

  try {
    metadata = await sharp(input, { limitInputPixels: maxPixels }).metadata();
  } catch {
    throw new Error("Source image is not a readable PNG, JPG, or WEBP file");
  }

  if (metadata.format !== expectedFormat) {
    throw new Error(`Source image signature does not match .${extension}`);
  }

  if (
    !Number.isSafeInteger(metadata.width) ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error("Source image has invalid dimensions");
  }

  if (metadata.width > maxDimension || metadata.height > maxDimension) {
    throw new Error(
      `Source image dimensions must not exceed ${maxDimension}px on either side`,
    );
  }

  const pixelCount = metadata.width * metadata.height;

  if (!Number.isSafeInteger(pixelCount) || pixelCount > maxPixels) {
    throw new Error(`Source image exceeds the ${maxPixels}-pixel limit`);
  }

  return { input, contentType: expectedContentType };
}

async function getJob(jobId) {
  const result = await dynamodb.send(
    new GetItemCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      Key: { job_id: { S: jobId } },
      ConsistentRead: true,
    }),
  );
  const item = result.Item;

  if (!item) {
    return null;
  }

  return {
    generationAttempt: valueAsNumber(item, "generation_attempt") ?? 0,
    generationRetryAt: valueAsNumber(item, "generation_retry_at"),
    status: valueAsString(item, "status"),
    sourceKey: valueAsString(item, "source_key"),
    sourceVersionId: valueAsString(item, "source_version_id"),
    prompt: valueAsString(item, "prompt"),
    style: valueAsString(item, "style"),
  };
}

async function updateJob(jobId, { status, error }, expectedStatus) {
  const names = {
    "#expectedStatus": "status",
    "#status": "status",
    "#updatedAt": "updated_at",
    "#generationRetryAt": "generation_retry_at",
  };
  const values = {
    ":expectedStatus": { S: expectedStatus },
    ":status": { S: status },
    ":updatedAt": { N: String(nowInSeconds()) },
  };
  const assignments = ["#status = :status", "#updatedAt = :updatedAt"];
  const removals = status === "GENERATING" ? [] : ["#generationRetryAt"];

  if (error !== undefined) {
    names["#error"] = "error";
    values[":error"] = error === null ? { NULL: true } : { S: error.slice(0, 500) };
    assignments.push("#error = :error");
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      Key: { job_id: { S: jobId } },
      ConditionExpression: "attribute_exists(job_id) AND #expectedStatus = :expectedStatus",
      UpdateExpression: [
        `SET ${assignments.join(", ")}`,
        removals.length > 0 ? `REMOVE ${removals.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

async function claimInitialGeneration(jobId, sourceVersionId) {
  const now = nowInSeconds();
  const retryAt = now + requiredPositiveIntegerEnvironment("GENERATION_LEASE_SECONDS");

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      Key: { job_id: { S: jobId } },
      ConditionExpression: "attribute_exists(job_id) AND #status = :uploading",
      UpdateExpression:
        "SET #status = :generating, #generationAttempt = :attempt, #generationRetryAt = :retryAt, #sourceVersionId = :sourceVersionId, #updatedAt = :now, #error = :null",
      ExpressionAttributeNames: {
        "#error": "error",
        "#generationAttempt": "generation_attempt",
        "#generationRetryAt": "generation_retry_at",
        "#sourceVersionId": "source_version_id",
        "#status": "status",
        "#updatedAt": "updated_at",
      },
      ExpressionAttributeValues: {
        ":attempt": { N: "1" },
        ":generating": { S: "GENERATING" },
        ":null": { NULL: true },
        ":now": { N: String(now) },
        ":retryAt": { N: String(retryAt) },
        ":sourceVersionId": { S: sourceVersionId },
        ":uploading": { S: "UPLOADING" },
      },
    }),
  );
}

async function claimRetryGeneration(jobId, sourceVersionId, expectedAttempt) {
  const previousAttempt = expectedAttempt - 1;

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: requiredEnvironment("DYNAMODB_JOBS_TABLE"),
      Key: { job_id: { S: jobId } },
      ConditionExpression:
        "attribute_exists(job_id) AND #status = :generating AND #generationAttempt = :previousAttempt AND #sourceVersionId = :sourceVersionId",
      UpdateExpression:
        "SET #generationAttempt = :expectedAttempt, #updatedAt = :now, #error = :null",
      ExpressionAttributeNames: {
        "#error": "error",
        "#generationAttempt": "generation_attempt",
        "#sourceVersionId": "source_version_id",
        "#status": "status",
        "#updatedAt": "updated_at",
      },
      ExpressionAttributeValues: {
        ":expectedAttempt": { N: String(expectedAttempt) },
        ":generating": { S: "GENERATING" },
        ":null": { NULL: true },
        ":now": { N: String(nowInSeconds()) },
        ":previousAttempt": { N: String(previousAttempt) },
        ":sourceVersionId": { S: sourceVersionId },
      },
    }),
  );
}

async function markJobFailed(jobId, error, expectedStatus) {
  try {
    await updateJob(
      jobId,
      {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Image generation failed",
      },
      expectedStatus,
    );
    return true;
  } catch (updateError) {
    if (isConditionalCheckFailed(updateError)) {
      return false;
    }

    throw updateError;
  }
}

async function getOpenAiApiKey() {
  if (openAiApiKey) {
    return openAiApiKey;
  }

  const result = await secrets.send(
    new GetSecretValueCommand({
      SecretId: requiredEnvironment("OPENAI_API_KEY_SECRET_ARN"),
    }),
  );
  const secretValue = result.SecretString?.trim();

  if (!secretValue) {
    throw new Error("The OpenAI API key secret does not contain a string value");
  }

  try {
    const parsed = JSON.parse(secretValue);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.OPENAI_API_KEY === "string" &&
      parsed.OPENAI_API_KEY.trim()
    ) {
      openAiApiKey = parsed.OPENAI_API_KEY.trim();
      return openAiApiKey;
    }
  } catch {
    // A raw key is also an accepted secret value.
  }

  openAiApiKey = secretValue;
  return openAiApiKey;
}

function generationPrompt(prompt, style) {
  return [
    "Edit the uploaded reference image into a single holiday app icon.",
    `The requested subject or direction is: ${prompt}`,
    `The requested visual style is: ${styleInstruction(style)}`,
    "Keep the main subject recognizable, centered, and legible at small sizes.",
    "Use a square composition, a clean silhouette, and no text or watermark.",
    "Return the finished icon as a PNG with a transparent background when possible.",
  ].join("\n");
}

async function generateImage({ input, contentType, extension, prompt, style }) {
  const form = new FormData();
  const model = requiredEnvironment("IMAGE_GENERATION_MODEL");
  const background = requiredEnvironment("IMAGE_GENERATION_BACKGROUND");

  form.set("model", model);
  form.set(
    "image[]",
    new Blob([input], { type: contentType }),
    `source.${extension}`,
  );
  form.set("prompt", generationPrompt(prompt, style));
  form.set("size", "1024x1024");
  form.set("quality", "medium");
  form.set("output_format", "png");

  if (background !== "auto") {
    form.set("background", background);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getOpenAiApiKey()}`,
    },
    body: form,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      typeof payload?.error?.message === "string"
        ? `: ${payload.error.message.slice(0, 500)}`
        : "";
    throw new Error(`OpenAI image edit failed with ${response.status}${detail}`);
  }

  const imageBase64 = payload?.data?.[0]?.b64_json;

  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    throw new Error("OpenAI image edit did not return image data");
  }

  return Buffer.from(imageBase64, "base64");
}

async function generateClaimedImage({
  job,
  sourceBucket,
  sourceDetails,
  sourceKey,
  sourceVersionId,
}) {
  let failureStatus = "GENERATING";

  try {
    const source = await getValidatedSourceImage({
      bucket: sourceBucket,
      extension: sourceDetails.extension,
      key: sourceKey,
      maxBytes: requiredPositiveIntegerEnvironment("MAX_SOURCE_IMAGE_BYTES"),
      maxDimension: requiredPositiveIntegerEnvironment("MAX_SOURCE_IMAGE_DIMENSION"),
      maxPixels: requiredPositiveIntegerEnvironment("MAX_SOURCE_IMAGE_PIXELS"),
      versionId: sourceVersionId,
    });
    const output = await generateImage({
      input: source.input,
      contentType: source.contentType,
      extension: sourceDetails.extension,
      prompt: job.prompt,
      style: job.style,
    });

    await updateJob(
      sourceDetails.jobId,
      { status: "RESHAPING", error: null },
      "GENERATING",
    );
    failureStatus = "RESHAPING";

    const generatedKey = `images/${sourceDetails.jobId}/generated.png`;
    await s3.send(
      new PutObjectCommand({
        Bucket: sourceBucket,
        Key: generatedKey,
        Body: output,
        ContentType: "image/png",
        Metadata: { jobid: sourceDetails.jobId },
      }),
    );

    return {
      generatedKey,
      jobId: sourceDetails.jobId,
      status: "RESHAPING",
    };
  } catch (error) {
    const failed = await markJobFailed(sourceDetails.jobId, error, failureStatus);

    if (!failed) {
      console.info("Image job reached a terminal state before the worker could fail it", {
        jobId: sourceDetails.jobId,
      });
    }

    return { jobId: sourceDetails.jobId, status: "FAILED" };
  }
}

function queueWorkItemsFromSqsRecord(record) {
  let message;

  try {
    message = JSON.parse(record.body);
  } catch {
    throw new Error("SQS message did not contain a valid JSON payload");
  }

  if (message?.type === "generation-retry") {
    if (
      typeof message.jobId !== "string" ||
      typeof message.sourceBucket !== "string" ||
      typeof message.sourceKey !== "string" ||
      typeof message.sourceVersionId !== "string" ||
      !Number.isSafeInteger(message.expectedAttempt)
    ) {
      throw new Error("SQS generation retry message is invalid");
    }

    return [{ ...message, kind: "retry" }];
  }

  if (!Array.isArray(message?.Records)) {
    throw new Error("SQS message did not contain S3 event records");
  }

  return message.Records.map((s3Record) => ({ kind: "source", record: s3Record }));
}

async function processS3Record(record) {
  const sourceBucket = record.s3?.bucket?.name;
  const encodedKey = record.s3?.object?.key;

  if (!sourceBucket || !encodedKey) {
    throw new Error("S3 event record does not contain a bucket and object key");
  }

  if (sourceBucket !== requiredEnvironment("SOURCE_BUCKET")) {
    console.warn("Skipping source event from an unexpected bucket", { sourceBucket });
    return { skipped: true, reason: "unexpected-source-bucket" };
  }

  const sourceKey = decodeS3Key(encodedKey);
  const sourceDetails = sourceDetailsFromKey(sourceKey);

  if (!sourceDetails) {
    console.info("Skipping a non-job-scoped source upload", { sourceKey });
    return { skipped: true, reason: "non-job-scoped-source" };
  }

  const job = await getJob(sourceDetails.jobId);

  if (!job || job.sourceKey !== sourceKey) {
    console.info("Skipping a source event that is not an uploadable job", {
      jobId: sourceDetails.jobId,
      sourceKey,
      status: job?.status,
    });
    return { skipped: true, reason: "job-not-uploadable" };
  }

  if (job.status !== "UPLOADING") {
    return {
      skipped: true,
      reason: job.status === "GENERATING" ? "job-generation-in-progress" : "job-not-uploadable",
    };
  }

  const sourceVersionId = record.s3?.object?.versionId;

  if (typeof sourceVersionId !== "string" || sourceVersionId.length === 0) {
    await markJobFailed(
      sourceDetails.jobId,
      new Error("Source upload event did not include an object version"),
      "UPLOADING",
    );
    return { jobId: sourceDetails.jobId, status: "FAILED" };
  }

  if (!job.prompt || !job.style) {
    await markJobFailed(
      sourceDetails.jobId,
      new Error("Image job is missing generation instructions"),
      "UPLOADING",
    );
    return { jobId: sourceDetails.jobId, status: "FAILED" };
  }

  try {
    await claimInitialGeneration(sourceDetails.jobId, sourceVersionId);
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { skipped: true, reason: "job-already-claimed" };
    }

    throw error;
  }

  return generateClaimedImage({
    job,
    sourceBucket,
    sourceDetails,
    sourceKey,
    sourceVersionId,
  });
}

async function processGenerationRetry(message) {
  const sourceDetails = sourceDetailsFromKey(message.sourceKey);

  if (
    !sourceDetails ||
    sourceDetails.jobId !== message.jobId ||
    message.sourceBucket !== requiredEnvironment("SOURCE_BUCKET") ||
    message.expectedAttempt < 2 ||
    message.expectedAttempt > requiredPositiveIntegerEnvironment("GENERATION_MAX_RETRIES") + 1
  ) {
    return { skipped: true, reason: "invalid-generation-retry" };
  }

  const job = await getJob(sourceDetails.jobId);

  if (
    !job ||
    job.status !== "GENERATING" ||
    job.sourceKey !== message.sourceKey ||
    job.sourceVersionId !== message.sourceVersionId ||
    job.generationAttempt !== message.expectedAttempt - 1
  ) {
    return { skipped: true, reason: "generation-retry-not-claimable" };
  }

  if (!job.prompt || !job.style) {
    await markJobFailed(
      sourceDetails.jobId,
      new Error("Image job is missing generation instructions"),
      "GENERATING",
    );
    return { jobId: sourceDetails.jobId, status: "FAILED" };
  }

  try {
    await claimRetryGeneration(
      sourceDetails.jobId,
      message.sourceVersionId,
      message.expectedAttempt,
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { skipped: true, reason: "generation-retry-already-claimed" };
    }

    throw error;
  }

  return generateClaimedImage({
    job,
    sourceBucket: message.sourceBucket,
    sourceDetails,
    sourceKey: message.sourceKey,
    sourceVersionId: message.sourceVersionId,
  });
}

async function processSqsRecord(record) {
  const workItems = queueWorkItemsFromSqsRecord(record);
  const results = [];

  for (const workItem of workItems) {
    results.push(
      workItem.kind === "retry"
        ? await processGenerationRetry(workItem)
        : await processS3Record(workItem.record),
    );
  }

  return results;
}

export async function handler(event) {
  requiredEnvironment("DYNAMODB_JOBS_TABLE");
  requiredEnvironment("IMAGE_GENERATION_MODEL");
  requiredEnvironment("IMAGE_GENERATION_BACKGROUND");
  requiredPositiveIntegerEnvironment("MAX_SOURCE_IMAGE_BYTES");
  requiredPositiveIntegerEnvironment("MAX_SOURCE_IMAGE_DIMENSION");
  requiredPositiveIntegerEnvironment("MAX_SOURCE_IMAGE_PIXELS");
  requiredPositiveIntegerEnvironment("GENERATION_LEASE_SECONDS");
  requiredPositiveIntegerEnvironment("GENERATION_MAX_RETRIES");
  requiredEnvironment("OPENAI_API_KEY_SECRET_ARN");
  requiredEnvironment("SOURCE_BUCKET");

  const batchItemFailures = [];

  for (const record of event.Records ?? []) {
    try {
      const results = await processSqsRecord(record);
      console.info("Processed source image event", {
        messageId: record.messageId,
        results,
      });
    } catch (error) {
      console.error("Unable to process source image event", {
        error: error instanceof Error ? error.message : "Unknown error",
        messageId: record.messageId,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
