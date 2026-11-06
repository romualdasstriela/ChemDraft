// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MainWindow } from "./MainWindow";
import { createPhase4Document, insertNativeBracket } from "./documentWorkflow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("polymer bracket on the canvas", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    window.history.replaceState(null, "", "/?agentBridge=1");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
    delete window.__CHEMDRAFT_AGENT__;
    globalThis.localStorage.clear();
    if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  it("draws ( )n as one object and changes n by double-click, typing and Enter", async () => {
    const drawing = insertNativeBracket(createPhase4Document("Polymer"), { x: 200, y: 200 }, "polymer");
    const id = drawing.pages[0].objects[0]!.id;
    await act(async () => {
      root.render(createElement(MainWindow, {
        initialDocument: drawing,
        initialPaletteMode: "hidden",
        initialRulersVisible: false,
        initialCrosshairsVisible: false,
        nativePalette: false
      }));
    });

    const visual = container.querySelector(`[data-page-svg-object-visual="${id}"]`)!;
    expect(visual).not.toBeNull();
    expect(visual.querySelector("text.bracket-label")?.textContent).toBe("n");
    expect([...visual.querySelectorAll("[data-bracket-hit]")].map((rect) => rect.getAttribute("data-bracket-hit")))
      .toEqual(["open", "close", "label"]);

    await act(async () => {
      visual.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    const input = container.querySelector<HTMLInputElement>(`[data-bracket-label-editor="${id}"]`)!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("n");

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "m");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(container.querySelector("[data-bracket-label-editor]")).toBeNull();
    const snapshot = window.__CHEMDRAFT_AGENT__!.snapshot().document;
    expect(snapshot.pages[0].objects).toHaveLength(1);
    expect(snapshot.pages[0].objects[0]).toMatchObject({ id, type: "bracket", bracketKind: "polymer", label: "m" });
    expect(container.querySelector(`[data-page-svg-object-visual="${id}"] text.bracket-label`)?.textContent).toBe("m");
  });
});
