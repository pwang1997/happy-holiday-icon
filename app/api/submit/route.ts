import {
  getSubmissionAuth,
  SubmissionAuthenticationError,
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
import PromptProtectProvider from "@/app/lib/llm/prompt-protect";
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
    console.error("Unable to validate image submission prompt", error);
    return setTrialSessionCookie(
      errorResponse(
        "Please describe the holiday icon you want without additional instructions.",
        400,
      ),
      trialSession,
    );
  }

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
