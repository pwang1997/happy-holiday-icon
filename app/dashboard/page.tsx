"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  apiErrorMessage,
  isImageJobListResponse,
  isImageJobStatusResponse,
  type ImageJobStatus,
  type ImageJobStatusResponse,
  type ImageJobSummary,
} from "../lib/image-job-contract";

const STATUS_LABELS: Record<ImageJobStatus, string> = {
  UPLOADING: "Uploading",
  GENERATING: "Generating",
  RESHAPING: "Preparing icons",
  READY: "Ready",
  FAILED: "Failed",
};

const STATUS_STYLES: Record<ImageJobStatus, string> = {
  UPLOADING: "bg-sky-400/15 text-sky-200 ring-sky-300/30",
  GENERATING: "bg-violet-400/15 text-violet-200 ring-violet-300/30",
  RESHAPING: "bg-amber-300/15 text-amber-200 ring-amber-300/30",
  READY: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30",
  FAILED: "bg-rose-400/15 text-rose-200 ring-rose-300/30",
};

type RunDetails =
  | { kind: "loading" }
  | { kind: "ready"; run: ImageJobStatusResponse }
  | { kind: "error"; message: string };

function formatRunTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

function DashboardPage() {
  const [runs, setRuns] = useState<ImageJobSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSignedIn, setIsSignedIn] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, RunDetails>>({});

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/jobs", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data: unknown = await response.json().catch(() => null);

      if (response.status === 401) {
        setIsSignedIn(false);
        setRuns([]);
        return;
      }

      if (!response.ok || !isImageJobListResponse(data)) {
        throw new Error(apiErrorMessage(data, "Unable to load your runs."));
      }

      setIsSignedIn(true);
      setRuns(data.jobs);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to load your runs.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const loadRunDetails = useCallback(async (runId: string) => {
    setRunDetails((current) => ({ ...current, [runId]: { kind: "loading" } }));

    try {
      const response = await fetch(`/api/jobs/${runId}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok || !isImageJobStatusResponse(data)) {
        throw new Error(apiErrorMessage(data, "Unable to load this run's icons."));
      }

      setRunDetails((current) => ({
        ...current,
        [runId]: { kind: "ready", run: data },
      }));
    } catch (error) {
      setRunDetails((current) => ({
        ...current,
        [runId]: {
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load this run's icons.",
        },
      }));
    }
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 sm:py-12">
      <div
        aria-hidden="true"
        className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-rose-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-amber-300/15 blur-3xl"
      />

      <section className="relative mx-auto w-full max-w-4xl rounded-3xl border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-10">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-7 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-300">
              Happy Holiday Icon
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Your runs
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
              Check progress and open a completed status to download its icons.
            </p>
          </div>
          <nav aria-label="Account" className="flex shrink-0 gap-4 text-sm">
            <Link
              href="/"
              className="font-medium text-amber-300 transition hover:text-amber-200"
            >
              Create an icon
            </Link>
            <a
              href="/api/auth/logout"
              className="font-medium text-slate-400 transition hover:text-slate-200"
            >
              Sign out
            </a>
          </nav>
        </header>

        {!isLoading && !isSignedIn && (
          <section className="py-16 text-center">
            <h2 className="text-xl font-semibold text-white">Sign in to see your runs</h2>
            <p className="mt-3 text-sm text-slate-300">
              Your icon history is available only to the account that created it.
            </p>
            <a
              href="/api/auth/login"
              className="mt-6 inline-flex rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-200"
            >
              Sign in
            </a>
          </section>
        )}

        {isLoading && (
          <p aria-live="polite" className="py-16 text-center text-sm text-slate-300">
            Loading your runs…
          </p>
        )}

        {loadError && !isLoading && (
          <section className="py-16 text-center">
            <p role="alert" className="text-sm text-rose-300">
              {loadError}
            </p>
            <button
              type="button"
              onClick={() => void loadRuns()}
              className="mt-5 rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-amber-300 hover:text-amber-200"
            >
              Try again
            </button>
          </section>
        )}

        {!isLoading && isSignedIn && !loadError && runs.length === 0 && (
          <section className="py-16 text-center">
            <h2 className="text-xl font-semibold text-white">No runs yet</h2>
            <p className="mt-3 text-sm text-slate-300">
              Create an icon and it will appear here while it is available.
            </p>
          </section>
        )}

        {!isLoading && isSignedIn && !loadError && runs.length > 0 && (
          <section className="pt-7" aria-labelledby="run-count">
            <h2 id="run-count" className="text-sm font-medium text-slate-300">
              {runs.length} {runs.length === 1 ? "run" : "runs"}
            </h2>
            <div className="mt-4 space-y-3">
              {runs.map((run) => {
                const details = runDetails[run.jobId];

                return (
                  <details
                    key={run.jobId}
                    className="group overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40"
                    onToggle={(event) => {
                      if (
                        event.currentTarget.open &&
                        run.status === "READY" &&
                        !details
                      ) {
                        void loadRunDetails(run.jobId);
                      }
                    }}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 sm:p-5">
                      <div>
                        <p className="text-sm font-medium text-white">
                          Run from {formatRunTime(run.createdAt)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Updated {formatRunTime(run.updatedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[run.status]}`}
                        >
                          {STATUS_LABELS[run.status]}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-lg text-slate-400 transition-transform group-open:rotate-180"
                        >
                          ⌄
                        </span>
                      </div>
                    </summary>

                    <div className="border-t border-white/10 px-4 py-5 sm:px-5">
                      {run.status !== "READY" && run.status !== "FAILED" && (
                        <p className="text-sm text-slate-300">
                          This run is still {STATUS_LABELS[run.status].toLowerCase()}.
                        </p>
                      )}

                      {run.status === "FAILED" && (
                        <p role="alert" className="text-sm text-rose-300">
                          {run.error ?? "This run could not be completed."}
                        </p>
                      )}

                      {run.status === "READY" && details?.kind === "loading" && (
                        <p aria-live="polite" className="text-sm text-slate-300">
                          Loading icon downloads…
                        </p>
                      )}

                      {run.status === "READY" && details?.kind === "error" && (
                        <p role="alert" className="text-sm text-rose-300">
                          {details.message}
                        </p>
                      )}

                      {run.status === "READY" && details?.kind === "ready" && (
                        <>
                          {details.run.imageUrls.length > 0 ? (
                            <div className="grid gap-4 sm:grid-cols-3">
                              {details.run.imageUrls.map((image) => (
                                <article
                                  key={image.key}
                                  className="rounded-xl border border-white/10 bg-slate-950/50 p-3"
                                >
                                  <Image
                                    src={image.url}
                                    alt={`${image.size}px generated holiday icon`}
                                    width={image.size}
                                    height={image.size}
                                    unoptimized
                                    className="mx-auto aspect-square max-h-36 w-auto rounded-lg object-contain"
                                  />
                                  <a
                                    href={image.url}
                                    download={`happy-holiday-icon-${image.size}px.webp`}
                                    className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-amber-300 hover:text-amber-200"
                                  >
                                    Download {image.size}px
                                  </a>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-300">
                              This run completed without icons large enough for the available sizes.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

export default DashboardPage;
