import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import type { UsageIdentity } from "./usage";

type SubmissionGuardLimits = {
  concurrentValidations: number;
  validationsPerWindow: number;
};

type SubmissionGuardConfiguration = {
  anonymous: SubmissionGuardLimits;
  authenticated: SubmissionGuardLimits;
  concurrencyLeaseSeconds: number;
  tableName: string;
  windowSeconds: number;
};

type AcquireRateLimitInput = {
  expiresAt: number;
  key: string;
  limit: number;
  tableName: string;
};

type AcquireConcurrencyInput = {
  key: string;
  leaseExpiresAt: number;
  limit: number;
  now: number;
  tableName: string;
};

type ReleaseConcurrencyInput = {
  key: string;
  tableName: string;
};

type SubmissionGuardDependencies = {
  acquireConcurrency: (input: AcquireConcurrencyInput) => Promise<void>;
  acquireRateLimit: (input: AcquireRateLimitInput) => Promise<void>;
  configuration: () => SubmissionGuardConfiguration;
  now: () => number;
  releaseConcurrency: (input: ReleaseConcurrencyInput) => Promise<void>;
};

export class SubmissionRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Submission rate limit reached");
    this.name = "SubmissionRateLimitError";
  }
}

export type SubmissionGuardLease = {
  release: () => Promise<void>;
};

let client: DynamoDBDocumentClient | undefined;

function requiredPositiveIntegerEnvironment(name: string) {
  const value = process.env[name]?.trim();
  const parsed = value ? Number(value) : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function getConfiguration(): SubmissionGuardConfiguration {
  const tableName = process.env.DYNAMODB_SUBMISSION_GUARD_TABLE?.trim();

  if (!tableName) {
    throw new Error("DYNAMODB_SUBMISSION_GUARD_TABLE is not configured");
  }

  return {
    anonymous: {
      concurrentValidations: requiredPositiveIntegerEnvironment(
        "ANONYMOUS_SUBMISSION_MAX_CONCURRENCY",
      ),
      validationsPerWindow: requiredPositiveIntegerEnvironment(
        "ANONYMOUS_SUBMISSION_RATE_LIMIT",
      ),
    },
    authenticated: {
      concurrentValidations: requiredPositiveIntegerEnvironment(
        "AUTHENTICATED_SUBMISSION_MAX_CONCURRENCY",
      ),
      validationsPerWindow: requiredPositiveIntegerEnvironment(
        "AUTHENTICATED_SUBMISSION_RATE_LIMIT",
      ),
    },
    concurrencyLeaseSeconds: requiredPositiveIntegerEnvironment(
      "SUBMISSION_CONCURRENCY_LEASE_SECONDS",
    ),
    tableName,
    windowSeconds: requiredPositiveIntegerEnvironment(
      "SUBMISSION_RATE_LIMIT_WINDOW_SECONDS",
    ),
  };
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

function isConditionalCheckFailure(error: unknown) {
  return (
    error instanceof Error &&
    error.name === "ConditionalCheckFailedException"
  );
}

async function acquireRateLimit({
  expiresAt,
  key,
  limit,
  tableName,
}: AcquireRateLimitInput) {
  await getClient().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { guard_id: key },
      UpdateExpression:
        "SET #expiresAt = :expiresAt, #requestCount = if_not_exists(#requestCount, :zero) + :one",
      ConditionExpression:
        "attribute_not_exists(#requestCount) OR #requestCount < :limit",
      ExpressionAttributeNames: {
        "#expiresAt": "expires_at",
        "#requestCount": "request_count",
      },
      ExpressionAttributeValues: {
        ":expiresAt": expiresAt,
        ":limit": limit,
        ":one": 1,
        ":zero": 0,
      },
    }),
  );
}

