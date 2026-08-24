import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { config, proxy } from "../proxy.ts";

test("runs only for image submissions", () => {
  assert.equal(config.matcher, "/api/submit");
});

test("overwrites the caller supplied proxy token", () => {
  const originalSecret = process.env.SUBMISSION_GUARD_SECRET;
  process.env.SUBMISSION_GUARD_SECRET = "test-proxy-secret";

  try {
    const response = proxy(
      new NextRequest("https://example.test/api/submit", {
        headers: { "x-submission-proxy-token": "caller-controlled" },
      }),
    );

    assert.equal(
      response.headers.get("x-middleware-request-x-submission-proxy-token"),
      "test-proxy-secret",
    );
    assert.equal(
      response.headers.get("x-submission-proxy-token"),
      null,
    );
  } finally {
    if (originalSecret === undefined) {
      delete process.env.SUBMISSION_GUARD_SECRET;
    } else {
      process.env.SUBMISSION_GUARD_SECRET = originalSecret;
    }
  }
});
