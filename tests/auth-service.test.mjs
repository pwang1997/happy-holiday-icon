import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSubmissionAuth,
  SubmissionAuthenticationError,
} from "../app/lib/auth-service.ts";

const TOKEN = "1f3830d9-c035-4f29-ae1a-7b075277fc7d";

test("resolves an authenticated submission identity", () => {
  assert.deepEqual(
    resolveSubmissionAuth(
      { kind: "authenticated", subject: "cognito-subject" },
      undefined,
    ),
    {
      trialSession: null,
      usageIdentity: { kind: "authenticated", subject: "cognito-subject" },
    },
  );
});

test("resolves an anonymous submission identity from the trial session", () => {
  assert.deepEqual(resolveSubmissionAuth({ kind: "anonymous" }, TOKEN), {
    trialSession: { token: TOKEN },
    usageIdentity: { kind: "anonymous", sessionToken: TOKEN },
  });
});

test("creates an anonymous trial session when no cookie is present", () => {
  const result = resolveSubmissionAuth({ kind: "anonymous" }, undefined);

  assert.match(result.trialSession?.token ?? "", /^[0-9a-f-]{36}$/i);
  assert.equal(result.usageIdentity.kind, "anonymous");
});

test("returns a client error for malformed anonymous trial sessions", () => {
  assert.throws(
    () => resolveSubmissionAuth({ kind: "anonymous" }, "not-a-session"),
    (error) =>
      error instanceof SubmissionAuthenticationError && error.status === 400,
  );
});

test("returns an unauthorized error for invalid Cognito sessions", () => {
  assert.throws(
    () => resolveSubmissionAuth({ kind: "invalid" }, undefined),
    (error) =>
      error instanceof SubmissionAuthenticationError && error.status === 401,
  );
});
