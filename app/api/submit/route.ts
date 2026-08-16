import { authenticateRequest } from "@/app/lib/cognito";
import { STYLE_INSTRUCTIONS, type Style } from "@/app/lib/instructions";
import {
  getImageJob,
  imageHashFromSourceKey,
  isExpired,
  updateImageJob,
} from "@/app/lib/jobs";
import ImageGenProvider, {
  ImageGenerationConfigurationError,
} from "@/app/lib/llm/image-gen";
import { getTemporaryImage, uploadImage } from "@/app/lib/s3";
import { getTrialSession } from "@/app/lib/trial-session";
import {
  MAX_FREE_TRIALS,
  recordUsage,
  TrialLimitError,
  type UsageIdentity,
} from "@/app/lib/usage";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PROMPT_LENGTH = 500;

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

function isStyle(value: string): value is Style {
  return Object.prototype.hasOwnProperty.call(STYLE_INSTRUCTIONS, value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
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

  const jobIdValue = formData.get("jobId");
  const promptValue = formData.get("prompt");
  const styleValue = formData.get("style");

  if (typeof jobIdValue !== "string" || !jobIdValue) {
    return errorResponse("An image job is required.", 400);
  }

  if (typeof promptValue !== "string" || promptValue.trim().length === 0) {
    return errorResponse("Please describe the icon you want to create.", 400);
  }

  const prompt = promptValue.trim();

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return errorResponse(
      `The description must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
      400,
    );
  }

  if (typeof styleValue !== "string" || !isStyle(styleValue)) {
    return errorResponse("Please choose a supported style.", 400);
  }

  let job;

  try {
    job = await getImageJob(jobIdValue);
  } catch (error) {
    console.error("Unable to read image job", error);
    return errorResponse("Unable to read the image job.", 503);
  }

  if (!job || isExpired(job)) {
    return errorResponse("Image job not found.", 404);
  }

  if (job.status !== "UPLOADING") {
    return errorResponse("This image job has already started.", 409);
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

  if (authentication.kind === "anonymous" && !trialSession) {
    return errorResponse("The trial session is invalid. Please try again.", 400);
  }

  const usageIdentity: UsageIdentity | null =
    authentication.kind === "authenticated"
      ? { kind: "authenticated", subject: authentication.subject }
      : trialSession
        ? { kind: "anonymous", sessionToken: trialSession.token }
        : null;

  let generationStarted = false;

  try {
    await updateImageJob(
      job.jobId,
      { status: "GENERATING", error: null },
      "UPLOADING",
    );
    generationStarted = true;

    if (usageIdentity) {
      try {
        await recordUsage(usageIdentity);
      } catch (error) {
        if (error instanceof TrialLimitError) {
          await updateImageJob(
            job.jobId,
            {
              status: "FAILED",
              error: "Anonymous trial limit reached",
            },
            "GENERATING",
          );

          return setAnonymousSessionCookie(
            errorResponse(
              `Your ${MAX_FREE_TRIALS} free trials are used. Sign in to continue.`,
              403,
            ),
            trialSession,
          );
        }

        console.error("Unable to account for anonymous trial", error);
        await updateImageJob(
          job.jobId,
          {
            status: "FAILED",
            error: "Anonymous usage accounting unavailable",
          },
          "GENERATING",
        );

        return setAnonymousSessionCookie(
          errorResponse("Usage accounting is temporarily unavailable.", 503),
          trialSession,
        );
      }
    }

    const sourceImage = await getTemporaryImage(job.sourceKey);
    const sourceContentType = sourceImage.contentType ?? "image/png";
    const imageDataUrl = `data:${sourceContentType};base64,${sourceImage.body.toString("base64")}`;

    const generatedImage = await imageGenerator.generate({
      imageDataUrl,
      prompt,
      style: styleValue,
    });

    const imageKey = `images/${imageHashFromSourceKey(job.sourceKey)}-holiday-icon.png`;
    await uploadImage({
      key: imageKey,
      body: Buffer.from(generatedImage.imageBase64, "base64"),
      contentType: "image/png",
      metadata: { jobid: job.jobId },
    });
    await updateImageJob(
      job.jobId,
      { status: "RESHAPING", error: null },
      "GENERATING",
    );

    const submitResponse = NextResponse.json(
      {
        jobId: job.jobId,
        status: "RESHAPING",
        imageKey,
        revisedPrompt: generatedImage.revisedPrompt,
      },
      { status: 202 },
    );

    return setAnonymousSessionCookie(submitResponse, trialSession);
  } catch (error) {
    const message = errorMessage(error);
    console.error("Image generation failed", error);

    try {
      if (generationStarted) {
        await updateImageJob(
          job.jobId,
          { status: "FAILED", error: message },
          "GENERATING",
        );
      }
    } catch (jobError) {
      console.error("Unable to mark image job as failed", jobError);
    }

    return setAnonymousSessionCookie(
      errorResponse("Image generation failed. Please try again.", 502),
      trialSession,
    );
  }
}
