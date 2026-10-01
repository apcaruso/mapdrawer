// Rivers drawn by hand: a stroke becomes a chain of adjacent cells anchored where the pointer passed
import type { River } from "@/generators/river-generator";
import type { Point } from "@/types/global";
import { rn } from "@/utils";

const LAND = 20;
const FLUX_AT_SOURCE = 30; // what a generated river needs to form
const FLUX_PER_CELL = 12; // the river gathers water downstream, so it widens toward the mouth
const SNAP_CELLS = 3; // a stroke released this many cells short of a river or the coast reaches it

export interface RiverCourse {
  cells: number[];
  points: Point[]; // one anchor per cell, on the stroke
}

/**
 * The cells under a stroke as a chain of neighbours, each anchored at the middle of the stroke's pass through it.
 * The course starts on land and ends at the first water cell or at the first cell of another river, which a
 * stroke released just short of one is extended to; a loop of the stroke is cut out. Null when fewer than two
 * cells remain
 */
function traceCourse(stroke: readonly Point[]): RiverCourse | null {
  const { cells } = pack;
  const course: number[] = [];
  const anchors: Point[] = [];
  let passing: Point[] = []; // stroke samples inside the last cell of the course
  let ended = false;

  const settleAnchor = () => {
    if (passing.length) anchors[course.length - 1] = passing[Math.floor(passing.length / 2)];
    passing = [];
  };

  const append = (cell: number, sample: Point | null): void => {
    const loop = course.indexOf(cell);
    if (loop !== -1) {
      course.length = anchors.length = loop + 1; // the stroke came back: drop the loop
      passing = sample ? [sample] : [];
      return;
    }

    settleAnchor();
    course.push(cell);
    anchors.push(cells.p[cell]);
    if (sample) passing.push(sample);
    if (cells.h[cell] < LAND || (course.length > 1 && cells.r[cell])) ended = true;
  };

  for (const sample of densify(stroke, grid.spacing / 4)) {
    if (ended) break;
    const cell = Pack.findCell(sample[0], sample[1]);
    if (cell === undefined) continue;

    if (!course.length) {
      if (cells.h[cell] >= LAND) append(cell, sample); // the source is on land
      continue;
    }

    const last = course.at(-1)!;
    if (cell === last) {
      passing.push(sample);
      continue;
    }

    for (const step of connect(last, cell)) {
      append(step, step === cell ? sample : null);
      if (ended) break;
    }
  }
  settleAnchor();

  if (!ended && course.length) {
    const target = findOutlet(stroke.at(-1)!, course);
    if (target !== undefined) for (const step of connect(course.at(-1)!, target)) append(step, null);
  }

  return course.length < 2 ? null : { cells: course, points: anchors };
}

/** the nearest water or river cell close to where the stroke was released, not on the course itself */
function findOutlet([x, y]: Point, course: readonly number[]): number | undefined {
  const { cells } = pack;
  const isOutlet = (cell: number) => !course.includes(cell) && (cells.h[cell] < LAND || cells.r[cell]);
  const nearest = Pack.findAll(x, y, grid.spacing * SNAP_CELLS)
    .filter(isOutlet)
    .sort(
      (a, b) => Math.hypot(cells.p[a][0] - x, cells.p[a][1] - y) - Math.hypot(cells.p[b][0] - x, cells.p[b][1] - y)
    );
  return nearest[0];
}

/** neighbour by neighbour from one cell toward another, the target included */
function connect(from: number, to: number): number[] {
  const { c: neighbors, p } = pack.cells;
  const distance = (cell: number) => Math.hypot(p[cell][0] - p[to][0], p[cell][1] - p[to][1]);
  const path: number[] = [];

  for (let current = from; current !== to && path.length < 50; ) {
    if (neighbors[current].includes(to)) break;
    const next = neighbors[current].reduce((best, cell) => (distance(cell) < distance(best) ? cell : best));
    if (distance(next) >= distance(current)) break;
    path.push(next);
    current = next;
  }

  path.push(to);
  return path;
}

