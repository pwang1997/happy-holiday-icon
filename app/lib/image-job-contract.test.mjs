import assert from "node:assert/strict";
import test from "node:test";
import {
  apiErrorMessage,
  isImageJobCreationResponse,
  isImageJobStatusResponse,
} from "./image-job-contract.ts";

const IMAGE_HASH = "a".repeat(64);

test("validates the image-job creation response contract", () => {
  assert.equal(
    isImageJobCreationResponse({
      jobId: "job-123",
      status: "UPLOADING",
      sourceKey: `uploads/${IMAGE_HASH}/source.png`,
      uploadUrl: "https://upload.example.test",
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
      sourceKey: `uploads/${IMAGE_HASH}/source.png`,
      derivativeKeys: [`images/${IMAGE_HASH}-holiday-icon/32.webp`],
      imageUrls: [
        {
          key: `images/${IMAGE_HASH}-holiday-icon/32.webp`,
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
