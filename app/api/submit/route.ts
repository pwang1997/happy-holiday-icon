import { errorResponse } from "@/app/lib/http-responses";
import {
  getSubmissionAuth,
  SubmissionAuthenticationError,
} from "@/app/lib/auth-service";
import {
  ImageSubmissionError,
  parseImageSubmission,
  submitImageJob,
  type ImageSubmissionInput,
} from "@/app/lib/image-submission";
import ImageGenProvider, {
  ImageGenerationConfigurationError,
} from "@/app/lib/llm/image-gen";
import { setTrialSessionCookie } from "@/app/lib/trial-session-cookie";
import { NextRequest, NextResponse } from "next/server";

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
    const result = await submitImageJob({
      generator: imageGenerator,
      input,
      usageIdentity,
    });

    return setTrialSessionCookie(
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
