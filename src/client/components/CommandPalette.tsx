// src/client/components/CommandPalette.tsx
//
// Global ⌘K / Ctrl+K palette for the Workspace UI — platform parity with the
// SSG dashboard's palette. Jump to any monorepo view, any project by slug, or
// run a top-level action (open settings, refresh, create project, switch
// theme). The active <li> is pinned with a ref and a useEffect calls
// scrollIntoView({block:"nearest"}) on every highlight change so arrow-key
// navigation never scrolls a row off-screen — the same bug the gov palette
// used to have.
//
// Programmatic open for AI agents:
//   window.dispatchEvent(new CustomEvent("sigmashake:open-palette",
//     { detail: { query: "fleet" } }));

import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectCard } from "../api/types";

export interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  group: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  projects: ProjectCard[];
  onSelectProject: (slug: string) => void;
  onSelectView: (slug: string) => void;
  onOpenSettings: () => void;
  onOpenCreate: () => void;
  onRefresh: () => void;
  onSetFilter: (value: string) => void;
}

const VIEW_ITEMS: ReadonlyArray<{
  slug: string;
  label: string;
  hint: string;
  keywords?: string;
}> = [
  {
    slug: "::overview",
    label: "Overview",
    hint: "monorepo overview",
    keywords: "home dashboard",
  },
  {
    slug: "::readiness",
    label: "Production Readiness",
    hint: "release gates",
    keywords: "readiness gate ship",
  },
  {
    slug: "::observability",
    label: "Observability",
    hint: "metrics + latency",
    keywords: "metrics telemetry",
  },
  {
    slug: "::inbox",
    label: "Inbox",
    hint: "tickets + leads",
    keywords: "support tickets sales leads",
  },
  {
    slug: "::cert",
    label: "Certification",
    hint: "SDLC cert score",
    keywords: "gold cert sdlc compliance",
  },
  {
    slug: "::ai-native",
    label: "AI Native",
    hint: "agent-readiness",
    keywords: "ai mcp cli",
  },
  {
    slug: "::map",
    label: "Service Map",
    hint: "dependency graph",
    keywords: "graph topology map",
  },
  {
    slug: "::distribution",
    label: "Distribution",
    hint: "release channels",
    keywords: "publish release npm docker",
  },
  {
    slug: "::parity",
    label: "Platform Parity",
    hint: "feature parity",
    keywords: "platform parity catalog",
  },
  {
    slug: "::fleet",
    label: "Fleet",
    hint: "MDM enrollment",
    keywords: "fleet device mdm",
  },
];

function score(query: string, hay: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const h = hay.toLowerCase();
  const direct = h.indexOf(q);
  if (direct === 0) return 1000;
  if (direct > 0) return 600 - direct;
  let qi = 0;
  let last = -1;
  let gaps = 0;
  for (let i = 0; i < h.length && qi < q.length; i++) {
    if (h[i] === q[qi]) {
      if (last >= 0) gaps += i - last - 1;
      last = i;
      qi++;
    }
  }
  if (qi < q.length) return -1;
  return 200 - gaps;
}

function rankItem(query: string, it: PaletteAction): number {
  if (!query) return 1;
  const a = score(query, it.label);
  const b = score(query, it.hint);
  const c = it.keywords ? score(query, it.keywords) : -1;
  return Math.max(a, b, c);
}

