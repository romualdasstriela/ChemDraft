import { describe, expect, it } from "vitest";
import { getDrawingToolDefinition } from "./drawingTools";
import { elementSymbolForToolCommand, elementToolCommandId, periodicTableElement, periodicTableElements } from "./periodicTable";

describe("periodic table layout", () => {
  it("places all 118 elements in distinct cells", () => {
    expect(periodicTableElements).toHaveLength(118);
    const cells = new Set(periodicTableElements.map((element) => `${element.row}:${element.column}`));
    expect(cells.size).toBe(118);
    for (const element of periodicTableElements) {
      expect(element.column).toBeGreaterThanOrEqual(1);
      expect(element.column).toBeLessThanOrEqual(18);
      expect([1, 2, 3, 4, 5, 6, 7, 9, 10]).toContain(element.row);
    }
  });

  it.each([
    ["H", 1, 1], ["He", 1, 18], ["B", 2, 13], ["Na", 3, 1], ["Ar", 3, 18], ["Fe", 4, 8], ["Br", 4, 17],
    ["Ba", 6, 2], ["Hf", 6, 4], ["Pt", 6, 10], ["Rn", 6, 18], ["Og", 7, 18],
    ["La", 9, 3], ["Lu", 9, 17], ["Ac", 10, 3], ["Lr", 10, 17]
  ])("puts %s at row %i, column %i", (symbol, row, column) => {
    expect(periodicTableElement(symbol)).toMatchObject({ row, column });
  });

  it("has an element tool for every element and none for anything else", () => {
    for (const element of periodicTableElements) {
      const commandId = elementToolCommandId(element.symbol);
      expect(elementSymbolForToolCommand(commandId)).toBe(element.symbol);
      expect(getDrawingToolDefinition(commandId)).toMatchObject({ kind: "atom", title: `${element.name} (${element.symbol})` });
    }
    expect(elementSymbolForToolCommand("tool.element.Xx")).toBeUndefined();
    expect(elementSymbolForToolCommand("tool.atom")).toBeUndefined();
  });
});
