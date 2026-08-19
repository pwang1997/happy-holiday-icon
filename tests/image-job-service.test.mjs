import assert from "node:assert/strict";
import test from "node:test";
import {
  createImageJobService,
  ImageJobServiceError,
  parseImageJobAdmission,
} from "../app/lib/image-job-service.ts";

const JOB_ID = "a9f4a6d7-ecf5-448d-a7ce-51954d3a234d";
const JOB = {
  jobId: "job-123",
  status: "UPLOADING",
  ownerId: "ANONYMOUS#hash",
  ownerType: "anonymous",
  sourceKey: `uploads/${JOB_ID}/source.png`,
  prompt: "A cheerful snowman",
  style: "playful",
  derivativeKeys: [],
  error: null,
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 4_102_444_800,
};

const JOB_OWNER = {
  ownerId: JOB.ownerId,
  ownerType: JOB.ownerType,
};

function createService({ job = JOB, downloadUrl = null, onDownload } = {}) {
  return createImageJobService({
    createImageJob: async () => job,
    getImageDownloadUrlIfExists: async (...arguments_) => {
      onDownload?.(...arguments_);
      return downloadUrl;
    },
    getImageJob: async () => job,
    getTemporaryImageUploadPost: async () => ({
      url: "https://upload.example.test",
      fields: { key: JOB.sourceKey },
      maxBytes: 10 * 1024 * 1024,
    }),
  });
}

test("validates image-job admission input", () => {
  assert.deepEqual(
    parseImageJobAdmission({
      contentType: "image/png",
      prompt: " A cheerful snowman ",
      style: "playful",
    }),
    {
      contentType: "image/png",
      prompt: "A cheerful snowman",
      style: "playful",
    },
  );

  assert.throws(
    () =>
      parseImageJobAdmission({
        contentType: "image/gif",
        prompt: "A cheerful snowman",
        style: "playful",
      }),
    (error) => error instanceof ImageJobServiceError && error.status === 415,
  );

  assert.throws(
    () =>
      parseImageJobAdmission({
        contentType: "image/png",
        prompt: "",
        style: "playful",
      }),
    (error) => error instanceof ImageJobServiceError && error.status === 400,
  );
});

test("creates an upload job with a size-limited presigned POST", async () => {
  const result = await createService().createImageUploadJob({
    contentType: "image/png",
    prompt: "A cheerful snowman",
    style: "playful",
    owner: { ownerId: "ANONYMOUS#hash", ownerType: "anonymous" },
  });

  assert.deepEqual(result, {
    jobId: JOB.jobId,
    status: "UPLOADING",
    sourceKey: JOB.sourceKey,
    upload: {
      url: "https://upload.example.test",
      fields: { key: JOB.sourceKey },
      maxBytes: 10 * 1024 * 1024,
    },
    expiresAt: JOB.expiresAt,
  });
});

test("returns signed URLs only for available, supported derivatives", async () => {
  const downloadRequests = [];
  const readyJob = {
    ...JOB,
    status: "READY",
    derivativeKeys: [
      `images/${JOB_ID}-holiday-icon/32.webp`,
      `images/${JOB_ID}-holiday-icon/48.webp`,
      `images/${JOB_ID}-holiday-icon/original.png`,
    ],
  };
  const service = createService({
    job: readyJob,
    downloadUrl: "https://download.example.test",
    onDownload: (...arguments_) => downloadRequests.push(arguments_),
  });

  const result = await service.getImageJobStatus(readyJob.jobId, JOB_OWNER);

  assert.deepEqual(result.imageUrls, [
    {
      key: `images/${JOB_ID}-holiday-icon/32.webp`,
      size: 32,
      url: "https://download.example.test",
    },
    {
      key: `images/${JOB_ID}-holiday-icon/48.webp`,
      size: 48,
      url: "https://download.example.test",
    },
  ]);
  assert.deepEqual(downloadRequests, [
    [
      `images/${JOB_ID}-holiday-icon/32.webp`,
      { fileName: "happy-holiday-icon-32px.webp" },
    ],
    [
      `images/${JOB_ID}-holiday-icon/48.webp`,
      { fileName: "happy-holiday-icon-48px.webp" },
    ],
  ]);
});

test("returns not found for missing or expired jobs", async () => {
  await assert.rejects(
    () => createService({ job: null }).getImageJobStatus("missing-job", JOB_OWNER),
    (error) => error instanceof ImageJobServiceError && error.status === 404,
  );

  await assert.rejects(
    () =>
      createService({ job: { ...JOB, expiresAt: 0 } }).getImageJobStatus(
        JOB.jobId,
        JOB_OWNER,
      ),
    (error) => error instanceof ImageJobServiceError && error.status === 404,
  );
});

test("hides jobs from a different identity", async () => {
  await assert.rejects(
    () =>
      createService().getImageJobStatus(JOB.jobId, {
        ownerId: "USER#different-user",
        ownerType: "authenticated",
      }),
    (error) => error instanceof ImageJobServiceError && error.status === 404,
  );
});
