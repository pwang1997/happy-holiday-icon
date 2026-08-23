import assert from "node:assert/strict";
import test from "node:test";
import {
  isPromptValidationPass,
  isPromptValidationRejection,
  PROMPT_VALIDATION_MODEL_CONFIG,
  PromptValidationServiceError,
  promptValidationOutcome,
} from "../app/lib/llm/prompt-protect.ts";

test("accepts only a PASS prompt-validation result", () => {
  assert.equal(isPromptValidationPass("PASS"), true);
  assert.equal(isPromptValidationPass(" pass\n"), true);
  assert.equal(isPromptValidationPass("FAIL"), false);
  assert.equal(isPromptValidationPass("PASS."), false);
  assert.equal(isPromptValidationPass([{ type: "text", text: "PASS" }]), false);
  assert.equal(isPromptValidationRejection("FAIL"), true);
  assert.equal(isPromptValidationRejection("PASS"), false);
});

test("bounds the validator model call", () => {
  assert.deepEqual(PROMPT_VALIDATION_MODEL_CONFIG, {
    maxRetries: 0,
    maxTokens: 4,
    model: "gpt-5.6-luna",
    temperature: 0,
    timeout: 5_000,
  });
});

test("separates intentional rejection from malformed provider results", () => {
  assert.equal(promptValidationOutcome("PASS"), "pass");
  assert.equal(promptValidationOutcome("FAIL"), "reject");
  assert.throws(
    () => promptValidationOutcome("PASS."),
    PromptValidationServiceError,
  );
});
