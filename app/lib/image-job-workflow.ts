import {
  apiErrorMessage,
  isImageJobCreationResponse,
  isImageJobStatusResponse,
  type ImageJobStatus,
  type ImageUrl,
} from "./image-job-contract";

const MAX_POLL_ATTEMPTS = 600;
const POLL_INTERVAL_MS = 1_500;

type ImageJobWorkflowOptions = {
  fetchImpl?: typeof fetch;
  hashImage?: (image: File) => Promise<string>;
  onStatus: (status: ImageJobStatus) => void;
  wait?: (milliseconds: number) => Promise<void>;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function hashImage(image: File) {
  const digest = await crypto.subtle.digest("SHA-256", await image.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function runImageJobWorkflow(
  formData: FormData,
  {
    fetchImpl = fetch,
    hashImage: hash = hashImage,
    onStatus,
    wait: waitFor = wait,
  }: ImageJobWorkflowOptions,
): Promise<ImageUrl[]> {
  const image = formData.get("image");

  if (!(image instanceof File) || image.size === 0) {
    throw new Error("Please upload an image.");
  }

  const jobResponse = await fetchImpl("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentType: image.type,
      imageHash: await hash(image),
    }),
  });
  const jobData: unknown = await jobResponse.json().catch(() => null);

  if (!jobResponse.ok) {
    throw new Error(apiErrorMessage(jobData, "The icon could not be created."));
  }

  if (!isImageJobCreationResponse(jobData)) {
    throw new Error("The server returned an invalid image job.");
  }

  const uploadResponse = await fetchImpl(jobData.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": image.type },
    body: image,
  });

  if (!uploadResponse.ok) {
    throw new Error("The source image could not be uploaded.");
  }

  onStatus("GENERATING");
  const generationData = new FormData();
  generationData.set("jobId", jobData.jobId);
  generationData.set("prompt", String(formData.get("prompt") ?? ""));
  generationData.set("style", String(formData.get("style") ?? ""));
  const generationResponse = await fetchImpl("/api/submit", {
    method: "POST",
    credentials: "same-origin",
    body: generationData,
  });
  const generationResult: unknown = await generationResponse
    .json()
    .catch(() => null);

  if (!generationResponse.ok) {
    throw new Error(
      apiErrorMessage(generationResult, "The icon could not be generated."),
    );
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    onStatus("RESHAPING");
    await waitFor(POLL_INTERVAL_MS);

    const pollResponse = await fetchImpl(`/api/jobs/${jobData.jobId}`, {
      cache: "no-store",
    });
    const pollData: unknown = await pollResponse.json().catch(() => null);

    if (!pollResponse.ok || !isImageJobStatusResponse(pollData)) {
      throw new Error("The image job could not be checked.");
    }

    onStatus(pollData.status);
    if (pollData.status === "FAILED") {
      throw new Error(pollData.error ?? "Image reshaping failed.");
    }

    if (pollData.status === "READY") {
      return pollData.imageUrls;
    }
  }

  throw new Error("Image processing is taking longer than expected.");
}
