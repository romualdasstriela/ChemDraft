import { describe, expect, it } from "vitest";
import {
  applyPatches,
  nativeTextStyleFromObjectStyle,
  type ChemDraftDocument,
  type DocumentObject,
  type ElectronMarkObject,
  type GraphicObject,
  type MoleculeObject,
  type TextObject
} from "@chemdraft/chem-core";
import { moleculeAnchorForArrangement, moleculeInkBoundsForArrangement } from "@chemdraft/layout-engine";
import {
  cleanUpReactionLayout,
  createPhase4Document,
  insertNativeTemplateMolecule,
  REACTION_CONDITIONS_FONT_SIZE_PX,
  REACTION_PLUS_FONT_SIZE_PX,
  selectDocumentObjects
} from "./documentWorkflow";
import { cleanUpReactionCommandId, createLayerActions, createQuickActions } from "./commands";
import { withStandaloneDrawingToolCommands } from "./drawingTools";
import { applyKeybindingSchemeToCommands } from "./keybindingScheme";
import { createDesktopShortcutRegistry, createMainWindowShortcutCommands } from "./keyboardShortcuts";
import { desktopToolsetRegistry, getToolsetCommandSpecs } from "./toolsets";

const arrow = (id: string, start: { x: number; y: number }, end: { x: number; y: number }): GraphicObject => ({
  id, type: "graphic", graphicKind: "line",
  x: Math.min(start.x, end.x) - 10, y: Math.min(start.y, end.y) - 10,
  width: Math.abs(end.x - start.x) + 20, height: Math.abs(end.y - start.y) + 20, rotation: 0,
  style: { strokeWidth: 1.5 },
  data: { artPathKind: "line", artToolId: "reactionArrow", lineStart: start, lineEnd: end, markerEnd: { kind: "filled-arrow", sizePx: 10 } }
});

const text = (id: string, value: string, x: number, y: number): TextObject => ({
  id, type: "text", text: value, spans: [], x, y, width: 90, height: 30, rotation: 0,
  style: { fontSizePx: 20, textBoxSizingMode: "auto" }
});

/** A messy A + B -> C: structures at different heights, a "+" drawn with the charge tool, a short
 *  arrow with conditions that do not fit it, and big text. */
function messyReaction(): ChemDraftDocument {
  let document = createPhase4Document("Reaction");
  document = insertNativeTemplateMolecule(document, { x: 120, y: 200 }, "benzene");
  document = insertNativeTemplateMolecule(document, { x: 260, y: 260 }, "cyclohexane");
  document = insertNativeTemplateMolecule(document, { x: 520, y: 170 }, "benzene");
  const molecules = document.pages[0].objects.filter((object) => object.type === "molecule");
  const plus: ElectronMarkObject = {
    id: "plus-mark", type: "electron-mark", markKind: "charge", charge: 1, chargeStyle: "plain",
    x: 185, y: 235, width: 10, height: 10, rotation: 0, style: {},
    anchor: { kind: "point", point: { x: 190, y: 240 } }
  };
  const objects: DocumentObject[] = [
    plus,
    arrow("arrow", { x: 360, y: 230 }, { x: 400, y: 232 }),
    text("above", "Pd(PPh3)4, K2CO3", 345, 190),
    text("below", "THF, 60 °C", 360, 245)
  ];
  document = applyPatches(document, objects.map((object) => ({ op: "addObject" as const, pageId: document.pages[0].id, object })));
  return selectDocumentObjects(document, document.pages[0].id, [...molecules.map((m) => m.id), ...objects.map((o) => o.id)]);
}

const byId = (document: ChemDraftDocument, id: string) => document.pages[0].objects.find((object) => object.id === id);

