// Shared localStorage adapter for WorkspaceSettings. Every runtime
// (cloud, local, vscode, plugin) reads from here so the user's mode choice
// is stable across reloads even when the daemon route is unavailable. The
// local + plugin clients additionally sync to the SSG daemon's
// `~/.sigmashake/workspace.json` — this module only knows the browser side.

import { normalizeLineOverrides } from "../lib/project-lines";
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from "./types";

export const SETTINGS_LS_KEY = "ssg:workspace:settings:v1";

function isValidMode(value: unknown): value is WorkspaceSettings["mode"] {
  return value === "stack" || value === "services" || value === "hybrid";
}

/**
 * Merge an unknown payload into a fully-shaped WorkspaceSettings. Unknown
 * keys are ignored; missing keys fall back to the default. settingsVersion
 * is normalised forward so a stale browser bundle that wrote `0` doesn't
 * stick around.
 */
// Lowercase-letters / digits / dashes, 2-40 chars — matches Fleet's org slug
// validation in routes/auth-device.ts.
const FLEET_SLUG_RE = /^[a-z0-9-]{2,40}$/;

function isValidFleetSlug(value: unknown): value is string {
  return typeof value === "string" && (value === "" || FLEET_SLUG_RE.test(value));
}

export function normalizeSettings(raw: unknown): WorkspaceSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WORKSPACE_SETTINGS };
  const r = raw as Partial<WorkspaceSettings>;
  return {
    settingsVersion: 1,
    mode: isValidMode(r.mode) ? r.mode : DEFAULT_WORKSPACE_SETTINGS.mode,
    onboarded:
      typeof r.onboarded === "boolean" ? r.onboarded : DEFAULT_WORKSPACE_SETTINGS.onboarded,
    fleetOrgSlug: isValidFleetSlug(r.fleetOrgSlug)
      ? r.fleetOrgSlug
      : DEFAULT_WORKSPACE_SETTINGS.fleetOrgSlug,
    lineOverrides: normalizeLineOverrides(r.lineOverrides),
    updatedAt:
      typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt)
        ? r.updatedAt
        : DEFAULT_WORKSPACE_SETTINGS.updatedAt,
  };
}

export function readLocalSettings(): WorkspaceSettings {
  if (typeof window === "undefined") return { ...DEFAULT_WORKSPACE_SETTINGS };
  try {
    const raw = window.localStorage?.getItem(SETTINGS_LS_KEY);
    if (!raw) return { ...DEFAULT_WORKSPACE_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_WORKSPACE_SETTINGS };
  }
}

export function writeLocalSettings(s: WorkspaceSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(SETTINGS_LS_KEY, JSON.stringify(s));
  } catch {
    // private-mode / quota — silently fall back to in-memory only
  }
}

export function mergeSettings(
  base: WorkspaceSettings,
  patch: Partial<WorkspaceSettings>,
): WorkspaceSettings {
  return normalizeSettings({ ...base, ...patch, updatedAt: Date.now() });
}
