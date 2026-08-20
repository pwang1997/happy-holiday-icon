import assert from "node:assert/strict";
import test from "node:test";
import {
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
