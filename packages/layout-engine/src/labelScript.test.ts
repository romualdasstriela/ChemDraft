import { describe, expect, it } from "vitest";
import { ChemDraftSyntheticStylePreset } from "@chemdraft/chem-core";
import { atomLabelLayout, nativeAtomLabelReading } from "./index";
import { atomLabelTextWithDigitScript, plainAtomLabelDigits } from "./labelScript";

describe("atom label digit scripts", () => {
  it("marks the digits just typed, or the selected ones, and toggles them back", () => {
    expect(atomLabelTextWithDigitScript("OR2", 3, 3, "superscript")).toMatchObject({ text: "OR²", changed: true, end: 3 });
    expect(atomLabelTextWithDigitScript("OR2", 3, 3, "subscript").text).toBe("OR₂");
    expect(atomLabelTextWithDigitScript("OR²", 3, 3, "superscript").text).toBe("OR2");
    expect(atomLabelTextWithDigitScript("OR²", 3, 3, "subscript").text).toBe("OR₂");
    expect(atomLabelTextWithDigitScript("R12x", 1, 3, "superscript").text).toBe("R¹²x");
    expect(atomLabelTextWithDigitScript("OMe", 3, 3, "superscript")).toMatchObject({ text: "OMe", changed: false });
    expect(plainAtomLabelDigits("R¹₂3")).toBe("R123");
  });

  it("draws marked digits raised or lowered, and reads them as plain digits", () => {
    const style = ChemDraftSyntheticStylePreset.drawing;
    const raised = atomLabelLayout("OR²", style).runs;
    expect(raised.find((run) => run.text === "2")).toMatchObject({ script: "superscript" });
    expect(raised.find((run) => run.text === "2")!.y).toBeLessThan(0);
    const lowered = atomLabelLayout("OR₂", style).runs;
    expect(lowered.find((run) => run.text === "2")).toMatchObject({ script: "subscript" });
    // A subscript marked before the symbol stays lowered (a plain leading digit is a mass number).
    expect(atomLabelLayout("₂R", style).runs.find((run) => run.text === "2")).toMatchObject({ script: "subscript" });
    expect(atomLabelLayout("2R", style).runs.find((run) => run.text === "2")).toMatchObject({ script: "superscript" });

    expect(nativeAtomLabelReading("CH₂")).toEqual(nativeAtomLabelReading("CH2"));
    expect(nativeAtomLabelReading("R²", { bonded: true })).toEqual(nativeAtomLabelReading("R2", { bonded: true }));
  });
});
