import {
  createImageJob,
  isImageHash,
} from "@/app/lib/jobs";
import { getTemporaryImageUploadUrl } from "@/app/lib/s3";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  let payload: { contentType?: unknown; imageHash?: unknown };

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (
    typeof payload.contentType !== "string" ||
    !ALLOWED_IMAGE_TYPES.has(payload.contentType)
  ) {
    return Response.json(
      { error: "Only PNG, JPG, and WEBP images are supported." },
      { status: 415 },
    );
  }

  if (typeof payload.imageHash !== "string" || !isImageHash(payload.imageHash)) {
    return Response.json({ error: "A valid image hash is required." }, { status: 400 });
  }

  try {
    const contentType = payload.contentType;
    const job = await createImageJob(contentType, payload.imageHash);
    const uploadUrl = await getTemporaryImageUploadUrl(
      job.sourceKey,
      contentType,
    );

    return Response.json(
      {
        jobId: job.jobId,
        status: job.status,
        sourceKey: job.sourceKey,
        uploadUrl,
        expiresAt: job.expiresAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Unable to create image job", error);
    return Response.json(
      { error: "Unable to create an image job." },
      { status: 503 },
    );
  }
}
