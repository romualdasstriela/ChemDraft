// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ToolPalette } from "./ToolPalette";
import { desktopToolsets, getToolsetItemGroups } from "./toolsets";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("docked Main toolbar wrapping", () => {
  async function renderMain(wrapAtSeparators: boolean) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const main = desktopToolsets.find((toolset) => toolset.id === "core.main")!;
    await act(async () => {
      root.render(createElement(ToolPalette, {
        mode: "floating",
        orientation: "horizontal",
        gridLayout: main.gridLayout,
        itemGroups: getToolsetItemGroups("core.main"),
        onInvoke: () => undefined,
        wrapAtSeparators
      }));
    });
    const groups = [...container.querySelectorAll(".tool-group")];
    const itemIds = groups.flatMap((group) => [...group.querySelectorAll("[data-toolbar-item-id]")]
      .map((element) => element.getAttribute("data-toolbar-item-id")));
    const separators = container.querySelectorAll('[role="separator"]').length;
    act(() => root.unmount());
    container.remove();
    return { groupCount: groups.length, itemIds, separators };
  }

  it("splits the toolbar into one section per divider, keeping every tool in order", async () => {
    const whole = await renderMain(false);
    const wrapped = await renderMain(true);

    expect(whole.groupCount).toBe(1);
    expect(whole.separators).toBeGreaterThan(0);
    // Each divider starts a new section; the section edges draw the dividers instead.
    expect(wrapped.groupCount).toBeGreaterThan(whole.separators - 1);
    expect(wrapped.separators).toBe(0);
    expect(wrapped.itemIds).toEqual(whole.itemIds.filter((id) => !id?.includes(".divider.")));
    expect(wrapped.itemIds).toContain("tool.select");
    expect(wrapped.itemIds).toContain("structure.cleanup3d");
  });
});
