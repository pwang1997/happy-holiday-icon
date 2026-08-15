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

function usageId(sessionToken: string) {
  const digest = createHash("sha256").update(sessionToken).digest("hex");
  return `ANONYMOUS#${digest}`;
}

export async function consumeAnonymousTrial(sessionToken: string) {
  const now = nowInSeconds();
  const result = await getClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: { usage_id: usageId(sessionToken) },
      UpdateExpression:
        "SET #trialCount = if_not_exists(#trialCount, :zero) + :one, #createdAt = if_not_exists(#createdAt, :now), #updatedAt = :now, #expiresAt = :expiresAt",
      ConditionExpression:
        "attribute_not_exists(#trialCount) OR #trialCount < :limit",
      ExpressionAttributeNames: {
        "#createdAt": "created_at",
        "#expiresAt": "expires_at",
        "#trialCount": "trial_count",
        "#updatedAt": "updated_at",
      },
      ExpressionAttributeValues: {
        ":expiresAt": now + USAGE_TTL_SECONDS,
        ":limit": MAX_FREE_TRIALS,
        ":now": now,
        ":one": 1,
        ":zero": 0,
      },
      ReturnValues: "UPDATED_NEW",
    }),
  ).catch((error: unknown) => {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      throw new TrialLimitError();
    }

    throw error;
  });

  return result.Attributes?.trial_count;
}
