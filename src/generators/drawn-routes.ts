// Routes drawn by hand: a stroke becomes a chain of adjacent cells, joined to the burgs at its ends
import type { Point } from "@/types/global";
import { connect, densify } from "./drawn-rivers";
import type { Route } from "./routes-generator";

const LAND = 20;
const SNAP_CELLS = 3; // a stroke ending this close to a burg reaches it

/**
 * The cells under a stroke as a chain of neighbours, on land for a road or trail and on water for a sea route,
 * stopping where the stroke leaves that ground. Ends close to a burg are extended to it. Null when shorter than two
 */
function traceCourse(stroke: readonly Point[], onWater: boolean): number[] | null {
  const { cells } = pack;
  const fits = (cell: number) => cells.h[cell] < LAND === onWater || Boolean(cells.burg[cell]); // ports touch both
  const course: number[] = [];

  for (const [x, y] of densify(stroke, grid.spacing / 4)) {
    const cell = Pack.findCell(x, y);
    if (cell === undefined || cell === course.at(-1)) continue;
    if (!course.length) {
      if (fits(cell)) course.push(cell);
      continue;
    }

    const steps = connect(course.at(-1)!, cell);
    if (!steps.every(fits)) break; // the stroke left the ground the route runs on
    for (const step of steps) {
      const loop = course.indexOf(step);
      if (loop !== -1) course.length = loop + 1;
      else course.push(step);
    }
  }
  if (!course.length) return null;

  const startBurg = findBurgCell(stroke[0], course);
  if (startBurg !== undefined) course.unshift(startBurg, ...connect(startBurg, course[0]).slice(0, -1));
  const endBurg = findBurgCell(stroke.at(-1)!, course);
  if (endBurg !== undefined) course.push(...connect(course.at(-1)!, endBurg));

  const unique = course.filter((cell, index) => course.indexOf(cell) === index);
  return unique.length < 2 ? null : unique;
}

function findBurgCell([x, y]: Point, course: readonly number[]): number | undefined {
  const { cells } = pack;
  return Pack.findAll(x, y, grid.spacing * SNAP_CELLS)
    .filter(cell => cells.burg[cell] && !course.includes(cell))
    .sort(
      (a, b) => Math.hypot(cells.p[a][0] - x, cells.p[a][1] - y) - Math.hypot(cells.p[b][0] - x, cells.p[b][1] - y)
    )[0];
}

/** add a route of the group along the cells, linking them in the route network. Returns the route id */
function add(course: readonly number[], group: string): number {
  const { cells, burgs } = pack;
  const routeId = Routes.getNextId();
  const points = course.map(cell => {
    const burg = cells.burg[cell] ? burgs[cells.burg[cell]] : null;
    const [x, y] = burg ? [burg.x, burg.y] : cells.p[cell];
    return [x, y, cell];
  });
  const route: Route = { i: routeId, group, feature: cells.f[course[0]], points };
  pack.routes.push(route);

  const links = cells.routes;
  for (let index = 1; index < course.length; index++) {
    const [from, to] = [course[index - 1], course[index]];
    links[from] = { ...links[from], [to]: routeId };
    links[to] = { ...links[to], [from]: routeId };
  }
  Routes.sync();
  return routeId;
}

export const DrawnRoutes = { traceCourse, add };
