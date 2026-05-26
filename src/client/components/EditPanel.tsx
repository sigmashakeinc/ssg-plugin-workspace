// Friendly "Settings" surface for a project. Non-technical users see plain
// form fields that abstract package.json + CLAUDE.md + wrangler.toml. Power
// users can expand the "Show raw config files" section for direct text
// editing of the three whitelisted files.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceApiClient } from "../api/client";
import type { EditRequest, ProjectCard } from "../api/types";
import { friendlyError } from "../lib/errors";
import { CodeEditor } from "./CodeEditor";

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient;
}

const FILES: EditRequest["file"][] = ["CLAUDE.md", "wrangler.toml", "package.json"];

interface PkgData {
  raw: string;
  parsed: Record<string, unknown>;
  name: string;
  description: string;
}

export function EditPanel({ card, client }: Props) {
  const [pkg, setPkg] = useState<PkgData | null>(null);
  const [pkgErr, setPkgErr] = useState<string | null>(null);
  const [claudeMd, setClaudeMd] = useState<string | null>(null);
  const [wranglerToml, setWranglerToml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Friendly form state
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [about, setAbout] = useState("");
  const [savingPkg, setSavingPkg] = useState(false);
  const [savingMd, setSavingMd] = useState(false);
  const [pkgStatus, setPkgStatus] = useState<"idle" | "saved" | "error">("idle");
  const [mdStatus, setMdStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pkgSaveErr, setPkgSaveErr] = useState<string | null>(null);
  const [mdSaveErr, setMdSaveErr] = useState<string | null>(null);

  // Advanced expander
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advFile, setAdvFile] = useState<EditRequest["file"]>(
    card.hasWranglerToml ? "wrangler.toml" : "CLAUDE.md",
  );
  const [advContent, setAdvContent] = useState("");
  const [advOriginal, setAdvOriginal] = useState("");
  const [advLoading, setAdvLoading] = useState(false);
  const [advSaving, setAdvSaving] = useState(false);
  const [advErr, setAdvErr] = useState<string | null>(null);
  const [advStatus, setAdvStatus] = useState<"idle" | "saved">("idle");

  // ── Load everything once when the project changes ────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPkg(null);
    setPkgErr(null);
    setClaudeMd(null);
    setWranglerToml(null);
    setName("");
    setDesc("");
    setAbout("");
    setPkgStatus("idle");
    setMdStatus("idle");
    setPkgSaveErr(null);
    setMdSaveErr(null);
    setAdvancedOpen(false);
    setAdvStatus("idle");
    (async () => {
      try {
        const pkgRaw = await client.readFile(card.slug, "package.json");
        if (cancelled) return;
        try {
          const parsed = JSON.parse(pkgRaw) as Record<string, unknown>;
          const pkgName = typeof parsed.name === "string" ? parsed.name : card.slug;
          const pkgDesc = typeof parsed.description === "string" ? parsed.description : "";
          setPkg({ raw: pkgRaw, parsed, name: pkgName, description: pkgDesc });
          setName(pkgName);
          setDesc(pkgDesc);
        } catch {
          setPkgErr("package.json isn't valid JSON. Open the raw editor below to fix it.");
        }
      } catch (err) {
        if (!cancelled) {
          setPkgErr(friendlyError(err));
        }
      }
      if (card.hasClaudeMd) {
        try {
          const md = await client.readFile(card.slug, "CLAUDE.md");
          if (cancelled) return;
          setClaudeMd(md);
          setAbout(extractAbout(md));
        } catch {
          // CLAUDE.md is optional — silently fall back to empty
        }
      }
      if (card.hasWranglerToml) {
        try {
          const tomlText = await client.readFile(card.slug, "wrangler.toml");
          if (cancelled) return;
          setWranglerToml(tomlText);
        } catch {
          // ignore
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [card.slug, card.hasClaudeMd, card.hasWranglerToml, client]);

  // Load advanced file when picker changes
  useEffect(() => {
    if (!advancedOpen) return;
    let cancelled = false;
    setAdvLoading(true);
    setAdvErr(null);
    setAdvStatus("idle");
    (async () => {
      try {
        const body = await client.readFile(card.slug, advFile);
        if (cancelled) return;
        setAdvContent(body);
        setAdvOriginal(body);
      } catch (err) {
        if (!cancelled) setAdvErr(friendlyError(err));
      } finally {
        if (!cancelled) setAdvLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [advancedOpen, advFile, card.slug, client]);

  const liveUrl = useMemo(() => extractLiveUrl(wranglerToml), [wranglerToml]);

  const pkgDirty = pkg !== null && (name !== pkg.name || desc !== pkg.description);
  const mdDirty = claudeMd !== null && about !== extractAbout(claudeMd);
  const advDirty = advContent !== advOriginal;

  const savePkg = useCallback(async () => {
    if (!pkg || !pkgDirty) return;
    setSavingPkg(true);
    setPkgStatus("idle");
    setPkgSaveErr(null);
    try {
      const next: Record<string, unknown> = { ...pkg.parsed };
      next.name = name.trim() || card.slug;
      if (desc.trim()) next.description = desc.trim();
      else delete next.description;
      const raw = `${JSON.stringify(next, null, 2)}\n`;
      await client.writeFile({
        project: card.slug,
        file: "package.json",
        content: raw,
      });
      setPkg({ raw, parsed: next, name: String(next.name ?? ""), description: desc.trim() });
      setPkgStatus("saved");
      setTimeout(() => setPkgStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (err) {
      setPkgSaveErr(friendlyError(err));
      setPkgStatus("error");
    } finally {
      setSavingPkg(false);
    }
  }, [pkg, pkgDirty, name, desc, card.slug, client]);

  const saveMd = useCallback(async () => {
    if (claudeMd == null || !mdDirty) return;
    setSavingMd(true);
    setMdStatus("idle");
    setMdSaveErr(null);
    try {
      const next = replaceAboutBlock(claudeMd, about.trim());
      await client.writeFile({
        project: card.slug,
        file: "CLAUDE.md",
        content: next,
      });
      setClaudeMd(next);
      setMdStatus("saved");
      setTimeout(() => setMdStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (err) {
      setMdSaveErr(friendlyError(err));
      setMdStatus("error");
    } finally {
      setSavingMd(false);
    }
  }, [claudeMd, mdDirty, about, card.slug, client]);

  const saveAdv = useCallback(async () => {
    if (!advDirty) return;
    setAdvSaving(true);
    setAdvErr(null);
    setAdvStatus("idle");
    try {
      await client.writeFile({
        project: card.slug,
        file: advFile,
        content: advContent,
      });
      setAdvOriginal(advContent);
      setAdvStatus("saved");
      // Refresh the friendly form if user edited a file we mirror
      if (advFile === "package.json") {
        try {
          const parsed = JSON.parse(advContent) as Record<string, unknown>;
          setPkg({
            raw: advContent,
            parsed,
            name: typeof parsed.name === "string" ? parsed.name : card.slug,
            description: typeof parsed.description === "string" ? parsed.description : "",
          });
          setName(typeof parsed.name === "string" ? parsed.name : card.slug);
          setDesc(typeof parsed.description === "string" ? parsed.description : "");
          setPkgErr(null);
        } catch {
          setPkgErr("package.json isn't valid JSON.");
        }
      }
      if (advFile === "CLAUDE.md") {
        setClaudeMd(advContent);
        setAbout(extractAbout(advContent));
      }
      if (advFile === "wrangler.toml") {
        setWranglerToml(advContent);
      }
      setTimeout(() => setAdvStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (err) {
      setAdvErr(friendlyError(err));
    } finally {
      setAdvSaving(false);
    }
  }, [advDirty, advFile, advContent, card.slug, client]);

  if (loading) {
    return (
      <div className="panel">
        <h3 className="panel__h3">Settings</h3>
        <div className="empty">Reading settings from {card.slug}…</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3 className="panel__h3">Settings</h3>

      {pkgErr && <div className="error">{pkgErr}</div>}

      <section className="settings-card">
        <header className="settings-card__head">
          <span className="settings-card__title">App identity</span>
          <span className="settings-card__hint">
            How this app shows up everywhere — in the project list, on the marketing page, in deploy
            logs.
          </span>
        </header>
        <label className="settings-field">
          <span className="settings-field__label">App name</span>
          <input
            type="text"
            className="settings-field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={card.slug}
            spellCheck={false}
          />
          <span className="settings-field__sublabel">
            The technical identifier inside <code>package.json</code>. Lowercase, no spaces.
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-field__label">What this app does</span>
          <textarea
            className="settings-field__textarea"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Tell future-you what this app does in one or two sentences."
            rows={2}
          />
          <span className="settings-field__sublabel">
            A short summary that appears in the project list and on the support site.
          </span>
        </label>
        <div className="settings-card__actions">
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={savePkg}
            disabled={!pkgDirty || savingPkg}
          >
            {savingPkg ? "Saving…" : "Save"}
          </button>
          {pkgDirty && !savingPkg && (
            <span className="edit__status edit__status--dirty">Unsaved</span>
          )}
          {pkgStatus === "saved" && !pkgDirty && (
            <span className="edit__status edit__status--ok">Saved ✓</span>
          )}
          {pkgSaveErr && <span className="edit__status">Error: {pkgSaveErr}</span>}
        </div>
      </section>

      {card.hasClaudeMd && claudeMd != null && (
        <section className="settings-card">
          <header className="settings-card__head">
            <span className="settings-card__title">About this app</span>
            <span className="settings-card__hint">
              The longer-form intro that the AI assistant reads when it works on this project. Plain
              English, no Markdown required.
            </span>
          </header>
          <label className="settings-field">
            <textarea
              className="settings-field__textarea settings-field__textarea--tall"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="What is this app for? Who uses it? Any quirks worth remembering?"
              rows={6}
            />
            <span className="settings-field__sublabel">
              Saved into <code>CLAUDE.md</code>. The existing structure of that file (headings,
              command tables, etc.) is preserved — only the opening intro is replaced.
            </span>
          </label>
          <div className="settings-card__actions">
            <button
              type="button"
              className="pill-btn pill-btn--primary"
              onClick={saveMd}
              disabled={!mdDirty || savingMd}
            >
              {savingMd ? "Saving…" : "Save"}
            </button>
            {mdDirty && !savingMd && (
              <span className="edit__status edit__status--dirty">Unsaved</span>
            )}
            {mdStatus === "saved" && !mdDirty && (
              <span className="edit__status edit__status--ok">Saved ✓</span>
            )}
            {mdSaveErr && <span className="edit__status">Error: {mdSaveErr}</span>}
          </div>
        </section>
      )}

      {card.hasWranglerToml && (
        <section className="settings-card settings-card--readonly">
          <header className="settings-card__head">
            <span className="settings-card__title">Live website</span>
            <span className="settings-card__hint">
              Where this app shows up on the internet once it&apos;s published.
            </span>
          </header>
          {liveUrl ? (
            <a className="simple__live" href={liveUrl} target="_blank" rel="noreferrer">
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--ss-ok)",
                  marginRight: 6,
                }}
              />
              {liveUrl.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            <span className="settings-field__sublabel">
              No public URL set. Edit <code>wrangler.toml</code> below to add a route.
            </span>
          )}
        </section>
      )}

      <section className="settings-advanced">
        <button
          type="button"
          className="settings-advanced__toggle"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            aria-hidden="true"
            style={{
              transform: advancedOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.16s ease",
            }}
          >
            <path
              d="M6 4 L10 8 L6 12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          {advancedOpen ? "Hide raw config files" : "Show raw config files"}
        </button>
        {advancedOpen && (
          <div className="settings-advanced__body">
            <p className="settings-advanced__hint">
              Direct editor for the three project config files. Useful for tweaks the friendly form
              doesn&apos;t expose yet — like adding a new script, route, or env binding.
            </p>
            <div className="edit__toolbar">
              <div className="edit__file-pills" role="tablist">
                {FILES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={advFile === f}
                    className={`edit__file-pill${advFile === f ? " edit__file-pill--active" : ""}`}
                    onClick={() => setAdvFile(f)}
                    disabled={advLoading}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                onClick={saveAdv}
                disabled={!advDirty || advLoading || advSaving}
              >
                {advSaving ? "Saving…" : "Save"}
              </button>
              {advDirty && !advSaving && (
                <span className="edit__status edit__status--dirty">Unsaved</span>
              )}
              {advStatus === "saved" && !advDirty && (
                <span className="edit__status edit__status--ok">Saved ✓</span>
              )}
            </div>
            {advErr && <div className="error">{advErr}</div>}
            {advLoading ? (
              <div className="empty">Loading {advFile}…</div>
            ) : (
              <div className="edit__frame">
                <CodeEditor
                  value={advContent}
                  height="50vh"
                  onChange={(value) => setAdvContent(value)}
                  ariaLabel={`Editing ${advFile}`}
                />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const ABOUT_MARK_OPEN = "<!-- workspace:about -->";
const ABOUT_MARK_CLOSE = "<!-- /workspace:about -->";

function extractAbout(md: string): string {
  const between = sliceBetween(md, ABOUT_MARK_OPEN, ABOUT_MARK_CLOSE);
  if (between != null) return between.trim();
  // Fallback: first prose paragraph (skip headings + code fences + tables)
  const lines = md.split(/\r?\n/);
  const paragraphs: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buf.length === 0) return;
    const text = buf.join(" ").trim();
    if (text && !text.startsWith("#") && !text.startsWith("<")) {
      paragraphs.push(text);
    }
    buf = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;
    if (!line) {
      flush();
      if (paragraphs.length >= 1) break;
      continue;
    }
    if (line.startsWith("#")) {
      flush();
      continue;
    }
    if (line.startsWith("|") || line.startsWith("---")) continue;
    buf.push(line);
  }
  flush();
  return paragraphs[0] ?? "";
}

function sliceBetween(text: string, open: string, close: string): string | null {
  const o = text.indexOf(open);
  if (o === -1) return null;
  const c = text.indexOf(close, o + open.length);
  if (c === -1) return null;
  return text.slice(o + open.length, c);
}

function replaceAboutBlock(md: string, next: string): string {
  const block = `${ABOUT_MARK_OPEN}\n${next}\n${ABOUT_MARK_CLOSE}`;
  if (md.includes(ABOUT_MARK_OPEN) && md.includes(ABOUT_MARK_CLOSE)) {
    const start = md.indexOf(ABOUT_MARK_OPEN);
    const end = md.indexOf(ABOUT_MARK_CLOSE) + ABOUT_MARK_CLOSE.length;
    return md.slice(0, start) + block + md.slice(end);
  }
  // No marker yet — inject after the first heading line (or at the top)
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("#")) {
      const before = lines.slice(0, i + 1).join("\n");
      const after = lines.slice(i + 1).join("\n");
      return `${before}\n\n${block}\n\n${after}`.replace(/\n{3,}/g, "\n\n");
    }
  }
  return `${block}\n\n${md}`;
}

function extractLiveUrl(toml: string | null): string | null {
  if (!toml) return null;
  const match = toml.match(/pattern\s*=\s*["']([^"']+)["']/);
  if (!match?.[1]) return null;
  const raw = match[1];
  const host = raw.replace(/\/.*$/, "");
  if (!host || host.includes("*")) return null;
  return host.startsWith("http") ? host : `https://${host}`;
}
