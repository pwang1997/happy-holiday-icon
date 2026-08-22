import assert from "node:assert/strict";
import test from "node:test";
import { isPromptValidationPass } from "../app/lib/llm/prompt-protect.ts";

test("accepts only a PASS prompt-validation result", () => {
  assert.equal(isPromptValidationPass("PASS"), true);
  assert.equal(isPromptValidationPass(" pass\n"), true);
  assert.equal(isPromptValidationPass("FAIL"), false);
  assert.equal(isPromptValidationPass("PASS."), false);
  assert.equal(isPromptValidationPass([{ type: "text", text: "PASS" }]), false);
});
