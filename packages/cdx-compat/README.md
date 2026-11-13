# @chemdraft/cdx-compat

Owns CDXML/CDX import, export, intermediate models, unknown-object preservation, and compatibility warnings.

ChemDraw binary (.cdx) files are read by `cdx.ts`, which writes the CDX object tree out as the CDXML it
is the binary form of; the one CDXML importer then reads both formats. It was written from the published
description of the CDX format. The app hands a .cdx file to the opener base64-encoded (its signature
"VjCD0100" becomes "VmpDRDAx"), since its bytes are not text.

`cdxWriter.ts` writes .cdx the other way round: the CDXML export, turned into the binary form with the
same tag and value tables (`cdxTables`), so a written file reads back unchanged. It carries the visible
drawing only; ChemDraft's embedded native document (kept in CDXML object tags) is left out, with a
warning.

This package must not become the native document model and must not depend on GPL or AGPL code without an explicit project decision.
