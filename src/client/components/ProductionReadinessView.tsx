// Production Readiness view — the one screen that answers "are Fleet, SSG, and
// SigmaShake Desktop production ready, right now?".
//
// Data source: the `readiness` slice of the shared WorkspaceCacheProvider,
// which calls GET /api/json/workspace/readiness on the SSG daemon. That
// endpoint evaluates `.sigmashake/production-readiness.json` — auto checks
// (cert-signal, path-exists) resolve live against the SDLC cert scanner + the
// filesystem; manual checks read their status from the manifest. A product is
// production-ready when every blocking requirement resolves to "met".
//
// The manifest is the editable source of truth for *which* requirements
// exist — add or retune a requirement there and it shows up here on the next
// scan. Nothing in this component is hard-coded per product.

import { useMemo, useRef, useState } from "react";

import type {
  ReadinessCategory,
  ReadinessProduct,
  ReadinessRequirement,
  ReadinessStatus,
} from "../api/types";
import { friendlyError } from "../lib/errors";
import { useWorkspaceCache } from "../lib/workspace-cache";
import { ProgressStrip } from "./ProgressStrip";
import "../styles/readiness.css";

type Tone = "ok" | "warn" | "err" | "muted";

const STATUS_TONE: Record<ReadinessStatus, Tone> = {
  met: "ok",
  partial: "warn",
  unmet: "err",
  unknown: "muted",
};

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  met: "Met",
  partial: "Partial",
  unmet: "Unmet",
  unknown: "Unknown",
};

const CATEGORY_LABEL: Record<ReadinessCategory, string> = {
  quality: "Quality",
  security: "Security",
  reliability: "Reliability",
  release: "Release",
  compliance: "Compliance",
  docs: "Documentation",
};

const CATEGORY_ORDER: ReadinessCategory[] = [
  "quality",
  "security",
  "reliability",
  "release",
  "compliance",
  "docs",
];

// Sort key: unmet blockers float to the top, met recommendations sink.
const STATUS_RANK: Record<ReadinessStatus, number> = {
  unmet: 0,
  unknown: 1,
  partial: 2,
  met: 3,
};

function reqRank(r: ReadinessRequirement): number {
  return STATUS_RANK[r.status] * 2 + (r.blocking ? 0 : 1);
}

