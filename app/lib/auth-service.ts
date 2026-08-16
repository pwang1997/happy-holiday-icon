import { NextRequest } from "next/server";
import { authenticateRequest } from "./cognito";
import { getTrialSession, TrialSession } from "./trial-session";
import { UsageIdentity } from "./usage";
type UserAuthUsage = {
  trialSession: TrialSession | null;
  usageIdentity: UsageIdentity;
};

export const getUserAuth = async (request: NextRequest): Promise<UserAuthUsage> => {
  let authentication;

  try {
    authentication = await authenticateRequest(request);
  } catch (error) {
    console.error("Unable to verify Cognito session", error);
    throw Error("Authentication is not configured.");
  }

  if (authentication.kind === "invalid") {
    throw Error("Your sign-in session is invalid. Please sign in again.");
  }

  const trialSession =
    authentication.kind === "anonymous"
      ? getTrialSession(request.cookies.get("session_token")?.value)
      : null;

  let usageIdentity: UsageIdentity;

  if (authentication.kind === "authenticated") {
    usageIdentity = {
      kind: "authenticated",
      subject: authentication.subject,
    };
  } else {
    if (!trialSession) {
      throw Error("The trial session is invalid. Please try again.");
    }

    usageIdentity = {
      kind: "anonymous",
      sessionToken: trialSession.token,
    };
  }
  return { trialSession, usageIdentity };
};
