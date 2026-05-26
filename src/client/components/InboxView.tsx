// Monorepo-wide "Inbox" panel. Read + inline-triage unified view over:
//   - sigmashake-support tickets (/agent/tickets via service binding)
//   - sigmashake-sales leads (/agent/leads via service binding)
//
// Cloud-only by design: the proxy holds SUPPORT_AGENT_TOKEN + SALES_AGENT_TOKEN
// secrets + the SUPPORT/SALES service bindings. Local + electrobun runtimes
// render an "Open in cloud" CTA instead of trying to fetch.
//
// Mutations supported inline:
//   - Reply to a support ticket (public or internal note)
//   - Close a support ticket with optional resolution note
//   - Change ticket status (open / in_progress / waiting / resolved / closed)
//   - Change lead status (new / replied / ignored / escalated / meeting_booked / closed)
// Everything else still lives on support.sigmashake.com — click the ticket
// subject to open the full thread there.

import { useCallback, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  InboxLead,
  InboxSourceStatus,
  InboxTicket,
  LeadClassification,
  LeadStatus,
  TicketSeverity,
  TicketStatus,
} from "../api/types";
import { useWorkspaceCache } from "../lib/workspace-cache";
import { ProgressStrip } from "./ProgressStrip";

const SUPPORT_BASE = "https://support.sigmashake.com";

const TICKET_STATUSES: readonly TicketStatus[] = [
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
];

const LEAD_STATUSES: readonly LeadStatus[] = [
  "new",
  "replied",
  "ignored",
  "escalated",
  "meeting_booked",
  "closed",
];

interface Props {
  client: WorkspaceApiClient | null;
}

