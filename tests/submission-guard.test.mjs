import assert from "node:assert/strict";
import test from "node:test";
import {
  createSubmissionGuard,
  SubmissionRateLimitError,
  submissionGuardIdentityId,
} from "../app/lib/submission-guard.ts";

const CONFIGURATION = {
  anonymous: { concurrentValidations: 1, validationsPerWindow: 2 },
  authenticated: { concurrentValidations: 2, validationsPerWindow: 4 },
  concurrencyLeaseSeconds: 60,
  tableName: "submission-guard",
  windowSeconds: 60,
};

function conditionalCheckFailure() {
  const error = new Error("limit reached");
  error.name = "ConditionalCheckFailedException";
  return error;
}

function createGuard({
  acquireConcurrency = async () => {},
  acquireRateLimit = async () => {},
  releaseConcurrency = async () => {},
} = {}) {
  return createSubmissionGuard({
    acquireConcurrency,
    acquireRateLimit,
    configuration: () => CONFIGURATION,
    now: () => 125,
    releaseConcurrency,
  });
}

test("limits requests before prompt validation can begin", async () => {
  const guard = createGuard({
    acquireRateLimit: async () => {
      throw conditionalCheckFailure();
    },
  });

  await assert.rejects(
    () => guard.acquire({ kind: "anonymous", visitorId: "visitor" }),
    (error) =>
      error instanceof SubmissionRateLimitError && error.retryAfterSeconds === 55,
  );
});

test("limits concurrent prompt validations and does not create a lease", async () => {
  let releases = 0;
  const guard = createGuard({
    acquireConcurrency: async () => {
      throw conditionalCheckFailure();
    },
    releaseConcurrency: async () => {
      releases += 1;
    },
  });

  await assert.rejects(
    () => guard.acquire({ kind: "authenticated", subject: "subject" }),
    SubmissionRateLimitError,
  );
  assert.equal(releases, 0);
});

test("releases an acquired validation lease exactly once", async () => {
  let releases = 0;
  const guard = createGuard({
    releaseConcurrency: async () => {
      releases += 1;
    },
  });
  const lease = await guard.acquire({ kind: "anonymous", visitorId: "visitor" });

  await lease.release();
  await lease.release();

  assert.equal(releases, 1);
});

test("does not derive a guard key from the resettable session cookie", () => {
  assert.equal(
    submissionGuardIdentityId({ kind: "anonymous", visitorId: "visitor" }),
    submissionGuardIdentityId({ kind: "anonymous", visitorId: "visitor" }),
  );
  assert.notEqual(
    submissionGuardIdentityId({ kind: "anonymous", visitorId: "visitor" }),
    submissionGuardIdentityId({ kind: "anonymous", visitorId: "different" }),
  );
});
