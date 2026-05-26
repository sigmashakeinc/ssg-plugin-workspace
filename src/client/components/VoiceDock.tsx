// Floating voice dock. Talk-to-Workspace v0: browser SpeechRecognition for
// STT, a rule-based intent matcher, and a typed action surface lifted from
// App.tsx. The UI is state-driven, so every dispatched action morphs the
// page through the same code path a click would take — no special-cased
// "voice mode" anywhere else.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProjectCard } from "../api/types";

export interface VoiceActions {
  goToDistribution(): void;
  goToMap(): void;
  goToFleet(): void;
  goToOverview(): void;
  goToCertification(): void;
  goToAiNative(): void;
  goToInbox(): void;
  goToObservability(): void;
  goToPlatformParity(): void;
  goToProject(slug: string): boolean;
  openCreateModal(): boolean;
  setFilter(value: string): void;
  refresh(): void;
}

interface Props {
  projects: ProjectCard[];
  actions: VoiceActions;
}

type Intent =
  | "go-distribution"
  | "go-map"
  | "go-fleet"
  | "go-inbox"
  | "go-ai-native"
  | "go-observability"
  | "go-parity"
  | "go-project"
  | "new-app"
  | "set-filter"
  | "clear-filter"
  | "refresh"
  | "unknown";

interface InterpretedAction {
  intent: Intent;
  payload?: string;
  /** Plain-language description of what the dock will do. */
  said: string;
  /** True when the dock should treat this as a failed parse. */
  failed?: boolean;
}

// Browser-only API; not in stock lib.dom. Kept narrowly typed so the rest of
// the component stays readable.
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

function findProject(projects: ProjectCard[], phrase: string): ProjectCard | null {
  if (!phrase) return null;
  const needle = phrase.toLowerCase().trim().replace(/\s+/g, "-");
  // Exact slug
  const exact = projects.find((p) => p.slug.toLowerCase() === needle);
  if (exact) return exact;
  // Strip "sigmashake-" prefix on both sides
  const bareNeedle = needle.replace(/^sigmashake-/, "");
  const bare = projects.find(
    (p) => p.slug.toLowerCase().replace(/^sigmashake-/, "") === bareNeedle,
  );
  if (bare) return bare;
  // Substring match in slug or description (use space-preserved phrase)
  const sub = phrase.toLowerCase().trim();
  return (
    projects.find(
      (p) => p.slug.toLowerCase().includes(sub) || p.description.toLowerCase().includes(sub),
    ) ?? null
  );
}

function interpret(raw: string, projects: ProjectCard[]): InterpretedAction {
  const t = raw.trim().toLowerCase();
  if (!t) return { intent: "unknown", said: "", failed: true };

  // Distribution view
  if (
    /\b(show|open|go to|take me to|switch to|jump to)\b[^a-z]*\bdistribution\b/.test(t) ||
    /^distribution\b/.test(t) ||
    /\b(release|ship)\b.*\b(view|page|screen|status)\b/.test(t)
  ) {
    return { intent: "go-distribution", said: "Opening Distribution" };
  }

  // Service map — the monorepo-wide topology view.
  if (
    /\b(show|open|go to|take me to|switch to|jump to)\b[^a-z]*\b(service\s+map|map|topology|overview|architecture)\b/.test(
      t,
    ) ||
    /^(service\s+map|map|overview|topology)\b/.test(t) ||
    /\b(how|where).*\b(everything|projects|services)\b.*\b(connect|fit|relate)\b/.test(t)
  ) {
    return { intent: "go-map", said: "Opening the service map" };
  }

  // Fleet control plane
  if (
    /\b(show|open|go to|take me to|switch to|jump to)\b[^a-z]*\bfleet\b/.test(t) ||
    /^fleet\b/.test(t)
  ) {
    return { intent: "go-fleet", said: "Opening Fleet" };
  }

  // Unified inbox — support tickets + sales leads.
  if (
    /\b(show|open|go to|take me to|switch to|jump to)\b[^a-z]*\b(inbox|tickets|support|leads)\b/.test(
      t,
    ) ||
    /^(inbox|tickets|leads)\b/.test(t)
  ) {
    return { intent: "go-inbox", said: "Opening the Inbox" };
  }

  // AI-native readiness + latency gauge.
  if (
    /\b(show|open|go to|take me to|switch to|jump to)\b[^a-z]*\bai[\s-]?native\b/.test(t) ||
    /^ai[\s-]?native\b/.test(t) ||
    /\b(ai|agent)\s+readiness\b/.test(t)
  ) {
    return { intent: "go-ai-native", said: "Opening AI Native" };
  }

  // Observability — the consolidated service-health board.
  if (
    /\b(show|open|go to|take me to|switch to|jump to)\b[^a-z]*\b(observability|health|uptime)\b/.test(
      t,
    ) ||
    /^(observability|health|uptime|service health)\b/.test(t)
  ) {
    return { intent: "go-observability", said: "Opening Observability" };
  }

  // Platform parity — desktop cross-OS checklist.
  if (
    /\b(show|open|go to|take me to|switch to|jump to)\b[^a-z]*\b(platform\s+parity|parity|cross[-\s]?os|desktop\s+checklist)\b/.test(
      t,
    ) ||
    /^(platform parity|parity|checklist)\b/.test(t)
  ) {
    return { intent: "go-parity", said: "Opening Platform parity" };
  }

  // New app
  if (/\b(new|create|make|add)\s+(a\s+)?(new\s+)?(app|project)\b/.test(t)) {
    return { intent: "new-app", said: "Opening the new-app dialog" };
  }

  // Refresh
  if (/\b(refresh|reload|update)(\s+(the\s+)?(list|projects|page))?\b/.test(t)) {
    return { intent: "refresh", said: "Refreshing the project list" };
  }

  // Clear filter
  if (
    /\b(clear|reset)\b[^a-z]*\b(filter|search)\b/.test(t) ||
    /\bshow (all|everything)\b/.test(t)
  ) {
    return { intent: "clear-filter", said: "Showing every project" };
  }

  // Filter — "search for X", "filter for/by X", "find X", "look for X"
  const filterMatch = t.match(/\b(?:search for|filter(?:\s+(?:by|for))?|find|look for)\s+(.+)$/);
  if (filterMatch) {
    const q = filterMatch[1]!.replace(/[?!.]+$/, "").trim();
    return {
      intent: "set-filter",
      payload: q,
      said: `Filtering for "${q}"`,
    };
  }

  // Project navigation — explicit verb
  const navMatch = t.match(/\b(?:show me|show|open|go to|take me to|switch to|jump to)\s+(.+)$/);
  if (navMatch) {
    const phrase = navMatch[1]!.replace(/[?!.]+$/, "").trim();
    const project = findProject(projects, phrase);
    if (project) {
      return {
        intent: "go-project",
        payload: project.slug,
        said: `Opening ${project.slug}`,
      };
    }
    return {
      intent: "unknown",
      payload: phrase,
      said: `I couldn't find a project matching "${phrase}"`,
      failed: true,
    };
  }

  // Bare project name as the whole utterance
  const project = findProject(projects, t);
  if (project) {
    return {
      intent: "go-project",
      payload: project.slug,
      said: `Opening ${project.slug}`,
    };
  }

  const example = projects[0]?.slug ?? "sigmashake-gov";
  return {
    intent: "unknown",
    said: `Didn't catch that. Try "show distribution", "open ${example}", or "filter for hub".`,
    failed: true,
  };
}

