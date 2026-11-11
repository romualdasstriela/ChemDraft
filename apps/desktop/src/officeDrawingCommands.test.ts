import { describe, expect, it } from "vitest";
import { createQuickActions, isOfficeDrawingPath } from "./commands";
import { createPhase4Document } from "./documentWorkflow";

describe("drawings opened from Office documents", () => {
  it("are recognised by their temporary folder, on either path separator", () => {
    expect(isOfficeDrawingPath("C:\\Users\\Admin\\AppData\\Local\\Temp\\ChemDraft Office drawings\\9988-1\\Drawing in Report.docx.chemdraft")).toBe(true);
    expect(isOfficeDrawingPath("/tmp/chemdraft office drawings/1-1/Drawing.chemdraft")).toBe(true);
    expect(isOfficeDrawingPath("C:\\Users\\Admin\\Documents\\scheme.chemdraft")).toBe(false);
    expect(isOfficeDrawingPath(undefined)).toBe(false);
  });

  it("enable Close and Return only for such a drawing, saying why otherwise", () => {
    const document = createPhase4Document();
    const find = (isOfficeDrawing: boolean) =>
      createQuickActions(document, undefined, { isOfficeDrawing }).find((action) => action.id === "document.closeAndReturn");
    expect(find(true)).toMatchObject({ enabled: true, disabledReason: undefined });
    expect(find(false)).toMatchObject({ enabled: false, disabledReason: "This drawing was not opened from an Office document" });
  });
});
