import assert from "node:assert/strict";
import test from "node:test";
import {
  apiErrorMessage,
  isImageJobCreationResponse,
  isImageJobStatusResponse,
} from "../app/lib/image-job-contract.ts";

const JOB_ID = "a9f4a6d7-ecf5-448d-a7ce-51954d3a234d";

test("validates the image-job creation response contract", () => {
  assert.equal(
    isImageJobCreationResponse({
      jobId: "job-123",
      status: "UPLOADING",
      sourceKey: `uploads/${JOB_ID}/source.png`,
      upload: {
        url: "https://upload.example.test",
        fields: { key: `uploads/${JOB_ID}/source.png` },
        maxBytes: 10 * 1024 * 1024,
      },
      expiresAt: 4_102_444_800,
    }),
    true,
  );
  assert.equal(isImageJobCreationResponse({ jobId: "job-123" }), false);
});

test("validates a ready image-job response with derivatives", () => {
  assert.equal(
    isImageJobStatusResponse({
      jobId: "job-123",
      status: "READY",
      sourceKey: `uploads/${JOB_ID}/source.png`,
      derivativeKeys: [`images/${JOB_ID}-holiday-icon/32.webp`],
      imageUrls: [
        {
          key: `images/${JOB_ID}-holiday-icon/32.webp`,
          size: 32,
          url: "https://download.example.test",
        },
      ],
      error: null,
      createdAt: 1,
      updatedAt: 2,
      expiresAt: 4_102_444_800,
    }),
    true,
  );
  assert.equal(
    isImageJobStatusResponse({ status: "READY", imageUrls: [] }),
    false,
  );
});

test("reads API error messages with a fallback", () => {
  assert.equal(apiErrorMessage({ error: "Request failed" }, "Fallback"), "Request failed");
  assert.equal(apiErrorMessage({}, "Fallback"), "Fallback");
});