async function acquireConcurrency({
  key,
  leaseExpiresAt,
  limit,
  now,
  tableName,
}: AcquireConcurrencyInput) {
  try {
    await getClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { guard_id: key },
        UpdateExpression:
          "SET #expiresAt = :expiresAt, #inFlight = if_not_exists(#inFlight, :zero) + :one",
        ConditionExpression:
          "attribute_not_exists(#inFlight) OR #inFlight < :limit",
        ExpressionAttributeNames: {
          "#expiresAt": "expires_at",
          "#inFlight": "in_flight",
        },
        ExpressionAttributeValues: {
          ":expiresAt": leaseExpiresAt,
          ":limit": limit,
          ":one": 1,
          ":zero": 0,
        },
      }),
    );
  } catch (error) {
    if (!isConditionalCheckFailure(error)) {
      throw error;
    }

    try {
      await getClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { guard_id: key },
          UpdateExpression: "SET #expiresAt = :expiresAt, #inFlight = :one",
          ConditionExpression: "#expiresAt <= :now",
          ExpressionAttributeNames: {
            "#expiresAt": "expires_at",
            "#inFlight": "in_flight",
          },
          ExpressionAttributeValues: {
            ":expiresAt": leaseExpiresAt,
            ":now": now,
            ":one": 1,
          },
        }),
      );
    } catch (resetError) {
      if (isConditionalCheckFailure(resetError)) {
        throw error;
      }

      throw resetError;
    }
  }
}

async function releaseConcurrency({ key, tableName }: ReleaseConcurrencyInput) {
  await getClient().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { guard_id: key },
      UpdateExpression: "ADD #inFlight :decrement",
      ConditionExpression: "attribute_exists(#inFlight) AND #inFlight > :zero",
      ExpressionAttributeNames: {
        "#inFlight": "in_flight",
      },
      ExpressionAttributeValues: {
        ":decrement": -1,
        ":zero": 0,
      },
    }),
  );
}

function limitsFor(
  identity: UsageIdentity,
  configuration: SubmissionGuardConfiguration,
) {
  return identity.kind === "anonymous"
    ? configuration.anonymous
    : configuration.authenticated;
}

export function submissionGuardIdentityId(identity: UsageIdentity) {
  const value =
    identity.kind === "anonymous" ? identity.visitorId : identity.subject;
  return createHash("sha256").update(`${identity.kind}:${value}`).digest("hex");
}

export function createSubmissionGuard({
  acquireConcurrency: acquireConcurrentValidation,
  acquireRateLimit: acquireValidationRate,
  configuration,
  now,
  releaseConcurrency: releaseConcurrentValidation,
}: SubmissionGuardDependencies) {
  return {
    async acquire(identity: UsageIdentity): Promise<SubmissionGuardLease> {
      const guardConfiguration = configuration();
      const limits = limitsFor(identity, guardConfiguration);
      const currentTime = now();
      const windowStart =
        currentTime - (currentTime % guardConfiguration.windowSeconds);
      const identityKey = submissionGuardIdentityId(identity);

      try {
        await acquireValidationRate({
          expiresAt: windowStart + guardConfiguration.windowSeconds + 60,
          key: `RATE#${identityKey}#${windowStart}`,
          limit: limits.validationsPerWindow,
          tableName: guardConfiguration.tableName,
        });
      } catch (error) {
        if (isConditionalCheckFailure(error)) {
          throw new SubmissionRateLimitError(
            Math.max(1, windowStart + guardConfiguration.windowSeconds - currentTime),
          );
        }

        throw error;
      }

      const concurrencyKey = `CONCURRENCY#${identityKey}`;

      try {
        await acquireConcurrentValidation({
          key: concurrencyKey,
          leaseExpiresAt:
            currentTime + guardConfiguration.concurrencyLeaseSeconds,
          limit: limits.concurrentValidations,
          now: currentTime,
          tableName: guardConfiguration.tableName,
        });
      } catch (error) {
        if (isConditionalCheckFailure(error)) {
          throw new SubmissionRateLimitError(1);
        }

        throw error;
      }

      let released = false;

      return {
        async release() {
          if (released) {
            return;
          }

          released = true;
          await releaseConcurrentValidation({
            key: concurrencyKey,
            tableName: guardConfiguration.tableName,
          });
        },
      };
    },
  };
}

export const submissionGuard = createSubmissionGuard({
  acquireConcurrency,
  acquireRateLimit,
  configuration: getConfiguration,
  now: nowInSeconds,
  releaseConcurrency,
});
