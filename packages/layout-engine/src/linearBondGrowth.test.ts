import { describe, expect, it } from "vitest";
import { linearBondGrowthDirection } from "./index";

const atoms = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 30, y: 0 }, { id: "c", x: 45, y: 26 }];

describe("linearBondGrowthDirection", () => {
  it("continues straight on from a triple bond, and lines a new triple bond up with a single bond", () => {
    const triple = [{ fromAtomId: "a", toAtomId: "b", order: "triple" }];
    expect(linearBondGrowthDirection(atoms, triple, "b", false)).toEqual({ x: 1, y: 0 });
    const single = [{ fromAtomId: "a", toAtomId: "b", order: "single" }];
    expect(linearBondGrowthDirection(atoms, single, "b", true)).toEqual({ x: 1, y: 0 });
  });

  it("leaves ordinary growth to the zig-zag planner", () => {
    const single = [{ fromAtomId: "a", toAtomId: "b", order: "single" }];
    expect(linearBondGrowthDirection(atoms, single, "b", false)).toBeUndefined();
    // Past a double bond the new bond could not be triple.
    expect(linearBondGrowthDirection(atoms, [{ fromAtomId: "a", toAtomId: "b", order: "double" }], "b", true)).toBeUndefined();
    // Two existing bonds: nothing single to line up with.
    const branched = [
      { fromAtomId: "a", toAtomId: "b", order: "triple" },
      { fromAtomId: "b", toAtomId: "c", order: "single" }
    ];
    expect(linearBondGrowthDirection(atoms, branched, "b", false)).toBeUndefined();
  });
});
