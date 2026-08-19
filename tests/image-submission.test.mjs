import assert from "node:assert/strict";
import test from "node:test";
import {
  createImageSubmissionService,
  ImageSubmissionError,
  parseImageSubmission,
} from "../app/lib/image-submission.ts";
import { TrialLimitError } from "../app/lib/usage.ts";

const JOB = {
  jobId: "a9f4a6d7-ecf5-448d-a7ce-51954d3a234d",
  status: "UPLOADING",
  sourceKey: "uploads/a9f4a6d7-ecf5-448d-a7ce-51954d3a234d/source.png",
  uploadUrl: "https://upload.example.test/source.png",
  expiresAt: 4_102_444_800,
};

const INPUT = {
  contentType: "image/png",
  prompt: "A cheerful snowman",
  style: "playful",
};

function createService({ recordUsage = async () => 1, onCreate, onUpdate } = {}) {
  return createImageSubmissionService({
    createImageUploadJob: async (input) => {
      onCreate?.(input);
      return JOB;
    },
    recordUsage,
    updateImageJob: async (...arguments_) => {
      onUpdate?.(...arguments_);
    },
  });
}

test("parses asynchronous submission instructions", () => {
  assert.deepEqual(parseImageSubmission(INPUT), INPUT);
  assert.throws(
    () => parseImageSubmission({ ...INPUT, style: "unsupported" }),
    (error) => error instanceof ImageSubmissionError && error.status === 400,
  );
});

test("creates an owned upload job before recording usage", async () => {
  const created = [];
  const usage = [];
  const service = createService({
    onCreate: (input) => created.push(input),
    recordUsage: async (identity) => usage.push(identity),
  });

  const result = await service.admitImageJob({
    input: INPUT,
    usageIdentity: { kind: "anonymous", sessionToken: "trial-token" },
  });

  assert.deepEqual(result, JOB);
  assert.deepEqual(usage, [
    { kind: "anonymous", sessionToken: "trial-token" },
  ]);
  assert.deepEqual(created, [
    {
      ...INPUT,
      owner: {
        ownerId:
          "ANONYMOUS#6edf550811a5477ddf2d63eabcc169d010974b8f6e2133575d55146c3392bb2b",
        ownerType: "anonymous",
      },
    },
  ]);
});

test("fails the unuploaded job when the anonymous trial is exhausted", async () => {
  const updates = [];
  const service = createService({
    recordUsage: async () => {
      throw new TrialLimitError();
    },
    onUpdate: (...arguments_) => updates.push(arguments_),
  });

  await assert.rejects(
    () =>
      service.admitImageJob({
        input: INPUT,
        usageIdentity: { kind: "anonymous", sessionToken: "trial-token" },
      }),
    (error) => error instanceof ImageSubmissionError && error.status === 403,
  );
  assert.deepEqual(updates, [
    [
      JOB.jobId,
      { status: "FAILED", error: "Anonymous trial limit reached" },
      "UPLOADING",
    ],
  ]);
});
