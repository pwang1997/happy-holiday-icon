import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

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

function isConditionalCheckFailed(error) {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

async function bodyToBuffer(body) {
  if (!body) {
    throw new Error("S3 returned an empty source image");
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
    status: valueAsString(item, "status"),
    sourceKey: valueAsString(item, "source_key"),
    prompt: valueAsString(item, "prompt"),
    style: valueAsString(item, "style"),
  };
}

async function updateJob(jobId, { status, error }, expectedStatus) {
  const names = {
    "#expectedStatus": "status",
    "#status": "status",
    "#updatedAt": "updated_at",
  };
  const values = {
    ":expectedStatus": { S: expectedStatus },
    ":status": { S: status },
    ":updatedAt": { N: String(nowInSeconds()) },
  };
  const assignments = ["#status = :status", "#updatedAt = :updatedAt"];

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
      UpdateExpression: `SET ${assignments.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
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

function s3RecordsFromSqsRecord(record) {
  let event;

  try {
    event = JSON.parse(record.body);
  } catch {
    throw new Error("SQS message did not contain a valid S3 event");
  }

  return Array.isArray(event.Records) ? event.Records : [];
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

  if (!job || job.sourceKey !== sourceKey || job.status !== "UPLOADING") {
    console.info("Skipping a source event that is not an uploadable job", {
      jobId: sourceDetails.jobId,
      sourceKey,
      status: job?.status,
    });
    return { skipped: true, reason: "job-not-uploadable" };
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
    await updateJob(
      sourceDetails.jobId,
      { status: "GENERATING", error: null },
      "UPLOADING",
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return { skipped: true, reason: "job-already-claimed" };
    }

    throw error;
  }

  let failureStatus = "GENERATING";

  try {
    const source = await s3.send(
      new GetObjectCommand({
        Bucket: sourceBucket,
        Key: sourceKey,
      }),
    );
    const output = await generateImage({
      input: await bodyToBuffer(source.Body),
      contentType: source.ContentType ?? sourceContentType(sourceDetails.extension),
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

async function processSqsRecord(record) {
  const records = s3RecordsFromSqsRecord(record);
  const results = [];

  for (const s3Record of records) {
    results.push(await processS3Record(s3Record));
  }

  return results;
}

export async function handler(event) {
  requiredEnvironment("DYNAMODB_JOBS_TABLE");
  requiredEnvironment("IMAGE_GENERATION_MODEL");
  requiredEnvironment("IMAGE_GENERATION_BACKGROUND");
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
