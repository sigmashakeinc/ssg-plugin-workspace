import { useEffect, useState } from "react";

// Platform parity id: theme-dark-light-follow.
//
// Tracks the OS-level `prefers-color-scheme` media query and (optionally) an
// explicit override the user has pinned. The pinned preference persists across
// reloads via localStorage; reset by setTheme("system").
//
// The hook syncs <html data-theme="..."> so the CSS variables in index.css
// resolve to the right palette without React having to re-render every
// component that uses var(--ss-bg-0). LocalStorage key matches what the SSG
// dashboard's chrome already uses so the two surfaces feel coordinated when
// embedded together.

const STORAGE_KEY = "ssg:workspace:theme";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

function readStoredPreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "dark" || raw === "light" || raw === "system") return raw;
  return "system";
}

function osPrefersLight(): boolean {
  if (typeof matchMedia === "undefined") return false;
  return matchMedia("(prefers-color-scheme: light)").matches;
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return osPrefersLight() ? "light" : "dark";
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(preference));

  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", preference);
    }
    setResolved(resolve(preference));
    if (preference === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  }, [preference]);

  useEffect(() => {
    if (preference !== "system") return;
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setResolved(resolve("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  return { preference, resolved, setPreference: setPreferenceState };
}
