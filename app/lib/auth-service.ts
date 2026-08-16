import type { NextRequest } from "next/server";
import {
  authenticateRequest,
  type AuthenticationResult,
} from "./cognito";
import { getTrialSession, type TrialSession } from "./trial-session";
import type { UsageIdentity } from "./usage";

export type SubmissionAuth = {
  trialSession: TrialSession | null;
  usageIdentity: UsageIdentity;
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
      usageIdentity: {
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
    usageIdentity: {
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
