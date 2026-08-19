import assert from "node:assert/strict";
import test from "node:test";
import {
  getImageDownloadUrl,
  getTemporaryImageUploadPost,
} from "../app/lib/s3.ts";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function decodePostPolicy(fields) {
  return JSON.parse(Buffer.from(fields.Policy, "base64").toString("utf8"));
}

test("signs attachment disposition and filename into image downloads", async () => {
  const environment = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_REGION: process.env.AWS_REGION,
    AWS_S3_FINAL_BUCKET: process.env.AWS_S3_FINAL_BUCKET,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  };

  process.env.AWS_ACCESS_KEY_ID = "test-access-key";
  process.env.AWS_REGION = "ca-central-1";
  process.env.AWS_S3_FINAL_BUCKET = "test-final-images";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";

  try {
    const signedUrl = await getImageDownloadUrl(
      "images/job-123-holiday-icon/32.webp",
      { fileName: "happy-holiday-icon-32px.webp" },
    );
    const url = new URL(signedUrl);

    assert.equal(
      url.searchParams.get("response-content-disposition"),
      'attachment; filename="happy-holiday-icon-32px.webp"',
    );
  } finally {
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test("creates an exact, size-limited source upload POST", async () => {
  const environment = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_REGION: process.env.AWS_REGION,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    IMAGE_MAX_UPLOAD_BYTES: process.env.IMAGE_MAX_UPLOAD_BYTES,
  };

  process.env.AWS_ACCESS_KEY_ID = "test-access-key";
  process.env.AWS_REGION = "ca-central-1";
  process.env.AWS_S3_BUCKET = "test-images";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.IMAGE_MAX_UPLOAD_BYTES = String(MAX_UPLOAD_BYTES);

  try {
    const upload = await getTemporaryImageUploadPost(
      "uploads/job-123/source.png",
      "image/png",
    );
    const policy = decodePostPolicy(upload.fields);

    assert.equal(upload.maxBytes, MAX_UPLOAD_BYTES);
    assert.equal(upload.fields.key, "uploads/job-123/source.png");
    assert.equal(upload.fields["Content-Type"], "image/png");
    assert.ok(
      policy.conditions.some(
        (condition) =>
          typeof condition === "object" &&
          condition !== null &&
          !Array.isArray(condition) &&
          condition["Content-Type"] === "image/png",
      ),
    );
    assert.ok(
      policy.conditions.some(
        (condition) =>
          Array.isArray(condition) &&
          condition[0] === "content-length-range" &&
          condition[1] === 1 &&
          condition[2] === MAX_UPLOAD_BYTES,
      ),
    );
  } finally {
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});
