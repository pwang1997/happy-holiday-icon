import assert from "node:assert/strict";
import test from "node:test";
import { runImageJobWorkflow } from "../app/lib/image-job-workflow.ts";

const JOB_ID = "a9f4a6d7-ecf5-448d-a7ce-51954d3a234d";

function response(body, status = 200) {
  return Response.json(body, { status });
}

function readyJobResponse() {
  return {
    jobId: "job-123",
    status: "READY",
    sourceKey: `uploads/${JOB_ID}/source.png`,
    derivativeKeys: [`images/${JOB_ID}-holiday-icon/32.webp`],
    imageUrls: [
      {
        key: `images/${JOB_ID}-holiday-icon/32.webp`,
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

test("admits a job, uploads its source, and polls without waiting for generation", async () => {
  const statuses = [];
  const requests = [];
  const responses = [
    response({
      jobId: "job-123",
      status: "UPLOADING",
      sourceKey: `uploads/${JOB_ID}/source.png`,
      uploadUrl: "https://upload.example.test/source.png",
      expiresAt: 4_102_444_800,
    }, 202),
    new Response(null, { status: 200 }),
    response(readyJobResponse()),
  ];

  const imageUrls = await runImageJobWorkflow(submissionFormData(), {
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      const next = responses.shift();
      assert.ok(next, "received an unexpected fetch call");
      return next;
    },
    onStatus: (status) => statuses.push(status),
    wait: async () => {},
  });

  assert.deepEqual(statuses, ["UPLOADING", "READY"]);
  assert.deepEqual(imageUrls, readyJobResponse().imageUrls);
  assert.deepEqual(
    requests.map(({ input }) => input),
    [
      "/api/submit",
      "https://upload.example.test/source.png",
      "/api/jobs/job-123",
    ],
  );
});

test("surfaces an API error when job admission fails", async () => {
  await assert.rejects(
    () =>
      runImageJobWorkflow(submissionFormData(), {
        fetchImpl: async () => response({ error: "Trial unavailable" }, 503),
        onStatus: () => {},
        wait: async () => {},
      }),
    { message: "Trial unavailable" },
  );
});
