import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Point } from "@/types/global";

let BlankWorldPipeline: typeof import("./blank-world").BlankWorldPipeline;
let Terrain: typeof import("./terrain").Terrain;
let DrawnRivers: typeof import("./drawn-rivers").DrawnRivers;

beforeAll(async () => {
  await import("@/generators");
  ({ BlankWorldPipeline } = await import("./blank-world"));
  ({ Terrain } = await import("./terrain"));
  ({ DrawnRivers } = await import("./drawn-rivers"));
});

// a 400x300 map with land on x < 250, sea beyond
beforeEach(async () => {
  options = Options.getDefaultOptions();
  options.map.seed = "rivers";
  options.map.graph = { width: 400, height: 300, points: 2000, stable: true };
  globalThis.grid = {} as typeof grid;
  globalThis.pack = {} as typeof pack;
  await BlankWorldPipeline.run({});
  Terrain.setHeights(
    new Map(
      Array.from(pack.cells.i)
        .filter(cell => pack.cells.p[cell][0] < 250)
        .map(cell => [cell, 40])
    )
  );
});

const isNeighbor = (a: number, b: number) => pack.cells.c[a].includes(b);
const draw = (stroke: Point[]) => {
  const id = DrawnRivers.add(DrawnRivers.traceCourse(stroke)!);
  return pack.rivers.find(river => river.i === id)!;
};

describe("DrawnRivers.traceCourse", () => {
  it("follows the stroke cell by cell, from land to the first water cell", () => {
    const course = DrawnRivers.traceCourse([
      [40, 150],
      [380, 150]
    ])!;

    expect(course.cells.every((cell, index) => !index || isNeighbor(course.cells[index - 1], cell))).toBe(true);
    expect(pack.cells.h[course.cells[0]]).toBeGreaterThanOrEqual(20);
    expect(pack.cells.h[course.cells.at(-1)!]).toBeLessThan(20); // the mouth
    expect(course.cells.slice(0, -1).every(cell => pack.cells.h[cell] >= 20)).toBe(true); // it stops at the sea
    expect(course.points).toHaveLength(course.cells.length);
  });

  it("starts where the stroke reaches land and cuts out a loop", () => {
    const course = DrawnRivers.traceCourse([
      [390, 40], // sea
      [100, 40],
      [100, 120],
      [60, 120],
      [60, 40], // back across the start: a loop
      [60, 20]
    ])!;

    expect(pack.cells.h[course.cells[0]]).toBeGreaterThanOrEqual(20);
    expect(new Set(course.cells).size).toBe(course.cells.length);
  });

  it("is null for a stroke that never leaves the sea", () => {
    expect(
      DrawnRivers.traceCourse([
        [300, 100],
        [390, 200]
      ])
    ).toBeNull();
  });
});

describe("DrawnRivers.add", () => {
  it("marks the land cells and widens downstream", () => {
    const river = draw([
      [40, 150],
      [380, 150]
    ]);

    const land = river.cells.filter(cell => pack.cells.h[cell] >= 20);
    expect(land.every(cell => pack.cells.r[cell] === river.i)).toBe(true);
    expect(pack.cells.fl[river.cells.at(-1)!]).toBeGreaterThan(pack.cells.fl[river.cells[0]]);
    expect(river.parent).toBe(river.i);
  });

  it("makes a river ending in another one its tributary", () => {
    const main = draw([
      [40, 150],
      [380, 150]
    ]);
    const tributary = draw([
      [120, 40],
      [120, 280]
    ]);

    expect(pack.cells.r[tributary.cells.at(-1)!]).toBe(main.i);
    expect(tributary.parent).toBe(main.i);
    expect(tributary.basin).toBe(main.i);
  });
});

describe("DrawnRivers snapping", () => {
  it("reaches a river the stroke was released just short of", () => {
    const main = draw([
      [40, 150],
      [380, 150]
    ]);
    const tributary = draw([
      [120, 40],
      [120, 138] // about one and a half cells short of the main river
    ]);

    expect(tributary.parent).toBe(main.i);
  });

  it("does not reach a river far from the release point", () => {
    draw([
      [40, 150],
      [380, 150]
    ]);
    const separate = draw([
      [120, 20],
      [120, 90]
    ]);

    expect(separate.parent).toBe(separate.i);
  });
});

describe("DrawnRivers.trimDrowned", () => {
  it("ends a river at the first cell that sank, and forgets the rest", () => {
    const river = draw([
      [40, 150],
      [380, 150]
    ]);
    const length = river.cells.length;
    const sunk = river.cells[Math.floor(length / 2)];

    const edit = Terrain.setHeights(new Map([[sunk, 10]]));

    expect(edit.riversChanged).toBe(true);
    expect(river.cells.at(-1)).toBe(sunk);
    expect(river.cells.length).toBeLessThan(length);
    expect(river.points).toHaveLength(river.cells.length);
  });

  it("removes a river with too little land left", () => {
    const river = draw([
      [200, 150],
      [380, 150]
    ]);

    Terrain.setHeights(new Map(river.cells.slice(1).map(cell => [cell, 10])));

    expect(pack.rivers.some(other => other.i === river.i)).toBe(false);
  });
});
