import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./App.css", import.meta.url), "utf8");

describe("move pointer", () => {
  it("shows the four-way move pointer over anything a selection-tool drag would move", () => {
    const rule = css.match(/([^{}]*)\{\s*cursor:\s*move;\s*\}/g)?.find((block) => block.includes('data-active-tool-kind="selection"'));
    expect(rule).toBeDefined();
    // Objects (structures' atom/bond targets, text, shapes, brackets), charge marks and art glyphs.
    expect(rule).toContain(".page [data-object-id]");
    expect(rule).toContain(".charge-hit-area");
    expect(rule).toContain(".graphic-glyph-hit-target");
  });

  it("keeps the handles' and text fields' own pointers", () => {
    expect(css).toMatch(/\[data-object-id\] \.object-rotate-handle \{\s*cursor: default;/);
    expect(css).toMatch(/\[contenteditable="true"\] \{\s*cursor: text;/);
    expect(css).toMatch(/\.object-resize-top-left \{[^}]*cursor: nwse-resize;/);
  });
});