export function VoiceDock({ projects, actions }: Props) {
  const supported = useMemo(() => Boolean(getSpeechCtor()), []);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [last, setLast] = useState<InterpretedAction | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const dispatch = useCallback(
    (raw: string) => {
      const action = interpret(raw, projects);
      setLast(action);
      switch (action.intent) {
        case "go-distribution":
          actions.goToDistribution();
          break;
        case "go-map":
          actions.goToMap();
          break;
        case "go-fleet":
          actions.goToFleet();
          break;
        case "go-inbox":
          actions.goToInbox();
          break;
        case "go-ai-native":
          actions.goToAiNative();
          break;
        case "go-observability":
          actions.goToObservability();
          break;
        case "go-parity":
          actions.goToPlatformParity();
          break;
        case "go-project":
          if (action.payload) actions.goToProject(action.payload);
          break;
        case "new-app": {
          const opened = actions.openCreateModal();
          if (!opened) {
            setLast({
              intent: "unknown",
              said: "Creating apps needs SigmaShake running on your computer. Open Workspace in SigmaShake Desktop.",
              failed: true,
            });
          }
          break;
        }
        case "set-filter":
          if (action.payload !== undefined) actions.setFilter(action.payload);
          break;
        case "clear-filter":
          actions.setFilter("");
          break;
        case "refresh":
          actions.refresh();
          break;
        case "unknown":
          break;
      }
    },
    [projects, actions],
  );

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (r) {
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) final += text;
        else interim += text;
      }
      setTranscript(interim || final);
      if (final) dispatch(final);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognitionRef.current = r;
    setTranscript("");
    setLast(null);
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [dispatch]);

  useEffect(() => () => stop(), [stop]);

  const onSubmitText = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setTranscript(t);
    dispatch(t);
    setText("");
  };

  if (!open) {
    return (
      <button
        type="button"
        className="voice-dock voice-dock--collapsed"
        onClick={() => setOpen(true)}
        title="Talk to Workspace"
        aria-label="Open voice dock"
      >
        <MicGlyph />
      </button>
    );
  }

  return (
    <div
      className={
        "voice-dock voice-dock--open" +
        (listening ? " voice-dock--listening" : "") +
        (last?.failed ? " voice-dock--failed" : "")
      }
    >
      <div className="voice-dock__row">
        <button
          type="button"
          className={`voice-dock__mic${listening ? " voice-dock__mic--on" : ""}`}
          onClick={listening ? stop : start}
          disabled={!supported}
          title={
            supported
              ? listening
                ? "Stop listening"
                : 'Hold a command — try "show distribution"'
              : "Speech recognition isn't supported in this browser. Use the text box."
          }
        >
          <MicGlyph />
          <span>{listening ? "Listening…" : supported ? "Talk" : "Voice off"}</span>
        </button>
        <form className="voice-dock__form" onSubmit={onSubmitText}>
          <input
            type="text"
            className="voice-dock__input"
            placeholder='Type or say "show distribution"'
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        </form>
        <button
          type="button"
          className="voice-dock__close"
          onClick={() => setOpen(false)}
          title="Hide voice dock"
          aria-label="Hide voice dock"
        >
          ×
        </button>
      </div>
      {(transcript || last) && (
        <div className="voice-dock__feedback">
          {transcript && (
            <div className="voice-dock__line voice-dock__line--heard">
              <span className="voice-dock__tag">Heard</span>
              <span>{transcript}</span>
            </div>
          )}
          {last && (
            <div className={`voice-dock__line voice-dock__line--${last.failed ? "miss" : "did"}`}>
              <span className="voice-dock__tag">{last.failed ? "Hmm" : "Did"}</span>
              <span>{last.said}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MicGlyph() {
  return (
    <svg
      className="voice-dock__glyph"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="6" y="2" width="4" height="8" rx="2" fill="currentColor" />
      <path
        d="M4 8 v0.6 a4 4 0 0 0 8 0 V8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M8 13 v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