export function InboxView({ client }: Props) {
  const cache = useWorkspaceCache();
  const slice = cache.inbox;
  const snapshot = slice.data;

  const refresh = useCallback(() => {
    slice.refresh();
  }, [slice]);

  // Cloud-only — the bearers + service bindings only exist on the workspace
  // Worker. Local + electrobun + vscode runtimes get a friendly "open in
  // cloud" CTA below.
  const isCloud = client?.runtime === "cloud";

  if (!isCloud) {
    return (
      <div className="panel inbox">
        <header className="inbox__header">
          <div>
            <h3 className="panel__h3">Inbox</h3>
            <p className="panel__muted">
              Support tickets + sales leads, all in one place. Tracks what needs to be fixed and
              every customer conversation.
            </p>
          </div>
        </header>
        <div className="state-card">
          <h2 className="state-card__title">Open Inbox in the cloud</h2>
          <p className="state-card__body">
            The unified Inbox needs the support API bearer + the sales service binding — both live
            on the workspace.sigmashake.com Cloudflare Worker. Open it in your browser to view and
            triage tickets + leads.
          </p>
          <p className="state-card__hints" style={{ marginTop: 16 }}>
            <a
              className="pill-btn pill-btn--primary"
              href="https://workspace.sigmashake.com/"
              target="_blank"
              rel="noreferrer"
            >
              Open workspace.sigmashake.com →
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (!snapshot && slice.loading) {
    return (
      <div className="panel inbox">
        <h3 className="panel__h3">Inbox</h3>
        <ProgressStrip loading={true} label="Fetching tickets and leads…" />
      </div>
    );
  }

  if (!snapshot && slice.error) {
    return (
      <div className="panel inbox">
        <h3 className="panel__h3">Inbox</h3>
        <div className="state-card state-card--error">
          <p className="state-card__body">{slice.error}</p>
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={refresh}
            disabled={slice.loading}
            style={{ marginTop: 12 }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!snapshot || !client) return null;

  return (
    <div className="panel inbox">
      <ProgressStrip loading={slice.loading} label={slice.loading ? "Refreshing inbox…" : ""} />
      <header className="inbox__header">
        <div>
          <h3 className="panel__h3">Inbox</h3>
          <p className="panel__muted">
            Support tickets + sales leads, all in one place. Reply, close, and re-classify inline —
            click the subject to open the full thread on support.sigmashake.com.
          </p>
        </div>
        <button
          type="button"
          className="fleet__refresh"
          onClick={refresh}
          disabled={slice.loading}
          title="Refresh tickets and leads"
        >
          {slice.loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="inbox__counts">
        <CountCard
          label="Open tickets"
          value={snapshot.counts.ticketsOpen}
          tone={snapshot.counts.ticketsOpen > 0 ? "warn" : "ok"}
          hint="Status: open · in_progress · waiting"
        />
        <CountCard
          label="Critical (P0/P1)"
          value={snapshot.counts.ticketsCritical}
          tone={snapshot.counts.ticketsCritical > 0 ? "err" : "ok"}
          hint="Non-closed tickets at P0 or P1 severity"
        />
        <CountCard
          label="New leads"
          value={snapshot.counts.leadsNew}
          tone={snapshot.counts.leadsNew > 0 ? "warn" : "ok"}
          hint="Sales leads with status = new"
        />
      </section>

      <section className="inbox__columns">
        <TicketsColumn
          client={client}
          tickets={snapshot.tickets}
          source={snapshot.sources.support}
          onChanged={refresh}
        />
        <LeadsColumn
          client={client}
          leads={snapshot.leads}
          source={snapshot.sources.sales}
          onChanged={refresh}
        />
      </section>

      <p className="inbox__foot">
        Snapshot at {new Date(snapshot.generatedAt).toLocaleString()}. For attachments and audit
        history, open the ticket in the{" "}
        <a href={`${SUPPORT_BASE}/support`} target="_blank" rel="noreferrer">
          support portal
        </a>
        .
      </p>
    </div>
  );
}

// ── Count cards ──────────────────────────────────────────────────────────────

interface CountCardProps {
  label: string;
  value: number;
  tone: "ok" | "warn" | "err";
  hint: string;
}

function CountCard({ label, value, tone, hint }: CountCardProps) {
  return (
    <article className={`fleet-card fleet-card--${tone}`}>
      <header className="fleet-card__head">
        <span className={`fleet-card__dot fleet-card__dot--${tone}`} aria-hidden="true" />
        <h4 className="fleet-card__title">{label}</h4>
      </header>
      <p className="fleet-card__value">{value}</p>
      <p className="fleet-card__detail">{hint}</p>
    </article>
  );
}

// ── Tickets column ───────────────────────────────────────────────────────────

interface TicketsColumnProps {
  client: WorkspaceApiClient;
  tickets: InboxTicket[];
  source: InboxSourceStatus;
  onChanged: () => void;
}

function TicketsColumn({ client, tickets, source, onChanged }: TicketsColumnProps) {
  return (
    <div className="inbox__col">
      <header className="inbox__col-head">
        <h4 className="inbox__col-title">Support tickets</h4>
        <a
          className="inbox__col-link"
          href={`${SUPPORT_BASE}/support`}
          target="_blank"
          rel="noreferrer"
        >
          Open support portal →
        </a>
      </header>
      <SourceBanner source={source} kind="support" />
      {tickets.length === 0 && source.state === "ok" ? (
        <p className="inbox__empty">No open tickets. Inbox zero.</p>
      ) : (
        <ul className="inbox__list">
          {tickets.map((t) => (
            <TicketRow key={t.id} client={client} ticket={t} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface TicketRowProps {
  client: WorkspaceApiClient;
  ticket: InboxTicket;
  onChanged: () => void;
}

function TicketRow({ client, ticket, onChanged }: TicketRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<"reply" | "close" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyVisibility, setReplyVisibility] = useState<"public" | "internal">("public");
  const [closeNote, setCloseNote] = useState("");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const handleStatus = useCallback(
    async (next: string) => {
      if (next === ticket.status) return;
      setError(null);
      setPending("status");
      try {
        await client.patchTicket(ticket.id, { status: next });
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(null);
      }
    },
    [client, ticket.id, ticket.status, onChanged],
  );

  const handleReply = useCallback(async () => {
    const body = replyDraft.trim();
    if (!body) return;
    setError(null);
    setPending("reply");
    try {
      await client.replyTicket(ticket.id, body, replyVisibility);
      setReplyDraft("");
      setExpanded(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, [client, ticket.id, replyDraft, replyVisibility, onChanged]);

  const handleClose = useCallback(async () => {
    setError(null);
    setPending("close");
    try {
      await client.closeTicket(ticket.id, closeNote.trim() || undefined);
      setCloseNote("");
      setShowCloseConfirm(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }, [client, ticket.id, closeNote, onChanged]);

  const isClosed = ticket.status === "closed";
  const busy = pending !== null;

  return (
    <li className="inbox-row">
      <div className="inbox-row__body">
        <a
          className="inbox-row__head-link"
          href={`${SUPPORT_BASE}/support/${ticket.id}`}
          target="_blank"
          rel="noreferrer"
          title="Open the full ticket thread in the support portal"
        >
          <div className="inbox-row__lead">
            <SeverityPill severity={ticket.severity} />
            <StatusPill status={ticket.status} />
            <span className="inbox-row__age">{ageLabel(ticket.updatedAt)}</span>
          </div>
          <div className="inbox-row__subject">{ticket.subject}</div>
        </a>
        <div className="inbox-row__meta">
          <span className="inbox-row__from">{ticket.contactEmail}</span>
          {ticket.tags.length > 0 ? (
            <span className="inbox-row__tags">
              {ticket.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="inbox-row__tag">
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        {ticket.aiSummary ? (
          <div className="inbox-row__ai" title={`AI confidence ${ticket.aiConfidence ?? "—"}`}>
            {ticket.aiSummary}
          </div>
        ) : null}

        <div className="inbox-row__actions">
          {!isClosed ? (
            <>
              <button
                type="button"
                className="inbox-row__action"
                onClick={() => setExpanded((v) => !v)}
                disabled={busy}
              >
                {expanded ? "Cancel reply" : "Reply"}
              </button>
              <button
                type="button"
                className="inbox-row__action inbox-row__action--danger"
                onClick={() => setShowCloseConfirm((v) => !v)}
                disabled={busy}
              >
                {showCloseConfirm ? "Cancel close" : "Close"}
              </button>
            </>
          ) : (
            <span className="inbox-row__action-note">Closed</span>
          )}
          <label className="inbox-row__status-select">
            <span className="inbox-row__status-label">Status</span>
            <select
              value={ticket.status}
              onChange={(e) => handleStatus(e.target.value)}
              disabled={busy}
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        {expanded ? (
          <div className="inbox-row__compose">
            <textarea
              className="inbox-row__textarea"
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              placeholder="Reply to the customer…"
              rows={4}
              disabled={busy}
            />
            <div className="inbox-row__compose-foot">
              <label className="inbox-row__visibility">
                <input
                  type="radio"
                  name={`vis-${ticket.id}`}
                  value="public"
                  checked={replyVisibility === "public"}
                  onChange={() => setReplyVisibility("public")}
                  disabled={busy}
                />
                Public reply
              </label>
              <label className="inbox-row__visibility">
                <input
                  type="radio"
                  name={`vis-${ticket.id}`}
                  value="internal"
                  checked={replyVisibility === "internal"}
                  onChange={() => setReplyVisibility("internal")}
                  disabled={busy}
                />
                Internal note
              </label>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                onClick={handleReply}
                disabled={busy || replyDraft.trim().length === 0}
              >
                {pending === "reply" ? "Sending…" : "Send reply"}
              </button>
            </div>
          </div>
        ) : null}

        {showCloseConfirm ? (
          <div className="inbox-row__compose">
            <textarea
              className="inbox-row__textarea"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              placeholder="Optional resolution note (for audit log)"
              rows={2}
              disabled={busy}
            />
            <div className="inbox-row__compose-foot">
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                onClick={handleClose}
                disabled={busy}
              >
                {pending === "close" ? "Closing…" : "Close ticket"}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <div className="inbox-row__error">{error}</div> : null}
      </div>
    </li>
  );
}

// ── Leads column ─────────────────────────────────────────────────────────────

interface LeadsColumnProps {
  client: WorkspaceApiClient;
  leads: InboxLead[];
  source: InboxSourceStatus;
  onChanged: () => void;
}

function LeadsColumn({ client, leads, source, onChanged }: LeadsColumnProps) {
  return (
    <div className="inbox__col">
      <header className="inbox__col-head">
        <h4 className="inbox__col-title">Sales leads</h4>
        <span className="inbox__col-link inbox__col-link--muted" title="No public sales UI yet">
          via sigmashake-sales D1
        </span>
      </header>
      <SourceBanner source={source} kind="sales" />
      {leads.length === 0 && source.state === "ok" ? (
        <p className="inbox__empty">No leads yet. Pipeline's quiet.</p>
      ) : (
        <ul className="inbox__list">
          {leads.map((l) => (
            <LeadRow key={l.id} client={client} lead={l} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface LeadRowProps {
  client: WorkspaceApiClient;
  lead: InboxLead;
  onChanged: () => void;
}

function LeadRow({ client, lead, onChanged }: LeadRowProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatus = useCallback(
    async (next: string) => {
      if (next === lead.status) return;
      setError(null);
      setPending(true);
      try {
        await client.patchLead(lead.id, { status: next });
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [client, lead.id, lead.status, onChanged],
  );

  return (
    <li className="inbox-row">
      <div className="inbox-row__body inbox-row__body--static">
        <div className="inbox-row__lead">
          <ClassificationPill classification={lead.classification} />
          <LeadStatusPill status={lead.status} />
          <span className="inbox-row__age">{ageLabel(lead.createdAt)}</span>
        </div>
        <div className="inbox-row__subject">
          {lead.subject ?? <span className="inbox-row__placeholder">(no subject)</span>}
        </div>
        <div className="inbox-row__meta">
          <span className="inbox-row__from">
            {lead.fromName ? `${lead.fromName} <${lead.fromEmail}>` : lead.fromEmail}
          </span>
        </div>
        {lead.aiSummary ? (
          <div className="inbox-row__ai" title={`AI confidence ${lead.confidence ?? "—"}`}>
            {lead.aiSummary}
          </div>
        ) : (
          <div className="inbox-row__preview">{lead.bodyPreview}</div>
        )}
        <div className="inbox-row__actions">
          <a
            className="inbox-row__action"
            href={`mailto:${lead.fromEmail}?subject=${encodeURIComponent(`Re: ${lead.subject ?? "your enquiry"}`)}`}
          >
            Reply via email
          </a>
          <label className="inbox-row__status-select">
            <span className="inbox-row__status-label">Status</span>
            <select
              value={lead.status}
              onChange={(e) => handleStatus(e.target.value)}
              disabled={pending}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <div className="inbox-row__error">{error}</div> : null}
      </div>
    </li>
  );
}

// ── Pills ────────────────────────────────────────────────────────────────────

function SeverityPill({ severity }: { severity: TicketSeverity }) {
  const tone =
    severity === "p0" || severity === "p1" ? "err" : severity === "p2" ? "warn" : "muted";
  return <span className={`inbox-pill inbox-pill--${tone}`}>{severity.toUpperCase()}</span>;
}

function StatusPill({ status }: { status: TicketStatus }) {
  const label = status.replace("_", " ");
  const tone =
    status === "open" || status === "in_progress" ? "info" : status === "waiting" ? "warn" : "ok";
  return <span className={`inbox-pill inbox-pill--${tone}`}>{label}</span>;
}

function ClassificationPill({ classification }: { classification: LeadClassification | null }) {
  const label = classification ?? "unclassified";
  const tone =
    classification === "cold_pitch"
      ? "muted"
      : classification === "legitimate_inquiry" || classification === "partnership"
        ? "info"
        : classification === "media"
          ? "warn"
          : "muted";
  return <span className={`inbox-pill inbox-pill--${tone}`}>{label.replace("_", " ")}</span>;
}

function LeadStatusPill({ status }: { status: InboxLead["status"] }) {
  const tone =
    status === "new"
      ? "info"
      : status === "replied" || status === "meeting_booked"
        ? "ok"
        : status === "ignored" || status === "closed"
          ? "muted"
          : "warn";
  return <span className={`inbox-pill inbox-pill--${tone}`}>{status.replace("_", " ")}</span>;
}

// ── Source banner ────────────────────────────────────────────────────────────

interface SourceBannerProps {
  source: InboxSourceStatus;
  kind: "support" | "sales";
}

function SourceBanner({ source, kind }: SourceBannerProps) {
  if (source.state === "ok") return null;
  const tone = source.state === "unauthorized" || source.state === "unconfigured" ? "warn" : "err";
  const title =
    source.state === "unconfigured"
      ? `${kind === "support" ? "Support" : "Sales"} not configured`
      : source.state === "unauthorized"
        ? "Authentication failed"
        : "Source unreachable";
  return (
    <div className={`inbox__banner inbox__banner--${tone}`}>
      <strong>{title}.</strong> <span>{source.message ?? "No additional detail."}</span>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ageLabel(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
