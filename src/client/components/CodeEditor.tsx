// Minimal first-party code editor — replaces @uiw/react-codemirror and the
// ~29-package CodeMirror / Lezer dependency tree.
//
// The raw-config editor needs to read, edit, and save three whitelisted text
// files. That is all this provides: a controlled, dark, monospace textarea
// with a scroll-synced line-number gutter and tab-to-indent. Syntax
// highlighting and folding are intentionally dropped — not needed to edit a
// config file, and a native <textarea> cannot fail to mount the way a parser
// can. Smaller, faster, and nothing to crash.

import { type ChangeEvent, type KeyboardEvent, type UIEvent, useMemo, useRef } from "react";

const INDENT = "  ";

/** Visual line count of the buffer (always >= 1). */
export function countLines(value: string): number {
  let n = 1;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\n") n++;
  }
  return n;
}

/** Gutter body: "1\n2\n…\nN" for an N-line buffer. */
export function gutterText(value: string): string {
  const n = countLines(value);
  const rows: string[] = [];
  for (let i = 1; i <= n; i++) rows.push(String(i));
  return rows.join("\n");
}

/**
 * Tab-key behaviour. With no selection, insert one indent at the caret. With a
 * selection spanning text, indent every line it touches. Pure so it can be
 * unit-tested without a DOM; returns the new buffer and caret range.
 */
export function applyIndent(
  value: string,
  selStart: number,
  selEnd: number,
): { value: string; selStart: number; selEnd: number } {
  if (selStart === selEnd) {
    const next = value.slice(0, selStart) + INDENT + value.slice(selStart);
    const caret = selStart + INDENT.length;
    return { value: next, selStart: caret, selEnd: caret };
  }
  const lineStart = value.lastIndexOf("\n", selStart - 1) + 1;
  const block = value.slice(lineStart, selEnd);
  const indented = block.replace(/^/gm, INDENT);
  const next = value.slice(0, lineStart) + indented + value.slice(selEnd);
  const added = indented.length - block.length;
  return {
    value: next,
    selStart: selStart + INDENT.length,
    selEnd: selEnd + added,
  };
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
  ariaLabel?: string;
}

const FONT = '13px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const LINE_HEIGHT = "1.5";

export function CodeEditor({
  value,
  onChange,
  height = "50vh",
  readOnly = false,
  ariaLabel = "Code editor",
}: CodeEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const gutter = useMemo(() => gutterText(value), [value]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  // Keep the gutter vertically aligned with the textarea as it scrolls.
  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    const g = gutterRef.current;
    if (g) g.scrollTop = e.currentTarget.scrollTop;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || readOnly) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const next = applyIndent(value, ta.selectionStart, ta.selectionEnd);
    onChange(next.value);
    // The controlled re-render resets the caret; restore it next frame.
    requestAnimationFrame(() => {
      ta.selectionStart = next.selStart;
      ta.selectionEnd = next.selEnd;
    });
  };

  return (
    <div
      className="code-editor"
      style={{
        display: "flex",
        height,
        boxSizing: "border-box",
        border: "1px solid #2a2a30",
        borderRadius: 6,
        overflow: "hidden",
        background: "#1e1e22",
        font: FONT,
        lineHeight: LINE_HEIGHT,
      }}
    >
      <div
        ref={gutterRef}
        aria-hidden="true"
        style={{
          flex: "0 0 auto",
          padding: "8px 8px 8px 10px",
          textAlign: "right",
          whiteSpace: "pre",
          overflow: "hidden",
          userSelect: "none",
          color: "#5a5a66",
          background: "#18181b",
          font: FONT,
          lineHeight: LINE_HEIGHT,
        }}
      >
        {gutter}
      </div>
      <textarea
        className="code-editor__area"
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-label={ariaLabel}
        style={{
          flex: "1 1 auto",
          margin: 0,
          padding: "8px 10px",
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          color: "#d4d4d8",
          font: FONT,
          lineHeight: LINE_HEIGHT,
          whiteSpace: "pre",
          overflow: "auto",
          tabSize: 2,
        }}
      />
    </div>
  );
}
