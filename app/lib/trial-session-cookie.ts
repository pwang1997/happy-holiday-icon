import { NextResponse } from "next/server";
import type { TrialSession } from "./trial-session";

export function setTrialSessionCookie(
  response: NextResponse,
  trialSession: TrialSession | null,
) {
  if (!trialSession) {
    return response;
  }

  response.cookies.set({
    name: "session_token",
    value: trialSession.token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