/** points along the stroke, no further apart than the step */
function densify(stroke: readonly Point[], step: number): Point[] {
  const points: Point[] = stroke.length ? [stroke[0]] : [];
  for (let i = 1; i < stroke.length; i++) {
    const [x0, y0] = stroke[i - 1];
    const [x1, y1] = stroke[i];
    const parts = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let part = 1; part <= parts; part++) {
      points.push([x0 + ((x1 - x0) * part) / parts, y0 + ((y1 - y0) * part) / parts]);
    }
  }
  return points;
}

/** add a river along the course; `widthScale` scales how wide it grows. Returns the river id */
function add({ cells: riverCells, points }: RiverCourse, widthScale = 1): number {
  const { cells, rivers } = pack;
  const riverId = Rivers.getNextId(rivers);
  const last = riverCells.at(-1)!;
  const joined = cells.h[last] >= LAND ? cells.r[last] : 0; // ends in another river: a tributary
  const parent = joined || riverId;

  riverCells.forEach((cell, index) => {
    cells.fl[cell] = Math.max(cells.fl[cell], FLUX_AT_SOURCE + FLUX_PER_CELL * index); // a bigger river keeps its flux
    if (!cells.r[cell] && cells.h[cell] >= LAND) cells.r[cell] = riverId;
  });

  const source = riverCells[0];
  const mouth = joined ? riverCells[riverCells.length - 2] : last;
  const widthFactor = rn(1.2 * widthScale * (1 / (options.map.graph.points / 10000) ** 0.25), 2);
  const sourceWidth = Rivers.getSourceWidth(cells.fl[source]);
  const meandered = Rivers.addMeandering(riverCells, points);
  const discharge = cells.fl[mouth];
  const offset = Rivers.getOffset({
    flux: discharge,
    pointIndex: meandered.length,
    widthFactor,
    startingWidth: sourceWidth
  });

  const river: River = {
    i: riverId,
    source,
    mouth,
    discharge,
    length: Rivers.getApproximateLength(meandered.map(([x, y]) => [x, y] as Point)),
    width: Rivers.getWidth(offset),
    widthFactor,
    sourceWidth,
    parent,
    basin: Rivers.getBasin(parent),
    cells: riverCells,
    points,
    name: Rivers.getName(source),
    type: "River"
  };
  rivers.push(river);
  return riverId;
}

/**
 * Rivers follow the land: a river ends at the first cell that is now water, and starts at the first land cell
 * if its source sank. A river with less than two land cells left is removed. True when any river changed
 */
function trimDrowned(): boolean {
  const { cells } = pack;
  const isWater = (cell: number) => cell !== -1 && cells.h[cell] < LAND;
  let changed = false;

  for (const river of [...pack.rivers]) {
    const course = river.cells;
    let start = 0;
    while (start < course.length && isWater(course[start])) start++;
    const firstWater = course.findIndex((cell, index) => index >= start && isWater(cell));
    const end = firstWater === -1 ? course.length : firstWater + 1; // the first water cell stays as the mouth
    if (start === 0 && end === course.length) continue;

    changed = true;
    const kept = course.slice(start, end);
    for (const cell of course) {
      if (cell !== -1 && cells.r[cell] === river.i && (isWater(cell) || !kept.includes(cell))) cells.r[cell] = 0;
    }

    if (kept.filter(cell => cell !== -1 && !isWater(cell)).length < 2) {
      pack.rivers = pack.rivers.filter(other => other !== river);
      continue;
    }

    river.cells = kept;
    if (river.points) river.points = river.points.slice(start, end);
    river.source = kept[0];
    if (!kept.includes(river.mouth)) river.mouth = kept.at(-1)!;
  }

  return changed;
}

export const DrawnRivers = { traceCourse, add, trimDrowned };
