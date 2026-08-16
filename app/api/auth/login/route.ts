import {
  COGNITO_STATE_COOKIE,
  COGNITO_VERIFIER_COOKIE,
  getCognitoConfig,
  getCognitoRedirectUri,
} from "@/app/lib/cognito";
import { NextRequest, NextResponse } from "next/server";

function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );

  return Buffer.from(digest).toString("base64url");
}

export async function GET(request: NextRequest) {
  try {
    const config = getCognitoConfig();
    const state = randomToken();
    const verifier = randomToken();
    const authorizationUrl = new URL(`${config.domain}/oauth2/authorize`);

    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid email profile");
    authorizationUrl.searchParams.set(
      "redirect_uri",
      getCognitoRedirectUri(request),
    );
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", await pkceChallenge(verifier));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    const response = NextResponse.redirect(authorizationUrl);
    const cookieOptions = {
      httpOnly: true,
      maxAge: 600,
      path: "/auth/callback",
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
    };

    response.cookies.set({ ...cookieOptions, name: COGNITO_STATE_COOKIE, value: state });
    response.cookies.set({
      ...cookieOptions,
      name: COGNITO_VERIFIER_COOKIE,
      value: verifier,
    });

    return response;
  } catch (error) {
    console.error("Unable to start Cognito sign-in", error);
    return NextResponse.json(
      { error: "Sign-in is not configured." },
      { status: 503 },
    );
  }
}
