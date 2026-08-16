import { getImageJob, isExpired } from "@/app/lib/jobs";
import { getImageDownloadUrlIfExists } from "@/app/lib/s3";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  try {
    const job = await getImageJob(jobId);

    if (!job || isExpired(job)) {
      return Response.json({ error: "Image job not found." }, { status: 404 });
    }

    const derivatives =
      job.status === "READY"
        ? await Promise.all(
            job.derivativeKeys.map(async (key) => ({
              key,
              size: Number(key.match(/\/(32|48|512)\.webp$/)?.[1]),
              url: await getImageDownloadUrlIfExists(key),
            })),
          )
        : [];

    return Response.json({
      jobId: job.jobId,
      status: job.status,
      sourceKey: job.sourceKey,
      derivativeKeys: job.derivativeKeys,
      imageUrls: derivatives
        .filter(
          (derivative): derivative is { key: string; size: number; url: string } =>
            Number.isFinite(derivative.size) && derivative.url !== null,
        )
        .map(({ key, size, url }) => ({ key, size, url })),
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      expiresAt: job.expiresAt,
    });
  } catch (error) {
    console.error("Unable to read image job", error);
    return Response.json(
      { error: "Unable to read the image job." },
      { status: 503 },
    );
  }
}
