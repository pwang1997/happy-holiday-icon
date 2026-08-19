import assert from "node:assert/strict";
import test from "node:test";
import { getImageDownloadUrl } from "../app/lib/s3.ts";

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
