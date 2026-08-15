import {
  COGNITO_ACCESS_TOKEN_COOKIE,
  COGNITO_REFRESH_TOKEN_COOKIE,
  getCognitoConfig,
} from "@/app/lib/cognito";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const responseUrl = new URL("/", request.url);
  let redirectUrl = responseUrl;

  try {
    const config = getCognitoConfig();
    redirectUrl = new URL(`${config.domain}/logout`);
    redirectUrl.searchParams.set("client_id", config.clientId);
    redirectUrl.searchParams.set("logout_uri", responseUrl.toString());
  } catch {
    // Local cookie cleanup remains useful when Cognito is not configured.
  }

  const response = NextResponse.redirect(redirectUrl);
  for (const name of [
    COGNITO_ACCESS_TOKEN_COOKIE,
    COGNITO_REFRESH_TOKEN_COOKIE,
  ]) {
    response.cookies.set({
      name,
      value: "",
      expires: new Date(0),
      path: "/",
    });
  }

  return response;
}
