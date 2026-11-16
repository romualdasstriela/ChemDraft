import { describe, expect, it } from "vitest";
import type { BracketObject } from "@chemdraft/chem-core";
import { bracketGlyphPathD, bracketPairShape } from "@chemdraft/layout-engine";
import { polymerBracketHitRects } from "./MainWindow";
import { bracketKindForToolCommand, bracketPairShapeForToolCommand, createPhase4Document, insertNativeBracket } from "./documentWorkflow";
import { desktopToolsetRegistry, getToolsetCommandGroups } from "./toolsets";

const bracket: BracketObject = {
  id: "poly", type: "bracket", x: 100, y: 200, width: 64, height: 48, rotation: 0, style: {},
  bracketKind: "polymer", label: "n", containedObjectIds: []
};

describe("polymer bracket pointer catchers", () => {
  it("cover the two parentheses and the label, leaving the space between them free", () => {
    const rects = polymerBracketHitRects(bracket);
    expect(rects.map((rect) => rect.part)).toEqual(["open", "close", "label"]);
    const [open, close, label] = rects;
    // Nothing catches the middle of the box, where the repeat unit is drawn.
    const middle = 100 + 32;
    expect(open!.x + open!.width).toBeLessThan(middle);
    expect(close!.x).toBeGreaterThan(middle);
    // The label box sits right of the closing parenthesis, at the bottom.
    expect(label!.x).toBeGreaterThan(100 + 64);
    expect(label!.y + label!.height).toBeGreaterThan(200 + 48);
  });

  it("has no label catcher without a label", () => {
    expect(polymerBracketHitRects({ ...bracket, label: "" }).map((rect) => rect.part)).toEqual(["open", "close"]);
  });
});

describe("bracket pairs [ ]n and { }n", () => {
  it.each([
    ["tool.polymerBracket", "round", undefined],
    ["tool.squareBracketPair", "square", "square"],
    ["tool.curlyBracketPair", "curly", "curly"]
  ] as const)("%s places one pair with an n label, like ( )n", (toolId, shape, stored) => {
    expect(bracketKindForToolCommand(toolId)).toBe("polymer");
    expect(bracketPairShapeForToolCommand(toolId)).toBe(shape);
    const document = insertNativeBracket(createPhase4Document("Pairs"), { x: 200, y: 200 }, "polymer", bracketPairShapeForToolCommand(toolId));
    const placed = document.pages[0].objects.find((object): object is BracketObject => object.type === "bracket")!;
    expect(placed).toMatchObject({ bracketKind: "polymer", label: "n", width: 64, height: 48 });
    expect(placed.style.bracketPairShape).toBe(stored);
    expect(bracketPairShape(placed)).toBe(shape);
    expect(document.selection.objectIds).toEqual([placed.id]);
    // Same pointer catchers, so it selects, moves and edits its n like ( )n.
    expect(polymerBracketHitRects(placed).map((rect) => rect.part)).toEqual(["open", "close", "label"]);
  });

  it("draws two brackets of the chosen shape, one at each end of the box", () => {
    const round = bracketGlyphPathD("polymer", 64, 48, undefined, "round");
    const square = bracketGlyphPathD("polymer", 64, 48, undefined, "square");
    const curly = bracketGlyphPathD("polymer", 64, 48, undefined, "curly");
    expect(round).toBe(bracketGlyphPathD("polymer", 64, 48));
    for (const path of [square, curly]) expect(path.match(/M /g)).toHaveLength(2);
    expect(square).not.toContain("C ");
    expect(square).toContain("L 0.5 0.5");
    expect(square).toContain("L 63.5 0.5");
    expect(curly.match(/C /g)).toHaveLength(4);
    // The single curly and square tools keep their one-bracket shapes.
    expect(bracketKindForToolCommand("tool.bracket")).toBe("curly");
    expect(bracketKindForToolCommand("tool.squareBracket")).toBe("square");
    expect(bracketPairShapeForToolCommand("tool.bracket")).toBeUndefined();
  });

  it("puts every bracket tool in one Brackets drop-down on the Main and Annotation toolbars", () => {
    for (const toolsetId of ["core.main", "core.annotations"]) {
      const items = getToolsetCommandGroups(toolsetId).flat().map((command) => command.id);
      expect(items.filter((id) => id.includes("racket"))).toEqual(["tool.polymerBracket"]);
    }
    const toolset = desktopToolsetRegistry.listToolsets().find((candidate) => candidate.id === "core.main")!;
    const owner = toolset.groups.flatMap((group) => group.items).find((item) => item.id === "tool.polymerBracket")!;
    expect(owner.submenu?.items.map((item) => item.commandId)).toEqual([
      "tool.polymerBracket", "tool.squareBracketPair", "tool.curlyBracketPair", "tool.bracket", "tool.squareBracket"
    ]);
  });
});
