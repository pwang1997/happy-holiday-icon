import {
  imageJobService,
  ImageJobServiceError,
  parseImageJobAdmission,
  type ImageJobAdmissionInput,
} from "./image-job-service";
import { updateImageJob } from "./jobs";
import {
  MAX_FREE_TRIALS,
  recordUsage,
  TrialLimitError,
  usageOwner,
  type UsageIdentity,
} from "./usage";

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
      usageIdentity,
    }: {
      input: ImageSubmissionInput;
      usageIdentity: UsageIdentity;
    }) {
      let job;

      try {
        job = await createImageUploadJob({
          ...input,
          owner: usageOwner(usageIdentity),
        });
      } catch (error) {
        throw toSubmissionError(error);
      }

      try {
        await saveUsage(usageIdentity);
      } catch (error) {
        if (error instanceof TrialLimitError) {
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
