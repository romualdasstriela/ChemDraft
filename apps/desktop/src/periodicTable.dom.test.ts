// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoleculeObject } from "@chemdraft/chem-core";
import { MainWindow } from "./MainWindow";
import { createPhase4Document, insertNativeTemplateMolecule, selectDocumentObjects } from "./documentWorkflow";
import { ToolPalette } from "./ToolPalette";
import { TOOLBAR_WIDGET_IDS } from "./toolbars/toolbarWidgets";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("periodic table element tools", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    window.history.replaceState(null, "", "/?agentBridge=1");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const withRing = insertNativeTemplateMolecule(createPhase4Document("Element tool"), { x: 300, y: 300 }, "cyclohexane");
    await act(async () => {
      root.render(createElement(MainWindow, {
        initialActiveToolCommandId: "tool.select",
        initialCrosshairsVisible: false,
        initialDocument: selectDocumentObjects(withRing, withRing.pages[0].id, []),
        initialPaletteMode: "hidden",
        initialRulersVisible: false,
        nativePalette: true
      }));
    });
    const rect = { x: 0, y: 0, left: 0, top: 0, right: 792, bottom: 612, width: 792, height: 612, toJSON: () => ({}) } as DOMRect;
    for (const element of container.querySelectorAll<HTMLElement>(".page, .canvas-region")) {
      element.getBoundingClientRect = () => rect;
    }
    await act(async () => { await Promise.resolve(); });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
    delete window.__CHEMDRAFT_AGENT__;
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      Reflect.deleteProperty(globalThis, "ResizeObserver");
    }
  });

  const agent = () => window.__CHEMDRAFT_AGENT__!;
  function molecule(): MoleculeObject {
    const object = agent().snapshot().document.pages[0].objects[0];
    if (object?.type !== "molecule") throw new Error("Expected molecule");
    return object;
  }
  async function clickAtom(index: number) {
    const current = molecule();
    await act(async () => { await agent().click({ atom: { objectId: current.id, atomId: current.atoms[index]!.id } }); });
  }

  it("keeps the armed element and sets every clicked atom to it, one undo step each", async () => {
    await act(async () => { await agent().command("tool.element.Se"); });
    expect(agent().snapshot().activeToolCommandId).toBe("tool.element.Se");
    await clickAtom(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Set atom to Se");
    await clickAtom(2);
    expect(molecule().atoms.map((atom) => atom.element)).toEqual(["Se", "C", "Se", "C", "C", "C"]);
    expect(agent().snapshot().activeToolCommandId).toBe("tool.element.Se");

    await act(async () => { await agent().command("tool.element.Pt"); });
    await clickAtom(4);
    expect(molecule().atoms[4]!.element).toBe("Pt");

    await act(async () => { await agent().command("edit.undo"); });
    expect(molecule().atoms.map((atom) => atom.element)).toEqual(["Se", "C", "Se", "C", "C", "C"]);
    expect(molecule().atoms).toHaveLength(6);
    expect(molecule().bonds).toHaveLength(6);
  });
});

describe("periodic table widget", () => {
  it("lays out every element, marks the armed one, and arms a tool on press", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const invoked: string[] = [];
    await act(async () => {
      root.render(createElement(ToolPalette, {
        mode: "floating",
        orientation: "horizontal",
        activeTool: "tool.element.Fe",
        onInvoke: (commandId: string) => invoked.push(commandId),
        itemGroups: [[{
          id: TOOLBAR_WIDGET_IDS.periodicTable,
          kind: "control",
          label: "Periodic Table",
          primary: { type: "control", controlId: TOOLBAR_WIDGET_IDS.periodicTable },
          submenu: null,
          tooltip: { title: "Periodic Table" },
          layout: { colSpan: 1, rowSpan: 1 }
        }]]
      }));
    });

    const cells = container.querySelectorAll<HTMLButtonElement>(".periodic-table-cell");
    expect(cells).toHaveLength(118);
    expect(container.querySelector(".periodic-table-cell.active")?.textContent).toBe("Fe");
    const se = container.querySelector<HTMLButtonElement>('[data-command-id="tool.element.Se"]')!;
    expect(se.style.gridRow).toBe("4");
    expect(se.style.gridColumn).toBe("16");
    await act(async () => {
      se.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    expect(invoked).toEqual(["tool.element.Se"]);

    act(() => root.unmount());
    container.remove();
  });
});
