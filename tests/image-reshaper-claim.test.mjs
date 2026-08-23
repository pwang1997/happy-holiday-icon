import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reshaperSource = readFileSync(
  new URL("../infra/lambda/image-reshaper/index.mjs", import.meta.url),
  "utf8",
);
const claimStart = reshaperSource.indexOf("async function claimInitialReshaping");
const claimEnd = reshaperSource.indexOf("async function claimRetryReshaping");
const initialClaim = reshaperSource.slice(claimStart, claimEnd);

test("supplies every value used by the initial reshaping claim", () => {
  assert.notEqual(claimStart, -1);
  assert.notEqual(claimEnd, -1);
  assert.match(initialClaim, /#status = :generating/);
  assert.match(initialClaim, /":generating": \{ S: "GENERATING" \}/);
});
