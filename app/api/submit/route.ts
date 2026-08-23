import {
  getSubmissionAuth,
  imageJobOwner,
  SubmissionAuthenticationError,
  usageIdentityForSubmission,
} from "@/app/lib/auth-service";
import { errorResponse } from "@/app/lib/http-responses";
import {
  ImageSubmissionError,
  imageSubmissionService,
  parseImageSubmission,
  validateSubmissionRequestContentLength,
  type ImageSubmissionInput,
} from "@/app/lib/image-submission";
import { STYLE_INSTRUCTIONS, SYSTEM_PROMPT } from "@/app/lib/instructions";
import PromptProtectProvider, {
  PromptValidationRejectedError,
  PromptValidationServiceError,
} from "@/app/lib/llm/prompt-protect";
import {
  type SubmissionGuardLease,
  SubmissionRateLimitError,
  submissionGuard,
} from "@/app/lib/submission-guard";
import { setTrialSessionCookie } from "@/app/lib/trial-session-cookie";
import type { UsageIdentity } from "@/app/lib/usage";
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

  const { identity, trialSession } = submissionAuth;
  let usageIdentity: UsageIdentity;

  try {
    usageIdentity = usageIdentityForSubmission(request, identity);
  } catch (error) {
    if (error instanceof SubmissionAuthenticationError) {
      return setTrialSessionCookie(
        errorResponse(error.message, error.status),
        trialSession,
      );
    }

    console.error("Unable to establish submission usage identity", error);
    return setTrialSessionCookie(
      errorResponse("Submission protection is unavailable.", 503),
      trialSession,
    );
  }

  let validationLease: SubmissionGuardLease;

  try {
    validationLease = await submissionGuard.acquire(usageIdentity);
  } catch (error) {
    if (error instanceof SubmissionRateLimitError) {
      return setTrialSessionCookie(
        errorResponse(
          "Too many submission attempts. Please try again shortly.",
          429,
          { "Retry-After": String(error.retryAfterSeconds) },
        ),
        trialSession,
      );
    }

    console.error("Unable to enforce submission protection", error);
    return setTrialSessionCookie(
      errorResponse("Submission protection is unavailable.", 503),
      trialSession,
    );
  }

  const trustedBasePrompt = [
    SYSTEM_PROMPT,
    "Edit the uploaded reference image into a single holiday app icon.",
    `The requested visual style is: ${STYLE_INSTRUCTIONS[input.style]}`,
    "Keep the main subject recognizable, centered, and legible at small sizes.",
    "Use a square composition, a clean silhouette, and no text or watermark.",
    "Return a PNG with a transparent background when possible.",
  ].join("\n");

  try {
    await new PromptProtectProvider().validate(trustedBasePrompt, input.prompt);
  } catch (error) {
    if (error instanceof PromptValidationRejectedError) {
      return setTrialSessionCookie(
        errorResponse(
          "Please describe the holiday icon you want without additional instructions.",
          400,
        ),
        trialSession,
      );
    }

    if (error instanceof PromptValidationServiceError) {
      console.error("Prompt validation service failed", error);
      return setTrialSessionCookie(
        errorResponse("Prompt validation is temporarily unavailable.", 503),
        trialSession,
      );
    }

    console.error("Unable to validate image submission prompt", error);
    return setTrialSessionCookie(
      errorResponse("Prompt validation is temporarily unavailable.", 503),
      trialSession,
    );
  } finally {
    try {
      await validationLease.release();
    } catch (error) {
      console.error("Unable to release submission validation lease", error);
    }
  }

  try {
    const result = await imageSubmissionService.admitImageJob({
      input,
      owner: imageJobOwner(identity),
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
