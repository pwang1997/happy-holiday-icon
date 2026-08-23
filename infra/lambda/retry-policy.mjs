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

export function generationRetryClaim(
  expectedAttempt,
  expectedGenerationRetryAt,
  now,
  leaseSeconds,
) {
  if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 2) {
    throw new Error("expectedAttempt must be an integer greater than one");
  }

  if (
    !Number.isSafeInteger(expectedGenerationRetryAt) ||
    expectedGenerationRetryAt <= 0
  ) {
    throw new Error("expectedGenerationRetryAt must be a positive integer");
  }

  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative integer");
  }

  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds <= 0) {
    throw new Error("leaseSeconds must be a positive integer");
  }

  const renewedGenerationRetryAt = now + leaseSeconds;

  if (!Number.isSafeInteger(renewedGenerationRetryAt)) {
    throw new Error("renewed generation retry time must be a safe integer");
  }

  return {
    expectedGenerationRetryAt,
    previousAttempt: expectedAttempt - 1,
    renewedGenerationRetryAt,
  };
}

export function reshapingRetryClaim(
  expectedAttempt,
  expectedReshapingRetryAt,
  now,
  leaseSeconds,
) {
  if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 2) {
    throw new Error("expectedAttempt must be an integer greater than one");
  }

  if (
    !Number.isSafeInteger(expectedReshapingRetryAt) ||
    expectedReshapingRetryAt <= 0
  ) {
    throw new Error("expectedReshapingRetryAt must be a positive integer");
  }

  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("now must be a non-negative integer");
  }

  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds <= 0) {
    throw new Error("leaseSeconds must be a positive integer");
  }

  const renewedReshapingRetryAt = now + leaseSeconds;

  if (!Number.isSafeInteger(renewedReshapingRetryAt)) {
    throw new Error("renewed reshaping retry time must be a safe integer");
  }

  return {
    expectedReshapingRetryAt,
    previousAttempt: expectedAttempt - 1,
    renewedReshapingRetryAt,
  };
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
