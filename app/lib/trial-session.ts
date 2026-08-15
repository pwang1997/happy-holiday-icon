export type TrialSession = {
  token: string;
};

export function getTrialSession(
  cookieValue: string | undefined,
): TrialSession | null {
  if (!cookieValue) {
    return { token: crypto.randomUUID() };
  }

  const match = cookieValue.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(\d+))?$/i,
  );

  if (!match) {
    return null;
  }

  return { token: match[1] };
}
