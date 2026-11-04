import { describe, expect, it } from "vitest";
import { nicknameDefinitionsFromFiles, nicknameLabelForToolCommand, nicknameToolCommandId } from "./userNicknames";

const ethyl = `<?xml version="1.0" encoding="UTF-8" ?><CDXML><page id="1"><fragment id="2">` +
  `<n id="10" p="100 100"/><n id="11" p="114 92"/><n id="12" p="86 92" NodeType="ExternalConnectionPoint"/>` +
  `<b id="20" B="10" E="11"/><b id="21" B="10" E="12"/></fragment></page></CDXML>`;

describe("user nicknames", () => {
  it("encode any label as a plain command id and back", () => {
    for (const label of ["Ad", "t-Bu", "3'", "c-C3H5", "Za"]) {
      const id = nicknameToolCommandId(label);
      expect(id).toMatch(/^tool\.nickname\.[0-9a-f]+$/);
      expect(nicknameLabelForToolCommand(id)).toBe(label);
    }
    expect(nicknameLabelForToolCommand("tool.element.C")).toBeUndefined();
    expect(nicknameLabelForToolCommand("tool.nickname.xyz")).toBeUndefined();
  });

  it("take each file's name as the label and report the files they could not read", () => {
    const { definitions, skipped } = nicknameDefinitionsFromFiles([
      { name: "Et2.cdxml", contents: ethyl },
      { name: "Broken.cdxml", contents: "not xml" }
    ]);
    expect(definitions.map((definition) => [definition.label, definition.formula])).toEqual([["Et2", "C2H5"]]);
    expect(skipped.map((entry) => entry.file)).toEqual(["Broken.cdxml"]);
  });
});
