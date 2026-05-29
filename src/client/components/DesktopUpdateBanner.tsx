import { useEffect, useState } from "react";

import { detectRuntime } from "../api/client";

const DISMISS_LS_KEY = "ssg:desktop-update:dismissed-hash";

interface DesktopUpdateState {
  hash: string;
  version: string;
}

/**
 * Persistent dismissible banner that fires when the Electrobun desktop wrapper
 * posts a `desktop-update-ready` SSE event to the SSG daemon. Mirrors the
 * dashboard's DesktopUpdateBanner so the Workspace plugin surface (which is
 * the canonical rail entry inside SigmaShake Desktop) doesn't leave users
 * blind to a freshly published update — see parity entry
 * `update-available-in-app-banner`.
 *
 * Only opens an EventSource in local + plugin runtimes — the cloud and
 * vscode bundles render through different transports and have no daemon to
 * subscribe to. Dismissal is per-hash so a NEW published update re-surfaces.
 */
export function DesktopUpdateBanner() {
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [dismissedHash, setDismissedHash] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage?.getItem(DISMISS_LS_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    const runtime = detectRuntime();
    if (runtime !== "local" && runtime !== "plugin") return;

    const cfg = window.__WORKSPACE_CONFIG__;
    const port = (cfg?.port ?? Number(location.port)) || 0;
    const origin = `${location.protocol}//${location.hostname}${port ? `:${port}` : ""}`;
    const url = new URL(`${origin}/api/events`);
    if (cfg?.token) url.searchParams.set("token", cfg.token);

    let es: EventSource | null = null;
    try {
      es = new EventSource(url.toString());
      es.addEventListener("desktop-update-ready", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            hash?: unknown;
            version?: unknown;
          };
          if (
            typeof payload?.hash === "string" &&
            payload.hash.length > 0 &&
            typeof payload?.version === "string" &&
            payload.version.length > 0
          ) {
            setUpdate({ hash: payload.hash, version: payload.version });
          }
        } catch {
          // Malformed payload — ignore.
        }
      });
    } catch {
      // EventSource not supported / blocked — banner stays silent, OS toast
      // + tray row still serve as the fallback indicator.
    }
    return () => {
      es?.close();
    };
  }, []);

  useEffect(() => {
    if (!update) return;
    if (update.hash === dismissedHash) return;
    try {
      window.localStorage?.removeItem(DISMISS_LS_KEY);
    } catch {
      // localStorage unavailable — banner still renders in-memory.
    }
  }, [update, dismissedHash]);

  if (!update) return null;
  if (update.hash === dismissedHash) return null;

  const dismiss = () => {
    setDismissedHash(update.hash);
    try {
      window.localStorage?.setItem(DISMISS_LS_KEY, update.hash);
    } catch {
      // localStorage unavailable — dismissal is in-memory only.
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 1rem",
        background: "var(--accent-bg, color-mix(in oklab, #2563eb 14%, transparent))",
        color: "var(--accent-fg, inherit)",
        fontSize: "0.875rem",
        borderBottom: "1px solid var(--accent-border, rgba(37,99,235,0.3))",
      }}
    >
      <span aria-hidden="true">↑</span>
      <span style={{ flex: 1 }}>
        <strong>SigmaShake Desktop v{update.version}</strong> is downloaded — open the tray and
        choose <strong>Restart to apply</strong>.
      </span>
      <button
        type="button"
        aria-label="Dismiss update banner"
        onClick={dismiss}
        style={{
          background: "transparent",
          color: "inherit",
          border: "none",
          padding: "0.25rem 0.5rem",
          cursor: "pointer",
          fontSize: "1rem",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
