export const IMAGE_JOB_STATUSES = [
  "UPLOADING",
  "GENERATING",
  "RESHAPING",
  "READY",
  "FAILED",
] as const;

export type ImageJobStatus = (typeof IMAGE_JOB_STATUSES)[number];

export type ImageUrl = {
  key: string;
  size: number;
  url: string;
};

export type ImageUploadPost = {
  url: string;
  fields: Record<string, string>;
  maxBytes: number;
};

export type ImageJobCreationResponse = {
  jobId: string;
  status: "UPLOADING";
  sourceKey: string;
  upload: ImageUploadPost;
  expiresAt: number;
};

export type ImageJobStatusResponse = {
  jobId: string;
  status: ImageJobStatus;
  sourceKey: string;
  derivativeKeys: string[];
  imageUrls: ImageUrl[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type ImageJobSummary = {
  jobId: string;
  status: ImageJobStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ImageJobListResponse = {
  jobs: ImageJobSummary[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isImageUrl(value: unknown): value is ImageUrl {
  return (
    isObject(value) &&
    typeof value.key === "string" &&
    typeof value.size === "number" &&
    typeof value.url === "string"
  );
}

function isImageUploadPost(value: unknown): value is ImageUploadPost {
  return (
    isObject(value) &&
    typeof value.url === "string" &&
    typeof value.maxBytes === "number" &&
    Number.isSafeInteger(value.maxBytes) &&
    value.maxBytes > 0 &&
    isObject(value.fields) &&
    Object.values(value.fields).every((field) => typeof field === "string")
  );
}

export function isImageJobCreationResponse(
  value: unknown,
): value is ImageJobCreationResponse {
  return (
    isObject(value) &&
    typeof value.jobId === "string" &&
    value.status === "UPLOADING" &&
    typeof value.sourceKey === "string" &&
    isImageUploadPost(value.upload) &&
    typeof value.expiresAt === "number"
  );
}

export function isImageJobStatusResponse(
  value: unknown,
): value is ImageJobStatusResponse {
  return (
    isObject(value) &&
    typeof value.jobId === "string" &&
    typeof value.status === "string" &&
    IMAGE_JOB_STATUSES.includes(value.status as ImageJobStatus) &&
    typeof value.sourceKey === "string" &&
    Array.isArray(value.derivativeKeys) &&
    value.derivativeKeys.every((key) => typeof key === "string") &&
    Array.isArray(value.imageUrls) &&
    value.imageUrls.every(isImageUrl) &&
    (value.error === null || typeof value.error === "string") &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    typeof value.expiresAt === "number"
  );
}

function isImageJobSummary(value: unknown): value is ImageJobSummary {
  return (
    isObject(value) &&
    typeof value.jobId === "string" &&
    typeof value.status === "string" &&
    IMAGE_JOB_STATUSES.includes(value.status as ImageJobStatus) &&
    (value.error === null || typeof value.error === "string") &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

export function isImageJobListResponse(
  value: unknown,
): value is ImageJobListResponse {
  return (
    isObject(value) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isImageJobSummary)
  );
}

export function apiErrorMessage(value: unknown, fallback: string) {
  return isObject(value) && typeof value.error === "string"
    ? value.error
    : fallback;
}
