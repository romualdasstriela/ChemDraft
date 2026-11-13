import { cdxmlToCdx } from "@chemdraft/cdx-compat";
import type { ChemDraftDocument } from "@chemdraft/chem-core";
import { exportDocumentToCdxml, type CdxmlTextExportOptions } from "./cdxml";
import { getExportFormatDescriptor } from "./formats";
import type { BinaryExportResult, ExportWarning } from "./results";

/**
 * ChemDraw binary (.cdx): the document's CDXML, written in binary form by cdx-compat. What the CDXML
 * export cannot show, CDX cannot either; and the embedded ChemDraft document that CDXML carries for
 * a lossless reopen has no place in a CDX file, so warnings that point to it say so.
 */
export function exportDocumentToCdx(
  document: ChemDraftDocument,
  options: CdxmlTextExportOptions = {}
): BinaryExportResult {
  const descriptor = getExportFormatDescriptor("cdx");
  const cdxml = exportDocumentToCdxml(document, options);
  const written = cdxmlToCdx(cdxml.contents);
  if (!written.bytes) {
    throw new Error(written.warnings[0]?.message ?? "CDX export failed.");
  }
  const payloadNote = " A CDX file does not carry that ChemDraft data; save as .chemdraft to keep it.";
  const warnings: ExportWarning[] = [
    ...cdxml.warnings.map((warning) => warning.message.includes("embedded ChemDraft payload")
      ? { ...warning, message: warning.message + payloadNote }
      : warning),
    ...written.warnings.map<ExportWarning>((warning) => ({ code: warning.code, message: warning.message, severity: "warning" }))
  ];
  return {
    format: "cdx",
    kind: "binary",
    bytes: written.bytes,
    mimeType: descriptor.mimeType,
    extension: descriptor.extensions[0] ?? "cdx",
    warnings
  };
}
