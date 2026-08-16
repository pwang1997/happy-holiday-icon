import {
  createImageJob,
  getImageJob,
  isExpired,
  isImageHash,
  type ImageJob,
} from "./jobs";
import {
  getImageDownloadUrlIfExists,
  getTemporaryImageUploadUrl,
} from "./s3";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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

export type ImageJobCreation = {
  contentType: string;
  imageHash: string;
};

export type ImageJobStatus = {
  jobId: string;
  status: ImageJob["status"];
  sourceKey: string;
  derivativeKeys: string[];
  imageUrls: Array<{ key: string; size: number; url: string }>;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export function parseImageJobCreation(payload: unknown): ImageJobCreation {
  if (!payload || typeof payload !== "object") {
    throw new ImageJobServiceError("Request body must be JSON.", 400);
  }

  const { contentType, imageHash } = payload as Record<string, unknown>;

  if (typeof contentType !== "string" || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new ImageJobServiceError(
      "Only PNG, JPG, and WEBP images are supported.",
      415,
    );
  }

  if (typeof imageHash !== "string" || !isImageHash(imageHash)) {
    throw new ImageJobServiceError("A valid image hash is required.", 400);
  }

  return { contentType, imageHash };
}

function derivativeSize(key: string) {
  const match = key.match(/\/(32|48|512)\.webp$/);
  return match ? Number(match[1]) : null;
}

export function createImageJobService({
  createImageJob: createJob,
  getImageDownloadUrlIfExists: getDownloadUrl,
  getImageJob: getJob,
  getTemporaryImageUploadUrl: getUploadUrl,
}: ImageJobServiceDependencies) {
  return {
    async createImageUploadJob(payload: unknown) {
      const { contentType, imageHash } = parseImageJobCreation(payload);
      const job = await createJob(contentType, imageHash);
      const uploadUrl = await getUploadUrl(job.sourceKey, contentType);

      return {
        jobId: job.jobId,
        status: job.status,
        sourceKey: job.sourceKey,
        uploadUrl,
        expiresAt: job.expiresAt,
      };
    },

    async getImageJobStatus(jobId: string): Promise<ImageJobStatus> {
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

                  const url = await getDownloadUrl(key);
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
