import assert from "node:assert/strict";
import test from "node:test";
import {
  createImageJobService,
  ImageJobServiceError,
  parseImageJobCreation,
} from "../app/lib/image-job-service.ts";

const IMAGE_HASH = "a".repeat(64);
const JOB = {
  jobId: "job-123",
  status: "UPLOADING",
  sourceKey: `uploads/${IMAGE_HASH}/source.png`,
  derivativeKeys: [],
  error: null,
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 4_102_444_800,
};

function createService({ job = JOB, downloadUrl = null } = {}) {
  return createImageJobService({
    createImageJob: async () => job,
    getImageDownloadUrlIfExists: async () => downloadUrl,
    getImageJob: async () => job,
    getTemporaryImageUploadUrl: async () => "https://upload.example.test",
  });
}

test("validates image-job creation input", () => {
  assert.deepEqual(
    parseImageJobCreation({ contentType: "image/png", imageHash: IMAGE_HASH }),
    { contentType: "image/png", imageHash: IMAGE_HASH },
  );

  assert.throws(
    () => parseImageJobCreation({ contentType: "image/gif", imageHash: IMAGE_HASH }),
    (error) => error instanceof ImageJobServiceError && error.status === 415,
  );

  assert.throws(
    () => parseImageJobCreation({ contentType: "image/png", imageHash: "bad" }),
    (error) => error instanceof ImageJobServiceError && error.status === 400,
  );
});

test("creates an upload job with a presigned URL", async () => {
  const result = await createService().createImageUploadJob({
    contentType: "image/png",
    imageHash: IMAGE_HASH,
  });

  assert.deepEqual(result, {
    jobId: JOB.jobId,
    status: "UPLOADING",
    sourceKey: JOB.sourceKey,
    uploadUrl: "https://upload.example.test",
    expiresAt: JOB.expiresAt,
  });
});

test("returns signed URLs only for available, supported derivatives", async () => {
  const readyJob = {
    ...JOB,
    status: "READY",
    derivativeKeys: [
      `images/${IMAGE_HASH}-holiday-icon/32.webp`,
      `images/${IMAGE_HASH}-holiday-icon/48.webp`,
      `images/${IMAGE_HASH}-holiday-icon/original.png`,
    ],
  };
  const service = createService({
    job: readyJob,
    downloadUrl: "https://download.example.test",
  });

  const result = await service.getImageJobStatus(readyJob.jobId);

  assert.deepEqual(result.imageUrls, [
    {
      key: `images/${IMAGE_HASH}-holiday-icon/32.webp`,
      size: 32,
      url: "https://download.example.test",
    },
    {
      key: `images/${IMAGE_HASH}-holiday-icon/48.webp`,
      size: 48,
      url: "https://download.example.test",
    },
  ]);
});

test("returns not found for missing or expired jobs", async () => {
  await assert.rejects(
    () => createService({ job: null }).getImageJobStatus("missing-job"),
    (error) => error instanceof ImageJobServiceError && error.status === 404,
  );

  await assert.rejects(
    () =>
      createService({ job: { ...JOB, expiresAt: 0 } }).getImageJobStatus(
        JOB.jobId,
      ),
    (error) => error instanceof ImageJobServiceError && error.status === 404,
  );
});
