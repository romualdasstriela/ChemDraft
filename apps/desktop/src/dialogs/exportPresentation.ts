import type { ExportDialogFormat, ExportDialogState } from "./exportOptions";
import { DRAWING_PX_PER_INCH, presentationDpiRange, TIFF_DEFAULT_DPI, tiffDpiRangeMessage } from "./tiffResolution";
/** The size section's starting values. A TIFF starts at 600 DPI, its pixel width the frame's true
 *  size at that resolution (capped at 8192 px); other formats start at the frame's own size, 96 DPI. */
export function defaultExportPresentation(frame: { width: number; height: number }, format?: ExportDialogFormat): NonNullable<ExportDialogState["presentation"]> {
 const dpi = format === "tiff" ? TIFF_DEFAULT_DPI : DRAWING_PX_PER_INCH;
 const width = Math.min(8192, Math.max(1, Math.round(frame.width * dpi / DRAWING_PX_PER_INCH)));
 return { width, dpi, crop: "page", background: "white", linked: true, preset: "custom" };
}
export function exportDialogHeight(presentation: NonNullable<ExportDialogState["presentation"]>, ratio: number): number {
  return presentation.linked === false || presentation.height !== undefined ? (presentation.height ?? NaN) : Math.max(1, Math.round(presentation.width * ratio));
}

export function exportDialogSizeError(state: ExportDialogState, ratio: number): string | undefined {
  const presentation = state.presentation ?? defaultExportPresentation({ width: 800, height: 600 }, state.format);
  const { width, dpi } = presentation;
  const height = exportDialogHeight(presentation, ratio);
  if (!Number.isInteger(width) || width < 1 || width > 8192 || !Number.isInteger(height) || height < 1 || height > 8192) {
    return "Export dimensions must be whole pixels from 1 to 8192 on each side. Reduce the width or height, or choose a size preset to fit the frame.";
  }
  if (!Number.isFinite(dpi) || dpi < 36 || dpi > 1200) {
    return "DPI must be between 36 and 1200. Enter a value in that range.";
  }
  const range = presentationDpiRange(state.format);
  if (dpi < range.min || dpi > range.max) {
    return tiffDpiRangeMessage;
  }
  if (state.format === "pdf" && Math.max(width, height) / dpi * 72 > 14400) {
    return "PDF page size exceeds 14400 points (200 inches) per side. Reduce the pixel dimensions or increase DPI.";
  }
  return undefined;
}
