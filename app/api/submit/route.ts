import {
  getSubmissionAuth,
  SubmissionAuthenticationError,
} from "@/app/lib/auth-service";
import { errorResponse } from "@/app/lib/http-responses";
import {
  ImageSubmissionError,
  imageSubmissionService,
  parseImageSubmission,
  type ImageSubmissionInput,
  validateSubmissionRequestContentLength,
} from "@/app/lib/image-submission";
import { setTrialSessionCookie } from "@/app/lib/trial-session-cookie";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    validateSubmissionRequestContentLength(
      request.headers.get("content-length"),
    );
  } catch (error) {
    if (error instanceof ImageSubmissionError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to validate image submission size", error);
    return errorResponse("Unable to validate request size.", 503);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be JSON.", 400);
  }

  let input: ImageSubmissionInput;

  try {
    input = parseImageSubmission(payload);
  } catch (error) {
    if (error instanceof ImageSubmissionError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to parse image submission", error);
    return errorResponse("The form submission could not be read.", 400);
  }

  let submissionAuth;

  try {
    submissionAuth = await getSubmissionAuth(request);
  } catch (error) {
    if (error instanceof SubmissionAuthenticationError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to resolve submission authentication", error);
    return errorResponse("Authentication is not configured.", 503);
  }

  const { trialSession, usageIdentity } = submissionAuth;

  try {
    const result = await imageSubmissionService.admitImageJob({
      input,
      usageIdentity,
    });

    return setTrialSessionCookie(
      NextResponse.json(
        {
          ...result,
        },
        { status: 202 },
      ),
      trialSession,
    );
  } catch (error) {
    if (error instanceof ImageSubmissionError) {
      return setTrialSessionCookie(
        errorResponse(error.message, error.status),
        trialSession,
      );
    }

    console.error("Unable to submit image job", error);
    return setTrialSessionCookie(
      errorResponse("Image generation failed. Please try again.", 502),
      trialSession,
    );
  }
}
