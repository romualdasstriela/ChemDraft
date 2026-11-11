import { describe, expect, it } from "vitest";
import { OFFICE_STANDARD_COLORS, officeThemeColorRows } from "./officeColors";

describe("the Office colour palette", () => {
  it("is laid out as Office's theme grid: six rows of ten, base colours on top", () => {
    const rows = officeThemeColorRows();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toHaveLength(10);
      for (const entry of row) {
        expect(entry.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(rows[0].map((entry) => entry.color.slice(1)).join(" "))
      .toBe("ffffff 000000 e8e8e8 0e2841 156082 e97132 196b24 0f9ed5 a02b93 4ea72e");
  });

  it("names each swatch the way Office does", () => {
    const rows = officeThemeColorRows();
    expect(rows[0][4].title).toBe("Accent 1");
    expect(rows[1][4]).toEqual({ title: "Accent 1, Lighter 80%", color: "#c0e6f5" });
    expect(rows[5][4]).toEqual({ title: "Accent 1, Darker 50%", color: "#0b3040" });
    expect(rows[1][0]).toEqual({ title: "Background 1, Darker 5%", color: "#f2f2f2" });
    expect(rows[1][1]).toEqual({ title: "Text 1, Lighter 50%", color: "#808080" });
    expect(rows[1][3]).toEqual({ title: "Text 2, Lighter 90%", color: "#dae9f8" });
  });

  it("has Office's ten standard colours", () => {
    expect(OFFICE_STANDARD_COLORS.map((entry) => entry.color.slice(1).toUpperCase()).join(" "))
      .toBe("C00000 FF0000 FFC000 FFFF00 92D050 00B050 00B0F0 0070C0 002060 7030A0");
  });
});
