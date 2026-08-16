import { STYLE_INSTRUCTIONS, type Style } from "@/app/lib/instructions";
import {
  getImageJob,
  imageHashFromSourceKey,
  isExpired,
  type JobStatus,
  updateImageJob,
} from "@/app/lib/jobs";
import type {
  GeneratedImage,
  ImageGenerationRequest,
} from "@/app/lib/llm/image-gen";
import { getTemporaryImage, uploadImage } from "@/app/lib/s3";
import {
  MAX_FREE_TRIALS,
  recordUsage,
  TrialLimitError,
  type UsageIdentity,
} from "@/app/lib/usage";

const MAX_PROMPT_LENGTH = 500;

export type ImageSubmissionInput = {
  jobId: string;
  prompt: string;
  style: Style;
};

export type ImageSubmissionResult = {
  imageKey: string;
  revisedPrompt: string | null;
};

export type ImageGenerator = {
  generate(request: ImageGenerationRequest): Promise<GeneratedImage>;
};

export class ImageSubmissionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ImageSubmissionError";
  }
}

function isStyle(value: string): value is Style {
  return Object.prototype.hasOwnProperty.call(STYLE_INSTRUCTIONS, value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
}

function isConditionalCheckFailed(error: unknown) {
  return (
    error instanceof Error && error.name === "ConditionalCheckFailedException"
  );
}

async function markJobFailed(
  jobId: string,
  message: string,
  expectedStatus: JobStatus,
) {
  try {
    await updateImageJob(
      jobId,
      { status: "FAILED", error: message },
      expectedStatus,
    );
  } catch (error) {
    console.error("Unable to mark image job as failed", error);
  }
}

export function parseImageSubmission(formData: FormData): ImageSubmissionInput {
  const jobId = formData.get("jobId");
  const promptValue = formData.get("prompt");
  const style = formData.get("style");

  if (typeof jobId !== "string" || !jobId) {
    throw new ImageSubmissionError("An image job is required.", 400);
  }

  if (typeof promptValue !== "string" || promptValue.trim().length === 0) {
    throw new ImageSubmissionError(
      "Please describe the icon you want to create.",
      400,
    );
  }

  const prompt = promptValue.trim();

  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new ImageSubmissionError(
      `The description must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
      400,
    );
  }

  if (typeof style !== "string" || !isStyle(style)) {
    throw new ImageSubmissionError("Please choose a supported style.", 400);
  }

  return { jobId, prompt, style };
}

export async function submitImageJob({
  generator,
  input,
  usageIdentity,
}: {
  generator: ImageGenerator;
  input: ImageSubmissionInput;
  usageIdentity: UsageIdentity;
}): Promise<ImageSubmissionResult> {
  let job;

  try {
    job = await getImageJob(input.jobId);
  } catch (error) {
    console.error("Unable to read image job", error);
    throw new ImageSubmissionError("Unable to read the image job.", 503);
  }

  if (!job || isExpired(job)) {
    throw new ImageSubmissionError("Image job not found.", 404);
  }

  if (job.status !== "UPLOADING") {
    throw new ImageSubmissionError("This image job has already started.", 409);
  }

  try {
    await updateImageJob(
      job.jobId,
      { status: "GENERATING", error: null },
      "UPLOADING",
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new ImageSubmissionError(
        "This image job has already started.",
        409,
      );
    }

    console.error("Unable to start image generation", error);
    throw new ImageSubmissionError("Unable to start image generation.", 503);
  }

  try {
    await recordUsage(usageIdentity);
  } catch (error) {
    if (error instanceof TrialLimitError) {
      await markJobFailed(
        job.jobId,
        "Anonymous trial limit reached",
        "GENERATING",
      );
      throw new ImageSubmissionError(
        `Your ${MAX_FREE_TRIALS} free trials are used. Sign in to continue.`,
        403,
      );
    }

    console.error("Unable to account for image usage", error);
    await markJobFailed(
      job.jobId,
      "Usage accounting unavailable",
      "GENERATING",
    );
    throw new ImageSubmissionError(
      "Usage accounting is temporarily unavailable.",
      503,
    );
  }

  let expectedFailureStatus: JobStatus = "GENERATING";

  try {
    const sourceImage = await getTemporaryImage(job.sourceKey);
    const sourceContentType = sourceImage.contentType ?? "image/png";
    const imageDataUrl = `data:${sourceContentType};base64,${sourceImage.body.toString("base64")}`;
    const generatedImage = await generator.generate({
      imageDataUrl,
      prompt: input.prompt,
      style: input.style,
    });
    const imageKey = `images/${imageHashFromSourceKey(job.sourceKey)}-holiday-icon.png`;

    await updateImageJob(
      job.jobId,
      { status: "RESHAPING", error: null },
      "GENERATING",
    );
    expectedFailureStatus = "RESHAPING";

    await uploadImage({
      key: imageKey,
      body: Buffer.from(generatedImage.imageBase64, "base64"),
      contentType: "image/png",
      metadata: { jobid: job.jobId },
    });

    return {
      imageKey,
      revisedPrompt: generatedImage.revisedPrompt,
    };
  } catch (error) {
    const message = errorMessage(error);
    console.error("Image generation failed", error);
    await markJobFailed(job.jobId, message, expectedFailureStatus);
    throw new ImageSubmissionError(
      "Image generation failed. Please try again.",
      502,
    );
  }
}