function timeAgo(epochMs: number): string {
  const delta = Math.max(0, Date.now() - epochMs);
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Derived signals: priority + risk + importance ────────────────────────────
// The API hands back `status`, `blocking`, `category` per requirement. The
// expanded drill-down folds those into operator-facing badges + a paragraph
// that explains *why* an AI agent should care, so the handoff prompt below
// reads like an actual brief instead of a row dump.

interface Badge {
  label: string;
  tone: Tone;
}

function computePriority(req: ReadinessRequirement): Badge {
  if (req.status === "met") return { label: "Done", tone: "ok" };
  if (req.blocking) {
    if (req.status === "unmet") return { label: "P0 · Critical", tone: "err" };
    if (req.status === "partial") return { label: "P1 · High", tone: "warn" };
    return { label: "P2 · Verify", tone: "warn" };
  }
  return { label: "P3 · Recommended", tone: "muted" };
}

function computeRisk(req: ReadinessRequirement): Badge {
  if (req.status === "met") return { label: "Cleared", tone: "ok" };
  if (req.blocking) {
    if (req.status === "unmet") return { label: "Severe — blocks release", tone: "err" };
    if (req.status === "partial") return { label: "High — partial coverage", tone: "warn" };
    return { label: "Unmeasured — verify before ship", tone: "warn" };
  }
  return { label: "Low — does not block", tone: "muted" };
}

const IMPORTANCE_PROSE: Record<ReadinessCategory, { blocking: string; recommended: string }> = {
  quality: {
    blocking: "Code correctness gate. A regression here ships defects straight to users.",
    recommended: "Code-quality polish. Worth doing before the next release; not a blocker.",
  },
  security: {
    blocking:
      "Trust boundary. Customer data, credentials, or compliance posture is exposed if this fails.",
    recommended:
      "Defense-in-depth improvement. Tightens the security posture beyond the minimum bar.",
  },
  reliability: {
    blocking:
      "Uptime contract. A failure here drives on-call burden and customer-visible downtime.",
    recommended:
      "Operational resilience. Reduces failure modes that aren't yet on the critical path.",
  },
  release: {
    blocking: "Ship pipeline. Without this the release process itself can't run end-to-end.",
    recommended:
      "Release ergonomics. Improves distribution surface area but does not block a release.",
  },
  compliance: {
    blocking:
      "Audit gate. Required for SOC 2 / customer due-diligence — affects deals, not just code.",
    recommended:
      "Compliance enrichment. Strengthens the audit narrative without being load-bearing.",
  },
  docs: {
    blocking:
      "Onboarding gate. Without this, customers and AI agents misuse or stall on the product.",
    recommended: "Documentation polish. Improves clarity but is not a release blocker.",
  },
};

function computeImportance(req: ReadinessRequirement): string {
  return IMPORTANCE_PROSE[req.category][req.blocking ? "blocking" : "recommended"];
}

function buildAgentPrompt(args: {
  req: ReadinessRequirement;
  productName: string;
  productProjects: string[];
  priority: Badge;
  risk: Badge;
  importance: string;
}): string {
  const { req, productName, productProjects, priority, risk, importance } = args;
  const lines: string[] = [];
  lines.push(`# ${req.title}`);
  lines.push("");
  lines.push(`Product:      ${productName}`);
  lines.push(`Requirement:  ${req.id}`);
  lines.push(`Priority:     ${priority.label}`);
  lines.push(`Risk:         ${risk.label}`);
  lines.push(
    `Severity:     ${req.blocking ? "Blocking — must be MET before ship" : "Recommended — does not block"}`,
  );
  lines.push(`Category:     ${CATEGORY_LABEL[req.category]}`);
  if (productProjects.length > 0) {
    lines.push(`Projects:     ${productProjects.join(", ")}`);
  }
  lines.push("");
  lines.push("## Why this matters");
  lines.push(importance);
  if (req.detail) {
    lines.push("");
    lines.push(req.detail);
  }
  lines.push("");
  lines.push("## Current state");
  lines.push(`Status:   ${req.status.toUpperCase()}`);
  lines.push(`Evidence: ${req.evidence}`);
  if (req.source === "manual" && req.updatedAt) {
    lines.push(`Last manually attested: ${req.updatedAt}`);
  }
  lines.push("");
  lines.push("## What to do");
  if (req.remediation) {
    lines.push(req.remediation);
  } else {
    lines.push(
      "No prepackaged remediation command. Investigate the evidence above; the underlying check is in the SSG daemon at GET /api/json/workspace/certify.",
    );
  }
  lines.push("");
  lines.push("## Definition of done");
  lines.push("Re-scan via the local SSG daemon and confirm status flips to met:");
  lines.push(
    `  curl -s http://127.0.0.1:7901/api/json/workspace/readiness | jq '.products[].requirements[] | select(.id == "${req.id}")'`,
  );
  lines.push("");
  lines.push(
    "Do NOT edit .sigmashake/production-readiness.json to force-pass — the underlying signal must actually flip. For cert-signal checks the matching signal in /api/json/workspace/certify must also resolve to 'ok'.",
  );
  return lines.join("\n");
}

interface CategoryGroup {
  category: ReadinessCategory;
  items: ReadinessRequirement[];
}

function groupByCategory(reqs: ReadinessRequirement[]): CategoryGroup[] {
  const map = new Map<ReadinessCategory, ReadinessRequirement[]>();
  for (const r of reqs) {
    const arr = map.get(r.category) ?? [];
    arr.push(r);
    map.set(r.category, arr);
  }
  const out: CategoryGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const items = map.get(category);
    if (items && items.length > 0) {
      out.push({ category, items: [...items].sort((a, b) => reqRank(a) - reqRank(b)) });
    }
  }
  return out;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ShieldCheck() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 L20 6 V12.5 C20 17.5 16.5 20.8 12 22 C7.5 20.8 4 17.5 4 12.5 V6 Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M12 2.5 L20 6 V12.5 C20 17.5 16.5 20.8 12 22 C7.5 20.8 4 17.5 4 12.5 V6 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 12 L11 14.5 L15.6 9.4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldAlert() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 L20 6 V12.5 C20 17.5 16.5 20.8 12 22 C7.5 20.8 4 17.5 4 12.5 V6 Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M12 2.5 L20 6 V12.5 C20 17.5 16.5 20.8 12 22 C7.5 20.8 4 17.5 4 12.5 V6 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 8 V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="1.15" fill="currentColor" />
    </svg>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ReadinessStatus }) {
  return (
    <span className={`rdy-pill rdy-pill--${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
  );
}

function RequirementRow({
  req,
  productName,
  productProjects,
  isExpanded,
  onToggle,
}: {
  req: ReadinessRequirement;
  productName: string;
  productProjects: string[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [copiedFix, setCopiedFix] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const fixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const priority = computePriority(req);
  const risk = computeRisk(req);
  const importance = computeImportance(req);
  const showFix = req.status !== "met" && Boolean(req.remediation);
  const showAgentPrompt = req.status !== "met";

  const onCopyFix = async () => {
    if (!req.remediation) return;
    try {
      await navigator.clipboard.writeText(req.remediation);
    } catch {
      /* clipboard unavailable */
    }
    setCopiedFix(true);
    if (fixTimerRef.current) clearTimeout(fixTimerRef.current);
    fixTimerRef.current = setTimeout(() => setCopiedFix(false), 1500);
  };

  const onCopyPrompt = async () => {
    const prompt = buildAgentPrompt({
      req,
      productName,
      productProjects,
      priority,
      risk,
      importance,
    });
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      /* clipboard unavailable */
    }
    setCopiedPrompt(true);
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    promptTimerRef.current = setTimeout(() => setCopiedPrompt(false), 1500);
  };

  return (
    <li
      className={`rdy-req rdy-req--${STATUS_TONE[req.status]}${isExpanded ? " rdy-req--expanded" : ""}`}
    >
      <button type="button" className="rdy-req__head" aria-expanded={isExpanded} onClick={onToggle}>
        <span
          className={`rdy-req__chev${isExpanded ? " rdy-req__chev--open" : ""}`}
          aria-hidden="true"
        >
          ▸
        </span>
        <StatusPill status={req.status} />
        <span className="rdy-req__title">{req.title}</span>
        <span className={`rdy-req__tag rdy-req__tag--${req.blocking ? "blocking" : "recommended"}`}>
          {req.blocking ? "Blocking" : "Recommended"}
        </span>
        <span className={`rdy-req__pri rdy-req__pri--${priority.tone}`}>{priority.label}</span>
        <span
          className="rdy-req__src"
          title={req.source === "auto" ? "Resolved live" : "Manually attested"}
        >
          {req.source === "auto" ? "auto" : "manual"}
          {req.updatedAt ? ` · ${req.updatedAt}` : ""}
        </span>
      </button>

      <p className="rdy-req__evidence">{req.evidence}</p>

      {isExpanded ? (
        <div className="rdy-req__drill">
          {req.detail ? <p className="rdy-req__detail">{req.detail}</p> : null}

          <dl className="rdy-req__facts">
            <div className="rdy-fact">
              <dt className="rdy-fact__label">Priority</dt>
              <dd className={`rdy-fact__value rdy-fact__value--${priority.tone}`}>
                {priority.label}
              </dd>
            </div>
            <div className="rdy-fact">
              <dt className="rdy-fact__label">Risk</dt>
              <dd className={`rdy-fact__value rdy-fact__value--${risk.tone}`}>{risk.label}</dd>
            </div>
            <div className="rdy-fact">
              <dt className="rdy-fact__label">Category</dt>
              <dd className="rdy-fact__value">{CATEGORY_LABEL[req.category]}</dd>
            </div>
            <div className="rdy-fact">
              <dt className="rdy-fact__label">Requirement ID</dt>
              <dd className="rdy-fact__value rdy-fact__value--mono">{req.id}</dd>
            </div>
          </dl>

          <div className="rdy-req__why">
            <h5 className="rdy-req__why-title">Why this matters</h5>
            <p className="rdy-req__why-body">{importance}</p>
          </div>

          {showFix ? (
            <div className="rdy-req__fix">
              <code className="rdy-req__fix-cmd">{req.remediation}</code>
              <button type="button" className="rdy-req__fix-copy" onClick={onCopyFix}>
                {copiedFix ? "Copied" : "Copy fix"}
              </button>
            </div>
          ) : null}

          {showAgentPrompt ? (
            <div className="rdy-req__agent">
              <div className="rdy-req__agent-head">
                <h5 className="rdy-req__agent-title">Hand off to an AI coding agent</h5>
                <button type="button" className="rdy-req__fix-copy" onClick={onCopyPrompt}>
                  {copiedPrompt ? "Copied" : "Copy prompt"}
                </button>
              </div>
              <pre className="rdy-req__agent-prompt">
                {buildAgentPrompt({
                  req,
                  productName,
                  productProjects,
                  priority,
                  risk,
                  importance,
                })}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ProductCard({
  product,
  blockersOnly,
}: {
  product: ReadinessProduct;
  blockersOnly: boolean;
}) {
  const visible = blockersOnly
    ? product.requirements.filter((r) => r.blocking && r.status !== "met")
    : product.requirements;
  const groups = useMemo(() => groupByCategory(visible), [visible]);
  const tone: Tone = product.ready ? "ok" : "err";

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allVisibleIds = visible.map((r) => r.id);
  const allExpanded = allVisibleIds.length > 0 && allVisibleIds.every((id) => expanded.has(id));
  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(allVisibleIds));
  };

  return (
    <article className={`rdy-product rdy-product--${product.ready ? "ready" : "blocked"}`}>
      <header className="rdy-product__head">
        <span className={`rdy-pill rdy-pill--${tone} rdy-pill--lg`}>
          {product.ready ? "Ready" : "Not ready"}
        </span>
        <div className="rdy-product__heading">
          <h3 className="rdy-product__name">{product.name}</h3>
          <p className="rdy-product__blurb">{product.blurb}</p>
        </div>
        {product.blockerCount > 0 ? (
          <span className="rdy-product__blockers" title="Blocking requirements not yet met">
            {product.blockerCount} blocker{product.blockerCount === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="rdy-product__blockers rdy-product__blockers--clear">0 blockers</span>
        )}
      </header>

      <div className="rdy-product__meta">
        <div className="rdy-product__projects">
          {product.projects.map((slug) => (
            <span key={slug} className="rdy-chip">
              {slug}
            </span>
          ))}
        </div>
        <div className="rdy-product__totals">
          <span className="rdy-total rdy-total--ok">{product.totals.met} met</span>
          <span className="rdy-total rdy-total--warn">{product.totals.partial} partial</span>
          <span className="rdy-total rdy-total--err">{product.totals.unmet} unmet</span>
          <span className="rdy-total rdy-total--muted">{product.totals.unknown} unknown</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="rdy-product__empty">
          {blockersOnly
            ? "Every blocking requirement for this product is met."
            : "No requirements defined for this product."}
        </p>
      ) : (
        <>
          <div className="rdy-product__tools">
            <button type="button" className="rdy-product__expand" onClick={toggleAll}>
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </div>
          {groups.map((g) => (
            <section key={g.category} className="rdy-cat">
              <h4 className="rdy-cat__title">{CATEGORY_LABEL[g.category]}</h4>
              <ul className="rdy-cat__list">
                {g.items.map((r) => (
                  <RequirementRow
                    key={r.id}
                    req={r}
                    productName={product.name}
                    productProjects={product.projects}
                    isExpanded={expanded.has(r.id)}
                    onToggle={() => toggle(r.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </article>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProductionReadinessView() {
  const cache = useWorkspaceCache();
  const readiness = cache.readiness;
  const data = readiness.data;
  const [blockersOnly, setBlockersOnly] = useState(false);

  // Loading skeleton — first paint, no cached data yet.
  if (!data && readiness.loading && !readiness.error) {
    return (
      <div className="rdy">
        <header className="rdy__hero rdy__hero--skeleton">
          <ProgressStrip loading label="Evaluating production readiness" />
          <div className="rdy__skeleton-verdict" />
        </header>
        <div className="rdy__products">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rdy__skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  // Error state — including the cloud runtime's CapabilityError.
  if (!data && readiness.error) {
    return (
      <div className="rdy rdy--empty">
        <h2 className="rdy__empty-title">Couldn&apos;t evaluate production readiness</h2>
        <p className="rdy__empty-body">{friendlyError(readiness.error)}</p>
        <button type="button" className="rdy__rescan" onClick={() => readiness.refresh()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  // The manifest is missing or malformed — nothing to evaluate.
  if (data.manifestError) {
    return (
      <div className="rdy rdy--empty">
        <h2 className="rdy__empty-title">No production-readiness manifest</h2>
        <p className="rdy__empty-body">{data.manifestError}</p>
        <p className="rdy__empty-hint">
          Create <code>.sigmashake/production-readiness.json</code> at the monorepo root to define
          which requirements gate each product. The SSG daemon evaluates it live.
        </p>
        <button type="button" className="rdy__rescan" onClick={() => readiness.refresh()}>
          Re-scan
        </button>
      </div>
    );
  }

  const { ready, readyProductCount, productCount, totalBlockers, products } = data;

  return (
    <div className="rdy">
      <header className="rdy__hero">
        <ProgressStrip
          loading={readiness.loading}
          label={
            readiness.loading ? "Refreshing in background" : `Updated ${timeAgo(data.generatedAt)}`
          }
        />
        <div className={`rdy__verdict rdy__verdict--${ready ? "ready" : "blocked"}`}>
          <span className="rdy__verdict-mark">{ready ? <ShieldCheck /> : <ShieldAlert />}</span>
          <div className="rdy__verdict-text">
            <h2 className="rdy__verdict-title">
              {ready ? "Production ready" : "Not production ready"}
            </h2>
            <p className="rdy__verdict-meta">
              {readyProductCount} of {productCount} product{productCount === 1 ? "" : "s"} ready
              {totalBlockers > 0
                ? ` · ${totalBlockers} blocking gap${totalBlockers === 1 ? "" : "s"} to close`
                : " · every blocking requirement met"}
            </p>
            <p className="rdy__verdict-sub">
              Live evaluation of <code>.sigmashake/production-readiness.json</code> — auto checks
              re-resolve on every scan, manual checks track attested state.
            </p>
          </div>
          <div className="rdy__controls">
            <label className="rdy__toggle">
              <input
                type="checkbox"
                checked={blockersOnly}
                onChange={(e) => setBlockersOnly(e.target.checked)}
              />
              Blockers only
            </label>
            <button
              type="button"
              className="rdy__rescan"
              onClick={() => readiness.refresh()}
              disabled={readiness.loading}
            >
              Re-scan
            </button>
          </div>
        </div>
      </header>

      <div className="rdy__products">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} blockersOnly={blockersOnly} />
        ))}
      </div>
    </div>
  );
}
