import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let BlankWorldPipeline: typeof import("./blank-world").BlankWorldPipeline;
let Terrain: typeof import("./terrain").Terrain;
let RegionGrowth: typeof import("./region-growth").RegionGrowth;

beforeAll(async () => {
  await import("@/generators");
  ({ BlankWorldPipeline } = await import("./blank-world"));
  ({ Terrain } = await import("./terrain"));
  ({ RegionGrowth } = await import("./region-growth"));
});

const landWhere = (inside: (x: number, y: number) => boolean) =>
  new Map(
    Array.from(pack.cells.i)
      .filter(cell => inside(...pack.cells.p[cell]))
      .map(cell => [cell, 30])
  );

// two islands on a 400x300 map: x < 180 and x > 220
beforeEach(async () => {
  options = Options.getDefaultOptions();
  options.map.seed = "growth";
  options.map.graph = { width: 400, height: 300, points: 2000, stable: true };
  globalThis.grid = {} as typeof grid;
  globalThis.pack = {} as typeof pack;
  await BlankWorldPipeline.run({});
  Terrain.setHeights(landWhere((x, y) => (x < 180 || x > 220) && y > 20 && y < 280 && x > 20 && x < 380));
});

describe("RegionGrowth.expand", () => {
  it("fills the unclaimed land of an island from the regions on it, splitting it between them", () => {
    const values = new Uint16Array(pack.cells.i.length);
    values[Pack.findCell(40, 150)!] = 1;
    values[Pack.findCell(160, 150)!] = 2;

    const claimed = RegionGrowth.expand(values);

    const westLand = Array.from(pack.cells.i).filter(cell => pack.cells.h[cell] >= 20 && pack.cells.p[cell][0] < 200);
    expect(westLand.every(cell => values[cell])).toBe(true);
    expect(values[Pack.findCell(50, 150)!]).toBe(1);
    expect(values[Pack.findCell(150, 150)!]).toBe(2);
    expect(claimed.length).toBe(westLand.length - 2);
  });

  it("does not cross the sea or claim water", () => {
    const values = new Uint16Array(pack.cells.i.length);
    values[Pack.findCell(40, 150)!] = 1;

    RegionGrowth.expand(values);

    expect(values[Pack.findCell(300, 150)!]).toBe(0); // the other island
    expect(Array.from(pack.cells.i).some(cell => values[cell] && pack.cells.h[cell] < 20)).toBe(false);
  });

  it("keeps the cells already held and grows only where allowed", () => {
    const values = new Uint16Array(pack.cells.i.length);
    const held = Pack.findCell(100, 150)!;
    values[Pack.findCell(40, 150)!] = 1;
    values[held] = 2;

    RegionGrowth.expand(values, (cell, region) => region === 1 || pack.cells.p[cell][1] > 150);

    expect(values[held]).toBe(2);
    expect(
      Array.from(pack.cells.i).every(cell => values[cell] !== 2 || cell === held || pack.cells.p[cell][1] > 150)
    ).toBe(true);
  });
});
