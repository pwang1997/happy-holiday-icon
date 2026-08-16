import { NextResponse } from "next/server";
import { getTrialSession } from "./trial-session";

export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function setAnonymousSessionCookie(
  response: NextResponse,
  trialSession: ReturnType<typeof getTrialSession>,
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