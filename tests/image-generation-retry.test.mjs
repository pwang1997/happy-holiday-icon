import assert from "node:assert/strict";
import test from "node:test";
import {
  generationFailureDisposition,
  isJobExpired,
  generationRetryClaim,
  generationRecoveryAction,
  generationRetryDelaySeconds,
  MAX_GENERATION_RETRIES,
  RETRYABLE_GENERATION_FAILURE,
  reshapingRetryClaim,
  TERMINAL_GENERATION_FAILURE,
  terminalGenerationFailure,
} from "../infra/lambda/retry-policy.mjs";

test("treats an expiry at the current second as terminal", () => {
  assert.equal(isJobExpired(1_000, 1_000), true);
  assert.equal(isJobExpired(999, 1_000), true);
});

test("permits a job that has not yet expired", () => {
  assert.equal(isJobExpired(1_001, 1_000), false);
});

test("uses three generation retries with exponential retry delays", () => {
  assert.equal(MAX_GENERATION_RETRIES, 3);
  assert.equal(generationRetryDelaySeconds(1, 30), 30);
  assert.equal(generationRetryDelaySeconds(2, 30), 60);
  assert.equal(generationRetryDelaySeconds(3, 30), 120);
});

test("caps an SQS retry delay at its 15-minute maximum", () => {
  assert.equal(generationRetryDelaySeconds(8, 30), 900);
});

test("classifies transient OpenAI and S3 failures for recovery", () => {
  for (const status of [408, 409, 425, 429, 500, 503]) {
    assert.equal(
      generationFailureDisposition({ status }),
      RETRYABLE_GENERATION_FAILURE,
    );
  }

  assert.equal(
    generationFailureDisposition({ $metadata: { httpStatusCode: 503 } }),
    RETRYABLE_GENERATION_FAILURE,
  );
  assert.equal(
    generationFailureDisposition({ $retryable: { throttling: true } }),
    RETRYABLE_GENERATION_FAILURE,
  );
  assert.equal(
    generationFailureDisposition({ cause: { code: "ETIMEDOUT" } }),
    RETRYABLE_GENERATION_FAILURE,
  );
  assert.equal(
    generationFailureDisposition(new TypeError("fetch failed")),
    RETRYABLE_GENERATION_FAILURE,
  );
});

test("classifies malformed input and permanent provider rejections as terminal", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(
      generationFailureDisposition({ status }),
      TERMINAL_GENERATION_FAILURE,
    );
  }

  assert.equal(
    generationFailureDisposition(terminalGenerationFailure("invalid source image")),
    TERMINAL_GENERATION_FAILURE,
  );
  assert.equal(
    generationFailureDisposition(new Error("missing image data")),
    TERMINAL_GENERATION_FAILURE,
  );
});

test("renews a retry lease from its actual claim time", () => {
  assert.deepEqual(generationRetryClaim(2, 1_090, 1_400, 960), {
    expectedGenerationRetryAt: 1_090,
    previousAttempt: 1,
    renewedGenerationRetryAt: 2_360,
  });
});

test("requires a retry claim to identify the exact scheduled lease", () => {
  assert.throws(
    () => generationRetryClaim(2, 0, 1_400, 960),
    /expectedGenerationRetryAt must be a positive integer/,
  );
});

test("renews a reshaping lease from its actual claim time", () => {
  assert.deepEqual(reshapingRetryClaim(2, 1_090, 1_400, 120), {
    expectedReshapingRetryAt: 1_090,
    previousAttempt: 1,
    renewedReshapingRetryAt: 1_520,
  });
});

test("stops recovery after the configured retry limit", () => {
  assert.deepEqual(generationRecoveryAction(1, 3, 30), {
    action: "retry",
    delaySeconds: 30,
  });
  assert.deepEqual(generationRecoveryAction(2, 3, 30), {
    action: "retry",
    delaySeconds: 60,
  });
  assert.deepEqual(generationRecoveryAction(3, 3, 30), {
    action: "retry",
    delaySeconds: 120,
  });
  assert.deepEqual(generationRecoveryAction(4, 3, 30), { action: "fail" });
});
