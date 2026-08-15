import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { NextRequest } from "next/server";

export const COGNITO_ACCESS_TOKEN_COOKIE = "cognito_access_token";
export const COGNITO_REFRESH_TOKEN_COOKIE = "cognito_refresh_token";
export const COGNITO_STATE_COOKIE = "cognito_oauth_state";
export const COGNITO_VERIFIER_COOKIE = "cognito_pkce_verifier";

type CognitoConfig = {
  clientId: string;
  domain: string;
  userPoolId: string;
};

export type AuthenticationResult =
  | { kind: "anonymous" }
  | { kind: "authenticated"; subject: string }
  | { kind: "invalid" };

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export function getCognitoConfig(): CognitoConfig {
  const region = requiredEnvironment("AWS_REGION");
  const configuredDomain = requiredEnvironment("COGNITO_DOMAIN");
  const domain = configuredDomain.startsWith("http")
    ? configuredDomain
    : `https://${configuredDomain}.auth.${region}.amazoncognito.com`;

  return {
    clientId: requiredEnvironment("COGNITO_WEB_CLIENT_ID"),
    domain: domain.replace(/\/$/, ""),
    userPoolId: requiredEnvironment("COGNITO_USER_POOL_ID"),
  };
}

export function getCognitoRedirectUri(request: NextRequest) {
  return (
    process.env.COGNITO_REDIRECT_URI?.trim() ||
    new URL("/auth/callback", request.url).toString()
  );
}

export function getCognitoVerifier() {
  if (verifier) {
    return verifier;
  }

  const config = getCognitoConfig();
  verifier = CognitoJwtVerifier.create({
    clientId: config.clientId,
    tokenUse: "access",
    userPoolId: config.userPoolId,
  });

  return verifier;
}

function accessTokenFromRequest(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return request.cookies.get(COGNITO_ACCESS_TOKEN_COOKIE)?.value;
}

export async function authenticateRequest(
  request: NextRequest,
): Promise<AuthenticationResult> {
  const accessToken = accessTokenFromRequest(request);

  if (!accessToken) {
    return { kind: "anonymous" };
  }

  try {
    const payload = await getCognitoVerifier().verify(accessToken);

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return { kind: "invalid" };
    }

    return { kind: "authenticated", subject: payload.sub };
  } catch {
    return { kind: "invalid" };
  }
}