export function CommandPalette(props: CommandPaletteProps) {
  const {
    projects,
    onSelectProject,
    onSelectView,
    onOpenSettings,
    onOpenCreate,
    onRefresh,
    onSetFilter,
  } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen(e: Event) {
      const ce = e as CustomEvent<{ query?: string }>;
      setQuery(ce.detail?.query ?? "");
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("sigmashake:open-palette", onOpen as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sigmashake:open-palette", onOpen as EventListener);
    };
  }, []);

  const viewItems = useMemo<PaletteAction[]>(
    () =>
      VIEW_ITEMS.map((v) => ({
        id: `view:${v.slug}`,
        label: v.label,
        hint: v.hint,
        group: "Views",
        keywords: v.keywords,
        run: () => onSelectView(v.slug),
      })),
    [onSelectView],
  );

  const projectItems = useMemo<PaletteAction[]>(
    () =>
      projects.map((p) => ({
        id: `proj:${p.slug}`,
        label: p.slug,
        hint: p.description || p.dir || "",
        group: "Projects",
        keywords: `${p.description ?? ""} ${p.type ?? ""}`,
        run: () => onSelectProject(p.slug),
      })),
    [projects, onSelectProject],
  );

  const actionItems = useMemo<PaletteAction[]>(
    () => [
      {
        id: "act:create",
        label: "New project…",
        hint: "scaffold a service",
        group: "Actions",
        keywords: "create new scaffold",
        run: () => onOpenCreate(),
      },
      {
        id: "act:settings",
        label: "Settings",
        hint: "workspace settings",
        group: "Actions",
        keywords: "settings preferences",
        run: () => onOpenSettings(),
      },
      {
        id: "act:refresh",
        label: "Refresh projects",
        hint: "re-list projects",
        group: "Actions",
        keywords: "refresh reload",
        run: () => onRefresh(),
      },
      {
        id: "act:filter-clear",
        label: "Clear project filter",
        hint: "reset rail filter",
        group: "Actions",
        keywords: "filter clear reset",
        run: () => onSetFilter(""),
      },
      {
        id: "act:theme",
        label: "Toggle light / dark theme",
        hint: "html[data-theme]",
        group: "Actions",
        keywords: "theme dark light mode",
        run: () => {
          const html = document.documentElement;
          const cur = html.getAttribute("data-theme") || "system";
          const next = cur === "dark" ? "light" : "dark";
          html.setAttribute("data-theme", next);
          try {
            localStorage.setItem("ssg:workspace:theme", next);
          } catch {}
        },
      },
    ],
    [onOpenCreate, onOpenSettings, onRefresh, onSetFilter],
  );

  const allItems = useMemo(
    () => [...viewItems, ...actionItems, ...projectItems],
    [viewItems, actionItems, projectItems],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    const ranked = allItems
      .map((it) => ({ it, s: rankItem(q, it) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s);
    return ranked.slice(0, 80).map((r) => r.it);
  }, [allItems, query]);

  const grouped = useMemo(() => {
    if (query.trim()) return [{ group: "Matches", items: filtered }];
    const order = ["Views", "Actions", "Projects"];
    const map = new Map<string, PaletteAction[]>();
    for (const it of filtered) {
      const arr = map.get(it.group) ?? [];
      arr.push(it);
      map.set(it.group, arr);
    }
    return order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g) ?? [] }));
  }, [filtered, query]);

  const flatOrder = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query change
  useEffect(() => setActive(0), [query]);

  // Scroll the active row into view on every highlight change. block:"nearest"
  // keeps already-visible items still — only off-screen items trigger a scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: active drives the scroll target
  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, open]);

  if (!open) return null;

  const choose = (it: PaletteAction | undefined) => {
    if (!it) return;
    setOpen(false);
    it.run();
  };

  let flatIndex = -1;
  return (
    <div
      className="wcmdk-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="wcmdk-panel">
        <input
          ref={inputRef}
          className="wcmdk-input"
          placeholder="Search views, projects, actions…"
          value={query}
          aria-label="Search"
          aria-controls="wcmdk-listbox"
          aria-activedescendant={
            flatOrder[active] ? `wcmdk-opt-${flatOrder[active].id}` : undefined
          }
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, flatOrder.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(Math.max(flatOrder.length - 1, 0));
            } else if (e.key === "PageDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 8, flatOrder.length - 1));
            } else if (e.key === "PageUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 8, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(flatOrder[active]);
            }
          }}
        />
        <div id="wcmdk-listbox" className="wcmdk-list" role="listbox" aria-label="Results">
          {flatOrder.length === 0 ? (
            <div className="wcmdk-empty">No matches</div>
          ) : (
            grouped.map((g) => (
              <div key={g.group} className="wcmdk-group">
                <div className="wcmdk-group-label">{g.group}</div>
                <div className="wcmdk-group-list">
                  {g.items.map((it) => {
                    flatIndex += 1;
                    const isActive = flatIndex === active;
                    const myIndex = flatIndex;
                    return (
                      <div
                        key={it.id}
                        id={`wcmdk-opt-${it.id}`}
                        ref={isActive ? activeRef : null}
                        role="option"
                        aria-selected={isActive}
                        tabIndex={-1}
                        className={`wcmdk-item${isActive ? " wcmdk-item--active" : ""}`}
                        onMouseEnter={() => setActive(myIndex)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          choose(it);
                        }}
                      >
                        <span className="wcmdk-item-label">{it.label}</span>
                        <span className="wcmdk-hint">{it.hint}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="wcmdk-foot">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>PgUp/PgDn jump</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
