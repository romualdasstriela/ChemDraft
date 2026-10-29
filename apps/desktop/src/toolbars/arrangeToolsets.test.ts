import { describe, expect, it } from "vitest";
import { stackToolsetWindows, toolsetWindowLabel } from "./arrangeToolsets";

describe("stackToolsetWindows", () => {
  const area = { left: 10, top: 100, bottom: 600 };

  it("stacks windows top to bottom in the given order", () => {
    expect(stackToolsetWindows([
      { id: "a", width: 60, height: 200 },
      { id: "b", width: 80, height: 150 }
    ], area, 8)).toEqual([
      { id: "a", x: 10, y: 100 },
      { id: "b", x: 10, y: 308 }
    ]);
  });

  it("starts a new column past the widest window when the next one would overflow", () => {
    expect(stackToolsetWindows([
      { id: "a", width: 60, height: 300 },
      { id: "b", width: 90, height: 150 },
      { id: "c", width: 50, height: 200 }
    ], area, 8)).toEqual([
      { id: "a", x: 10, y: 100 },
      { id: "b", x: 10, y: 408 },
      { id: "c", x: 108, y: 100 }
    ]);
  });

  it("keeps a window taller than the area at the top of the first column", () => {
    expect(stackToolsetWindows([{ id: "a", width: 60, height: 900 }], area, 8)).toEqual([
      { id: "a", x: 10, y: 100 }
    ]);
  });
});

describe("toolsetWindowLabel", () => {
  it("matches the Rust label scheme", () => {
    expect(toolsetWindowLabel("core.main")).toBe("toolset-core-main");
    expect(toolsetWindowLabel("plugin.fixture")).toBe("toolset-plugin-fixture");
  });
});
