export type TrialSession = {
  token: string;
  count: number;
};

export function getTrialSession(
  cookieValue: string | undefined,
): TrialSession | null {
  if (!cookieValue) {
    return { token: crypto.randomUUID(), count: 0 };
  }

  const match = cookieValue.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(\d+))?$/i,
  );

  if (!match) {
    return null;
  }

  const count = match[2] === undefined ? 0 : Number(match[2]);

  return Number.isSafeInteger(count) ? { token: match[1], count } : null;
}