describe("Clean Up Reaction", () => {
  it("puts structures, plus and arrow on one line, spaced evenly, with 14 pt bold plus and 10 pt conditions", () => {
    const before = messyReaction();
    const { document, status } = cleanUpReactionLayout(before);
    expect(status).toBe("Cleaned up reaction: 3 items, 1 arrow");

    const line = (byId(document, "arrow") as GraphicObject).data;
    const lineY = line.lineStart!.y;
    expect(line.lineEnd!.y).toBeCloseTo(lineY, 6);
    expect(line.lineEnd!.x).toBeGreaterThan(line.lineStart!.x);

    const molecules = document.pages[0].objects.filter((object): object is MoleculeObject => object.type === "molecule");
    for (const molecule of molecules) expect(moleculeAnchorForArrangement(molecule).y).toBeCloseTo(lineY, 6);

    // The charge-tool plus became "+" text, 14 pt bold, centred on the line.
    expect(byId(document, "plus-mark")).toBeUndefined();
    const plus = document.pages[0].objects.find((object): object is TextObject => object.type === "text" && object.text === "+")!;
    const plusStyle = nativeTextStyleFromObjectStyle(plus.style);
    expect(plusStyle.fontSizePx).toBeCloseTo(REACTION_PLUS_FONT_SIZE_PX, 6);
    expect(plusStyle.fontWeight).toBe(700);
    expect(plus.y + plusStyle.fontSizePx * (1 - 0.32)).toBeCloseTo(lineY, 6);
    expect(document.selection.objectIds).toContain(plus.id);

    // Left to right with the same gap between neighbours.
    const [first, second, product] = [...molecules].sort((a, b) => a.x - b.x).map(moleculeInkBoundsForArrangement);
    const plusCenter = plus.x + plus.width / 2, plusHalf = 0.29 * plusStyle.fontSizePx;
    const gaps = [
      plusCenter - plusHalf - (first.x + first.width),
      second.x - (plusCenter + plusHalf),
      line.lineStart!.x - (second.x + second.width),
      product.x - line.lineEnd!.x
    ];
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
    expect(gaps[0]).toBeGreaterThan(5);

    // Conditions: 10 pt, centred over and under the arrow, which is long enough for them.
    const middle = (line.lineStart!.x + line.lineEnd!.x) / 2;
    const above = byId(document, "above") as TextObject, below = byId(document, "below") as TextObject;
    for (const condition of [above, below]) {
      const style = nativeTextStyleFromObjectStyle(condition.style);
      expect(style.fontSizePx).toBeCloseTo(REACTION_CONDITIONS_FONT_SIZE_PX, 6);
      expect(style.textAlign).toBe("center");
      expect(condition.x + condition.width / 2).toBeCloseTo(middle, 6);
    }
    expect(above.y + nativeTextStyleFromObjectStyle(above.style).fontSizePx).toBeLessThan(lineY);
    expect(below.y).toBeGreaterThan(lineY - 6);
    expect(line.lineEnd!.x - line.lineStart!.x).toBeGreaterThan(above.width - 6);

    // Chemistry untouched: same atoms and bonds, only moved.
    const original = before.pages[0].objects.filter((object): object is MoleculeObject => object.type === "molecule");
    for (const molecule of original) {
      const moved = byId(document, molecule.id) as MoleculeObject;
      expect(moved.atoms.map((atom) => atom.element)).toEqual(molecule.atoms.map((atom) => atom.element));
      expect(moved.bonds).toEqual(molecule.bonds);
      const dx = moved.atoms[0].x - molecule.atoms[0].x, dy = moved.atoms[0].y - molecule.atoms[0].y;
      moved.atoms.forEach((atom, index) => {
        expect(atom.x - molecule.atoms[index].x).toBeCloseTo(dx, 6);
        expect(atom.y - molecule.atoms[index].y).toBeCloseTo(dy, 6);
      });
    }
  });

  it("adds a 14 pt bold + between two products drawn side by side without one", () => {
    // A -> B C, as drawn: no plus between the two products.
    let document = createPhase4Document("Two products");
    document = insertNativeTemplateMolecule(document, { x: 120, y: 200 }, "benzene");
    document = insertNativeTemplateMolecule(document, { x: 400, y: 200 }, "benzene");
    document = insertNativeTemplateMolecule(document, { x: 520, y: 190 }, "cyclohexane");
    const molecules = document.pages[0].objects.filter((object) => object.type === "molecule").map((object) => object.id);
    document = applyPatches(document, [{ op: "addObject", pageId: document.pages[0].id, object: arrow("arrow", { x: 200, y: 205 }, { x: 330, y: 205 }) }]);
    document = selectDocumentObjects(document, document.pages[0].id, [...molecules, "arrow"]);

    const { document: next, status } = cleanUpReactionLayout(document);
    expect(status).toBe('Cleaned up reaction: 3 items, 1 arrow, 1 "+" added');
    const pluses = next.pages[0].objects.filter((object): object is TextObject => object.type === "text" && object.text === "+");
    expect(pluses).toHaveLength(1);
    const style = nativeTextStyleFromObjectStyle(pluses[0].style);
    expect(style.fontSizePx).toBeCloseTo(REACTION_PLUS_FONT_SIZE_PX, 6);
    expect(style.fontWeight).toBe(700);
    expect(next.selection.objectIds).toContain(pluses[0].id);

    const [, first, second] = next.pages[0].objects.filter((object): object is MoleculeObject => object.type === "molecule")
      .map(moleculeInkBoundsForArrangement).sort((a, b) => a.x - b.x);
    const center = pluses[0].x + pluses[0].width / 2, half = 0.29 * style.fontSizePx;
    expect(center - half - (first.x + first.width)).toBeCloseTo(second.x - (center + half), 6);
    const lineY = (byId(next, "arrow") as GraphicObject).data.lineStart!.y;
    expect(pluses[0].y + style.fontSizePx * (1 - 0.32)).toBeCloseTo(lineY, 6);
  });

  it("lays a top-to-bottom scheme out down one line, with conditions beside the arrow", () => {
    // A, a down arrow with two conditions on its right, then B + C stacked below.
    let document = createPhase4Document("Vertical");
    document = insertNativeTemplateMolecule(document, { x: 150, y: 200 }, "benzene");
    document = insertNativeTemplateMolecule(document, { x: 165, y: 380 }, "benzene");
    document = insertNativeTemplateMolecule(document, { x: 140, y: 480 }, "cyclohexane");
    const molecules = document.pages[0].objects.filter((object) => object.type === "molecule").map((object) => object.id);
    const objects: DocumentObject[] = [
      arrow("arrow", { x: 152, y: 255 }, { x: 151, y: 330 }),
      text("above", "MeI, K2CO3", 160, 270),
      text("below", "DMSO, 60 °C", 160, 296),
      { ...text("plus", "+", 150, 430), style: { fontSizePx: 18, textBoxSizingMode: "auto" } }
    ];
    document = applyPatches(document, objects.map((object) => ({ op: "addObject" as const, pageId: document.pages[0].id, object })));
    document = selectDocumentObjects(document, document.pages[0].id, [...molecules, ...objects.map((o) => o.id)]);

    const { document: next, status } = cleanUpReactionLayout(document);
    expect(status).toBe("Cleaned up reaction: 3 items, 1 arrow");
    const line = (byId(next, "arrow") as GraphicObject).data;
    const lineX = line.lineStart!.x;
    expect(line.lineEnd!.x).toBeCloseTo(lineX, 6);
    expect(line.lineEnd!.y).toBeGreaterThan(line.lineStart!.y);

    const placed = next.pages[0].objects.filter((object): object is MoleculeObject => object.type === "molecule");
    for (const molecule of placed) expect(moleculeAnchorForArrangement(molecule).x).toBeCloseTo(lineX, 6);
    const plus = byId(next, "plus") as TextObject;
    expect(plus.x + plus.width / 2).toBeCloseTo(lineX, 6);
    expect(nativeTextStyleFromObjectStyle(plus.style).fontWeight).toBe(700);

    // Top to bottom with equal gaps: A, arrow, B, +, C.
    const [a, b, c] = placed.map(moleculeInkBoundsForArrangement).sort((p, q) => p.y - q.y);
    const plusStyle = nativeTextStyleFromObjectStyle(plus.style);
    const plusTop = plus.y + 0.28 * plusStyle.fontSizePx, plusBottom = plus.y + 1.22 * plusStyle.fontSizePx;
    const gaps = [line.lineStart!.y - (a.y + a.height), b.y - line.lineEnd!.y, plusTop - (b.y + b.height), c.y - plusBottom];
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);

    // Conditions: 10 pt, left-aligned just right of the arrow, as one block centred on it.
    const above = byId(next, "above") as TextObject, below = byId(next, "below") as TextObject;
    for (const condition of [above, below]) {
      const style = nativeTextStyleFromObjectStyle(condition.style);
      expect(style.fontSizePx).toBeCloseTo(REACTION_CONDITIONS_FONT_SIZE_PX, 6);
      expect(style.textAlign).toBe("left");
      expect(condition.x).toBeGreaterThan(lineX);
      expect(condition.x).toBeLessThan(lineX + 12);
    }
    expect(below.y).toBeGreaterThan(above.y);
    const blockMiddle = ((above.y + 0.28 * REACTION_CONDITIONS_FONT_SIZE_PX) + (below.y + 1.22 * REACTION_CONDITIONS_FONT_SIZE_PX)) / 2;
    expect(blockMiddle).toBeCloseTo((line.lineStart!.y + line.lineEnd!.y) / 2, 6);
  });

  it("refuses a scheme whose arrows run different ways", () => {
    let document = messyReaction();
    document = applyPatches(document, [{ op: "addObject", pageId: document.pages[0].id, object: arrow("down", { x: 600, y: 100 }, { x: 600, y: 200 }) }]);
    document = selectDocumentObjects(document, document.pages[0].id, [...document.selection.objectIds, "down"]);
    expect(cleanUpReactionLayout(document).status).toBe("Clean Up Reaction needs all arrows running the same way: all across or all down");
  });

  it("keeps a right-to-left arrow pointing left and refuses selections without an arrow", () => {
    let document = messyReaction();
    document = applyPatches(document, [{ op: "updateObject", objectId: "arrow", changes: {
      data: { ...(byId(document, "arrow") as GraphicObject).data, lineStart: { x: 400, y: 232 }, lineEnd: { x: 360, y: 230 } } } }]);
    const line = (byId(cleanUpReactionLayout(document).document, "arrow") as GraphicObject).data;
    expect(line.lineEnd!.x).toBeLessThan(line.lineStart!.x);

    const noArrow = selectDocumentObjects(document, document.pages[0].id,
      document.selection.objectIds.filter((id) => id !== "arrow"));
    expect(cleanUpReactionLayout(noArrow)).toEqual({ document: noArrow, status: "Select a reaction with at least one arrow" });
  });

  it("is a layout command with a toolbar icon", () => {
    const command = createLayerActions(messyReaction()).find((action) => action.id === cleanUpReactionCommandId);
    expect(command).toMatchObject({ title: "Clean Up Reaction", shortcut: "Shift+Cmd+X", assetName: "Custom_Reaction_Cleanup", enabled: true });
  });

  it.each([
    ["windows", "chemdraft"], ["windows", "chemdraw"], ["macos", "chemdraft"], ["macos", "chemdraw"]
  ] as const)("Ctrl+Shift+X (Cmd on macOS) reaches it and clashes with nothing (%s, %s scheme)", (platform, scheme) => {
    const document = messyReaction();
    const commands = createMainWindowShortcutCommands({
      quickActions: createQuickActions(document, undefined, { canUndo: true, canRedo: true }),
      layerActions: createLayerActions(document),
      toolCommandSpecs: applyKeybindingSchemeToCommands(withStandaloneDrawingToolCommands(getToolsetCommandSpecs(desktopToolsetRegistry)), scheme)
    }, scheme);
    const registry = createDesktopShortcutRegistry(commands, { platform, includeDisabled: true });
    const modifier = platform === "macos" ? { metaKey: true } : { ctrlKey: true };
    expect(registry.resolve({ key: "x", shiftKey: true, ...modifier })).toBe(cleanUpReactionCommandId);
    expect(registry.resolve({ key: "X", shiftKey: true, ...modifier })).toBe(cleanUpReactionCommandId);
    expect(registry.conflicts().filter((conflict) => JSON.stringify(conflict).includes(cleanUpReactionCommandId))).toEqual([]);
  });
});
