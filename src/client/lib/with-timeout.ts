// Promise.race-based timeout helper shared across the workspace panels.
//
// The cert / distribution / fleet / map fetches all need a ceiling so a
// wedged daemon can't trap a panel in a permanent loading spinner. We default
// to 15 s — long enough for a cold scan across the whole monorepo, short
// enough that the operator sees a retry button instead of a permanent
// "Loading…" if the daemon is hung.

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${label} took longer than ${Math.round(ms / 1000)}s — the SigmaShake daemon may be busy. Retry shortly.`,
          ),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
