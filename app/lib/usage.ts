import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";

export const MAX_FREE_TRIALS = 5;

export class TrialLimitError extends Error {
  constructor() {
    super("Anonymous trial limit reached");
    this.name = "TrialLimitError";
  }
}

export type UsageIdentity =
  | { kind: "anonymous"; sessionToken: string }
  | { kind: "authenticated"; subject: string };

const USAGE_TTL_SECONDS = 365 * 24 * 60 * 60;
let client: DynamoDBDocumentClient | undefined;

function getTableName() {
  const tableName = process.env.DYNAMODB_USAGE_TABLE?.trim();

  if (!tableName) {
    throw new Error("DYNAMODB_USAGE_TABLE is not configured");
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

function usageId(identity: UsageIdentity) {
  if (identity.kind === "authenticated") {
    return `USER#${identity.subject}`;
  }

  const digest = createHash("sha256")
    .update(identity.sessionToken)
    .digest("hex");
  return `ANONYMOUS#${digest}`;
}

export async function recordUsage(identity: UsageIdentity) {
  const now = nowInSeconds();
  const isAnonymous = identity.kind === "anonymous";
  const updateParts = [
    "#usageCount = if_not_exists(#usageCount, :zero) + :one",
    "#identityType = :identityType",
    "#createdAt = if_not_exists(#createdAt, :now)",
    "#updatedAt = :now",
    "#expiresAt = :expiresAt",
  ];

  if (isAnonymous) {
    updateParts.splice(
      1,
      0,
      "#trialCount = if_not_exists(#trialCount, :zero) + :one",
    );
  }

  const result = await getClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { usage_id: usageId(identity) },
      UpdateExpression: `SET ${updateParts.join(", ")}`,
      ...(isAnonymous
        ? {
            ConditionExpression:
              "attribute_not_exists(#trialCount) OR #trialCount < :limit",
          }
        : {}),
      ExpressionAttributeNames: {
        "#createdAt": "created_at",
        "#expiresAt": "expires_at",
        ...(isAnonymous ? { "#trialCount": "trial_count" } : {}),
        "#identityType": "identity_type",
        "#updatedAt": "updated_at",
        "#usageCount": "usage_count",
      },
      ExpressionAttributeValues: {
        ":expiresAt": now + USAGE_TTL_SECONDS,
        ...(isAnonymous ? { ":limit": MAX_FREE_TRIALS } : {}),
        ":identityType": identity.kind,
        ":now": now,
        ":one": 1,
        ":zero": 0,
      },
      ReturnValues: "UPDATED_NEW",
    }),
  ).catch((error: unknown) => {
    if (
      isAnonymous &&
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      throw new TrialLimitError();
    }

    throw error;
  });

  return result.Attributes?.usage_count;
}
