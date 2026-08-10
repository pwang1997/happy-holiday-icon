import { getS3Client } from "@/app/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Request body is required" }, { status: 400 });
  }

  const { fileName, fileType } = body as {
    fileName?: unknown;
    fileType?: unknown;
  };

  if (typeof fileName !== "string" || fileName.trim() === "") {
    return Response.json({ error: "A file name is required" }, { status: 400 });
  }

  if (typeof fileType !== "string" || !fileType.startsWith("image/")) {
    return Response.json(
      { error: "Only images are allowed" },
      { status: 400 }
    );
  }

  const safeFileName = fileName
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 128);

  if (!safeFileName) {
    return Response.json({ error: "A valid file name is required" }, { status: 400 });
  }

  const bucket = process.env.AWS_S3_BUCKET;

  if (!bucket) {
    console.error("AWS_S3_BUCKET is not configured");
    return Response.json(
      { error: "S3 upload is not configured" },
      { status: 500 }
    );
  }
  // replace filename with image sha256 hash
  const key = `images/${crypto.randomUUID()}-${safeFileName}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: fileType,
    });

    console.debug("DEBUG: Start uploading image to S3 bucket")

    const uploadUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: 60,
    });

    console.debug("DEBUG: Uploaded image to S3 bucket")

    return Response.json({ uploadUrl, key });
  } catch (error) {
    console.error("Failed to create S3 upload URL", error);
    return Response.json(
      { error: "Unable to create upload URL" },
      { status: 500 }
    );
  }
}
