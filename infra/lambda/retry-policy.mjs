export const MAX_GENERATION_RETRIES = 3;
export const TERMINAL_GENERATION_FAILURE = "terminal";
export const RETRYABLE_GENERATION_FAILURE = "retryable";

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429]);
const RETRYABLE_ERROR_NAMES = new Set([
  "AbortError",
  "NetworkingError",
  "RequestTimeout",
  "ServiceUnavailable",
  "SlowDown",
  "ThrottlingException",
  "TimeoutError",
  "TooManyRequestsException",
]);
const RETRYABLE_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_ABORTED",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export function terminalGenerationFailure(message) {
  const error = new Error(message);
  error.generationFailureDisposition = TERMINAL_GENERATION_FAILURE;
  return error;
}

function httpStatusFromError(error) {
  const status = error?.$metadata?.httpStatusCode ?? error?.status ?? error?.statusCode;
  return Number.isSafeInteger(status) ? status : null;
}

function errorAndCause(error) {
  const errors = [error];
  let cause = error?.cause;

  while (cause && errors.length < 3) {
    errors.push(cause);
    cause = cause.cause;
  }

  return errors;
}

export function generationFailureDisposition(error) {
  if (error?.generationFailureDisposition === TERMINAL_GENERATION_FAILURE) {
    return TERMINAL_GENERATION_FAILURE;
  }

  for (const candidate of errorAndCause(error)) {
    const status = httpStatusFromError(candidate);

    if (
      candidate?.$retryable ||
      (status !== null && (status >= 500 || RETRYABLE_HTTP_STATUSES.has(status))) ||
      RETRYABLE_ERROR_NAMES.has(candidate?.name) ||
      RETRYABLE_ERROR_CODES.has(candidate?.code) ||
      (candidate?.name === "TypeError" && candidate?.message === "fetch failed")
    ) {
      return RETRYABLE_GENERATION_FAILURE;
    }
  }

  return TERMINAL_GENERATION_FAILURE;
}

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
