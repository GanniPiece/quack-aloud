import { describe, expect, it } from "vitest";
import { additionsFromOutside } from "./autoTidy";

describe("additionsFromOutside", () => {
  it("is empty when nothing new arrived", () => {
    expect(additionsFromOutside(["a", "b"], ["a", "b"], new Set())).toEqual([]);
    expect(additionsFromOutside(["a", "b"], ["a"], new Set())).toEqual([]); // removals are not additions
  });

  it("reports ids that appeared and were not added locally", () => {
    expect(additionsFromOutside(["a"], ["a", "b", "c"], new Set())).toEqual(["b", "c"]);
  });

  it("ignores cards this browser added itself (double-click), and forgets them afterwards", () => {
    const local = new Set(["b"]);
    expect(additionsFromOutside(["a"], ["a", "b", "c"], local)).toEqual(["c"]);
    expect(local.has("b")).toBe(false); // consumed
  });

  it("treats the very first load as nothing to tidy", () => {
    expect(additionsFromOutside(null, ["a", "b"], new Set())).toEqual([]);
  });
});
