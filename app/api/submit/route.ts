import { authenticateRequest } from "@/app/lib/cognito";
import {
  getImageJob,
  imageHashFromSourceKey,
  isExpired,
  updateImageJob,
} from "@/app/lib/jobs";
import { getTemporaryImage, uploadImage } from "@/app/lib/s3";
import { getTrialSession } from "@/app/lib/trial-session";
import {
  consumeAnonymousTrial,
  MAX_FREE_TRIALS,
  TrialLimitError,
} from "@/app/lib/usage";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI, tools } from "@langchain/openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PROMPT_LENGTH = 500;
const STYLE_INSTRUCTIONS = {
  playful:
    "Use a playful, hand-drawn illustration style with warm, friendly shapes.",
  minimal:
    "Use a minimal, clean style with simple geometry and plenty of negative space.",
  vintage:
    "Use a vintage holiday postcard style with softly textured, nostalgic colors.",
  festive:
    "Use a bright, festive style with joyful colors and celebratory details.",
} as const;

type Style = keyof typeof STYLE_INSTRUCTIONS;

type ImageGenerationOutput = {
  type?: string;
  result?: string;
  revised_prompt?: string;
};

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
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return errorResponse(
      "The image generator is not configured. Add OPENAI_API_KEY to the server environment.",
      503,
    );
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

  let generationStarted = false;

  try {
    await updateImageJob(
      job.jobId,
      { status: "GENERATING", error: null },
      "UPLOADING",
    );
    generationStarted = true;

    if (trialSession) {
      try {
        await consumeAnonymousTrial(trialSession.token);
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
    const instruction = [
      "Edit the uploaded reference image into a single holiday app icon.",
      `The requested subject or direction is: ${prompt}`,
      `The requested visual style is: ${STYLE_INSTRUCTIONS[styleValue]}`,
      "Keep the main subject recognizable, centered, and legible at small sizes.",
      "Use a square composition, a clean silhouette, and no text or watermark.",
      "Return the finished icon as a PNG with a transparent background when possible.",
    ].join("\n");
    const model = new ChatOpenAI({
      apiKey,
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o",
    });
    const response = await model.invoke(
      [
        new HumanMessage({
          content: [
            { type: "text", text: instruction },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        }),
      ],
      {
        tools: [
          tools.imageGeneration({
            action: "edit",
            background: "transparent",
            inputFidelity: "high",
            model: "gpt-image-1",
            outputFormat: "png",
            quality: "medium",
            size: "1024x1024",
          }),
        ],
        tool_choice: { type: "image_generation" },
      },
    );
    const toolOutputs = response.additional_kwargs?.tool_outputs;
    const imageOutput = Array.isArray(toolOutputs)
      ? (toolOutputs.find(
          (output): output is ImageGenerationOutput =>
            typeof output === "object" &&
            output !== null &&
            "type" in output &&
            output.type === "image_generation_call",
        ) as ImageGenerationOutput | undefined)
      : undefined;

    if (!imageOutput?.result) {
      throw new Error("The image generator did not return an image.");
    }

    const imageKey = `images/${imageHashFromSourceKey(job.sourceKey)}-holiday-icon.png`;
    await uploadImage({
      key: imageKey,
      body: Buffer.from(imageOutput.result, "base64"),
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
        revisedPrompt: imageOutput.revised_prompt ?? null,
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
