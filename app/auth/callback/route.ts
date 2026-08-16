import {
  COGNITO_ACCESS_TOKEN_COOKIE,
  COGNITO_REFRESH_TOKEN_COOKIE,
  COGNITO_STATE_COOKIE,
  COGNITO_VERIFIER_COOKIE,
  getCognitoConfig,
  getCognitoRedirectUri,
} from "@/app/lib/cognito";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
};

function callbackError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sameValue(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function authCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return callbackError("Sign-in was cancelled.");
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(COGNITO_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(COGNITO_VERIFIER_COOKIE)?.value;

  if (
    !code ||
    !state ||
    !storedState ||
    !verifier ||
    !sameValue(state, storedState)
  ) {
    return callbackError("The sign-in session is invalid or expired.");
  }

  try {
    const config = getCognitoConfig();
    const tokenResponse = await fetch(`${config.domain}/oauth2/token`, {
      body: new URLSearchParams({
        client_id: config.clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: getCognitoRedirectUri(request),
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const tokenData: unknown = await tokenResponse.json().catch(() => null);

    if (
      !tokenResponse.ok ||
      typeof tokenData !== "object" ||
      tokenData === null ||
      typeof (tokenData as TokenResponse).access_token !== "string"
    ) {
      console.error("Cognito token exchange failed", tokenResponse.status);
      return callbackError("Sign-in could not be completed.", 502);
    }

    const tokens = tokenData as TokenResponse;
    const accessTokenLifetime =
      typeof tokens.expires_in === "number" && Number.isSafeInteger(tokens.expires_in)
        ? tokens.expires_in
        : 3600;
    const response = NextResponse.redirect(new URL("/", request.url));

    response.cookies.set({
      ...authCookieOptions(accessTokenLifetime),
      name: COGNITO_ACCESS_TOKEN_COOKIE,
      value: tokens.access_token as string,
    });

    if (typeof tokens.refresh_token === "string") {
      response.cookies.set({
        ...authCookieOptions(60 * 60 * 24 * 30),
        name: COGNITO_REFRESH_TOKEN_COOKIE,
        value: tokens.refresh_token,
      });
    }

    response.cookies.set({
      name: COGNITO_STATE_COOKIE,
      value: "",
      expires: new Date(0),
      path: "/auth/callback",
    });
    response.cookies.set({
      name: COGNITO_VERIFIER_COOKIE,
      value: "",
      expires: new Date(0),
      path: "/auth/callback",
    });

    return response;
  } catch (error) {
    console.error("Unable to complete Cognito sign-in", error);
    return callbackError("Sign-in could not be completed.", 502);
  }
}
