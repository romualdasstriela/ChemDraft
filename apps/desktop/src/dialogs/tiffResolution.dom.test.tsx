// @vitest-environment jsdom
import { saveExportPreviewEnabled } from "../exportPreviewSettings";
import { MemoryStorage } from "../testSupport/memoryStorage";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportForm, updateExportDialogFormat } from "./ExportForm";
import { exportFixture } from "./exportTestFixtures";
import { exportOptions, validExportOptions } from "./exportOptionsValidation";
import { defaultExportPresentation, exportDialogSizeError } from "./exportPresentation";
import { tiffDpi } from "./tiffResolution";
import type { ExportDialogState } from "./exportOptions";

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const tiffState = (raster: Partial<ExportDialogState["raster"]> = {}): ExportDialogState =>
  ({ ...exportFixture(), format: "tiff", filename: "Drawing.tif", busy: false, raster: { ...exportFixture().raster, ...raster } });

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TIFF resolution", () => {
  it("defaults to 600 DPI and accepts only 100-1000", () => {
    expect(tiffDpi({})).toBe(600);
    expect(tiffDpi({ dpi: 300 })).toBe(300);
    expect(validExportOptions(exportOptions(tiffState()))).toBe(true);
    expect(validExportOptions(exportOptions(tiffState({ dpi: 100 })))).toBe(true);
    expect(validExportOptions(exportOptions(tiffState({ dpi: 1000 })))).toBe(true);
    expect(validExportOptions(exportOptions(tiffState({ dpi: 99 })))).toBe(false);
    expect(validExportOptions(exportOptions(tiffState({ dpi: 1001 })))).toBe(false);
  });

  it("shows a DPI box for TIFF instead of the scale, publishing only values in range", () => {
    const change = vi.fn();
    act(() => root.render(createElement(ExportForm, { state: tiffState(), onChange: change, onSubmit: vi.fn(), onCancel: vi.fn(), onChooseDestination: vi.fn() })));
    expect(container.querySelector("#chemdraft-export-raster-scale")).toBeNull();
    const input = container.querySelector<HTMLInputElement>("#chemdraft-export-tiff-dpi")!;
    expect(input.value).toBe("600");
    expect([input.min, input.max]).toEqual(["100", "1000"]);
    typeInto(input, "300");
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ raster: expect.objectContaining({ dpi: 300 }) }));
    change.mockClear();
    typeInto(input, "1500");
    expect(change).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("between 100 and 1000");
  });

  it("keeps the scale for other raster formats", () => {
    act(() => root.render(createElement(ExportForm, { state: { ...tiffState(), format: "png", filename: "Drawing.png" }, onChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(), onChooseDestination: vi.fn() })));
    expect(container.querySelector("#chemdraft-export-raster-scale")).not.toBeNull();
    expect(container.querySelector("#chemdraft-export-tiff-dpi")).toBeNull();
  });

  it("starts the size section's DPI box at 600 for TIFF, limited to 100-1000", () => {
    saveExportPreviewEnabled(true);
    const presentation = defaultExportPresentation({ width: 794, height: 1123 }, "tiff");
    expect(presentation.dpi).toBe(600);
    expect(presentation.width).toBe(Math.round(794 * 600 / 96));
    expect(defaultExportPresentation({ width: 794, height: 1123 }, "png").dpi).toBe(96);
    expect(exportDialogSizeError({ ...tiffState(), presentation: { ...presentation, dpi: 1100 } }, 1)).toContain("between 100 and 1000");
    expect(exportDialogSizeError({ ...tiffState(), format: "png", presentation: { ...presentation, dpi: 1100 } }, 1)).toBeUndefined();
    act(() => root.render(createElement(ExportForm, { state: tiffState(), frame: { page: { width: 794, height: 1123 }, content: { width: 400, height: 300 } }, onChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(), onChooseDestination: vi.fn() })));
    const dpiBox = [...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith("DPI"))?.querySelector("input");
    expect(dpiBox?.value).toBe("600");
    expect([dpiBox?.min, dpiBox?.max]).toEqual(["100", "1000"]);
  });

  it("moves a size set for another format to 600 DPI on switching to TIFF, keeping its physical size", () => {
    const state: ExportDialogState = { ...tiffState(), format: "png", filename: "Drawing.png", presentation: { width: 800, dpi: 96, crop: "page", background: "white", linked: true, preset: "custom" } };
    const switched = updateExportDialogFormat(state, "tiff");
    expect(switched.presentation).toMatchObject({ dpi: 600, width: 5000 });
    expect(switched.filename).toBe("Drawing.tif");
  });
});
