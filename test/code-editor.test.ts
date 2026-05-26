// Tests for the first-party CodeEditor that replaced @uiw/react-codemirror
// and the CodeMirror / Lezer dependency tree.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  applyIndent,
  CodeEditor,
  countLines,
  gutterText,
} from "../src/client/components/CodeEditor";

describe("countLines", () => {
  test("empty buffer is one line", () => {
    expect(countLines("")).toBe(1);
  });

  test("a single line with no newline", () => {
    expect(countLines("package.json")).toBe(1);
  });

  test("counts newline-separated lines", () => {
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\nc")).toBe(3);
  });

  test("a trailing newline opens a new (empty) line", () => {
    expect(countLines("a\n")).toBe(2);
    expect(countLines("\n\n")).toBe(3);
  });
});

describe("gutterText", () => {
  test("single line gutter is '1'", () => {
    expect(gutterText("only one line")).toBe("1");
  });

  test("one number per line, newline-joined", () => {
    expect(gutterText("a\nb\nc")).toBe("1\n2\n3");
  });

  test("gutter row count tracks countLines", () => {
    const buf = "x\ny\nz\nw";
    expect(gutterText(buf).split("\n").length).toBe(countLines(buf));
  });
});

describe("applyIndent", () => {
  test("inserts one indent at a collapsed caret", () => {
    const r = applyIndent("abc", 1, 1);
    expect(r.value).toBe("a  bc");
    expect(r.selStart).toBe(3);
    expect(r.selEnd).toBe(3);
  });

  test("indents at the start of the buffer", () => {
    const r = applyIndent("xy", 0, 0);
    expect(r.value).toBe("  xy");
    expect(r.selStart).toBe(2);
  });

  test("indents every line a multi-line selection touches", () => {
    const r = applyIndent("l1\nl2\nl3", 0, 8);
    expect(r.value).toBe("  l1\n  l2\n  l3");
    expect(r.selStart).toBe(2);
    expect(r.selEnd).toBe(14);
  });

  test("partial multi-line selection still indents whole lines", () => {
    const r = applyIndent("aa\nbb", 1, 4);
    expect(r.value).toBe("  aa\n  bb");
    expect(r.selEnd).toBe(8);
  });

  test("is a pure function — original buffer is untouched", () => {
    const src = "keep\nme";
    applyIndent(src, 0, 0);
    expect(src).toBe("keep\nme");
  });
});

describe("CodeEditor render", () => {
  const render = (props: Partial<Record<string, unknown>>) =>
    renderToStaticMarkup(
      createElement(CodeEditor, {
        value: "alpha\nbeta",
        onChange: () => {},
        ...props,
      }),
    );

  test("renders a textarea with the buffer contents", () => {
    const html = render({});
    expect(html).toContain("<textarea");
    expect(html).toContain("alpha");
  });

  test("renders a line-number gutter", () => {
    const html = render({});
    // Two lines -> gutter shows 1 and 2.
    expect(html).toContain(">1\n2<");
  });

  test("height prop drives the container height", () => {
    expect(render({ height: "30vh" })).toContain("height:30vh");
  });

  test("readOnly is forwarded to the textarea", () => {
    const html = render({ readOnly: true });
    expect(html).toContain('readOnly=""');
    expect(render({})).not.toContain("readOnly");
  });

  test("ariaLabel is forwarded for assistive tech", () => {
    expect(render({ ariaLabel: "Editing wrangler.toml" })).toContain(
      'aria-label="Editing wrangler.toml"',
    );
  });
});
