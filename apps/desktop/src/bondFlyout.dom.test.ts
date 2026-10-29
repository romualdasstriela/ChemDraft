// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ToolPalette } from "./ToolPalette";
import { getToolsetItemGroups } from "./toolsets";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("bond flyout button", () => {
  async function renderStructureToolbar(activeTool: string, invoked: string[] = []) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(ToolPalette, {
        mode: "floating",
        activeTool,
        itemGroups: getToolsetItemGroups("core.structure"),
        onInvoke: (commandId: string) => invoked.push(commandId)
      }));
    });
    const shell = container.querySelector<HTMLElement>('[data-toolbar-item-id="tool.bond"]')!;
    return { container, root, shell };
  }

  it("shows and stays on the bond picked from its flyout", async () => {
    const invoked: string[] = [];
    const { container, root, shell } = await renderStructureToolbar("tool.doubleBond", invoked);
    expect(shell.querySelector("img")?.getAttribute("src")).toContain("Custom_Bond_Double");
    expect(shell.querySelector("button")?.className).toContain("active");

    // Back to the plain single bond tool: the button stays on the last picked bond.
    await act(async () => {
      root.render(createElement(ToolPalette, {
        mode: "floating",
        activeTool: "tool.select",
        itemGroups: getToolsetItemGroups("core.structure"),
        onInvoke: (commandId: string) => invoked.push(commandId)
      }));
    });
    expect(shell.querySelector("img")?.getAttribute("src")).toContain("Custom_Bond_Double");
    expect(shell.querySelector("button")?.className).not.toContain("active");

    act(() => root.unmount());
    container.remove();
  });

  it("shows the single bond until another bond is picked", async () => {
    const { container, root, shell } = await renderStructureToolbar("tool.select");
    const src = shell.querySelector("img")?.getAttribute("src") ?? "";
    expect(src).toContain("Custom_Bond");
    expect(src).not.toContain("Custom_Bond_Double");
    act(() => root.unmount());
    container.remove();
  });
});
