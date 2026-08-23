import assert from "node:assert/strict";
import test from "node:test";
import {
  generationRetryClaim,
  generationRecoveryAction,
  generationRetryDelaySeconds,
  MAX_GENERATION_RETRIES,
} from "../infra/lambda/retry-policy.mjs";

test("uses three generation retries with exponential retry delays", () => {
  assert.equal(MAX_GENERATION_RETRIES, 3);
  assert.equal(generationRetryDelaySeconds(1, 30), 30);
  assert.equal(generationRetryDelaySeconds(2, 30), 60);
  assert.equal(generationRetryDelaySeconds(3, 30), 120);
});

test("caps an SQS retry delay at its 15-minute maximum", () => {
  assert.equal(generationRetryDelaySeconds(8, 30), 900);
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
