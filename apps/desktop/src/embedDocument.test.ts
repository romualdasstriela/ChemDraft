import { describe, expect, it } from "vitest";
import {
  createPhase4Document,
  createSelectionClipboardPayload,
  insertNativeTemplateMolecule,
  selectionClipboardImageDocument
} from "./documentWorkflow";
import { selectionClipboardPageDocument } from "./MainWindow";

describe("the drawing Ctrl+C embeds in Office", () => {
  it("keeps the whole page with the copied objects where they were drawn", () => {
    let document = insertNativeTemplateMolecule(createPhase4Document("Embed"), { x: 400, y: 500 }, "benzene");
    const copied = document.pages[0]!.objects[0]!;
    // A second, unselected structure stays out of the embedded drawing.
    document = insertNativeTemplateMolecule(document, { x: 150, y: 150 }, "cyclohexane");
    document = { ...document, selection: { ...document.selection, objectIds: [copied.id] } };
    const payload = createSelectionClipboardPayload(document)!;

    const embedded = selectionClipboardPageDocument(document, payload);
    const page = embedded.pages[0]!;
    expect(page.width).toBe(document.pages[0]!.width);
    expect(page.height).toBe(document.pages[0]!.height);
    expect(page.objects.map((object) => object.id)).toEqual([copied.id]);
    expect(page.objects[0]).toMatchObject({ x: copied.x, y: copied.y });
    expect(embedded.selection.objectIds).toEqual([]);

    // The picture is still cropped to the drawing.
    const picture = selectionClipboardImageDocument(document, payload).pages[0]!;
    expect(picture.width).toBeLessThan(page.width);
  });
});
