export const MAX_GENERATION_RETRIES = 3;

export function generationRetryDelaySeconds(completedAttempts, baseDelaySeconds) {
  if (!Number.isSafeInteger(completedAttempts) || completedAttempts < 1) {
    throw new Error("completedAttempts must be a positive integer");
  }

  if (!Number.isSafeInteger(baseDelaySeconds) || baseDelaySeconds < 1) {
    throw new Error("baseDelaySeconds must be a positive integer");
  }

  return Math.min(900, baseDelaySeconds * 2 ** (completedAttempts - 1));
}

export function generationRecoveryAction(
  completedAttempts,
  maxRetries,
  baseDelaySeconds,
) {
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new Error("maxRetries must be a non-negative integer");
  }

  if (completedAttempts > maxRetries) {
    return { action: "fail" };
  }

  return {
    action: "retry",
    delaySeconds: generationRetryDelaySeconds(
      completedAttempts,
      baseDelaySeconds,
    ),
  };
}
