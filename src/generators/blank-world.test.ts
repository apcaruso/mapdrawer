import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BLANK_OCEAN_HEIGHT, BlankWorldPipeline } from "./blank-world";

beforeAll(async () => {
  await import("@/generators");
});

beforeEach(() => {
  options = Options.getDefaultOptions();
  options.map.seed = "blank";
  options.map.graph = { width: 400, height: 300, points: 1000, stable: true };
  Options.setGraphSize(400, 300);
  globalThis.grid = {} as typeof grid;
  globalThis.pack = {} as typeof pack;
});

describe("stable graph", () => {
  it("packs every grid cell as is, so cell ids do not depend on the coastline", () => {
    grid = Grid.generate("stable", 400, 300, 1000);

    grid.cells.h = new Uint8Array(grid.points.length).fill(BLANK_OCEAN_HEIGHT);
    Pack.generate();
    const oceanPoints = pack.cells.p.map(point => point.join());
    expect(pack.cells.i.length).toBe(grid.points.length);
    expect(Array.from(pack.cells.g)).toEqual(Array.from(grid.cells.i));

    grid.cells.h = grid.cells.h.map((_, cell) => (grid.points[cell][0] < 200 ? 40 : BLANK_OCEAN_HEIGHT));
    Pack.generate();
    expect(pack.cells.p.map(point => point.join())).toEqual(oceanPoints);
    expect(Array.from(pack.cells.h).filter(h => h >= 20).length).toBeGreaterThan(0);
  });
});

describe("blank world", () => {
  it("is all ocean, with every collection empty and every cell array allocated", async () => {
    await BlankWorldPipeline.run({});
    const { cells } = pack;

    expect(cells.i.length).toBe(grid.points.length);
    expect(Array.from(cells.h).every(h => h === BLANK_OCEAN_HEIGHT)).toBe(true);
    expect(pack.features.filter(Boolean).map(feature => feature.type)).toEqual(["ocean"]);
    expect(pack.biomes.length).toBeGreaterThan(0);

    for (const key of [
      "biome",
      "s",
      "pop",
      "culture",
      "burg",
      "state",
      "religion",
      "province",
      "good",
      "market",
      "r"
    ]) {
      expect(cells[key as keyof typeof cells], key).toHaveLength(cells.i.length);
    }

    expect(pack.cultures.map(culture => culture.name)).toEqual(["Wildlands"]);
    expect(pack.states.map(state => state.name)).toEqual(["Neutrals"]);
    expect(pack.religions.map(religion => religion.name)).toEqual(["No religion"]);
    expect(pack.burgs).toEqual([0]);
    expect(pack.provinces).toEqual([0]);
    expect([pack.rivers, pack.routes, pack.markers, pack.zones, pack.markets, pack.journeys]).toEqual([
      [],
      [],
      [],
      [],
      [],
      []
    ]);
    expect(pack.goods.length).toBeGreaterThan(0); // the catalogue stays, so the economy can be built later
  });
});
