import { useCallback, useEffect, useMemo, useState } from "react";

import { detectRuntime, getClient, type WorkspaceApiClient } from "./api/client";
import type { ProjectCard, SessionInfo, WorkspaceSettings } from "./api/types";
import { DEFAULT_WORKSPACE_SETTINGS } from "./api/types";
import { AiNativeView } from "./components/AiNativeView";
import { CertificationView } from "./components/CertificationView";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { DistributionView } from "./components/DistributionView";
import { FleetView } from "./components/FleetView";
import { InboxView } from "./components/InboxView";
import { MonorepoMap } from "./components/MonorepoMap";
import { ObservabilityView } from "./components/ObservabilityView";
import { OverviewView } from "./components/OverviewView";
import { PlatformParityView } from "./components/PlatformParityView";
import { ProductionReadinessView } from "./components/ProductionReadinessView";
import { ProjectDetail } from "./components/ProjectDetail";
import { ProjectGrid } from "./components/ProjectGrid";
import { ServicesEmptyState } from "./components/ServicesEmptyState";
import { SettingsPanel } from "./components/SettingsPanel";
import { type VoiceActions, VoiceDock } from "./components/VoiceDock";
import { friendlyError } from "./lib/errors";
import { useWorkspaceCache, WorkspaceCacheProvider } from "./lib/workspace-cache";

const ROOT_LS_KEY = "ssg:workspace:root";

// Sentinel `selected` values for the monorepo-wide views. Real project slugs
// are kebab-case, so a colon-prefixed value can never collide.
const DISTRIBUTION_SLUG = "::distribution";
const MAP_SLUG = "::map";
const FLEET_SLUG = "::fleet";
const OVERVIEW_SLUG = "::overview";
const CERT_SLUG = "::cert";
const AI_NATIVE_SLUG = "::ai-native";
const INBOX_SLUG = "::inbox";
const OBSERVABILITY_SLUG = "::observability";
const READINESS_SLUG = "::readiness";
const PARITY_SLUG = "::parity";

const MONOREPO_SLUGS: readonly string[] = [
  DISTRIBUTION_SLUG,
  MAP_SLUG,
  FLEET_SLUG,
  OVERVIEW_SLUG,
  CERT_SLUG,
  AI_NATIVE_SLUG,
  INBOX_SLUG,
  OBSERVABILITY_SLUG,
  READINESS_SLUG,
  PARITY_SLUG,
];

function readInitialRoot(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage?.getItem(ROOT_LS_KEY);
    if (stored) return stored;
  } catch {
    // ignore — localStorage may be unavailable
  }
  return window.__WORKSPACE_CONFIG__?.root ?? "";
}

