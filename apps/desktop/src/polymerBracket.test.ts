import { describe, expect, it } from "vitest";
import type { BracketObject } from "@chemdraft/chem-core";
import { polymerBracketHitRects } from "./MainWindow";

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
