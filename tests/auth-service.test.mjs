import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  imageJobOwner,
  resolveSubmissionAuth,
  SubmissionAuthenticationError,
  usageIdentityForSubmission,
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
      identity: { kind: "authenticated", subject: "cognito-subject" },
    },
  );
});

test("resolves an anonymous submission identity from the trial session", () => {
  assert.deepEqual(resolveSubmissionAuth({ kind: "anonymous" }, TOKEN), {
    trialSession: { token: TOKEN },
    identity: { kind: "anonymous", sessionToken: TOKEN },
  });
});

test("creates an anonymous trial session when no cookie is present", () => {
  const result = resolveSubmissionAuth({ kind: "anonymous" }, undefined);

  assert.match(result.trialSession?.token ?? "", /^[0-9a-f-]{36}$/i);
  assert.equal(result.identity.kind, "anonymous");
});

test("returns a client error for malformed anonymous trial sessions", () => {
  assert.throws(
    () => resolveSubmissionAuth({ kind: "anonymous" }, "not-a-session"),
    (error) =>
      error instanceof SubmissionAuthenticationError && error.status === 400,
  );
});

test("uses the trusted client address for anonymous trial accounting", () => {
  const originalSecret = process.env.SUBMISSION_GUARD_SECRET;
  process.env.SUBMISSION_GUARD_SECRET = "test-proxy-secret";

  try {
    const request = new NextRequest("https://example.test/api/submit", {
      headers: {
        "x-forwarded-for": "203.0.113.42, 10.0.0.1",
        "x-submission-proxy-token": "test-proxy-secret",
      },
    });
    const firstIdentity = resolveSubmissionAuth({ kind: "anonymous" }, TOKEN)
      .identity;
    const replacementIdentity = resolveSubmissionAuth(
      { kind: "anonymous" },
      "6588bb11-d894-4b3c-a613-10e271550439",
    ).identity;

    assert.deepEqual(
      usageIdentityForSubmission(request, firstIdentity),
      usageIdentityForSubmission(request, replacementIdentity),
    );
  } finally {
    if (originalSecret === undefined) {
      delete process.env.SUBMISSION_GUARD_SECRET;
    } else {
      process.env.SUBMISSION_GUARD_SECRET = originalSecret;
    }
  }
});

test("rejects anonymous usage without a trusted proxy token", () => {
  const originalSecret = process.env.SUBMISSION_GUARD_SECRET;
  process.env.SUBMISSION_GUARD_SECRET = "test-proxy-secret";

  try {
    const request = new NextRequest("https://example.test/api/submit", {
      headers: { "x-forwarded-for": "203.0.113.42" },
    });
    const identity = resolveSubmissionAuth({ kind: "anonymous" }, TOKEN).identity;

    assert.throws(
      () => usageIdentityForSubmission(request, identity),
      (error) =>
        error instanceof SubmissionAuthenticationError && error.status === 503,
    );
  } finally {
    if (originalSecret === undefined) {
      delete process.env.SUBMISSION_GUARD_SECRET;
    } else {
      process.env.SUBMISSION_GUARD_SECRET = originalSecret;
    }
  }
});

test("keeps anonymous image-job ownership bound to its session", () => {
  assert.notDeepEqual(
    imageJobOwner(resolveSubmissionAuth({ kind: "anonymous" }, TOKEN).identity),
    imageJobOwner(
      resolveSubmissionAuth(
        { kind: "anonymous" },
        "6588bb11-d894-4b3c-a613-10e271550439",
      ).identity,
    ),
  );
});

test("returns an unauthorized error for invalid Cognito sessions", () => {
  assert.throws(
    () => resolveSubmissionAuth({ kind: "invalid" }, undefined),
    (error) =>
      error instanceof SubmissionAuthenticationError && error.status === 401,
  );
});
