'use client';

import Image from 'next/image';
import { useState, type FormEvent } from 'react';

type SubmitResponse = {
  imageUrls: Array<{
    size: number;
    key: string;
    url: string;
  }>;
  revisedPrompt: string | null;
};

type ImageUrlsResponse = Pick<SubmitResponse, 'imageUrls'>;

type JobStatus =
  | 'UPLOADING'
  | 'GENERATING'
  | 'RESHAPING'
  | 'READY'
  | 'FAILED';

type JobCreateResponse = {
  jobId: string;
  status: 'UPLOADING';
  uploadUrl: string;
};

type JobResponse = ImageUrlsResponse & {
  jobId: string;
  status: JobStatus;
  error: string | null;
};

const STATUS_LABELS: Record<Exclude<JobStatus, 'READY' | 'FAILED'>, string> = {
  UPLOADING: 'Uploading image…',
  GENERATING: 'Generating image…',
  RESHAPING: 'Reshaping image…',
};

function isSubmitResponse(value: unknown): value is SubmitResponse {
  if (!isImageUrlsResponse(value)) {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    response.revisedPrompt === null || typeof response.revisedPrompt === 'string'
  );
}

function isImageUrlsResponse(value: unknown): value is ImageUrlsResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;
  const imageUrls = response.imageUrls;

  return (
    Array.isArray(imageUrls) &&
    imageUrls.every(
      (image) =>
        typeof image === 'object' &&
        image !== null &&
        'size' in image &&
        typeof image.size === 'number' &&
        'key' in image &&
        typeof image.key === 'string' &&
        'url' in image &&
        typeof image.url === 'string',
    )
  );
}

function isJobCreateResponse(value: unknown): value is JobCreateResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jobId' in value &&
    typeof value.jobId === 'string' &&
    'status' in value &&
    value.status === 'UPLOADING' &&
    'uploadUrl' in value &&
    typeof value.uploadUrl === 'string'
  );
}

