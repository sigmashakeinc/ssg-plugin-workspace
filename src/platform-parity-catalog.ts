// Canonical desktop feature parity catalog. Lists every SigmaShake Desktop
// (Electrobun) capability that has to behave the same way on Linux + macOS +
// Windows. The SSG daemon's parity handler reads this catalog, resolves each
// entry against this host (auto-probes where it can, otherwise carries the
// last persisted result), and emits a feature × OS matrix the UI renders as a
// checklist.
//
// Identity rules — never change a feature's `id` after it ships. Persisted
// results key off the id. Add new entries to the end of each category. To
// retire a feature, mark `severity: "recommended"` and `expectedFor: "all"`
// with a note in `description`.

import type {
  PlatformParityCategory,
  PlatformParityExpectedFor,
  PlatformParitySeverity,
} from "./types";

export interface PlatformParityCatalogEntry {
  id: string;
  label: string;
  category: PlatformParityCategory;
  description: string;
  severity: PlatformParitySeverity;
  expectedFor: PlatformParityExpectedFor;
  verification: {
    linux: string;
    darwin: string;
    win32: string;
  };
  verificationKind: "auto" | "manual";
}

export const PLATFORM_PARITY_CATALOG: readonly PlatformParityCatalogEntry[] = [
  // ── integration ──────────────────────────────────────────────────────────
  {
    id: "taskbar-dock-presence",
    label: "Taskbar / Dock presence",
    category: "integration",
    description:
      "App appears in the OS task switcher with its real name and icon, and clicking the taskbar/dock entry focuses the window instead of opening a new one.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux:
        "Launch the app, confirm an entry in the GNOME/KDE taskbar with the SigmaShake icon, then switch to another window and click the taskbar entry — the original window should focus.",
      darwin:
        "Launch the app, confirm an entry in the macOS Dock with the SigmaShake icon, Cmd+Tab to another app, then click the Dock icon — the original window should focus.",
      win32:
        "Launch the app, confirm an entry in the Windows taskbar with the SigmaShake icon, switch to another window via Alt+Tab, then click the taskbar entry — the original window should focus.",
    },
  },
  {
    id: "app-icon-resource",
    label: "App icon resource loads",
    category: "integration",
    description:
      "The window, taskbar/dock, and Alt+Tab/Cmd+Tab switcher all show the SigmaShake icon at the correct resolution for the current DPI — no generic-app placeholder.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Verify a 512×512 PNG icon is bundled and the .desktop file references it; no placeholder square in GNOME activities.",
      darwin:
        "Verify the .icns asset is present in the .app bundle's Resources/ dir and Info.plist's CFBundleIconFile points at it.",
      win32:
        "Verify the .ico (multi-resolution) icon is bundled and visible in Explorer / Alt+Tab.",
    },
  },
  {
    id: "system-tray-menu",
    label: "System tray / menu bar icon",
    category: "integration",
    description:
      "A status icon lives in the system tray (Linux/Windows) or menu bar (macOS) and exposes quick actions (Open Workspace, Open Audit, Quit).",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux:
        "On GNOME with the AppIndicator extension, or KDE, confirm the tray icon and right-click to see the menu.",
      darwin:
        "Confirm the menu bar icon at top-right; clicking it should reveal the menu.",
      win32:
        "Confirm the icon in the system tray notification area; right-click for the menu.",
    },
  },
  {
    id: "deep-link-scheme",
    label: "Deep link (sigmashake://) handler",
    category: "integration",
    description:
      "Custom `sigmashake://...` URL scheme is registered with the OS so links from the browser, terminal, or other apps open in the desktop window.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Run `xdg-mime query default x-scheme-handler/sigmashake` — should print the SigmaShake .desktop file.",
      darwin:
        "Check Info.plist for CFBundleURLSchemes containing `sigmashake`, then test with `open sigmashake://workspace`.",
      win32:
        "Check the HKCU\\Software\\Classes\\sigmashake registry key for the URL Protocol handler.",
    },
  },
  {
    id: "file-association-rules",
    label: "`.rules` file association",
    category: "integration",
    description:
      "Double-clicking a `.rules` file in the OS file browser opens it in SigmaShake (or offers to).",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Right-click a .rules file → Open With… and confirm SigmaShake is listed.",
      darwin: "Right-click a .rules file → Open With and confirm SigmaShake is listed.",
      win32: "Right-click a .rules file → Open With → Choose another app, confirm SigmaShake.",
    },
  },
  {
    id: "single-instance-lock",
    label: "Single-instance enforcement",
    category: "integration",
    description:
      "Launching the app a second time focuses the existing window instead of opening a second one (and forwards the deep-link / file argument).",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Launch the app twice from the terminal; second invocation should foreground the first.",
      darwin:
        "`open -n` should not produce a second window; without -n, macOS already enforces single-instance.",
      win32: "Run the .exe twice from the Start menu; second invocation should foreground the first.",
    },
  },
  {
    id: "auto-update-channel",
    label: "Auto-update channel reachable",
    category: "integration",
    description:
      "The Electrobun update worker can reach the R2 / Releases manifest, fetch a delta patch, verify the signature, and apply it on next restart.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Trigger an update check from Settings; the daemon logs a successful manifest fetch and version comparison.",
      darwin:
        "Trigger an update check from Settings; the daemon logs a successful manifest fetch and version comparison.",
      win32:
        "Trigger an update check from Settings; the daemon logs a successful manifest fetch and version comparison.",
    },
  },
  {
    id: "launch-at-login",
    label: "Launch at login toggle",
    category: "integration",
    description:
      "The 'Open at login' setting registers the app with the OS so it auto-starts when the user logs in.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Toggle on, log out / back in, confirm SigmaShake is running.",
      darwin: "Toggle on, check System Settings → Login Items for SigmaShake.",
      win32: "Toggle on, check Task Manager → Startup tab for SigmaShake.",
    },
  },

  // ── files ────────────────────────────────────────────────────────────────
  {
    id: "home-dir-resolution",
    label: "HOME / USERPROFILE resolves",
    category: "files",
    description:
      "The app resolves the user's home directory correctly and `~/.sigmashake/` is writable.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "process.env.HOME points at /home/<user>; ~/.sigmashake/ exists and is writable.",
      darwin: "process.env.HOME points at /Users/<user>; ~/.sigmashake/ exists and is writable.",
      win32:
        "process.env.USERPROFILE points at C:\\Users\\<user>; %USERPROFILE%\\.sigmashake\\ exists and is writable.",
    },
  },
  {
    id: "app-data-dir",
    label: "Per-OS app-data directory",
    category: "files",
    description:
      "The OS-canonical app-data directory is reachable: `~/.config/sigmashake` on Linux, `~/Library/Application Support/SigmaShake` on macOS, `%AppData%\\SigmaShake` on Windows.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "Stat $XDG_CONFIG_HOME/sigmashake or ~/.config/sigmashake — directory exists.",
      darwin: "Stat ~/Library/Application Support/SigmaShake — directory exists.",
      win32: "Stat %AppData%\\SigmaShake — directory exists.",
    },
  },
  {
    id: "temp-dir-writable",
    label: "OS temp directory writable",
    category: "files",
    description:
      "os.tmpdir() resolves to a writable path so update staging, audit log spooling, and pickle exports succeed.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "fs.writeFileSync(`${tmpdir()}/ssg-parity-probe`, '') succeeds.",
      darwin: "fs.writeFileSync(`${tmpdir()}/ssg-parity-probe`, '') succeeds.",
      win32: "fs.writeFileSync(`${tmpdir()}/ssg-parity-probe`, '') succeeds (`%TEMP%`).",
    },
  },
  {
    id: "native-folder-picker",
    label: "Native folder picker dialog",
    category: "files",
    description:
      "Pressing 'Browse…' in the topbar opens the OS-native folder chooser and returns the selected path to the React app.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux:
        "Click Browse — the GTK or KDE folder chooser opens; selecting a folder updates the Root input.",
      darwin: "Click Browse — the macOS open-panel opens; selecting a folder updates the Root input.",
      win32:
        "Click Browse — the Windows IFileOpenDialog opens; selecting a folder updates the Root input.",
    },
  },
  {
    id: "drag-drop-files",
    label: "Drag-and-drop targets",
    category: "files",
    description:
      "Dragging a folder onto the window applies it as the workspace root; dragging a `.rules` file opens the rule editor.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Drag a folder from Nautilus/Dolphin onto the window — Root applies.",
      darwin: "Drag a folder from Finder onto the window — Root applies.",
      win32: "Drag a folder from Explorer onto the window — Root applies.",
    },
  },
  {
    id: "file-watcher-fsnotify",
    label: "Filesystem watcher fires events",
    category: "files",
    description:
      "Changes to a `.rules` file under the workspace root produce an event the UI sees (rules table auto-refreshes).",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Edit a .rules file in the terminal — the UI updates within ~1 s (inotify).",
      darwin: "Edit a .rules file in the terminal — the UI updates within ~1 s (FSEvents).",
      win32: "Edit a .rules file in Notepad — the UI updates within ~1 s (ReadDirectoryChangesW).",
    },
  },
  {
    id: "path-separator-normalization",
    label: "Path separator normalization",
    category: "files",
    description:
      "Mixed `/` and `\\` paths are normalized so a project rooted via the picker on Windows matches one typed with forward slashes.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "path.normalize() round-trips POSIX paths unchanged.",
      darwin: "path.normalize() round-trips POSIX paths unchanged.",
      win32: "path.normalize() converts `/` to `\\` for Windows paths without losing components.",
    },
  },
  {
    id: "long-path-support",
    label: "Long path support",
    category: "files",
    description:
      "Paths >260 characters work — required for deep node_modules trees on Windows.",
    severity: "recommended",
    expectedFor: "win32",
    verificationKind: "manual",
    verification: {
      linux: "Not applicable — POSIX paths have no 260-char limit.",
      darwin: "Not applicable — POSIX paths have no 260-char limit.",
      win32:
        "Confirm `\\\\?\\` long-path manifest set on the .exe and `LongPathsEnabled` is on in HKLM.",
    },
  },
  {
    id: "symlink-handling",
    label: "Symlink handling parity",
    category: "files",
    description:
      "Symlinks under the workspace root resolve identically across OS — either followed everywhere or skipped everywhere, never silently divergent.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Symlink a project subdir; confirm project list either includes or excludes it.",
      darwin: "Symlink a project subdir; confirm project list either includes or excludes it.",
      win32:
        "Junction-link a project subdir; confirm project list either includes or excludes it.",
    },
  },

  // ── ui ───────────────────────────────────────────────────────────────────
  {
    id: "window-controls-native",
    label: "Native window controls",
    category: "ui",
    description:
      "Min/maximize/close controls render in the OS-native style and position (left on macOS, right on Linux/Windows).",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Confirm controls on the right edge of the titlebar in GNOME/KDE.",
      darwin: "Confirm the red/yellow/green traffic lights on the top-left.",
      win32: "Confirm minimize/maximize/close on the top-right of the titlebar.",
    },
  },
  {
    id: "traffic-light-position-mac",
    label: "macOS traffic-light position",
    category: "ui",
    description:
      "The custom titlebar doesn't overlap or hide the macOS traffic lights — they remain clickable.",
    severity: "blocking",
    expectedFor: "darwin",
    verificationKind: "manual",
    verification: {
      linux: "Not applicable — Linux uses regular titlebar buttons.",
      darwin:
        "Hover over each traffic light — all three render with no UI element on top of them.",
      win32: "Not applicable — Windows uses regular titlebar buttons.",
    },
  },
  {
    id: "hidpi-rendering",
    label: "Hi-DPI / Retina rendering",
    category: "ui",
    description:
      "Text and icons render crisply at 2× / fractional scale factors; no blurry bitmap scaling.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Test on a 4K monitor with 200% scale; text remains crisp.",
      darwin: "Test on a Retina display; SVG icons render at 2×.",
      win32: "Test on a 4K monitor with 150% scale; manifest declares per-monitor DPI awareness.",
    },
  },
  {
    id: "theme-dark-light-follow",
    label: "Follows OS dark/light theme",
    category: "ui",
    description:
      "The app respects `prefers-color-scheme` and updates within ~1 s when the OS theme changes.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Toggle GNOME's color-scheme; the workspace adapts.",
      darwin: "Toggle System Settings → Appearance; the workspace adapts.",
      win32: "Toggle Settings → Personalization → Colors → Dark/Light; the workspace adapts.",
    },
  },
  {
    id: "keyboard-shortcuts-modifiers",
    label: "Keyboard shortcuts use OS modifiers",
    category: "ui",
    description:
      "Cmd is the primary modifier on macOS; Ctrl on Linux/Windows. Cmd+, opens Settings on Mac, Ctrl+, on the others.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Ctrl+, opens Settings; Ctrl+K opens command palette.",
      darwin: "Cmd+, opens Settings; Cmd+K opens command palette.",
      win32: "Ctrl+, opens Settings; Ctrl+K opens command palette.",
    },
  },
  {
    id: "context-menu-native",
    label: "Right-click context menus",
    category: "ui",
    description:
      "Right-clicking a project card, rule row, or log line shows a native-styled context menu at the click location.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Right-click a project card; menu renders next to cursor.",
      darwin: "Right-click (or two-finger click) a project card; menu renders next to cursor.",
      win32: "Right-click a project card; menu renders next to cursor.",
    },
  },
  {
    id: "clipboard-rw",
    label: "Clipboard read + write",
    category: "ui",
    description:
      "navigator.clipboard.writeText() writes to the OS clipboard; readText() reads pasted content.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Copy a rule remediation via the Copy button; paste into a terminal — matches.",
      darwin: "Copy a rule remediation via the Copy button; paste into Terminal — matches.",
      win32: "Copy a rule remediation via the Copy button; paste into Notepad — matches.",
    },
  },
  {
    id: "accessibility-tree",
    label: "Accessibility tree exposed",
    category: "ui",
    description:
      "Screen readers can announce the rail entries, project cards, and detail panels via the OS accessibility API.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Test with Orca — rail entries announce their labels.",
      darwin: "Test with VoiceOver — rail entries announce their labels.",
      win32: "Test with Narrator or NVDA — rail entries announce their labels.",
    },
  },
  {
    id: "multi-monitor-position",
    label: "Multi-monitor: window position remembered",
    category: "ui",
    description:
      "Closing the app on monitor 2 and re-opening lands the window back on monitor 2 at the same coordinates.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Open on a second monitor, close, reopen — same screen.",
      darwin: "Open on a second monitor, close, reopen — same screen.",
      win32: "Open on a second monitor, close, reopen — same screen.",
    },
  },
  {
    id: "fullscreen-toggle",
    label: "Native fullscreen toggle",
    category: "ui",
    description:
      "F11 (Linux/Windows) or Ctrl+Cmd+F (macOS) toggles native fullscreen without losing window state.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "F11 toggles fullscreen; F11 again restores window with same size.",
      darwin: "Ctrl+Cmd+F enters native fullscreen space; toggle again returns to space.",
      win32: "F11 toggles fullscreen; F11 again restores window with same size.",
    },
  },

  // ── runtime (in-window SSG features) ─────────────────────────────────────
  {
    id: "workspace-rail-loads",
    label: "Workspace rail entries render",
    category: "runtime",
    description:
      "Every left-rail entry (Overview, Readiness, Observability, Inbox, Certify, AI Native, Service map, Fleet, Distribution, Platform parity) renders without console errors.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Open Workspace → confirm every rail entry is visible and selectable.",
      darwin: "Open Workspace → confirm every rail entry is visible and selectable.",
      win32: "Open Workspace → confirm every rail entry is visible and selectable.",
    },
  },
  {
    id: "monorepo-map-graph",
    label: "Service map graph renders",
    category: "runtime",
    description:
      "The Service map view loads the deduped Cloudflare infrastructure graph (workers + bindings) without layout glitches.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Open Workspace → Service map; nodes and edges render and pan/zoom is smooth.",
      darwin: "Open Workspace → Service map; nodes and edges render and pan/zoom is smooth.",
      win32: "Open Workspace → Service map; nodes and edges render and pan/zoom is smooth.",
    },
  },
  {
    id: "graph-inspector-realtime",
    label: "Graph inspector updates in real time",
    category: "runtime",
    description:
      "Selecting a service in the SSG dashboard streams live eval/decision data into the graph inspector and panels update within ~1 s.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux:
        "Trigger a rule eval; the inspector's eval-count + last-decision update without a refresh.",
      darwin:
        "Trigger a rule eval; the inspector's eval-count + last-decision update without a refresh.",
      win32:
        "Trigger a rule eval; the inspector's eval-count + last-decision update without a refresh.",
    },
  },
  {
    id: "audit-log-viewer-live",
    label: "Audit log viewer streams live",
    category: "runtime",
    description:
      "The audit panel tails the SQLite audit log via SSE and new rows append at the top within ~1 s of being recorded.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux:
        "Run `ssg eval` from a terminal; the new audit row appears in the panel within ~1 s.",
      darwin:
        "Run `ssg eval` from a terminal; the new audit row appears in the panel within ~1 s.",
      win32:
        "Run `ssg eval` from a terminal; the new audit row appears in the panel within ~1 s.",
    },
  },
  {
    id: "run-script-streaming",
    label: "Run script streams stdout/stderr",
    category: "runtime",
    description:
      "Clicking 'Run' on a project script streams stdout/stderr live via SSE and updates the exit-code badge when the job finishes.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Run a noisy script (e.g. `bun test`); lines stream as they're emitted.",
      darwin: "Run a noisy script (e.g. `bun test`); lines stream as they're emitted.",
      win32: "Run a noisy script (e.g. `bun test`); lines stream as they're emitted.",
    },
  },
  {
    id: "ssg-daemon-loopback",
    label: "Embedded SSG daemon loopback",
    category: "runtime",
    description:
      "The SigmaShake Desktop window can reach the embedded SSG daemon at 127.0.0.1:<port> with the X-SigmaShake-Token header.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "GET http://127.0.0.1:<port>/api/health returns 200 with the embedded token.",
      darwin: "GET http://127.0.0.1:<port>/api/health returns 200 with the embedded token.",
      win32: "GET http://127.0.0.1:<port>/api/health returns 200 with the embedded token.",
    },
  },
  {
    id: "sse-streams-stable",
    label: "SSE streams stay open",
    category: "runtime",
    description:
      "Long-lived SSE streams (events, audit tail, run output) survive at least 5 min without being killed by an OS-level idle timeout.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Open the events stream, leave for 5 min, confirm `data:` heartbeats keep arriving.",
      darwin: "Open the events stream, leave for 5 min, confirm `data:` heartbeats keep arriving.",
      win32: "Open the events stream, leave for 5 min, confirm `data:` heartbeats keep arriving.",
    },
  },
  {
    id: "voice-dock-mic-capture",
    label: "VoiceDock mic capture",
    category: "runtime",
    description:
      "Clicking the VoiceDock mic button records audio and the recognized text appears in the command field.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Click mic, say 'go to Overview' — the rail switches to Overview.",
      darwin: "Click mic, say 'go to Overview' — the rail switches to Overview.",
      win32: "Click mic, say 'go to Overview' — the rail switches to Overview.",
    },
  },
  {
    id: "loading-icons-rail",
    label: "Rail SVG icons render",
    category: "runtime",
    description:
      "Each rail entry's inline SVG icon (shield, checkmark, network, etc.) renders without becoming a broken-image square.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Open Workspace → every rail entry shows an icon to the left of its label.",
      darwin: "Open Workspace → every rail entry shows an icon to the left of its label.",
      win32: "Open Workspace → every rail entry shows an icon to the left of its label.",
    },
  },

  // ── ipc ──────────────────────────────────────────────────────────────────
  {
    id: "electroview-rpc-bridge",
    label: "Electroview RPC bridge attached",
    category: "ipc",
    description:
      "`window.__WORKSPACE_VIEW__` is set before the first React render, so calls like pickDirectory() and getRuntimeConfig() resolve.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "DevTools console: typeof window.__WORKSPACE_VIEW__ === 'object'.",
      darwin: "DevTools console: typeof window.__WORKSPACE_VIEW__ === 'object'.",
      win32: "DevTools console: typeof window.__WORKSPACE_VIEW__ === 'object'.",
    },
  },
  {
    id: "protocol-handler-registered",
    label: "sigmashake:// protocol registered with OS",
    category: "ipc",
    description:
      "The custom protocol is registered system-wide so a `sigmashake://workspace` link from outside the app routes here.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "`xdg-mime query default x-scheme-handler/sigmashake` returns the SigmaShake .desktop entry.",
      darwin:
        "LaunchServices `lsregister -dump` lists SigmaShake as the handler for the sigmashake scheme.",
      win32:
        "HKCU\\Software\\Classes\\sigmashake exists with a shell\\open\\command pointing at the .exe.",
    },
  },

  // ── data ─────────────────────────────────────────────────────────────────
  {
    id: "sqlite-native-binding",
    label: "bun:sqlite native binding loads",
    category: "data",
    description:
      "The bundled SQLite native binding loads at runtime; `new Database(':memory:')` succeeds.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "import Database from 'bun:sqlite'; new Database(':memory:') succeeds and the right .so is loaded.",
      darwin:
        "import Database from 'bun:sqlite'; new Database(':memory:') succeeds and the right .dylib is loaded.",
      win32:
        "import Database from 'bun:sqlite'; new Database(':memory:') succeeds and the right .dll is loaded.",
    },
  },
  {
    id: "keys-dir-permissions",
    label: "`~/.sigmashake/keys/` permissions",
    category: "data",
    description:
      "The keys directory has 0700 on POSIX systems so license JWTs and signing keys aren't world-readable.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "stat -c '%a' ~/.sigmashake/keys → 700.",
      darwin: "stat -f '%A' ~/.sigmashake/keys → 700.",
      win32:
        "Confirm the keys dir inherits the user's ACL (no Everyone/Authenticated Users entries).",
    },
  },
  {
    id: "license-jwt-readable",
    label: "License JWT path resolves",
    category: "data",
    description:
      "The license JWT path (`~/.sigmashake/license.jwt`) exists and decodes — the desktop won't enter the SSG dashboard without it.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "fs.readFileSync('~/.sigmashake/license.jwt', 'utf8') succeeds.",
      darwin: "fs.readFileSync('~/.sigmashake/license.jwt', 'utf8') succeeds.",
      win32: "fs.readFileSync('%USERPROFILE%\\.sigmashake\\license.jwt', 'utf8') succeeds.",
    },
  },
  {
    id: "audit-log-rotation",
    label: "Audit log rotation runs",
    category: "data",
    description:
      "The audit SQLite database stays under the configured row cap (50k by default); old rows are pruned automatically.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux: "SELECT COUNT(*) FROM audit ≤ AUDIT_LOG_MAX_ROWS after a forced rotation.",
      darwin: "SELECT COUNT(*) FROM audit ≤ AUDIT_LOG_MAX_ROWS after a forced rotation.",
      win32: "SELECT COUNT(*) FROM audit ≤ AUDIT_LOG_MAX_ROWS after a forced rotation.",
    },
  },

  // ── security ─────────────────────────────────────────────────────────────
  {
    id: "code-signed-binary",
    label: "Binary is code-signed",
    category: "security",
    description:
      "The shipped SigmaShake Desktop binary carries a valid OS-trusted signature (Authenticode on Windows, Developer ID on macOS, sigstore/AppImage signature on Linux).",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux:
        "Verify the AppImage's gpg signature, or check the `.deb`'s dpkg-sig — should match the SigmaShake signing key.",
      darwin: "`codesign --verify --deep --strict /Applications/SigmaShake.app` exits 0.",
      win32:
        "Right-click the .exe → Properties → Digital Signatures → SigmaShake Inc with valid timestamp.",
    },
  },
  {
    id: "mac-notarization",
    label: "macOS notarization",
    category: "security",
    description:
      "The .app bundle is notarized by Apple; GateKeeper allows it without 'unidentified developer' warning.",
    severity: "blocking",
    expectedFor: "darwin",
    verificationKind: "auto",
    verification: {
      linux: "Not applicable — Linux has no equivalent notarization.",
      darwin:
        "`spctl --assess --type execute /Applications/SigmaShake.app` reports 'accepted' / 'Developer ID'.",
      win32: "Not applicable — Windows uses Authenticode + SmartScreen reputation instead.",
    },
  },
  {
    id: "windows-smartscreen-reputation",
    label: "Windows SmartScreen reputation",
    category: "security",
    description:
      "The signed installer has enough reputation that SmartScreen does not display 'Windows protected your PC' on first launch.",
    severity: "recommended",
    expectedFor: "win32",
    verificationKind: "manual",
    verification: {
      linux: "Not applicable.",
      darwin: "Not applicable.",
      win32:
        "Download the .msi/.exe via Edge on a fresh VM; first launch should not trigger SmartScreen warning.",
    },
  },
  {
    id: "linux-sandbox-policy",
    label: "Linux sandbox policy",
    category: "security",
    description:
      "When packaged as Snap/Flatpak/AppImage, the sandbox grants the permissions the app actually needs (home access, network, audio for VoiceDock) without overreaching.",
    severity: "recommended",
    expectedFor: "linux",
    verificationKind: "manual",
    verification: {
      linux:
        "Inspect the Snap/Flatpak manifest — confirm `home`, `network`, and `audio-record` plugs only.",
      darwin: "Not applicable.",
      win32: "Not applicable.",
    },
  },

  // ── notifications ────────────────────────────────────────────────────────
  {
    id: "native-toast-notification",
    label: "Native toast notifications fire",
    category: "notifications",
    description:
      "`new Notification()` displays a native OS toast (and lands in the OS notification center).",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Trigger a denial; a libnotify toast appears.",
      darwin: "Trigger a denial; a UserNotification appears in the top-right.",
      win32: "Trigger a denial; a Windows toast appears in the bottom-right.",
    },
  },
  {
    id: "badge-counter",
    label: "Taskbar / dock badge updates",
    category: "notifications",
    description:
      "Pending approvals count is reflected as a badge on the taskbar / dock icon.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Unity launcher API (or KDE equivalent) shows count next to the icon.",
      darwin: "Dock icon shows a red badge with the pending count.",
      win32: "Taskbar icon shows a Windows 10/11 overlay badge with the count.",
    },
  },
  {
    id: "click-notification-focuses-window",
    label: "Click notification focuses window",
    category: "notifications",
    description:
      "Clicking a toast brings the SigmaShake window to the front and navigates to the relevant view.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Click the toast → window foregrounds and routes to pending approvals.",
      darwin: "Click the toast → window foregrounds and routes to pending approvals.",
      win32: "Click the toast → window foregrounds and routes to pending approvals.",
    },
  },
  {
    id: "respects-dnd",
    label: "Respects Do-Not-Disturb",
    category: "notifications",
    description:
      "Toasts are suppressed (but still queued for the notification center) when the OS is in Do-Not-Disturb / Focus mode.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Enable GNOME's Do Not Disturb; trigger a notification — no toast.",
      darwin: "Enable Focus mode; trigger a notification — no toast.",
      win32: "Enable Focus assist (Priority only); trigger a notification — no toast.",
    },
  },

  // ── distribution ─────────────────────────────────────────────────────────
  {
    id: "installer-package-format",
    label: "Installer in OS-native format",
    category: "distribution",
    description:
      "The OS gets an installer it expects: .deb/.AppImage on Linux, .dmg/.pkg on macOS, .msi/.exe on Windows.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "The Distribution view's inventory matrix lists a .AppImage and a .deb for the current version.",
      darwin: "The Distribution view's inventory matrix lists a .dmg (and .pkg for MAS).",
      win32: "The Distribution view's inventory matrix lists a .msi or .exe installer.",
    },
  },
  {
    id: "delta-patch-applies",
    label: "Delta patch applies cleanly",
    category: "distribution",
    description:
      "The Electrobun delta-patch system can produce a binary diff between two consecutive versions on the same OS and apply it without a full re-download.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "manual",
    verification: {
      linux: "Install N-1, trigger update → app re-launches at version N with delta logs.",
      darwin: "Install N-1, trigger update → app re-launches at version N with delta logs.",
      win32: "Install N-1, trigger update → app re-launches at version N with delta logs.",
    },
  },
];
