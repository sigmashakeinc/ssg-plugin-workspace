// Per-project speech-to-text feature capture. Dictate (or type) a feature
// idea; on save it appends to a `<!-- workspace:features -->` block in the
// project's CLAUDE.md so the AI assistant sees the idea on its next read.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceApiClient } from "../api/client";
import type { ProjectCard } from "../api/types";
import { friendlyError } from "../lib/errors";

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient;
}

// Minimal browser SpeechRecognition typing — not in stock lib.dom. Mirrors
// the shape used by VoiceDock; kept local to avoid cross-file refactoring.
type SRConstructor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}
interface SREvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function getSpeechCtor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FEATURES_OPEN = "<!-- workspace:features -->";
const FEATURES_CLOSE = "<!-- /workspace:features -->";

export function FeatureIdeasCard({ card, client }: Props) {
  const [mdRaw, setMdRaw] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  const sttAvailable = useMemo(() => getSpeechCtor() !== null, []);

  // Load CLAUDE.md once when the project changes.
  useEffect(() => {
    let cancelled = false;
    setMdRaw(null);
    setDraft("");
    setSaveError(null);
    setSaveOk(false);
    (async () => {
      try {
        const raw = await client.readFile(card.slug, "CLAUDE.md");
        if (!cancelled) setMdRaw(raw ?? "");
      } catch {
        if (!cancelled) setMdRaw("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.slug, client]);

  const ideas = useMemo(() => extractIdeas(mdRaw ?? ""), [mdRaw]);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore — already stopped
      }
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      setSttError("Speech-to-text isn't available in this browser. Type the idea instead.");
      return;
    }
    if (recognitionRef.current) return;
    setSttError(null);
    setSaveOk(false);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    finalRef.current = draft;
    rec.onresult = (e) => {
      let interim = "";
      let final = finalRef.current;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const alt = result?.[0];
        if (!result || !alt) continue;
        if (result.isFinal) {
          final = `${final} ${alt.transcript}`.trim();
        } else {
          interim += alt.transcript;
        }
      }
      finalRef.current = final;
      setDraft(interim ? `${final} ${interim}`.trim() : final);
    };
    rec.onerror = (e) => {
      setSttError(
        e.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in the browser to dictate."
          : `Couldn't listen: ${e.error ?? "unknown error"}`,
      );
      stopListening();
    };
    rec.onend = () => {
      // Browsers sometimes auto-stop mid-session — reflect that in state.
      recognitionRef.current = null;
      setListening(false);
    };
    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch (err) {
      setSttError(friendlyError(err));
      recognitionRef.current = null;
    }
  }, [draft, stopListening]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    stopListening();
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      // Read fresh: the initial load may still be in flight, and another tab
      // or the AI assistant may have edited CLAUDE.md since we opened this
      // panel. Either way we don't want to clobber existing content.
      let current = "";
      try {
        current = await client.readFile(card.slug, "CLAUDE.md");
      } catch {
        current = "";
      }
      const date = new Date().toISOString().slice(0, 10);
      const next = appendIdea(current, `${date}: ${trimmed}`);
      await client.writeFile({
        project: card.slug,
        file: "CLAUDE.md",
        content: next,
      });
      setMdRaw(next);
      setDraft("");
      finalRef.current = "";
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (err) {
      setSaveError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }, [draft, card.slug, client, stopListening]);

  return (
    <section className="features">
      <header className="features__head">
        <h3 className="simple__h3">Feature ideas</h3>
        <p className="features__hint">
          Talk through what you&apos;d like to add. Each idea gets saved into this project&apos;s{" "}
          <code>CLAUDE.md</code> so the AI assistant sees it on its next read.
        </p>
      </header>

      <div className="features__input">
        <textarea
          className="features__textarea"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            finalRef.current = e.target.value;
          }}
          placeholder={
            sttAvailable
              ? "Click the mic and start talking — or type your idea here."
              : "Type the feature idea here. (Your browser doesn't support speech-to-text.)"
          }
          rows={3}
          disabled={saving}
        />
        <div className="features__controls">
          {sttAvailable && (
            <button
              type="button"
              className={`features__mic${listening ? " features__mic--listening" : ""}`}
              onClick={listening ? stopListening : startListening}
              disabled={saving}
              title={listening ? "Stop dictating" : "Start dictating"}
              aria-pressed={listening}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none">
                <rect
                  x="6"
                  y="2"
                  width="4"
                  height="8"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  fill={listening ? "currentColor" : "none"}
                />
                <path
                  d="M3.5 8 C 3.5 10.5 5.5 12.5 8 12.5 C 10.5 12.5 12.5 10.5 12.5 8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M8 12.5 V 14.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              <span>{listening ? "Listening…" : "Dictate"}</span>
            </button>
          )}
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={save}
            disabled={saving || !draft.trim()}
          >
            {saving ? "Saving…" : "Save idea"}
          </button>
          {saveOk && <span className="edit__status edit__status--ok">Saved ✓</span>}
        </div>
        {sttError && <div className="features__err">{sttError}</div>}
        {saveError && <div className="features__err">{saveError}</div>}
      </div>

      {ideas.length > 0 && (
        <div className="features__list">
          <span className="features__list-label">Saved ({ideas.length})</span>
          <ul className="features__list-ul">
            {ideas.map((idea, i) => (
              <li key={i} className="features__list-item">
                {idea}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function extractIdeas(md: string): string[] {
  const o = md.indexOf(FEATURES_OPEN);
  if (o === -1) return [];
  const c = md.indexOf(FEATURES_CLOSE, o + FEATURES_OPEN.length);
  if (c === -1) return [];
  const block = md.slice(o + FEATURES_OPEN.length, c);
  return block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
}

function appendIdea(md: string, idea: string): string {
  const line = `- ${idea}`;
  if (md.includes(FEATURES_OPEN) && md.includes(FEATURES_CLOSE)) {
    const c = md.indexOf(FEATURES_CLOSE);
    const before = md.slice(0, c).replace(/\s+$/, "");
    const after = md.slice(c);
    return `${before}\n${line}\n${after}`;
  }
  const block = `${FEATURES_OPEN}\n${line}\n${FEATURES_CLOSE}`;
  if (!md.trim()) return `${block}\n`;
  return `${md.replace(/\s+$/, "")}\n\n${block}\n`;
}
