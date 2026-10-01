import { lab } from "d3";
import { describe, expect, it } from "vitest";
import { C_12, getDistinctColor } from "./colorUtils";

const labDistance = (a: string, b: string) => {
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
};

describe("getDistinctColor", () => {
  it("picks a palette color nobody uses", () => {
    const used = C_12.slice(0, 5);
    const picked = getDistinctColor(used);
    expect(C_12.includes(picked)).toBe(true);
    expect(used.includes(picked)).toBe(false);
  });

  it("stays clearly different from every used color", () => {
    const picked = getDistinctColor(["#dababf", "#fb8072"]);
    expect(Math.min(labDistance(picked, "#dababf"), labDistance(picked, "#fb8072"))).toBeGreaterThan(25);
  });

  it("still answers when the whole palette is taken, ignoring hatchings", () => {
    const picked = getDistinctColor([...C_12, "url(#hatch3)", undefined]);
    expect(picked).toMatch(/^#[0-9a-f]{6}$/);
  });
});
