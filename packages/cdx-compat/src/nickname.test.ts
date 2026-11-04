import { describe, expect, it } from "vitest";
import { readCdxmlNickname } from "./index";

/** A minimal one-fragment nickname document, written for these tests: nodes and bonds as given. */
function nicknameCdxml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" ?><CDXML><page id="1"><fragment id="2">${body}</fragment></page></CDXML>`;
}

// Ethyl: two carbons, the first bonded to one connection point.
const ethyl = nicknameCdxml(
  `<n id="10" p="100 100"/><n id="11" p="114 92"/><n id="12" p="86 92" NodeType="ExternalConnectionPoint"/>` +
  `<b id="20" B="10" E="11"/><b id="21" B="10" E="12"/>`
);

// A two-site linker, N–C(=O): one connection point on the N, one on the carbonyl carbon.
const amideLinker = nicknameCdxml(
  `<n id="10" p="100 100" Element="7" NumHydrogens="1"/><n id="11" p="114 92"/><n id="12" p="114 76" Element="8"/>` +
  `<n id="13" p="86 92" NodeType="ExternalConnectionPoint"/><n id="14" p="128 100" NodeType="ExternalConnectionPoint"/>` +
  `<b id="20" B="10" E="11"/><b id="21" B="11" E="12" Order="2"/><b id="22" B="13" E="10"/><b id="23" B="11" E="14"/>`
);

describe("readCdxmlNickname", () => {
  it("reads a group's atoms, bonds and connection point", () => {
    const result = readCdxmlNickname(ethyl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.atoms.map((atom) => atom.element)).toEqual(["C", "C"]);
    expect(result.graph.bonds).toEqual([[0, 1, 1]]);
    // Coordinates come back in the importer's units; only the direction matters to a nickname.
    expect(result.graph.attachments.map((attachment) => attachment.atomIndex)).toEqual([0]);
    expect(result.graph.attachments[0]!.x).toBeLessThan(result.graph.atoms[0]!.x);
  });

  it("keeps each connection point's atom, in file order, and the stated hydrogens and bond orders", () => {
    const result = readCdxmlNickname(amideLinker);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.atoms).toMatchObject([{ element: "N", statedHydrogens: 1 }, { element: "C" }, { element: "O" }]);
    expect(result.graph.bonds).toEqual([[0, 1, 1], [1, 2, 2]]);
    expect(result.graph.attachments.map((attachment) => attachment.atomIndex)).toEqual([0, 1]);
  });

  it("refuses what it cannot read as one structure, with the reason", () => {
    expect(readCdxmlNickname(nicknameCdxml(`<n id="10" p="0 0" NodeType="GenericNickname"/>`)))
      .toEqual({ ok: false, reason: "it contains a GenericNickname node" });
    expect(readCdxmlNickname(nicknameCdxml(`<n id="10" p="0 0"/><n id="11" p="1 0"/><b id="20" B="10" E="11"/>`)))
      .toEqual({ ok: false, reason: "it has no connection point" });
    expect(readCdxmlNickname(nicknameCdxml(
      `<n id="10" p="0 0"/><n id="11" p="1 0"/><n id="12" p="-1 0" NodeType="ExternalConnectionPoint"/>` +
      `<b id="20" B="10" E="11" Order="1.5"/><b id="21" B="10" E="12"/>`
    ))).toEqual({ ok: false, reason: "bond 20 has order 1.5" });
    expect(readCdxmlNickname("not xml").ok).toBe(false);
  });
});
