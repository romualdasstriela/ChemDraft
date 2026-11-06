// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { NicknameGraphInput } from "@chemdraft/document-workflow-core";
import {
  loadNicknameDefineRequest,
  loadUserNicknameTemplates,
  NICKNAME_DEFINE_REQUEST_LIFETIME_MS,
  saveNicknameDefineRequest,
  saveUserNicknameTemplates,
  userTemplateDefinitions,
  withUserNicknameTemplate
} from "./userTemplates";
import { NicknamesWidget, userTemplateNameProblem } from "../toolbars/NicknamesWidget";
import { ToolbarWidgetStateContext } from "../toolbars/toolbarWidgets";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Propyl, attaching at its first carbon.
const propyl: NicknameGraphInput = {
  atoms: [
    { element: "C", charge: 0, x: 20, y: -10 },
    { element: "C", charge: 0, x: 40, y: 0 },
    { element: "C", charge: 0, x: 60, y: -10 }
  ],
  bonds: [[0, 1, 1], [1, 2, 1]],
  attachments: [{ atomIndex: 0, x: 0, y: 0 }]
};

afterEach(() => globalThis.localStorage.clear());

describe("user nickname templates", () => {
  it("are stored, replaced by label, and rebuilt as nickname definitions", () => {
    saveUserNicknameTemplates(withUserNicknameTemplate([], { label: "Prp", graph: propyl }));
    saveUserNicknameTemplates(withUserNicknameTemplate(loadUserNicknameTemplates(), { label: "Prp", graph: propyl }));
    const templates = loadUserNicknameTemplates();
    expect(templates.map((template) => template.label)).toEqual(["Prp"]);
    expect(userTemplateDefinitions(templates)[0]).toMatchObject({ label: "Prp", formula: "C3H7", source: "user template" });
  });

  it("keep the drawing of a template drawn with labels, so it places as drawn", () => {
    // Propyl drawn as C–C–OMe: the written-out graph plus the drawing with its OMe label.
    const withOMe: NicknameGraphInput = {
      atoms: [...propyl.atoms.slice(0, 2), { element: "O", charge: 0, x: 60, y: -10 }, { element: "C", charge: 0, x: 80, y: 0 }],
      bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1]],
      attachments: propyl.attachments,
      drawn: {
        atoms: [
          { label: "C", charge: 0, x: 20, y: -10 },
          { label: "C", charge: 0, x: 40, y: 0 },
          { label: "OMe", charge: 0, x: 60, y: -10 }
        ],
        bonds: [[0, 1, 1], [1, 2, 1]]
      }
    };
    saveUserNicknameTemplates([{ label: "EtOMe", graph: withOMe }]);
    const [definition] = userTemplateDefinitions(loadUserNicknameTemplates());
    expect(definition?.display?.atoms.map((atom) => atom.label)).toEqual(["C", "C", "OMe"]);
    // A stored drawing that is not one is not loaded.
    saveUserNicknameTemplates([{ label: "Bad", graph: { ...withOMe, drawn: { atoms: [], bonds: [] } } }]);
    expect(loadUserNicknameTemplates()).toEqual([]);
  });

  it("keep a Define Nickname request for a minute only", () => {
    saveNicknameDefineRequest({ graph: propyl, formula: "C3H7", sites: 1, at: 1000 });
    expect(loadNicknameDefineRequest(1000 + 10)).toMatchObject({ formula: "C3H7" });
    expect(loadNicknameDefineRequest(1000 + NICKNAME_DEFINE_REQUEST_LIFETIME_MS + 1)).toBeUndefined();
  });

  it("refuse a built-in group's name, an empty name and spaces", () => {
    expect(userTemplateNameProblem("OMe")).toMatch(/built-in/);
    expect(userTemplateNameProblem("  ")).toMatch(/Type/);
    expect(userTemplateNameProblem("My Grp")).toMatch(/spaces/);
    expect(userTemplateNameProblem("Prp")).toBeUndefined();
  });

  it("are named in the Nicknames toolbar's user tab and listed there", async () => {
    saveNicknameDefineRequest({ graph: propyl, formula: "C3H7", sites: 1, at: Date.now() });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(ToolbarWidgetStateContext.Provider, { value: { onInvoke: () => undefined } },
        createElement(NicknamesWidget)));
    });
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("user templ.");
    expect(container.querySelector("[data-nickname-define]")?.textContent).toContain("C3H7");

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Abbreviation"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Prp");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>("[data-nickname-define]")!.requestSubmit();
    });

    expect(loadUserNicknameTemplates().map((template) => template.label)).toEqual(["Prp"]);
    expect(loadNicknameDefineRequest()).toBeUndefined();
    expect(container.querySelector("[data-nickname-define]")).toBeNull();
    expect([...container.querySelectorAll(".nickname-button")].map((button) => button.textContent)).toEqual(["Prp"]);

    act(() => root.unmount());
    container.remove();
  });
});
