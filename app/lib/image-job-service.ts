import {
  createImageJob,
  getImageJob,
  isExpired,
  type ImageJobOwner,
} from "./jobs";
import type {
  ImageJobCreationResponse,
  ImageJobStatusResponse,
} from "./image-job-contract";
import {
  getImageDownloadUrlIfExists,
  getTemporaryImageUploadUrl,
} from "./s3";
import { STYLE_INSTRUCTIONS, type Style } from "./instructions";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_PROMPT_LENGTH = 500;

type ImageJobServiceDependencies = {
  createImageJob: typeof createImageJob;
  getImageDownloadUrlIfExists: typeof getImageDownloadUrlIfExists;
  getImageJob: typeof getImageJob;
  getTemporaryImageUploadUrl: typeof getTemporaryImageUploadUrl;
};

export class ImageJobServiceError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ImageJobServiceError";
    this.status = status;
  }
}

export type ImageJobAdmissionInput = {
  contentType: string;
  prompt: string;
  style: Style;
};

type ImageJobCreationInput = ImageJobAdmissionInput & {
  owner: ImageJobOwner;
};

export function parseImageJobAdmission(payload: unknown): ImageJobAdmissionInput {
  if (!payload || typeof payload !== "object") {
    throw new ImageJobServiceError("Request body must be JSON.", 400);
  }

  const { contentType, prompt: promptValue, style } = payload as Record<
    string,
    unknown
  >;

  if (typeof contentType !== "string" || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new ImageJobServiceError(
      "Only PNG, JPG, and WEBP images are supported.",
      415,
    );
  }

  if (typeof promptValue !== "string" || promptValue.trim().length === 0) {
    throw new ImageJobServiceError(
      "Please describe the icon you want to create.",
      400,
    );
  }

  const prompt = promptValue.trim();

  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new ImageJobServiceError(
      `The description must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
      400,
    );
  }

  if (
    typeof style !== "string" ||
    !Object.prototype.hasOwnProperty.call(STYLE_INSTRUCTIONS, style)
  ) {
    throw new ImageJobServiceError("Please choose a supported style.", 400);
  }

  return { contentType, prompt, style: style as Style };
}

function derivativeSize(key: string) {
  const match = key.match(/\/(32|48|512)\.webp$/);
  return match ? Number(match[1]) : null;
}

function derivativeDownloadFileName(size: number) {
  return `happy-holiday-icon-${size}px.webp`;
}

export function createImageJobService({
  createImageJob: createJob,
  getImageDownloadUrlIfExists: getDownloadUrl,
  getImageJob: getJob,
  getTemporaryImageUploadUrl: getUploadUrl,
}: ImageJobServiceDependencies) {
  return {
    async createImageUploadJob(
      input: ImageJobCreationInput,
    ): Promise<ImageJobCreationResponse> {
      const job = await createJob(input);
      const uploadUrl = await getUploadUrl(job.sourceKey, input.contentType);

      return {
        jobId: job.jobId,
        status: "UPLOADING",
        sourceKey: job.sourceKey,
        uploadUrl,
        expiresAt: job.expiresAt,
      };
    },

    async getImageJobStatus(jobId: string): Promise<ImageJobStatusResponse> {
      const job = await getJob(jobId);

      if (!job || isExpired(job)) {
        throw new ImageJobServiceError("Image job not found.", 404);
      }

      const imageUrls =
        job.status === "READY"
          ? (
              await Promise.all(
                job.derivativeKeys.map(async (key) => {
                  const size = derivativeSize(key);

                  if (size === null) {
                    return null;
                  }

                  const url = await getDownloadUrl(key, {
                    fileName: derivativeDownloadFileName(size),
                  });
                  return url ? { key, size, url } : null;
                }),
              )
            ).filter(
              (
                derivative,
              ): derivative is { key: string; size: number; url: string } =>
                derivative !== null,
            )
          : [];

      return {
        jobId: job.jobId,
        status: job.status,
        sourceKey: job.sourceKey,
        derivativeKeys: job.derivativeKeys,
        imageUrls,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        expiresAt: job.expiresAt,
      };
    },
  };
}

export const imageJobService = createImageJobService({
  createImageJob,
  getImageDownloadUrlIfExists,
  getImageJob,
  getTemporaryImageUploadUrl,
});
