import {
  imageJobService,
  ImageJobServiceError,
  parseImageJobAdmission,
  type ImageJobAdmissionInput,
} from "./image-job-service";
import { updateImageJob } from "./jobs";
import {
  MAX_FREE_TRIALS,
  isTrialLimitError,
  recordUsage,
  type UsageIdentity,
} from "./usage";
import type { ImageJobOwner } from "./jobs";
import { getMaxSourceImageBytes } from "./s3";

export type ImageSubmissionInput = ImageJobAdmissionInput;

export class ImageSubmissionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ImageSubmissionError";
  }
}

type ImageSubmissionDependencies = {
  createImageUploadJob: typeof imageJobService.createImageUploadJob;
  recordUsage: typeof recordUsage;
  updateImageJob: typeof updateImageJob;
};

function toSubmissionError(error: unknown) {
  if (error instanceof ImageJobServiceError) {
    return new ImageSubmissionError(error.message, error.status);
  }

  return error;
}

export function parseImageSubmission(payload: unknown): ImageSubmissionInput {
  try {
    return parseImageJobAdmission(payload);
  } catch (error) {
    throw toSubmissionError(error);
  }
}

export function validateSubmissionRequestContentLength(
  contentLength: string | null,
) {
  if (contentLength === null) {
    return;
  }

  if (!/^\d+$/.test(contentLength)) {
    throw new ImageSubmissionError("Request content length is invalid.", 400);
  }

  const byteLength = Number(contentLength);

  if (!Number.isSafeInteger(byteLength)) {
    throw new ImageSubmissionError("Request content length is invalid.", 400);
  }

  if (byteLength > getMaxSourceImageBytes()) {
    throw new ImageSubmissionError(
      `Request body must be ${Math.floor(getMaxSourceImageBytes() / (1024 * 1024))} MB or smaller.`,
      413,
    );
  }
}

async function markJobFailed(
  updateJob: typeof updateImageJob,
  jobId: string,
  message: string,
) {
  try {
    await updateJob(jobId, { status: "FAILED", error: message }, "UPLOADING");
  } catch (error) {
    console.error("Unable to mark image job as failed", error);
  }
}

export function createImageSubmissionService({
  createImageUploadJob,
  recordUsage: saveUsage,
  updateImageJob: updateJob,
}: ImageSubmissionDependencies) {
  return {
    async admitImageJob({
      input,
      owner,
      usageIdentity,
    }: {
      input: ImageSubmissionInput;
      owner: ImageJobOwner;
      usageIdentity: UsageIdentity;
    }) {
      let job;

      try {
        job = await createImageUploadJob({
          ...input,
          owner,
        });
      } catch (error) {
        throw toSubmissionError(error);
      }

      try {
        await saveUsage(usageIdentity);
      } catch (error) {
        if (isTrialLimitError(error)) {
          await markJobFailed(
            updateJob,
            job.jobId,
            "Anonymous trial limit reached",
          );
          throw new ImageSubmissionError(
            `Your ${MAX_FREE_TRIALS} free trials are used. Sign in to continue.`,
            403,
          );
        }

        console.error("Unable to account for image usage", error);
        await markJobFailed(
          updateJob,
          job.jobId,
          "Usage accounting unavailable",
        );
        throw new ImageSubmissionError(
          "Usage accounting is temporarily unavailable.",
          503,
        );
      }

      return job;
    },
  };
}

export const imageSubmissionService = createImageSubmissionService({
  createImageUploadJob: imageJobService.createImageUploadJob,
  recordUsage,
  updateImageJob,
});
