import assert from "node:assert/strict";
import test from "node:test";
import { getTrialSession } from "../app/lib/trial-session.ts";

const TOKEN = "1f3830d9-c035-4f29-ae1a-7b075277fc7d";

test("creates a trial session when no cookie is present", () => {
  const session = getTrialSession(undefined);

  assert.match(session?.token ?? "", /^[0-9a-f-]{36}$/i);
});

test("accepts a legacy UUID-only session cookie as zero trials", () => {
  assert.deepEqual(getTrialSession(TOKEN), { token: TOKEN });
});

test("ignores the legacy client-side count", () => {
  assert.deepEqual(getTrialSession(`${TOKEN}:4`), { token: TOKEN });
});

test("rejects malformed trial session cookies", () => {
  assert.equal(getTrialSession("not-a-session"), null);
});
