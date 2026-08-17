import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { setTrialSessionCookie } from "../app/lib/trial-session-cookie.ts";

test("leaves the response unchanged without a trial session", () => {
  const response = setTrialSessionCookie(NextResponse.json({ ok: true }), null);

  assert.equal(response.cookies.get("session_token"), undefined);
});

test("sets a long-lived, HTTP-only trial session cookie", () => {
  const response = setTrialSessionCookie(NextResponse.json({ ok: true }), {
    token: "1f3830d9-c035-4f29-ae1a-7b075277fc7d",
  });
  const cookie = response.cookies.get("session_token");

  assert.equal(cookie?.value, "1f3830d9-c035-4f29-ae1a-7b075277fc7d");
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie?.sameSite, "lax");
  assert.equal(cookie?.path, "/");
  assert.equal(cookie?.maxAge, 60 * 60 * 24 * 365);
});
