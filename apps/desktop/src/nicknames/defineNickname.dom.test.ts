// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MoleculeObject } from "@chemdraft/chem-core";
import { MainWindow } from "../MainWindow";
import {
  applyNativeAtomElementTarget,
  applySingleBondToolAtPoint,
  createPhase4Document,
  selectDocumentObjects
} from "../documentWorkflow";
import { loadNicknameDefineRequest } from "./userTemplates";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function molecule(document: ReturnType<typeof createPhase4Document>): MoleculeObject {
  return document.pages[0].objects.find((object): object is MoleculeObject => object.type === "molecule")!;
}

describe("Define Nickname", () => {
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

  async function mount(document: ReturnType<typeof createPhase4Document>) {
    await act(async () => {
      root.render(createElement(MainWindow, {
        initialDocument: document,
        initialPaletteMode: "hidden",
        initialRulersVisible: false,
        initialCrosshairsVisible: false,
        nativePalette: false
      }));
    });
  }

  it("hands a selected structure with a * attachment mark to the Nicknames toolbar", async () => {
    // *–C–C: a two-atom chain with a * on one end.
    let drawing = applySingleBondToolAtPoint(createPhase4Document("Define"), { x: 200, y: 200 });
    const end = molecule(drawing).atoms[1]!;
    drawing = applySingleBondToolAtPoint(drawing, { x: end.x, y: end.y });
    const first = molecule(drawing).atoms[0]!;
    drawing = applyNativeAtomElementTarget(drawing, { objectId: molecule(drawing).id, kind: "atom", atomId: first.id, distanceToPointer: 0 }, "*");
    drawing = selectDocumentObjects(drawing, drawing.pages[0].id, [molecule(drawing).id]);
    await mount(drawing);

    await act(async () => { await window.__CHEMDRAFT_AGENT__!.command("nicknames.defineFromSelection"); });

    expect(loadNicknameDefineRequest()).toMatchObject({ formula: "C2H5", sites: 1 });
  });

  it("takes a whole structure with no attachment as drawn", async () => {
    const drawing = applySingleBondToolAtPoint(createPhase4Document("Define"), { x: 200, y: 200 });
    await mount(selectDocumentObjects(drawing, drawing.pages[0].id, [molecule(drawing).id]));

    await act(async () => { await window.__CHEMDRAFT_AGENT__!.command("nicknames.defineFromSelection"); });

    expect(loadNicknameDefineRequest()).toMatchObject({ formula: "C2H6", sites: 0 });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("as drawn");
  });
});
