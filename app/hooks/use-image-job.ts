"use client";

import { useCallback, useState } from "react";
import type { ImageJobStatus, ImageUrl } from "../lib/image-job-contract";
import { runImageJobWorkflow } from "../lib/image-job-workflow";

export function useImageJob() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<ImageJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<ImageUrl[] | null>(null);

  const submit = useCallback(async (formData: FormData) => {
    setIsSubmitting(true);
    setError(null);
    setStatus("UPLOADING");
    setImageUrls(null);

    try {
      setImageUrls(
        await runImageJobWorkflow(formData, {
          onStatus: setStatus,
        }),
      );
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "The icon could not be created.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return { error, imageUrls, isSubmitting, status, submit };
}
