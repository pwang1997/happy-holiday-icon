import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3 = new S3Client({});
const OUTPUT_SIZES = [32, 48, 512];

function decodeS3Key(key) {
  return decodeURIComponent(key.replace(/\+/g, " "));
}

async function bodyToBuffer(body) {
  if (!body) {
    throw new Error("S3 returned an empty object body");
  }

  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }

  const chunks = [];

  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function outputKey(sourceKey, size) {
  const fileName = sourceKey.split("/").pop() || "image";
  const baseName = fileName.replace(/\.[^/.]+$/, "") || "image";

  return `images/${baseName}/${size}.webp`;
}

async function processRecord(record, destinationBucket) {
  const sourceBucket = record.s3?.bucket?.name;
  const encodedKey = record.s3?.object?.key;

  if (!sourceBucket || !encodedKey) {
    throw new Error("S3 event record does not contain a bucket and object key");
  }

  if (sourceBucket !== process.env.SOURCE_BUCKET) {
    console.warn("Skipping an object from an unexpected source bucket", {
      sourceBucket,
      key: encodedKey,
    });
    return { key: encodedKey, skipped: true, reason: "unexpected-source" };
  }

  const sourceKey = decodeS3Key(encodedKey);

  if (!sourceKey.startsWith("images/")) {
    console.info("Skipping an object outside the image prefix", { sourceKey });
    return { key: sourceKey, skipped: true, reason: "outside-image-prefix" };
  }

  const object = await s3.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: sourceKey,
    }),
  );
  const input = await bodyToBuffer(object.Body);
  const metadata = await sharp(input).rotate().metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const eligibleSizes = OUTPUT_SIZES.filter(
    (size) => width >= size && height >= size,
  );

  if (eligibleSizes.length === 0) {
    console.info("Skipping an image smaller than every output size", {
      sourceKey,
      width,
      height,
    });
    return {
      key: sourceKey,
      skipped: true,
      reason: "smaller-than-all-output-sizes",
      width,
      height,
    };
  }

  const outputs = await Promise.all(
    eligibleSizes.map(async (size) => {
      const body = await sharp(input)
        .rotate()
        .resize(size, size, {
          fit: "cover",
          position: "centre",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
      const key = outputKey(sourceKey, size);

      await s3.send(
        new PutObjectCommand({
          Bucket: destinationBucket,
          Key: key,
          Body: body,
          ContentType: "image/webp",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );

      return { key, size, bytes: body.length };
    }),
  );

  console.info("Created image derivatives", {
    sourceKey,
    width,
    height,
    outputs,
  });

  return { key: sourceKey, outputs };
}

export async function handler(event) {
  const destinationBucket = process.env.DESTINATION_BUCKET;

  if (!process.env.SOURCE_BUCKET || !destinationBucket) {
    throw new Error(
      "SOURCE_BUCKET and DESTINATION_BUCKET environment variables are required",
    );
  }

  const results = [];

  for (const record of event.Records ?? []) {
    results.push(await processRecord(record, destinationBucket));
  }

  return { results };
}
