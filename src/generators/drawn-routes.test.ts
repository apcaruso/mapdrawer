import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let BlankWorldPipeline: typeof import("./blank-world").BlankWorldPipeline;
let Terrain: typeof import("./terrain").Terrain;
let DrawnRoutes: typeof import("./drawn-routes").DrawnRoutes;

beforeAll(async () => {
  await import("@/generators");
  ({ BlankWorldPipeline } = await import("./blank-world"));
  ({ Terrain } = await import("./terrain"));
  ({ DrawnRoutes } = await import("./drawn-routes"));
});

// a 400x300 map with land on x < 250, sea beyond; burgs at (60, 150) and (200, 150)
beforeEach(async () => {
  options = Options.getDefaultOptions();
  options.map.seed = "routes";
  options.map.graph = { width: 400, height: 300, points: 2000, stable: true };
  globalThis.grid = {} as typeof grid;
  globalThis.pack = {} as typeof pack;
  await BlankWorldPipeline.run({});
  Terrain.setHeights(
    new Map(
      Array.from(pack.cells.i)
        .filter(cell => pack.cells.p[cell][0] < 250)
        .map(cell => [cell, 30])
    )
  );
  for (const [x, y] of [
    [60, 150],
    [200, 150]
  ]) {
    const cell = Pack.findCell(x, y)!;
    pack.cells.burg[cell] = pack.burgs.length;
    pack.burgs.push({ i: pack.burgs.length, cell, x, y } as (typeof pack.burgs)[number]);
  }
});

const isNeighbor = (a: number, b: number) => pack.cells.c[a].includes(b);

describe("DrawnRoutes.traceCourse", () => {
  it("runs cell by cell and reaches the burgs its ends were drawn close to", () => {
    const course = DrawnRoutes.traceCourse(
      [
        [70, 160], // just off the first burg
        [190, 140] // just short of the second
      ],
      false
    )!;

    expect(course[0]).toBe(pack.burgs[1].cell);
    expect(course.at(-1)).toBe(pack.burgs[2].cell);
    expect(course.every((cell, index) => !index || isNeighbor(course[index - 1], cell))).toBe(true);
  });

  it("stops a road where the stroke goes out to sea", () => {
    const course = DrawnRoutes.traceCourse(
      [
        [100, 60],
        [380, 60]
      ],
      false
    )!;

    expect(course.every(cell => pack.cells.h[cell] >= 20)).toBe(true);
    expect(pack.cells.p[course.at(-1)!][0]).toBeLessThan(260);
  });

  it("runs a sea route on water only", () => {
    const course = DrawnRoutes.traceCourse(
      [
        [280, 40],
        [380, 260]
      ],
      true
    )!;
    expect(course.every(cell => pack.cells.h[cell] < 20)).toBe(true);
  });
});

describe("DrawnRoutes.add", () => {
  it("links consecutive cells in the route network and starts the points at the burg", () => {
    const course = DrawnRoutes.traceCourse(
      [
        [60, 150],
        [200, 150]
      ],
      false
    )!;
    const routeId = DrawnRoutes.add(course, "roads");
    const route = pack.routes.find(route => route.i === routeId)!;

    expect(route.points[0].slice(0, 2)).toEqual([60, 150]);
    expect(pack.cells.routes[course[0]][course[1]]).toBe(routeId);
    expect(pack.cells.routes[course[1]][course[0]]).toBe(routeId);
  });
});

describe("DrawnRoutes.trimDrowned", () => {
  const roadBetweenBurgs = () =>
    DrawnRoutes.add(
      DrawnRoutes.traceCourse(
        [
          [60, 150],
          [200, 150]
        ],
        false
      )!,
      "roads"
    );
  const sinkStrait = () =>
    Terrain.setHeights(
      new Map(
        Array.from(pack.cells.i)
          .filter(cell => Math.abs(pack.cells.p[cell][0] - 130) < 15)
          .map(cell => [cell, 5])
      )
    );

  it("splits a road the sea cut into its pieces on land, linked anew", () => {
    const routeId = roadBetweenBurgs();
    const edit = sinkStrait();

    expect(edit.routesChanged).toBe(true);
    expect(pack.routes.length).toBe(2);
    expect(pack.routes.some(route => route.i === routeId)).toBe(true);
    for (const route of pack.routes) {
      expect(route.points.every(point => pack.cells.h[point[2]] >= 20)).toBe(true);
      const [from, to] = [route.points[0][2], route.points[1][2]];
      expect(pack.cells.routes[from][to]).toBe(route.i);
    }
    const links = Object.entries(pack.cells.routes).flatMap(([cell, next]) => [
      Number(cell),
      ...Object.keys(next).map(Number)
    ]);
    expect(links.every(cell => pack.cells.h[cell] >= 20)).toBe(true);
  });

  it("leaves a road the sea did not reach alone", () => {
    roadBetweenBurgs();
    const before = pack.routes.map(route => route.points.map(point => point[2]));
    const edit = Terrain.setHeights(
      new Map(
        Array.from(pack.cells.i)
          .filter(cell => pack.cells.p[cell][1] < 30 && pack.cells.h[cell] >= 20)
          .map(cell => [cell, 5])
      )
    );
    expect(edit.routesChanged).toBe(false);
    expect(pack.routes.map(route => route.points.map(point => point[2]))).toEqual(before); // its feature id may be renumbered
  });
});
