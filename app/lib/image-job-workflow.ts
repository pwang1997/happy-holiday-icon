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
  onStatus: (status: ImageJobStatus) => void;
  wait?: (milliseconds: number) => Promise<void>;
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function runImageJobWorkflow(
  formData: FormData,
  {
    fetchImpl = fetch,
    onStatus,
    wait: waitFor = wait,
  }: ImageJobWorkflowOptions,
): Promise<ImageUrl[]> {
  const image = formData.get("image");

  if (!(image instanceof File) || image.size === 0) {
    throw new Error("Please upload an image.");
  }

  onStatus("UPLOADING");
  const jobResponse = await fetchImpl("/api/submit", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentType: image.type,
      prompt: String(formData.get("prompt") ?? ""),
      style: String(formData.get("style") ?? ""),
    }),
  });
  const jobData: unknown = await jobResponse.json().catch(() => null);

  if (!jobResponse.ok) {
    throw new Error(apiErrorMessage(jobData, "The icon could not be created."));
  }

  if (!isImageJobCreationResponse(jobData)) {
    throw new Error("The server returned an invalid image job.");
  }

  if (image.size > jobData.upload.maxBytes) {
    throw new Error(
      `The source image must be ${Math.floor(jobData.upload.maxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }

  const uploadFormData = new FormData();

  for (const [name, value] of Object.entries(jobData.upload.fields)) {
    uploadFormData.append(name, value);
  }

  uploadFormData.append("file", image);
  const uploadResponse = await fetchImpl(jobData.upload.url, {
    method: "POST",
    body: uploadFormData,
  });

  if (!uploadResponse.ok) {
    throw new Error("The source image could not be uploaded.");
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
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
