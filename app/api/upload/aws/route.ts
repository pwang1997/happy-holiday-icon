import { getS3Client } from "@/app/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "Request body must be multipart form data" },
      { status: 400 },
    );
  }

  const imageValue = formData.get("image");

  if (!(imageValue instanceof File) || imageValue.size === 0) {
    return Response.json(
      { error: "An image file is required" },
      { status: 400 },
    );
  }

  if (!imageValue.type.startsWith("image/")) {
    return Response.json({ error: "Only images are allowed" }, { status: 400 });
  }

  const safeFileName = imageValue.name
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 128);

  if (!safeFileName) {
    return Response.json(
      { error: "A valid file name is required" },
      { status: 400 },
    );
  }

  const bucket = process.env.AWS_S3_BUCKET;

  if (!bucket) {
    console.error("AWS_S3_BUCKET is not configured");
    return Response.json(
      { error: "S3 upload is not configured" },
      { status: 500 },
    );
  }

  const imageBytes = await imageValue.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", imageBytes);
  const imageHash = Array.from(new Uint8Array(hashBuffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const key = `images/${imageHash}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: imageValue.type,
    });

    console.debug("DEBUG: Start uploading image to S3 bucket");

    const uploadUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: 60,
    });

    console.debug("DEBUG: Uploaded image to S3 bucket");

    return Response.json({ uploadUrl, key });
  } catch (error) {
    console.error("Failed to create S3 upload URL", error);
    return Response.json(
      { error: "Unable to create upload URL" },
      { status: 500 },
    );
  }
}
