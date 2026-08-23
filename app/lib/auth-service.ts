import type { NextRequest } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  authenticateRequest,
  type AuthenticationResult,
} from "./cognito";
import { getTrialSession, type TrialSession } from "./trial-session";
import type { ImageJobOwner } from "./jobs";
import type { UsageIdentity } from "./usage";

const TRUSTED_PROXY_TOKEN_HEADER = "x-submission-proxy-token";

export type SubmissionIdentity =
  | { kind: "anonymous"; sessionToken: string }
  | { kind: "authenticated"; subject: string };

export type SubmissionAuth = {
  trialSession: TrialSession | null;
  identity: SubmissionIdentity;
};

export class SubmissionAuthenticationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SubmissionAuthenticationError";
    this.status = status;
  }
}

export function resolveSubmissionAuth(
  authentication: AuthenticationResult,
  trialSessionCookie: string | undefined,
): SubmissionAuth {
  if (authentication.kind === "invalid") {
    throw new SubmissionAuthenticationError(
      "Your sign-in session is invalid. Please sign in again.",
      401,
    );
  }

  if (authentication.kind === "authenticated") {
    return {
      trialSession: null,
      identity: {
        kind: "authenticated",
        subject: authentication.subject,
      },
    };
  }

  const trialSession = getTrialSession(trialSessionCookie);

  if (!trialSession) {
    throw new SubmissionAuthenticationError(
      "The trial session is invalid. Please try again.",
      400,
    );
  }

  return {
    trialSession,
    identity: {
      kind: "anonymous",
      sessionToken: trialSession.token,
    },
  };
}

export async function getSubmissionAuth(
  request: NextRequest,
): Promise<SubmissionAuth> {
  let authentication;

  try {
    authentication = await authenticateRequest(request);
  } catch (error) {
    console.error("Unable to verify Cognito session", error);
    throw new SubmissionAuthenticationError(
      "Authentication is not configured.",
      503,
    );
  }

  return resolveSubmissionAuth(
    authentication,
    request.cookies.get("session_token")?.value,
  );
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new SubmissionAuthenticationError(
      "Anonymous submission protection is not configured.",
      503,
    );
  }

  return value;
}

function hasTrustedProxyToken(request: NextRequest, secret: string) {
  const suppliedToken = request.headers.get(TRUSTED_PROXY_TOKEN_HEADER);

  if (!suppliedToken) {
    return false;
  }

  const suppliedBuffer = Buffer.from(suppliedToken);
  const expectedBuffer = Buffer.from(secret);

  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function clientAddressFromRequest(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientAddress = forwardedFor?.split(",")[0]?.trim();

  if (!clientAddress || isIP(clientAddress) === 0) {
    throw new SubmissionAuthenticationError(
      "Anonymous submission protection requires a client address from the trusted proxy.",
      503,
    );
  }

  return clientAddress;
}

export function imageJobOwner(identity: SubmissionIdentity): ImageJobOwner {
  if (identity.kind === "authenticated") {
    return {
      ownerId: `USER#${identity.subject}`,
      ownerType: identity.kind,
    };
  }

  return {
    ownerId: `ANONYMOUS#${createHash("sha256").update(identity.sessionToken).digest("hex")}`,
    ownerType: identity.kind,
  };
}

export function usageIdentityForSubmission(
  request: NextRequest,
  identity: SubmissionIdentity,
): UsageIdentity {
  if (identity.kind === "authenticated") {
    return identity;
  }

  const secret = requiredEnvironment("SUBMISSION_GUARD_SECRET");

  if (!hasTrustedProxyToken(request, secret)) {
    throw new SubmissionAuthenticationError(
      "Anonymous submission protection requires a trusted proxy.",
      503,
    );
  }

  return {
    kind: "anonymous",
    visitorId: createHmac("sha256", secret)
      .update(clientAddressFromRequest(request))
      .digest("hex"),
  };
}
