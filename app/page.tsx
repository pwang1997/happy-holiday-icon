'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';
import { useImageJob } from './hooks/use-image-job';
import type { ImageJobStatus } from './lib/image-job-contract';

const STATUS_LABELS: Record<
  Exclude<ImageJobStatus, 'READY' | 'FAILED'>,
  string
> = {
  UPLOADING: 'Uploading image…',
  GENERATING: 'Generating image…',
  RESHAPING: 'Reshaping image…',
};

function Page() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const { error, imageUrls, isSubmitting, status, submit } = useImageJob();

  useEffect(() => {
    let active = true;

    fetch('/api/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null);

        if (
          active &&
          response.ok &&
          typeof data === 'object' &&
          data !== null &&
          'authenticated' in data &&
          typeof data.authenticated === 'boolean'
        ) {
          setIsAuthenticated(data.authenticated);
        }
      })
      .catch(() => {
        if (active) {
          setIsAuthenticated(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit(new FormData(event.currentTarget));
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
          <nav aria-label="Account" className="mt-5 flex gap-4 text-sm">
            {isAuthenticated ? (
              <a
                href="/api/auth/logout"
                className="font-medium text-slate-400 hover:text-slate-200"
              >
                Sign out
              </a>
            ) : (
              <a
                href="/api/auth/login"
                className="font-medium text-amber-300 hover:text-amber-200"
              >
                Sign in
              </a>
            )}
          </nav>
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

        {imageUrls && (
          <section
            aria-live="polite"
            className="mt-8 space-y-4 border-t border-white/10 pt-8"
          >
            {imageUrls.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {imageUrls.map((image) => (
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
          </section>
        )}
      </section>
    </main>
  );
}


export default Page;
