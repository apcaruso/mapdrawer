import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Burg } from "./burgs-generator";

let BlankWorldPipeline: typeof import("./blank-world").BlankWorldPipeline;
let Terrain: typeof import("./terrain").Terrain;

beforeAll(async () => {
  await import("@/generators");
  ({ BlankWorldPipeline } = await import("./blank-world"));
  ({ Terrain } = await import("./terrain"));
});

beforeEach(async () => {
  options = Options.getDefaultOptions();
  options.map.seed = "terrain";
  options.map.graph = { width: 400, height: 300, points: 2000, stable: true };
  globalThis.grid = {} as typeof grid;
  globalThis.pack = {} as typeof pack;
  await BlankWorldPipeline.run({});
});

/** heights for the cells within a radius of a point */
function blob(x: number, y: number, radius: number, height: number): Map<number, number> {
  return new Map(Pack.findAll(x, y, radius).map(cell => [cell, height]));
}

const islands = () => pack.features.filter(feature => feature && feature.type === "island");

describe("Terrain.setHeights", () => {
  it("raises an island: features, the grid copy and the new land's biomes follow", () => {
    const edit = Terrain.setHeights(blob(200, 150, 50, 30));

    expect(edit.coastChanged).toBe(true);
    expect(islands()).toHaveLength(1);
    for (const cell of edit.changed) {
      expect(grid.cells.h[pack.cells.g[cell]]).toBe(30);
      expect(pack.cells.biome[cell]).not.toBe(0); // land is not marine
    }
  });

  it("keeps the land a burg stands on", () => {
    Terrain.setHeights(blob(200, 150, 50, 30));
    const cell = Pack.findCell(200, 150)!;
    pack.burgs.push({ i: 1, cell, x: 200, y: 150, feature: pack.cells.f[cell], port: 0 } as Burg);

    const edit = Terrain.setHeights(blob(200, 150, 60, 10));

    expect(edit.anchored).toBe(1);
    expect(pack.cells.h[cell]).toBe(20);
    expect(pack.burgs[1].feature).toBe(pack.cells.f[cell]);
  });

  it("leaves the biomes of cells it did not touch", () => {
    Terrain.setHeights(blob(100, 150, 40, 30));
    const painted = Pack.findCell(100, 150)!;
    pack.cells.biome[painted] = 9;

    Terrain.setHeights(blob(300, 150, 40, 30));

    expect(pack.cells.biome[painted]).toBe(9);
  });

  it("keeps the name of an island that grows, and names a new one", () => {
    Terrain.setHeights(blob(100, 150, 40, 30));
    islands()[0].name = "Avalon";

    Terrain.setHeights(blob(130, 150, 40, 30));
    Terrain.setHeights(blob(320, 150, 30, 30));

    const names = islands().map(island => island.name);
    expect(names.includes("Avalon")).toBe(true);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2); // every stroke does not repeat the same first name
  });

  it("clears the state of land that sinks", () => {
    Terrain.setHeights(blob(200, 150, 50, 30));
    const cell = Pack.findCell(230, 150)!;
    pack.cells.state[cell] = 1;
    pack.states.push({ i: 1, name: "Sunk", center: Pack.findCell(170, 150)! } as (typeof pack.states)[number]);

    Terrain.setHeights(new Map([[cell, 10]]));

    expect(pack.cells.state[cell]).toBe(0);
  });
});

describe("Terrain.resync", () => {
  it("rebuilds features from heights put back directly", () => {
    const { changed } = Terrain.setHeights(blob(200, 150, 50, 30));
    for (const cell of changed) pack.cells.h[cell] = 10;

    Terrain.resync();

    expect(islands()).toHaveLength(0);
    expect(grid.cells.h[pack.cells.g[changed[0]]]).toBe(10);
  });
});
