import assert from "node:assert/strict";
import test from "node:test";
import { runImageJobWorkflow } from "../app/lib/image-job-workflow.ts";

const IMAGE_HASH = "a".repeat(64);

function response(body, status = 200) {
  return Response.json(body, { status });
}

function readyJobResponse() {
  return {
    jobId: "job-123",
    status: "READY",
    sourceKey: `uploads/${IMAGE_HASH}/source.png`,
    derivativeKeys: [`images/${IMAGE_HASH}-holiday-icon/32.webp`],
    imageUrls: [
      {
        key: `images/${IMAGE_HASH}-holiday-icon/32.webp`,
        size: 32,
        url: "https://download.example.test/32.webp",
      },
    ],
    error: null,
    createdAt: 1,
    updatedAt: 2,
    expiresAt: 4_102_444_800,
  };
}

function submissionFormData() {
  const formData = new FormData();
  formData.set("image", new File(["image"], "source.png", { type: "image/png" }));
  formData.set("prompt", "A cheerful snowman");
  formData.set("style", "playful");
  return formData;
}

test("runs the create, upload, submit, and poll workflow", async () => {
  const statuses = [];
  const requests = [];
  const responses = [
    response({
      jobId: "job-123",
      status: "UPLOADING",
      sourceKey: `uploads/${IMAGE_HASH}/source.png`,
      uploadUrl: "https://upload.example.test/source.png",
      expiresAt: 4_102_444_800,
    }, 201),
    new Response(null, { status: 200 }),
    response({ jobId: "job-123", status: "RESHAPING" }, 202),
    response(readyJobResponse()),
  ];

  const imageUrls = await runImageJobWorkflow(submissionFormData(), {
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      const next = responses.shift();
      assert.ok(next, "received an unexpected fetch call");
      return next;
    },
    hashImage: async () => IMAGE_HASH,
    onStatus: (status) => statuses.push(status),
    wait: async () => {},
  });

  assert.deepEqual(statuses, ["GENERATING", "RESHAPING", "READY"]);
  assert.deepEqual(imageUrls, readyJobResponse().imageUrls);
  assert.deepEqual(
    requests.map(({ input }) => input),
    [
      "/api/jobs",
      "https://upload.example.test/source.png",
      "/api/submit",
      "/api/jobs/job-123",
    ],
  );
});

test("surfaces an API error when job creation fails", async () => {
  await assert.rejects(
    () =>
      runImageJobWorkflow(submissionFormData(), {
        fetchImpl: async () => response({ error: "Trial unavailable" }, 503),
        hashImage: async () => IMAGE_HASH,
        onStatus: () => {},
        wait: async () => {},
      }),
    { message: "Trial unavailable" },
  );
});
