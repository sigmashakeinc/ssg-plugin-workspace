// Turns an unknown thrown value into a short, plain-language message a
// non-technical user can act on. Recognized failure modes get a specific
// "what to try" line; anything unrecognized falls through to the raw message
// so genuine errors aren't hidden from the user.

export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";

  // A local-only feature was reached from the web edition of Workspace.
  if (err instanceof Error && err.name === "CapabilityError") {
    return (
      raw ||
      "This only works in the SigmaShake desktop app, or when you open Workspace from SigmaShake running on your own computer."
    );
  }

  // The SSG daemon is unreachable — fetch() rejects with a TypeError.
  if (
    err instanceof TypeError ||
    /failed to fetch|networkerror|load failed|fetch failed/i.test(raw)
  ) {
    return "Couldn't reach SigmaShake on your computer. Make sure SigmaShake is running, then try again.";
  }

  // The API clients surface HTTP failures as messages like "health: 501".
  const status = raw.match(/\b(401|403|404|429|500|501|502|503)\b/)?.[1];
  if (status === "401" || status === "403") {
    return "SigmaShake didn't accept this request. Reload the page and try again.";
  }
  if (status === "404") {
    return "That couldn't be found — the project or file may have been moved or renamed since the page loaded.";
  }
  if (status === "501") {
    return "This only works in the SigmaShake desktop app, or when you open Workspace from SigmaShake running on your own computer.";
  }
  if (status === "429") {
    return "Too many requests at once. Wait a moment, then try again.";
  }
  if (status) {
    return "SigmaShake ran into a problem handling that. Make sure it's up to date, then try again.";
  }

  // Unrecognized — show the real message rather than burying it.
  return raw || "Something went wrong. Try again, or reload the page.";
}
