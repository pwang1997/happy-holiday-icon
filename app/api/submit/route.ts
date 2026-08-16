import { authenticateRequest } from "@/app/lib/cognito";
import {
  ImageSubmissionError,
  parseImageSubmission,
  submitImageJob,
  type ImageSubmissionInput,
} from "@/app/lib/image-submission";
import ImageGenProvider, {
  ImageGenerationConfigurationError,
} from "@/app/lib/llm/image-gen";
import { getTrialSession } from "@/app/lib/trial-session";
import type { UsageIdentity } from "@/app/lib/usage";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function setAnonymousSessionCookie(
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

export async function POST(request: NextRequest) {
  let imageGenerator: ImageGenProvider;

  try {
    imageGenerator = new ImageGenProvider();
  } catch (error) {
    if (error instanceof ImageGenerationConfigurationError) {
      return errorResponse(error.message, 503);
    }

    console.error("Unable to configure image generation", error);
    return errorResponse("The image generator is not configured.", 503);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse("The form submission could not be read.", 400);
  }

  let input: ImageSubmissionInput;

  try {
    input = parseImageSubmission(formData);
  } catch (error) {
    if (error instanceof ImageSubmissionError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to parse image submission", error);
    return errorResponse("The form submission could not be read.", 400);
  }

  let authentication;

  try {
    authentication = await authenticateRequest(request);
  } catch (error) {
    console.error("Unable to verify Cognito session", error);
    return errorResponse("Authentication is not configured.", 503);
  }

  if (authentication.kind === "invalid") {
    return errorResponse(
      "Your sign-in session is invalid. Please sign in again.",
      401,
    );
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
      return errorResponse(
        "The trial session is invalid. Please try again.",
        400,
      );
    }

    usageIdentity = {
      kind: "anonymous",
      sessionToken: trialSession.token,
    };
  }

  try {
    const result = await submitImageJob({
      generator: imageGenerator,
      input,
      usageIdentity,
    });

    return setAnonymousSessionCookie(
      NextResponse.json(
        {
          jobId: input.jobId,
          status: "RESHAPING",
          ...result,
        },
        { status: 202 },
      ),
      trialSession,
    );
  } catch (error) {
    if (error instanceof ImageSubmissionError) {
      return setAnonymousSessionCookie(
        errorResponse(error.message, error.status),
        trialSession,
      );
    }

    console.error("Unable to submit image job", error);
    return setAnonymousSessionCookie(
      errorResponse("Image generation failed. Please try again.", 502),
      trialSession,
    );
  }
}