function isJobResponse(value: unknown): value is JobResponse {
  return (
    isImageUrlsResponse(value) &&
    'jobId' in value &&
    typeof value.jobId === 'string' &&
    'status' in value &&
    typeof value.status === 'string' &&
    ['UPLOADING', 'GENERATING', 'RESHAPING', 'READY', 'FAILED'].includes(
      value.status,
    ) &&
    'error' in value &&
    (value.error === null || typeof value.error === 'string')
  );
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getImageHash(image: File) {
  const digest = await crypto.subtle.digest('SHA-256', await image.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export default function Home() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResponse | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setStatus('UPLOADING');
    setResult(null);

    try {
      const formData = new FormData(event.currentTarget);
      const image = formData.get('image');

      if (!(image instanceof File) || image.size === 0) {
        throw new Error('Please upload an image.');
      }

      const jobResponse = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType: image.type,
          imageHash: await getImageHash(image),
        }),
      });
      const jobData: unknown = await jobResponse.json().catch(() => null);

      if (!jobResponse.ok) {
        const message =
          typeof jobData === 'object' &&
            jobData !== null &&
            'error' in jobData &&
            typeof jobData.error === 'string'
            ? jobData.error
            : 'The icon could not be created.';

        throw new Error(message);
      }

      if (!isJobCreateResponse(jobData)) {
        throw new Error('The server returned an invalid image job.');
      }

      const uploadResponse = await fetch(jobData.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': image.type },
        body: image,
      });

      if (!uploadResponse.ok) {
        throw new Error('The source image could not be uploaded.');
      }

      setStatus('GENERATING');
      const generationData = new FormData();
      generationData.set('jobId', jobData.jobId);
      generationData.set('prompt', String(formData.get('prompt') ?? ''));
      generationData.set('style', String(formData.get('style') ?? ''));
      const generationResponse = await fetch('/api/submit', {
        method: 'POST',
        credentials: 'same-origin',
        body: generationData,
      });
      const generationResult: unknown = await generationResponse
        .json()
        .catch(() => null);

      if (!generationResponse.ok) {
        const message =
          typeof generationResult === 'object' &&
            generationResult !== null &&
            'error' in generationResult &&
            typeof generationResult.error === 'string'
            ? generationResult.error
            : 'The icon could not be generated.';

        throw new Error(message);
      }

      const revisedPrompt =
        typeof generationResult === 'object' &&
        generationResult !== null &&
        'revisedPrompt' in generationResult &&
        typeof generationResult.revisedPrompt === 'string'
          ? generationResult.revisedPrompt
          : null;

      for (let attempt = 0; attempt < 600; attempt += 1) {
        setStatus('RESHAPING');
        await wait(1_500);

        const pollResponse = await fetch(`/api/jobs/${jobData.jobId}`, {
          cache: 'no-store',
        });
        const pollData: unknown = await pollResponse.json().catch(() => null);

        if (!pollResponse.ok || !isJobResponse(pollData)) {
          throw new Error('The image job could not be checked.');
        }

        setStatus(pollData.status);

        if (pollData.status === 'FAILED') {
          throw new Error(pollData.error ?? 'Image reshaping failed.');
        }

        if (pollData.status === 'READY') {
          setResult({
            imageUrls: pollData.imageUrls,
            revisedPrompt,
          });
          return;
        }
      }

      throw new Error('Image processing is taking longer than expected.');
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'The icon could not be created.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12 text-slate-100 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-rose-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-amber-300/15 blur-3xl"
      />

      <section className="relative w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
            Happy Holiday Icon
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Create something merry.
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-300 sm:text-base">
            Upload an image, add a little direction, and choose a style for your
            holiday icon.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          encType="multipart/form-data"
          className="mt-8 space-y-6"
        >
          <div>
            <label
              htmlFor="image"
              className="block text-sm font-medium text-slate-100"
            >
              Upload an image
            </label>
            <div className="mt-2 rounded-2xl border border-dashed border-white/20 bg-slate-900/40 p-4 transition-colors focus-within:border-amber-300/70">
              <input
                id="image"
                name="image"
                type="file"
                accept="image/*"
                required
                className="block w-full cursor-pointer text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-amber-300 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-950 file:transition-colors hover:file:bg-amber-200 focus:outline-none"
              />
              <p className="mt-3 text-xs text-slate-400">
                PNG, JPG, or WEBP image files.
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="prompt"
              className="block text-sm font-medium text-slate-100"
            >
              What should we make?
            </label>
            <input
              id="prompt"
              name="prompt"
              type="text"
              placeholder="A cheerful snowman with a red scarf"
              required
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 transition focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
            />
          </div>

          <div>
            <label
              htmlFor="style"
              className="block text-sm font-medium text-slate-100"
            >
              Choose a style
            </label>
            <select
              id="style"
              name="style"
              defaultValue="playful"
              className="mt-2 block w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20"
            >
              <option value="playful">Playful illustration</option>
              <option value="minimal">Minimal and clean</option>
              <option value="vintage">Vintage postcard</option>
              <option value="festive">Bright and festive</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting && status && status !== 'READY' && status !== 'FAILED'
              ? STATUS_LABELS[status]
              : 'Create icon'}
            <span aria-hidden="true">{isSubmitting ? '⋯' : '→'}</span>
          </button>

          {isSubmitting && status && status !== 'READY' && status !== 'FAILED' && (
            <p aria-live="polite" className="text-center text-sm text-slate-300">
              {STATUS_LABELS[status]}
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
        </form>

        {result && (
          <section
            aria-live="polite"
            className="mt-8 space-y-4 border-t border-white/10 pt-8"
          >
            {result.imageUrls.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {result.imageUrls.map((image) => (
                  <div key={image.size} className="space-y-3">
                    <div className={`overflow-hidden rounded-2xl`}>
                      <Image
                        src={image.url}
                        alt={`${image.size}px generated holiday icon`}
                        width={image.size}
                        height={image.size}
                        unoptimized
                        className="w-auto"
                      />
                    </div>
                    <a
                      href={image.url}
                      download={`happy-holiday-icon-${image.size}.webp`}
                      className="inline-flex rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-amber-300 hover:text-amber-200"
                    >
                      Download {image.size}px
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                The generated image is too small for the available icon sizes.
              </p>
            )}
            {result.revisedPrompt && (
              <p className="text-xs leading-5 text-slate-400">
                Generated with: {result.revisedPrompt}
              </p>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
