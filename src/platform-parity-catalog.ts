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
      "App appears in the OS task switcher with its real name and icon, and clicking the taskbar/dock entry focuses the window instead of opening a new one. The probe checks that the Electrobun bundle creates a visible BrowserWindow without `skipTaskbar:true`, and (best-effort) confirms a live SigmaShake process holds a non-zero MainWindowHandle / Dock entry when the desktop is running.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: confirm the Electrobun bundle creates a visible BrowserWindow without skipTaskbar; optional live snapshot via `wmctrl -l`. Manual: launch the app, confirm an entry in the GNOME/KDE taskbar with the SigmaShake icon, then switch to another window and click the taskbar entry — the original window should focus.",
      darwin:
        "Auto: confirm the Electrobun bundle creates a visible BrowserWindow without skipTaskbar; optional live snapshot via System Events. Manual: launch the app, confirm an entry in the macOS Dock with the SigmaShake icon, Cmd+Tab to another app, then click the Dock icon — the original window should focus.",
      win32:
        "Auto: confirm the Electrobun bundle creates a visible BrowserWindow without skipTaskbar; optional live snapshot via `Get-Process bun,launcher | Where MainWindowHandle -ne 0`. Manual: launch the app, confirm an entry in the Windows taskbar with the SigmaShake icon, switch to another window via Alt+Tab, then click the taskbar entry — the original window should focus.",
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
    verificationKind: "auto",
    verification: {
      linux:
        "On GNOME with the AppIndicator extension, or KDE, confirm the tray icon and right-click to see the menu.",
      darwin: "Confirm the menu bar icon at top-right; clicking it should reveal the menu.",
      win32: "Confirm the icon in the system tray notification area; right-click for the menu.",
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
    verificationKind: "auto",
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
    verificationKind: "auto",
    verification: {
      linux:
        "Launch the app twice from the terminal; second invocation should foreground the first.",
      darwin:
        "`open -n` should not produce a second window; without -n, macOS already enforces single-instance.",
      win32:
        "Run the .exe twice from the Start menu; second invocation should foreground the first.",
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
    verificationKind: "auto",
    verification: {
      linux: "Toggle on, log out / back in, confirm SigmaShake is running.",
      darwin: "Toggle on, check System Settings → Login Items for SigmaShake.",
      win32: "Toggle on, check Task Manager → Startup tab for SigmaShake.",
    },
  },
  {
    id: "autostart-persistence",
    label: "Autostart persists across reboots",
    category: "integration",
    description:
      "SigmaShake Desktop reattaches at every user login via the OS-native persistence mechanism (XDG autostart on Linux, SMAppService LaunchAgent on macOS, HKCU Run key on Windows). Users can disable it in one click from the tray menu (Disable Start at Login) or from Workspace → Platform parity; the toggle writes ~/.sigmashake/desktop-prefs.json which the autostart manager honors.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Check ~/.config/autostart/sigmashake-desktop.desktop exists with an Exec= line matching the installed launcher. Probe reads ~/.sigmashake/desktop-prefs.json — if autostart=false the row reports not-applicable (user opt-out).",
      darwin:
        "Check loginItem.status() returns 'enabled' or 'requiresApproval'. The Swift SMAppService helper drives this; in non-MAS dev builds the probe falls back to ~/Library/LaunchAgents/com.sigmashake.desktop.plist.",
      win32:
        "Check HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run has a 'SigmaShakeDesktop' value pointing at the installed launcher.",
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
      linux: "fs.writeFileSync(`<tmpdir()>/ssg-parity-probe`, '') succeeds.",
      darwin: "fs.writeFileSync(`<tmpdir()>/ssg-parity-probe`, '') succeeds.",
      win32: "fs.writeFileSync(`<tmpdir()>/ssg-parity-probe`, '') succeeds (`%TEMP%`).",
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
    verificationKind: "auto",
    verification: {
      linux:
        "Click Browse — the GTK or KDE folder chooser opens; selecting a folder updates the Root input.",
      darwin:
        "Click Browse — the macOS open-panel opens; selecting a folder updates the Root input.",
      win32:
        "Click Browse — the Windows IFileOpenDialog opens; selecting a folder updates the Root input.",
    },
  },
  {
    id: "drag-drop-files",
    label: "Drag-and-drop targets",
    category: "files",
    description:
      "Dragging a folder onto the window applies it as the workspace root; dragging a `.rules` file opens the rule editor. The probe scans the workspace plugin bundle for dragover + drop + dataTransfer event handlers.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: workspace plugin app.js embeds dragover / onDrop / dataTransfer handlers. Manual: drag a folder from Nautilus/Dolphin onto the window — Root applies.",
      darwin:
        "Auto: workspace plugin app.js embeds dragover / onDrop / dataTransfer handlers. Manual: drag a folder from Finder onto the window — Root applies.",
      win32:
        "Auto: workspace plugin app.js embeds dragover / onDrop / dataTransfer handlers. Manual: drag a folder from Explorer onto the window — Root applies.",
    },
  },
  {
    id: "file-watcher-fsnotify",
    label: "Filesystem watcher fires events",
    category: "files",
    description:
      "Changes to a `.rules` file under the workspace root produce an event the UI sees (rules table auto-refreshes). The probe runs a live fs.watch round-trip in a tmpdir — install watcher, write a file, wait 900ms, confirm the OS-level fsnotify backend (inotify / FSEvents / ReadDirectoryChangesW) delivered an event.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: live fs.watch round-trip exercises inotify. Manual: edit a .rules file in the terminal — the UI updates within ~1 s.",
      darwin:
        "Auto: live fs.watch round-trip exercises FSEvents. Manual: edit a .rules file in the terminal — the UI updates within ~1 s.",
      win32:
        "Auto: live fs.watch round-trip exercises ReadDirectoryChangesW. Manual: edit a .rules file in Notepad — the UI updates within ~1 s.",
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
    description: "Paths >260 characters work — required for deep node_modules trees on Windows.",
    severity: "recommended",
    expectedFor: "win32",
    verificationKind: "auto",
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
      "Symlinks (POSIX) or directory junctions (Windows) resolve identically across OS — fs.realpath follows them to the target, and write-through-link lands in the target dir. The probe creates a live link in $TMP, write-tests through it, and verifies realpath resolution.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: live symlink round-trip (ln -s + realpath + write-through). Manual: symlink a project subdir; confirm project list either includes or excludes it.",
      darwin:
        "Auto: live symlink round-trip (ln -s + realpath + write-through). Manual: symlink a project subdir; confirm project list either includes or excludes it.",
      win32:
        "Auto: live junction round-trip (mklink /J — no admin / Developer Mode required — + realpath + write-through). Manual: junction-link a project subdir; confirm project list either includes or excludes it.",
    },
  },

  // ── ui ───────────────────────────────────────────────────────────────────
  {
    id: "window-controls-native",
    label: "Native window controls",
    category: "ui",
    description:
      "Min/maximize/close controls render in the OS-native style and position (left on macOS, right on Linux/Windows). The probe verifies the Electrobun bundle wires BrowserWindow + titleBarStyle + native min/max/restore/setWindowFrame ffi calls.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: Electrobun bundle exposes BrowserWindow + minimizeWindow/maximizeWindow/restoreWindow ffi. Manual: confirm controls on the right edge of the titlebar in GNOME/KDE.",
      darwin:
        "Auto: Electrobun bundle exposes BrowserWindow + titleBarStyle native chrome. Manual: confirm the red/yellow/green traffic lights on the top-left.",
      win32:
        "Auto: Electrobun bundle exposes BrowserWindow + minimizeWindow/maximizeWindow/restoreWindow ffi. Manual: confirm minimize/maximize/close on the top-right of the titlebar.",
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
      darwin: "Hover over each traffic light — all three render with no UI element on top of them.",
      win32: "Not applicable — Windows uses regular titlebar buttons.",
    },
  },
  {
    id: "hidpi-rendering",
    label: "Hi-DPI / Retina rendering",
    category: "ui",
    description:
      "Text and icons render crisply at 2× / fractional scale factors; no blurry bitmap scaling. On Windows the probe scans libNativeWrapper.dll for per-monitor DPI Win32 imports (GetDpiForMonitor / SetProcessDpiAwarenessContext). macOS Cocoa renderers backing-scale by default; Linux inherits the compositor's scale.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: Electrobun bundle present (renderer inherits compositor DPI). Manual: test on a 4K monitor with 200% scale; text remains crisp.",
      darwin:
        "Auto: Electrobun bundle present (Cocoa backing-scale). Manual: test on a Retina display; SVG icons render at 2×.",
      win32:
        "Auto: libNativeWrapper.dll imports GetDpiForMonitor / SetProcessDpiAwarenessContext. Manual: test on a 4K monitor with 150% scale.",
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
    verificationKind: "auto",
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
    verificationKind: "auto",
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
      "Right-clicking a project card, rule row, or log line shows a native-styled context menu at the click location. The probe scans the workspace plugin bundle for contextmenu / onContextMenu handlers.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: workspace plugin app.js wires contextmenu / onContextMenu handlers. Manual: right-click a project card; menu renders next to cursor.",
      darwin:
        "Auto: workspace plugin app.js wires contextmenu / onContextMenu handlers. Manual: right-click (or two-finger click) a project card; menu renders next to cursor.",
      win32:
        "Auto: workspace plugin app.js wires contextmenu / onContextMenu handlers. Manual: right-click a project card; menu renders next to cursor.",
    },
  },
  {
    id: "clipboard-rw",
    label: "Clipboard read + write",
    category: "ui",
    description:
      "navigator.clipboard.writeText() writes to the OS clipboard; readText() reads pasted content. The probe scans the workspace plugin bundle for navigator.clipboard call sites.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: workspace plugin app.js wires navigator.clipboard + writeText/readText. Manual: copy a rule remediation via the Copy button; paste into a terminal — matches.",
      darwin:
        "Auto: workspace plugin app.js wires navigator.clipboard + writeText/readText. Manual: copy a rule remediation via the Copy button; paste into Terminal — matches.",
      win32:
        "Auto: workspace plugin app.js wires navigator.clipboard + writeText/readText. Manual: copy a rule remediation via the Copy button; paste into Notepad — matches.",
    },
  },
  {
    id: "accessibility-tree",
    label: "Accessibility tree exposed",
    category: "ui",
    description:
      "Screen readers can announce the rail entries, project cards, and detail panels via the OS accessibility API. The probe verifies the workspace plugin bundle embeds aria-label + aria-* attributes + tabIndex hints across the widget tree.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: workspace plugin app.js embeds aria-label + aria-* attributes. Manual: test with Orca — rail entries announce their labels.",
      darwin:
        "Auto: workspace plugin app.js embeds aria-label + aria-* attributes. Manual: test with VoiceOver — rail entries announce their labels.",
      win32:
        "Auto: workspace plugin app.js embeds aria-label + aria-* attributes. Manual: test with Narrator or NVDA — rail entries announce their labels.",
    },
  },
  {
    id: "multi-monitor-position",
    label: "Multi-monitor: window position remembered",
    category: "ui",
    description:
      "Closing the app on monitor 2 and re-opening lands the window back on monitor 2 at the same coordinates. The probe verifies the Electrobun bundle wires setWindowFrame/getWindowFrame ffi AND ships either the loadWindowFrame/saveWindowFrame persistence helpers or a populated ~/.sigmashake/desktop-window-state.json.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: Electrobun bundle wires setWindowFrame ffi + window-state persistence. Manual: open on a second monitor, close, reopen — same screen.",
      darwin:
        "Auto: Electrobun bundle wires setWindowFrame ffi + window-state persistence. Manual: open on a second monitor, close, reopen — same screen.",
      win32:
        "Auto: Electrobun bundle wires setWindowFrame ffi + window-state persistence. Manual: open on a second monitor, close, reopen — same screen.",
    },
  },
  {
    id: "fullscreen-toggle",
    label: "Native fullscreen toggle",
    category: "ui",
    description:
      "F11 (Linux/Windows) or Ctrl+Cmd+F (macOS) toggles native fullscreen without losing window state. The probe verifies the Electrobun bundle wires setWindowFullScreen + isWindowFullScreen ffi.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: Electrobun bundle wires setWindowFullScreen + isWindowFullScreen ffi. Manual: F11 toggles fullscreen; F11 again restores window with same size.",
      darwin:
        "Auto: Electrobun bundle wires setWindowFullScreen + isWindowFullScreen ffi. Manual: Ctrl+Cmd+F enters native fullscreen space; toggle again returns to space.",
      win32:
        "Auto: Electrobun bundle wires setWindowFullScreen + isWindowFullScreen ffi. Manual: F11 toggles fullscreen; F11 again restores window with same size.",
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
    verificationKind: "auto",
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
    verificationKind: "auto",
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
      "Selecting a service in the SSG dashboard streams live eval/decision data into the graph inspector and panels update within ~1 s. The probe verifies the workspace plugin bundle wires both an Inspector component and an EventSource consumer pointing at /api/events.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: workspace plugin app.js wires Inspector + EventSource('/api/events'). Manual: trigger a rule eval; the inspector's eval-count + last-decision update without a refresh.",
      darwin:
        "Auto: workspace plugin app.js wires Inspector + EventSource('/api/events'). Manual: trigger a rule eval; the inspector's eval-count + last-decision update without a refresh.",
      win32:
        "Auto: workspace plugin app.js wires Inspector + EventSource('/api/events'). Manual: trigger a rule eval; the inspector's eval-count + last-decision update without a refresh.",
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
    verificationKind: "auto",
    verification: {
      linux: "Run `ssg eval` from a terminal; the new audit row appears in the panel within ~1 s.",
      darwin: "Run `ssg eval` from a terminal; the new audit row appears in the panel within ~1 s.",
      win32: "Run `ssg eval` from a terminal; the new audit row appears in the panel within ~1 s.",
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
    verificationKind: "auto",
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
      "Long-lived SSE streams (events, audit tail, run output) survive at least 5 min without being killed by an OS-level idle timeout. The probe verifies the daemon's SSE handler emits a `: ping` heartbeat at SSE_HEARTBEAT_MS (default 15s) — well below the 5 min idle ceiling.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: SSE_HEARTBEAT_MS sits in the 1s..60s safe band. Manual: open the events stream, leave for 5 min, confirm `data:` heartbeats keep arriving.",
      darwin:
        "Auto: SSE_HEARTBEAT_MS sits in the 1s..60s safe band. Manual: open the events stream, leave for 5 min, confirm `data:` heartbeats keep arriving.",
      win32:
        "Auto: SSE_HEARTBEAT_MS sits in the 1s..60s safe band. Manual: open the events stream, leave for 5 min, confirm `data:` heartbeats keep arriving.",
    },
  },
  {
    id: "voice-dock-mic-capture",
    label: "VoiceDock mic capture",
    category: "runtime",
    description:
      "Clicking the VoiceDock mic button records audio and the recognized text appears in the command field. The probe verifies the workspace plugin bundle ships a VoiceDock component with mic-related wiring.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: workspace plugin app.js wires VoiceDock component. Manual: click mic, say 'go to Overview' — the rail switches to Overview.",
      darwin:
        "Auto: workspace plugin app.js wires VoiceDock component. Manual: click mic, say 'go to Overview' — the rail switches to Overview.",
      win32:
        "Auto: workspace plugin app.js wires VoiceDock component. Manual: click mic, say 'go to Overview' — the rail switches to Overview.",
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
    verificationKind: "auto",
    verification: {
      linux: "Open Workspace → every rail entry shows an icon to the left of its label.",
      darwin: "Open Workspace → every rail entry shows an icon to the left of its label.",
      win32: "Open Workspace → every rail entry shows an icon to the left of its label.",
    },
  },

  // ── ipc ──────────────────────────────────────────────────────────────────
  {
    id: "electroview-rpc-bridge",
    label: "Workspace plugin config bridge attached",
    category: "ipc",
    description:
      "The plugin shell's bootstrap script translates `window.__SSG_PLUGIN_CONFIG__` (port + token + root injected by the SSG daemon) into `window.__WORKSPACE_CONFIG__` before the React app loads, so the workspace can fetch the daemon. (The legacy Electroview-defined RPC bridge that set `__WORKSPACE_VIEW__` was retired 2026-05-26 when the workspace stopped shipping as an Electrobun BrowserView and moved to the plugin shell.)",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "DevTools console after page load: typeof window.__WORKSPACE_CONFIG__ === 'object' && typeof window.__WORKSPACE_CONFIG__.port === 'number'.",
      darwin:
        "DevTools console after page load: typeof window.__WORKSPACE_CONFIG__ === 'object' && typeof window.__WORKSPACE_CONFIG__.port === 'number'.",
      win32:
        "DevTools console after page load: typeof window.__WORKSPACE_CONFIG__ === 'object' && typeof window.__WORKSPACE_CONFIG__.port === 'number'.",
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
    verificationKind: "auto",
    verification: {
      linux:
        "Verify the AppImage's gpg signature, or check the `.deb`'s dpkg-sig — should match the SigmaShake signing key.",
      darwin: "`codesign --verify --deep --strict /Applications/SigmaShake.app` exits 0.",
      win32:
        "Right-click the .exe → Properties → Digital Signatures → SigmaShake with valid timestamp.",
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
      "The signed installer has enough reputation that SmartScreen does not display 'Windows protected your PC' on first launch. SmartScreen is reputation-based not signature-based, so there is no deterministic auto-probe — the closest signal is the VirusTotal scan sidecar at ~/.sigmashake/virustotal-last.json (written by `bun run --cwd sigmashake-dist scan:virustotal`). Clean-on-VT Setup.exe → reputation accumulates without churn; flagged Setup.exe → file an appeal via `bun run --cwd sigmashake-electrobun submit:smartscreen`.",
    severity: "recommended",
    expectedFor: "win32",
    verificationKind: "auto",
    verification: {
      linux: "Not applicable.",
      darwin: "Not applicable.",
      win32:
        "Auto: VirusTotal sidecar (~/.sigmashake/virustotal-last.json) reports the Setup.exe as clean. Manual: download the Setup.exe via Edge on a fresh VM; first launch should not trigger SmartScreen warning.",
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
    verificationKind: "auto",
    verification: {
      linux: "Trigger a denial; a libnotify toast appears.",
      darwin: "Trigger a denial; a UserNotification appears in the top-right.",
      win32: "Trigger a denial; a Windows toast appears in the bottom-right.",
    },
  },
  {
    id: "badge-counter",
    label: "Dock badge updates (macOS)",
    category: "notifications",
    description:
      "Pending approvals count is reflected as a badge on the macOS Dock icon (via NSDockTile.badgeLabel). Scoped to darwin because the only badge primitive currently wired through the Electrobun native-ext lives in the macOS-only Swift dylib (sigmashake-electrobun/src/bun/native-ext.ts::setDockBadge). On Linux there is no universal compositor surface (GNOME/KDE ignore Unity launcher); on Windows a future ITaskbarList3::SetOverlayIcon binding would re-enable parity but isn't shipped today.",
    severity: "recommended",
    expectedFor: "darwin",
    verificationKind: "auto",
    verification: {
      linux:
        "Not applicable — GNOME/KDE don't honor Unity launcher protocol; no universal compositor surface for icon badges.",
      darwin:
        "Auto: Electrobun bundle wires nativeExt.setDockBadge — dock icon renders the pending count. Manual: dock icon shows a red badge with the pending count.",
      win32:
        "Not applicable — Windows ITaskbarList3::SetOverlayIcon binding is not yet wired in Electrobun's native ext; the in-window update banner serves as the surface.",
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
    verificationKind: "auto",
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
      "Toasts are suppressed (but still queued for the notification center) when the OS is in Do-Not-Disturb / Focus mode. The OS shell handles the suppression — the probe verifies the bundle uses the *native* Notification primitive (which inherits the OS policy) rather than rolling its own toast UI that would bypass DND.",
    severity: "recommended",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Auto: Electrobun bundle uses the native Notification primitive (inherits GNOME/KDE DND state). Manual: enable GNOME's Do Not Disturb; trigger a notification — no toast.",
      darwin:
        "Auto: Electrobun bundle uses the native Notification primitive (inherits macOS Focus state). Manual: enable Focus mode; trigger a notification — no toast.",
      win32:
        "Auto: Electrobun bundle uses the native Notification primitive (inherits Windows Focus assist state). Manual: enable Focus assist (Priority only); trigger a notification — no toast.",
    },
  },
  {
    id: "update-available-in-app-banner",
    label: "Update-available in-app banner (real-time)",
    category: "notifications",
    description:
      "When the Electrobun updater detects a downloaded-and-ready update, the dashboard shell AND the Workspace plugin render a persistent in-app 'Update vX.Y.Z ready - Restart to apply' banner within ~5 s — without requiring a page refresh. Today the signal exists only as a one-shot OS toast (deduped per hash, fires once) and a tray-menu row (passive, requires the user to open the tray); a missed toast leaves the dashboard/workspace surfaces silent. Wire-up needs: (1) the Electrobun bun process posts to a daemon endpoint when updateReadyToApply flips true (mirrors notifyUpdateReady at sigmashake-electrobun/src/bun/index.ts:1123); (2) the daemon broadcasts a `desktop-update-ready` SSE event; (3) the dashboard SPA and the Workspace plugin both subscribe and render the banner. Cadence: the 4 h Updater.checkForUpdate poll at index.ts:1284 should also be cut to <=15 min while a window is focused so 'real-time' actually holds after a publish.",
    severity: "blocking",
    expectedFor: "all",
    verificationKind: "auto",
    verification: {
      linux:
        "Run a build with release.baseUrl pointed at a manifest one version ahead. Within the first check (5 s after launch, then every 4 h), confirm: (a) ~/.sigmashake/desktop-update-state.json gets notifiedVersion=<newer>; (b) the dashboard shell at http://127.0.0.1:<port>/ shows an Update-ready banner WITHOUT manual reload; (c) the Workspace plugin at /plugins/workspace/ shows the same banner; (d) clicking restarts into the new version.",
      darwin:
        "Same as Linux. Additionally verify the banner survives navigating between rail entries inside the Workspace plugin (state must be cache-backed, not per-route).",
      win32:
        "Same as Linux. The Windows desktop runs the windowless ssg-hookw build (no conhost) — make sure the banner does NOT require a console attach or a tray click to surface; the webview must learn about update-ready via the daemon's SSE stream, not a tray-menu side-effect.",
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
    verificationKind: "auto",
    verification: {
      linux: "Install N-1, trigger update → app re-launches at version N with delta logs.",
      darwin: "Install N-1, trigger update → app re-launches at version N with delta logs.",
      win32: "Install N-1, trigger update → app re-launches at version N with delta logs.",
    },
  },
];
