// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChemDraftDocument, GraphicObject, MoleculeObject, Point } from "@chemdraft/chem-core";
import { MainWindow } from "./MainWindow";
import {
  createPhase4Document,
  groupSelectedDocumentObjects,
  insertNativeSingleBondMolecule,
  selectDocumentObjects
} from "./documentWorkflow";
import { saveKeybindingSettings } from "./keybindingSettings";

// Structures opened from other programs usually sit in groups (a structure with its caption) and
// inside unfilled boxes drawn around a scheme. Neither may stop a drawing tool editing the atoms.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
const molecules = (document: ChemDraftDocument) =>
  document.pages[0].objects.filter((object): object is MoleculeObject => object.type === "molecule");

/** Two bonds drawn apart and grouped, as an imported structure-with-caption group would be. */
function groupedDocument(): ChemDraftDocument {
  const first = insertNativeSingleBondMolecule(createPhase4Document("Grouped"), { x: 240, y: 240 });
  const second = insertNativeSingleBondMolecule(first, { x: 420, y: 240 });
  const ids = molecules(second).map((molecule) => molecule.id);
  return groupSelectedDocumentObjects(selectDocumentObjects(second, second.pages[0].id, ids));
}

/** An unfilled box drawn over everything, after the structures. */
function withBox(document: ChemDraftDocument): ChemDraftDocument {
  const box: GraphicObject = {
    id: "box", type: "graphic", graphicKind: "rect", x: 150, y: 150, width: 380, height: 180, rotation: 0,
    style: { strokeColor: "#004080", fillColor: "none", strokeWidth: 1 }, data: {}
  };
  return { ...document, pages: [{ ...document.pages[0], objects: [...document.pages[0].objects, box] }] };
}

describe("drawing tools on grouped and boxed structures", () => {
  let root: Root;
  let container: HTMLDivElement;
  const captureMethods = ["setPointerCapture", "releasePointerCapture", "hasPointerCapture"] as const;
  let descriptors: Array<PropertyDescriptor | undefined>;
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    // jsdom has no CSS.escape; the press re-targeting looks the structure's element up with it.
    if (typeof CSS === "undefined") vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/["\\]/g, "\\$&") });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
    descriptors = captureMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    for (const name of captureMethods) Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true, value: name === "hasPointerCapture" ? () => false : () => {}
    });
    saveKeybindingSettings({ scheme: "chemdraft" });
    window.history.replaceState(null, "", "/?agentBridge=1");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    captureMethods.forEach((name, i) => {
      const descriptor = descriptors[i];
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    });
    window.history.replaceState(null, "", "/");
    delete window.__CHEMDRAFT_AGENT__;
  });
  const current = () => window.__CHEMDRAFT_AGENT__!.snapshot().document;
  async function mount(document: ChemDraftDocument, tool = "tool.bond") {
    await act(async () => root.render(createElement(MainWindow, {
      initialDocument: document, initialActiveToolCommandId: tool, initialCrosshairsVisible: false,
      initialRulersVisible: false, initialPaletteMode: "hidden", nativePalette: true
    })));
    const rect = { x: 0, y: 0, left: 0, top: 0, right: 792, bottom: 612, width: 792, height: 612, toJSON: () => ({}) } as DOMRect;
    for (const element of container.querySelectorAll<HTMLElement>(".page, .canvas-region")) element.getBoundingClientRect = () => rect;
  }
  async function pointer(type: "pointerdown" | "pointermove" | "pointerup", point: Point, target: Element) {
    await act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0,
        buttons: type === "pointerup" ? 0 : 1, clientX: point.x, clientY: point.y });
      Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: "mouse" }, isPrimary: { value: true } });
      target.dispatchEvent(event);
    });
  }

  it("grows a grouped structure from the clicked atom instead of drawing a separate bond", async () => {
    await mount(groupedDocument());
    const [molecule] = molecules(current());
    const atom = molecule!.atoms[1]!;
    const wrapper = container.querySelector(`[data-object-id="${molecule!.id}"]`)!;
    await pointer("pointermove", atom, wrapper);
    await pointer("pointerdown", atom, wrapper);
    await pointer("pointerup", atom, wrapper);
    const after = molecules(current());
    expect(after).toHaveLength(2);
    expect(after.find((candidate) => candidate.id === molecule!.id)!.atoms).toHaveLength(3);
  });

  it.each([["tool.doubleBond", "double"], ["tool.tripleBond", "triple"]] as const)(
    "%s sets the order of the bond clicked in a grouped structure, drawing nothing new",
    async (tool, order) => {
      await mount(groupedDocument(), tool);
      const [molecule] = molecules(current());
      const [from, to] = molecule!.atoms;
      const middle = { x: (from!.x + to!.x) / 2, y: (from!.y + to!.y) / 2 };
      const wrapper = container.querySelector(`[data-object-id="${molecule!.id}"]`)!;
      await pointer("pointermove", middle, wrapper);
      await pointer("pointerdown", middle, wrapper);
      await pointer("pointerup", middle, wrapper);
      const after = molecules(current());
      expect(after).toHaveLength(2);
      expect(after.find((candidate) => candidate.id === molecule!.id)!.bonds[0]!.order).toBe(order);
    }
  );

  it("lets an atom seen through an unfilled box take the press", async () => {
    await mount(withBox(groupedDocument()));
    const [molecule] = molecules(current());
    const atom = molecule!.atoms[1]!;
    const box = container.querySelector('[data-page-svg-object-visual="box"]')!;
    expect(box).not.toBeNull();
    await pointer("pointermove", atom, box);
    await pointer("pointerdown", atom, box);
    // The press moved pointer capture to the structure, so the release arrives there.
    await pointer("pointerup", atom, container.querySelector(`[data-object-id="${molecule!.id}"]`)!);
    const after = molecules(current());
    expect(after).toHaveLength(2);
    expect(after.find((candidate) => candidate.id === molecule!.id)!.atoms).toHaveLength(3);
    expect(current().pages[0].objects.find((object) => object.id === "box")).toBeDefined();
  });
});