export function App() {
  const runtime = detectRuntime();
  const [client, setClient] = useState<WorkspaceApiClient | null>(null);
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [root, setRoot] = useState(readInitialRoot);
  const [rootDraft, setRootDraft] = useState(readInitialRoot);
  const [loading, setLoading] = useState(true);
  const [appliedRoot, setAppliedRoot] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_WORKSPACE_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchProjects = useCallback(async (c: WorkspaceApiClient, targetRoot: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await c.listProjects(targetRoot || undefined);
      setProjects(res.projects);
      setAppliedRoot(res.root);
      if (res.projects[0]) {
        setSelected((cur) =>
          (cur && MONOREPO_SLUGS.includes(cur)) || (cur && res.projects.some((p) => p.slug === cur))
            ? cur
            : OVERVIEW_SLUG,
        );
      } else {
        setSelected((cur) => (cur && MONOREPO_SLUGS.includes(cur) ? cur : null));
      }
    } catch (err) {
      setError(friendlyError(err));
      setProjects([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getClient();
        if (cancelled) return;
        setClient(c);
        // The cloud auth gate would have already 302-redirected us away if the
        // cookie were invalid, so a failure here is benign metadata — log and
        // keep going so the rest of the workspace is still usable.
        c.getSession()
          .then((s) => {
            if (!cancelled) setSession(s);
          })
          .catch(() => {});
        c.getSettings()
          .then((s) => {
            if (!cancelled) setSettings(s);
          })
          .catch(() => {});
        await fetchProjects(c, root);
      } catch (err) {
        if (!cancelled) {
          setError(friendlyError(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [root, fetchProjects]);

  const applyRoot = useCallback((next: string) => {
    const trimmed = next.trim();
    try {
      window.localStorage?.setItem(ROOT_LS_KEY, trimmed);
    } catch {
      // ignore
    }
    setRoot(trimmed);
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return projects;
    const needle = filter.toLowerCase();
    return projects.filter(
      (p) => p.slug.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle),
    );
  }, [projects, filter]);

  const selectedCard = projects.find((p) => p.slug === selected) ?? null;
  // Electrobun runs the workspace UI in its own window — there's no SSG
  // dashboard tab to go back to. The VS Code webview is a sandboxed iframe
  // inside the editor, where navigating to "/" reloads the bundle instead
  // of going anywhere useful. Cloud and local-web are the only runtimes
  // where the back link points at a real page.
  const canGoBack = runtime !== "electrobun" && runtime !== "vscode";

  const pickDirectory = useCallback(async () => {
    if (!client?.pickDirectory) return;
    const next = await client.pickDirectory(rootDraft || root);
    if (!next) return;
    setRootDraft(next);
    applyRoot(next);
  }, [client, rootDraft, root, applyRoot]);

  const canPick = Boolean(client?.pickDirectory);
  const canCreate = Boolean(client?.hasLocalCapabilities);
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreated = useCallback((card: ProjectCard) => {
    setCreateOpen(false);
    setProjects((cur) => {
      if (cur.some((p) => p.slug === card.slug)) return cur;
      return [...cur, card].sort((a, b) => a.slug.localeCompare(b.slug));
    });
    setSelected(card.slug);
  }, []);

  const voiceActions = useMemo<VoiceActions>(
    () => ({
      goToDistribution: () => setSelected(DISTRIBUTION_SLUG),
      goToMap: () => setSelected(MAP_SLUG),
      goToFleet: () => setSelected(FLEET_SLUG),
      goToOverview: () => setSelected(OVERVIEW_SLUG),
      goToCertification: () => setSelected(CERT_SLUG),
      goToAiNative: () => setSelected(AI_NATIVE_SLUG),
      goToInbox: () => setSelected(INBOX_SLUG),
      goToObservability: () => setSelected(OBSERVABILITY_SLUG),
      goToPlatformParity: () => setSelected(PARITY_SLUG),
      goToProject: (slug) => {
        if (projects.some((p) => p.slug === slug)) {
          setSelected(slug);
          return true;
        }
        return false;
      },
      openCreateModal: () => {
        if (!canCreate) return false;
        setCreateOpen(true);
        return true;
      },
      setFilter: (v) => setFilter(v),
      refresh: () => {
        if (client) fetchProjects(client, root);
      },
    }),
    [projects, canCreate, client, root, fetchProjects],
  );

  const showStack = settings.mode === "stack" || settings.mode === "hybrid";
  const showServices = settings.mode === "services" || settings.mode === "hybrid";
  // First-run gate: force the SettingsPanel on top of everything until the
  // operator picks. We render the rest of the app underneath so once they
  // commit the page is already populated.
  const forceSettings = !settings.onboarded;

  return (
    <WorkspaceCacheProvider client={client} root={appliedRoot ?? root}>
      <div className="app">
        <TopBar
          runtime={runtime}
          canGoBack={canGoBack}
          rootDraft={rootDraft}
          appliedRoot={appliedRoot ?? root}
          onRootDraftChange={setRootDraft}
          onRootApply={() => applyRoot(rootDraft)}
          onRootReset={() => {
            const def = window.__WORKSPACE_CONFIG__?.root ?? "";
            setRootDraft(def);
            applyRoot(def);
          }}
          canPick={canPick}
          onPick={pickDirectory}
          session={session}
          mode={settings.mode}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="app__body">
          <aside className="app__rail">
            {!showStack && (
              <div className="rail__mode-note">
                <span className="rail__mode-note-label">Services mode</span>
                <p className="rail__mode-note-body">
                  Connectors will appear here. Switch to the monorepo manager any time from{" "}
                  <button
                    type="button"
                    className="rail__mode-note-link"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Workspace mode
                  </button>
                  .
                </p>
              </div>
            )}
            {showStack && canCreate && (
              <button
                type="button"
                className="rail__create"
                onClick={() => setCreateOpen(true)}
                title="Create a new app in this monorepo"
              >
                <span className="rail__create-plus" aria-hidden="true">
                  +
                </span>
                New app
              </button>
            )}
            {showStack && (
              <>
                <button
                  type="button"
                  className={`rail__nav${selected === OVERVIEW_SLUG ? " rail__nav--active" : ""}`}
                  onClick={() => setSelected(OVERVIEW_SLUG)}
                  title="Per-project health, drift, attention items, and KPIs in a single pane"
                >
                  <span className="rail__nav-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <rect
                        x="2"
                        y="2"
                        width="5.5"
                        height="5.5"
                        rx="0.8"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <rect
                        x="8.5"
                        y="2"
                        width="5.5"
                        height="3"
                        rx="0.8"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <rect
                        x="8.5"
                        y="5.5"
                        width="5.5"
                        height="3"
                        rx="0.8"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <rect
                        x="2"
                        y="8.5"
                        width="12"
                        height="5.5"
                        rx="0.8"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                    </svg>
                  </span>
                  Overview
                </button>
                <ReadinessNavButton
                  active={selected === READINESS_SLUG}
                  onSelect={() => setSelected(READINESS_SLUG)}
                />
                <button
                  type="button"
                  className={`rail__nav${selected === OBSERVABILITY_SLUG ? " rail__nav--active" : ""}`}
                  onClick={() => setSelected(OBSERVABILITY_SLUG)}
                  title="Observability — live health of every SigmaShake platform service"
                >
                  <span className="rail__nav-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M1.5 8 H4.5 L6 4 L9 12 L10.5 8 H14.5"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  Observability
                </button>
                <button
                  type="button"
                  className={`rail__nav${selected === INBOX_SLUG ? " rail__nav--active" : ""}`}
                  onClick={() => setSelected(INBOX_SLUG)}
                  title="Unified Inbox — open support tickets and new sales leads"
                >
                  <span className="rail__nav-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M2 4.5 L8 9 L14 4.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      />
                      <rect
                        x="2"
                        y="3.4"
                        width="12"
                        height="9"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                    </svg>
                  </span>
                  Inbox
                </button>
                <button
                  type="button"
                  className={`rail__nav${selected === CERT_SLUG ? " rail__nav--active" : ""}`}
                  onClick={() => setSelected(CERT_SLUG)}
                  title="SDLC certification — format, lint, types, tests, security, build, deploy per service"
                >
                  <span className="rail__nav-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="6.4" r="3.6" stroke="currentColor" strokeWidth="1.2" />
                      <path
                        d="M5.6 9.2 L4.4 13.6 L8 11.6 L11.6 13.6 L10.4 9.2"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  Certify
                </button>
                <button
                  type="button"
                  className={`rail__nav${selected === AI_NATIVE_SLUG ? " rail__nav--active" : ""}`}
                  onClick={() => setSelected(AI_NATIVE_SLUG)}
                  title="AI Native — per-service agent-readiness (docs, CLI, MCP, API) and response-latency gauge"
                >
                  <span className="rail__nav-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M8 1.5 L9.5 6.5 L14.5 8 L9.5 9.5 L8 14.5 L6.5 9.5 L1.5 8 L6.5 6.5 Z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  AI Native
                </button>
                <button
                  type="button"
                  className={`rail__nav${selected === MAP_SLUG ? " rail__nav--active" : ""}`}
                  onClick={() => setSelected(MAP_SLUG)}
                  title="A single-pane map of every project in this monorepo and how they connect"
                >
                  <span className="rail__nav-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <rect
                        x="1.6"
                        y="6.4"
                        width="3.2"
                        height="3.2"
                        rx="0.6"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <rect
                        x="6.4"
                        y="2.4"
                        width="3.2"
                        height="3.2"
                        rx="0.6"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <rect
                        x="6.4"
                        y="10.4"
                        width="3.2"
                        height="3.2"
                        rx="0.6"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <rect
                        x="11.2"
                        y="6.4"
                        width="3.2"
                        height="3.2"
                        rx="0.6"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M4.8 7.8 L6.4 4.4 M4.8 8.2 L6.4 11.6 M9.6 4.4 L11.2 7.8 M9.6 11.6 L11.2 8.2"
                        stroke="currentColor"
                        strokeWidth="1.1"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  Service map
                </button>
                <FleetNavButton
                  active={selected === FLEET_SLUG}
                  onSelect={() => setSelected(FLEET_SLUG)}
                />
                <button
                  type="button"
                  className={`rail__nav${selected === PARITY_SLUG ? " rail__nav--active" : ""}`}
                  onClick={() => setSelected(PARITY_SLUG)}
                  title="Platform parity — desktop feature checklist across Linux, macOS, and Windows"
                >
                  <span className="rail__nav-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <rect
                        x="1.6"
                        y="3.4"
                        width="12.8"
                        height="7.6"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M5.4 11 V13 M10.6 11 V13 M4 13.2 H12"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M4 6.2 L5.2 7.4 L7.2 5.2"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M9 5.4 H12.4 M9 7.2 H11.6 M9 8.8 H12"
                        stroke="currentColor"
                        strokeWidth="1.1"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  Platform parity
                </button>
                <button
                  type="button"
                  className={`rail__nav${selected === DISTRIBUTION_SLUG ? " rail__nav--active" : ""}`}
                  onClick={() => setSelected(DISTRIBUTION_SLUG)}
                  title="Release status across builds, npm, the download CDN, and the download page"
                >
                  <span className="rail__nav-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <circle cx="4" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.3" />
                      <circle cx="12" cy="3.5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
                      <circle cx="12" cy="12.5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
                      <path
                        d="M5.6 7 L10.4 4.2 M5.6 9 L10.4 11.8"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  Distribution
                </button>
                <input
                  type="search"
                  className="rail__filter"
                  placeholder="Filter projects…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <ProjectGrid projects={filtered} selected={selected} onSelect={setSelected} />
              </>
            )}
          </aside>
          <main
            className={`app__detail${showStack && selected === MAP_SLUG ? " app__detail--full" : ""}`}
          >
            {showStack && selected === OVERVIEW_SLUG ? (
              <OverviewView
                client={client}
                projects={projects}
                onSelectProject={setSelected}
                onGoToDistribution={() => setSelected(DISTRIBUTION_SLUG)}
                onGoToMap={() => setSelected(MAP_SLUG)}
                onGoToFleet={() => setSelected(FLEET_SLUG)}
              />
            ) : showStack && selected === READINESS_SLUG ? (
              <ProductionReadinessView />
            ) : showStack && selected === OBSERVABILITY_SLUG ? (
              <ObservabilityView client={client} />
            ) : showStack && selected === INBOX_SLUG ? (
              <InboxView client={client} />
            ) : showStack && selected === CERT_SLUG ? (
              <CertificationView client={client} root={appliedRoot ?? root} />
            ) : showStack && selected === AI_NATIVE_SLUG ? (
              <AiNativeView client={client} />
            ) : showStack && selected === MAP_SLUG ? (
              <MonorepoMap client={client} projects={projects} onSelectProject={setSelected} />
            ) : showStack && selected === DISTRIBUTION_SLUG ? (
              <DistributionView client={client} root={appliedRoot ?? root} />
            ) : showStack && selected === PARITY_SLUG ? (
              <PlatformParityView client={client} />
            ) : showStack && selected === FLEET_SLUG ? (
              <FleetView
                client={client}
                orgSlug={settings.fleetOrgSlug}
                onSlugChange={async (slug) => {
                  if (!client) return;
                  const next = await client.setSettings({ fleetOrgSlug: slug });
                  setSettings(next);
                }}
              />
            ) : showStack && selectedCard ? (
              <ProjectDetail card={selectedCard} client={client} />
            ) : showServices && !showStack ? (
              <ServicesEmptyState onOpenSettings={() => setSettingsOpen(true)} />
            ) : (
              <EmptyState
                loading={loading}
                error={error}
                root={appliedRoot ?? root}
                hasRoot={Boolean((appliedRoot ?? root).trim())}
                runtime={runtime}
              />
            )}
          </main>
        </div>
        {createOpen && client && (
          <CreateProjectModal
            client={client}
            onClose={() => setCreateOpen(false)}
            onCreated={handleCreated}
          />
        )}
        {client && (settingsOpen || forceSettings) && (
          <SettingsPanel
            client={client}
            settings={settings}
            forceChoice={forceSettings}
            onClose={() => setSettingsOpen(false)}
            onSaved={(next) => {
              setSettings(next);
              setSettingsOpen(false);
            }}
          />
        )}
        <VoiceDock projects={projects} actions={voiceActions} />
      </div>
    </WorkspaceCacheProvider>
  );
}

interface FleetNavButtonProps {
  active: boolean;
  onSelect: () => void;
}

function FleetNavButton({ active, onSelect }: FleetNavButtonProps) {
  const cache = useWorkspaceCache();
  const enrolled =
    cache.fleet.data?.enrollment?.enrolled === true &&
    cache.fleet.data?.enrollment?.jwtExpired === false;
  return (
    <button
      type="button"
      className={`rail__nav${active ? " rail__nav--active" : ""}`}
      onClick={onSelect}
      title={
        enrolled
          ? "Fleet — this machine is connected"
          : "Fleet control plane — agent enrollment, policies, audit, SSO"
      }
    >
      <span className="rail__nav-icon" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.6 L13.4 4 V8.4 C13.4 11.5 11 13.5 8 14.4 C5 13.5 2.6 11.5 2.6 8.4 V4 Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M5.6 8.2 L7.2 9.8 L10.4 6.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      Fleet
      {enrolled ? (
        <span
          className="rail__nav-status"
          aria-label="Connected to Fleet"
          title="Connected to Fleet"
        />
      ) : null}
    </button>
  );
}

interface ReadinessNavButtonProps {
  active: boolean;
  onSelect: () => void;
}

// Readiness rail entry. Carries an always-on indicator — a green dot when
// every blocking requirement is met, or a red count of open blocking gaps —
// so the production-readiness verdict is visible from every view.
function ReadinessNavButton({ active, onSelect }: ReadinessNavButtonProps) {
  const cache = useWorkspaceCache();
  const data = cache.readiness.data;
  const hasData = Boolean(data) && !data?.manifestError;
  const ready = data?.ready === true;
  const blockers = data?.totalBlockers ?? 0;
  return (
    <button
      type="button"
      className={`rail__nav${active ? " rail__nav--active" : ""}`}
      onClick={onSelect}
      title={
        !hasData
          ? "Production readiness — Fleet, SSG, and SigmaShake Desktop ship-readiness"
          : ready
            ? "Production ready — every blocking requirement is met"
            : `Not production ready — ${blockers} blocking gap${blockers === 1 ? "" : "s"}`
      }
    >
      <span className="rail__nav-icon" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect
            x="3"
            y="2.6"
            width="10"
            height="11.4"
            rx="1.3"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <rect
            x="5.6"
            y="1.4"
            width="4.8"
            height="2.4"
            rx="0.7"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M5.4 8 L7 9.6 L10.6 6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      Readiness
      {hasData && ready ? (
        <span
          className="rail__nav-status"
          aria-label="Production ready"
          title="Production ready"
        />
      ) : null}
      {hasData && !ready ? (
        <span
          className="rail__readiness-badge"
          aria-label={`${blockers} blocking gaps`}
          title={`${blockers} blocking gaps`}
        >
          {blockers}
        </span>
      ) : null}
    </button>
  );
}

interface TopBarProps {
  runtime: string;
  canGoBack: boolean;
  rootDraft: string;
  appliedRoot: string;
  onRootDraftChange: (v: string) => void;
  onRootApply: () => void;
  onRootReset: () => void;
  canPick: boolean;
  onPick: () => void;
  session: SessionInfo | null;
  mode: WorkspaceSettings["mode"];
  onOpenSettings: () => void;
}

function TopBar(props: TopBarProps) {
  const {
    runtime,
    canGoBack,
    rootDraft,
    appliedRoot,
    onRootDraftChange,
    onRootApply,
    onRootReset,
    canPick,
    onPick,
    session,
    mode,
    onOpenSettings,
  } = props;
  const isDirty = rootDraft.trim() !== appliedRoot.trim();
  return (
    <header className="topbar">
      {canGoBack && (
        <a href="/" className="topbar__back" title="Back to SSG Dashboard">
          ← Dashboard
        </a>
      )}
      <div className="topbar__brand">
        <svg className="topbar__brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M16 3 L27 8 V18 C27 23.5 22 27.5 16 29 C10 27.5 5 23.5 5 18 V8 Z"
            fill="currentColor"
            opacity="0.16"
          />
          <path
            d="M16 3 L27 8 V18 C27 23.5 22 27.5 16 29 C10 27.5 5 23.5 5 18 V8 Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M11 14 L16 11 L21 14 V19 L16 22 L11 19 Z" fill="currentColor" />
        </svg>
        <h1 className="topbar__title">Workspace</h1>
      </div>
      <span className="topbar__runtime" title="Active runtime">
        {runtime}
      </span>
      <button
        type="button"
        className="topbar__mode"
        onClick={onOpenSettings}
        title="Workspace mode — switch between monorepo manager, services, or both"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm0 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5-3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM3 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
            fill="currentColor"
          />
        </svg>
        <span className="topbar__mode-label">{modeLabel(mode)}</span>
      </button>
      <div className="topbar__root">
        <label className="topbar__root-label">Root</label>
        <input
          type="text"
          className="topbar__root-input"
          value={rootDraft}
          onChange={(e) => onRootDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRootApply();
          }}
          placeholder="/absolute/path/to/your/monorepo"
          spellCheck={false}
        />
        {canPick && (
          <button
            type="button"
            className="topbar__btn"
            onClick={onPick}
            title="Open a native folder picker to choose your monorepo"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.382a1.5 1.5 0 0 1 1.342.83l.276.553a1.5 1.5 0 0 0 1.342.829H13a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 13.21H3A1.5 1.5 0 0 1 1.5 11.71v-7.21Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            Browse…
          </button>
        )}
        <button
          type="button"
          className={`topbar__btn${isDirty ? " topbar__btn--primary" : ""}`}
          onClick={onRootApply}
          disabled={!isDirty}
          title={isDirty ? "Apply root path" : "No changes"}
        >
          Apply
        </button>
        <button
          type="button"
          className="topbar__btn"
          onClick={onRootReset}
          title="Reset to daemon working directory"
        >
          Reset
        </button>
      </div>
      {session && runtime === "cloud" ? (
        <div className="topbar__session">
          {session.avatar ? (
            <img
              src={session.avatar}
              alt=""
              className="topbar__session-avatar"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="topbar__session-avatar topbar__session-avatar--mono">
              {session.login.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span
            className="topbar__session-login"
            title={`Signed in via ${session.authType ?? "accounts.sigmashake.com"}`}
          >
            {session.login}
          </span>
          <a
            className="topbar__btn topbar__btn--ghost"
            href="https://accounts.sigmashake.com/auth/logout"
            title="Sign out — clears the .sigmashake.com session"
          >
            Sign out
          </a>
        </div>
      ) : null}
    </header>
  );
}

interface EmptyStateProps {
  loading: boolean;
  error: string | null;
  root: string;
  hasRoot: boolean;
  runtime: string;
}

function EmptyState({ loading, error, root, hasRoot, runtime }: EmptyStateProps) {
  if (loading) {
    return (
      <div className="state-card">
        <StateMark variant="info" />
        <h2 className="state-card__title">Loading projects…</h2>
        <p className="state-card__body">
          Scanning <code>{root || "default root"}</code> for sigmashake-style projects.
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="state-card state-card--error">
        <StateMark variant="error" />
        <h2 className="state-card__title">Couldn&apos;t open that folder</h2>
        <p className="state-card__body">{error}</p>
        <ul className="state-card__hints">
          <li>
            Double-check the <strong>Root</strong> path at the top — it should point at a folder
            that exists on this computer.
          </li>
          <li>
            The folder needs to be somewhere inside your home directory — SigmaShake won&apos;t
            reach outside it.
          </li>
        </ul>
      </div>
    );
  }
  if (runtime === "cloud") {
    return (
      <div className="state-card">
        <StateMark variant="info" />
        <h2 className="state-card__title">Welcome to Workspace</h2>
        <p className="state-card__body">
          You&apos;re viewing Workspace on the web. You can browse every project in the monorepo and
          see how they fit together. To run, inspect, or edit anything, open Workspace in the
          SigmaShake desktop app — it can reach the files on your own computer.
        </p>
      </div>
    );
  }
  return (
    <div className="state-card">
      <StateMark variant="info" />
      <h2 className="state-card__title">
        {hasRoot ? "No projects here yet" : "Point Workspace at your code"}
      </h2>
      <p className="state-card__body">
        Workspace is a visual home for everything in your monorepo — every app and service, what
        each one does, and how to run it.{" "}
        {hasRoot ? (
          <>
            We looked in <code>{root}</code> but didn&apos;t find any projects.
          </>
        ) : (
          <>Tell it where your code lives to get started.</>
        )}
      </p>
      <ul className="state-card__hints">
        <li>
          Set the <strong>Root</strong> field at the top of the window to the folder that holds your
          projects, then press <kbd>Enter</kbd> or click <strong>Apply</strong>.
        </li>
        <li>
          Each project lives in its own subfolder with a <code>package.json</code> (or{" "}
          <code>mix.exs</code> / <code>Cargo.toml</code>) inside it.
        </li>
        <li>The folder needs to be somewhere inside your home directory.</li>
      </ul>
    </div>
  );
}

function StateMark({ variant }: { variant: "info" | "error" }) {
  if (variant === "error") {
    return (
      <div className="state-card__mark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2 L22 20 H2 Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            fill="none"
          />
          <path d="M12 9 V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17" r="1.1" fill="currentColor" />
        </svg>
      </div>
    );
  }
  return (
    <div className="state-card__mark">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2 L21 6.5 V14 C21 18.5 17 21.5 12 22.5 C7 21.5 3 18.5 3 14 V6.5 Z"
          fill="currentColor"
          opacity="0.18"
        />
        <path
          d="M12 2 L21 6.5 V14 C21 18.5 17 21.5 12 22.5 C7 21.5 3 18.5 3 14 V6.5 Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M8.5 11 L12 8.5 L15.5 11 V15 L12 17.5 L8.5 15 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

function modeLabel(mode: WorkspaceSettings["mode"]): string {
  if (mode === "stack") return "Stack";
  if (mode === "services") return "Services";
  return "Both";
}
