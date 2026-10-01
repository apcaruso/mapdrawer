// Terrain tools: brushes, a lasso and a mountain range line that raise land, sink it into the sea and shape its
// relief. A stroke is previewed while drawn and becomes one undoable step when it ends
import { interpolateRgbBasis, polygonContains } from "d3";
import { fitMapToScreen } from "@/components/canvas";
import { type LayerId, Layers } from "@/components/layers";
import { registerMap } from "@/components/lifecycle";
import { hideLoading, showLoading } from "@/components/loading";
import { MapBrush } from "@/components/map-brush";
import { MapFreehand } from "@/components/map-freehand";
import { hideToolOptions, showToolOptions } from "@/components/tools/tool-options";
import { clearMainTip, tip } from "@/components/tooltips";
import { type HistoryDomain, UndoHistory } from "@/components/undo-history";
import { undraw } from "@/components/undraw";
import { POINTS_BY_DENSITY } from "@/data/graph-density";
import { Resample } from "@/generators/resample";
import { Terrain, type TerrainEdit } from "@/generators/terrain";
import {
  openPaintOverlay,
  removePaintOverlay,
  removePaintOverlayCells,
  updatePaintOverlay
} from "@/renderers/overlays/paint-overlay";
import type { Point } from "@/types/global";
import { ensureEl, minmax } from "@/utils";

export type TerrainMode = "land" | "sea" | "raise" | "lower" | "smooth" | "lasso" | "range";

interface ModeSpec {
  title: string;
  stroke: "brush" | "freehand"; // stamps along the pointer, or one shape when the pointer is released
  strength?: boolean;
  roughness?: boolean;
  relief?: boolean; // shows the heightmap layer, where the change is seen
}

const MODES: Record<TerrainMode, ModeSpec> = {
  land: { title: "Land brush", stroke: "brush", roughness: true },
  sea: { title: "Sea brush", stroke: "brush", roughness: true },
  raise: { title: "Raise", stroke: "brush", strength: true, relief: true },
  lower: { title: "Lower", stroke: "brush", strength: true, relief: true },
  smooth: { title: "Smooth", stroke: "brush", strength: true, relief: true },
  lasso: { title: "Lasso", stroke: "freehand" },
  range: { title: "Mountain range", stroke: "freehand", strength: true, relief: true }
};

const LAND = Terrain.LAND;
const SEA_HEIGHT = 15;
const MIN_STABLE_DENSITY = 5; // a converted map gets at least 20k cells: the stable graph has no extra points along coasts

const DOMAINS: HistoryDomain[] = [
  "cells.h",
  "cells.biome",
  "cells.state",
  "cells.province",
  "cells.culture",
  "cells.religion",
  "cells.pop",
  "cells.s",
  "cells.r",
  "burgs",
  "routes",
  "rivers"
];
const RELIEF_LAYERS: LayerId[] = ["heightmap", "biomes", "relief"];
const COAST_LAYERS: LayerId[] = [
  "ocean",
  "landmass",
  "lakes",
  "coastline",
  ...RELIEF_LAYERS,
  "states",
  "provinces",
  "borders",
  "cultures",
  "religions",
  "rivers"
];

const settings = { radius: 30, strength: 5, roughness: 40, lassoSea: false };

interface Session {
  mode: TerrainMode;
  pending: Map<number, number>; // cell -> height drawn by the current stroke
  brush?: MapBrush;
  freehand?: MapFreehand;
}

let session: Session | null = null;

/** start a terrain tool; false when it cannot start (another edit mode, or the map was not converted) */
async function start(mode: TerrainMode): Promise<boolean> {
  if (customization) {
    tip("Please exit the active edit mode first", false, "error");
    return false;
  }
  if (!(await ensureStableGraph())) return false;

  stop();
  session = { mode, pending: new Map() };
  if (MODES[mode].relief) Layers.show("heightmap");
  openPaintOverlay();
  renderOptions(mode); // a brush is wired to its size control there

  if (MODES[mode].stroke === "freehand") {
    session.freehand =
      mode === "lasso"
        ? new MapFreehand({
            closed: true,
            fill: "#ffffff33",
            onEnd: (points, event) => fillPolygon(points, settings.lassoSea !== Boolean(event?.altKey))
          })
        : new MapFreehand({ stroke: "#7a4a2a", onEnd: raiseRange });
    session.freehand.attach();
  }
  return true;
}

/** stop the tool, keeping a stroke cut short */
function stop(): void {
  if (!session) return;
  commit();
  session.brush?.detach();
  session.freehand?.detach();
  removePaintOverlay();
  hideToolOptions();
  clearMainTip();
  session = null;
}

function renderOptions(mode: TerrainMode): void {
  const { strength, roughness, stroke } = MODES[mode];
  const brush = stroke === "brush" ? createBrush(mode) : null;
  const controls = [
    brush?.markup ?? "",
    mode === "range"
      ? `<div data-tip="How wide the range spreads from its ridge"><slider-input id="terrainRangeWidth" min="5" max="200" value="${settings.radius}" data-brush-size>Width:</slider-input></div>`
      : "",
    strength
      ? `<div data-tip="How much each pass changes the ground"><slider-input id="terrainStrength" min="1" max="10" value="${settings.strength}">Strength:</slider-input></div>`
      : "",
    roughness
      ? `<div data-tip="How irregular the edge of the brush is: 0 is a clean circle"><slider-input id="terrainRoughness" min="0" max="100" value="${settings.roughness}">Roughness:</slider-input></div>`
      : "",
    mode === "lasso"
      ? `<div class="toolOptionsChoice" data-tip="What the shape is filled with. Holding Alt while drawing fills it with the other">
          <button id="terrainLassoLand" class="${settings.lassoSea ? "" : "pressed"}">Land</button>
          <button id="terrainLassoSea" class="${settings.lassoSea ? "pressed" : ""}">Sea</button>
        </div>`
      : ""
  ].join("");

  const bar = showToolOptions(MODES[mode].title, controls);
  bar.addEventListener("input", event => {
    const target = event.target as HTMLElement;
    if (target.id === "terrainStrength") settings.strength = Number((target as HTMLInputElement).value);
    if (target.id === "terrainRoughness") settings.roughness = Number((target as HTMLInputElement).value);
    if (target.id === "terrainRangeWidth") settings.radius = Number((target as HTMLInputElement).value);
  });
  bar.addEventListener("click", event => {
    const id = (event.target as HTMLElement).id;
    if (id !== "terrainLassoLand" && id !== "terrainLassoSea") return;
    settings.lassoSea = id === "terrainLassoSea";
    ensureEl("terrainLassoLand").classList.toggle("pressed", !settings.lassoSea);
    ensureEl("terrainLassoSea").classList.toggle("pressed", settings.lassoSea);
  });

  if (brush && session) {
    session.brush = brush;
    brush.attach();
  }
}

function createBrush(mode: TerrainMode): MapBrush {
  return new MapBrush({
    id: "terrainBrushSize",
    label: "Size:",
    radius: settings.radius,
    min: 2,
    max: 200,
    onStart: (_point, radius) => point => stamp(mode, point, radius),
    onEnd: commit,
    onResize: radius => {
      settings.radius = radius;
    }
  });
}

function stamp(mode: TerrainMode, [x, y]: Point, radius: number): void {
  if (!session) return;
  const { cells } = pack;
  const { pending } = session;
  const current = (cell: number) => pending.get(cell) ?? cells.h[cell];
  const rough = MODES[mode].roughness ? settings.roughness / 100 : 0;
  const strength = settings.strength;
  const updated: number[] = [];

  for (const cell of Pack.findAll(x, y, radius * (1 + 0.6 * rough))) {
    const [cellX, cellY] = cells.p[cell];
    const distance = Math.hypot(cellX - x, cellY - y) / radius;
    const height = current(cell);
    let next = height;

    if (mode === "land" || mode === "sea") {
      const edge = 1 + rough * 0.6 * (edgeNoise(cellX, cellY, radius * 0.7) * 2 - 1);
      if (distance > edge) continue;
      if (mode === "land" && height < LAND) next = landHeight(cellX, cellY);
      if (mode === "sea" && height >= LAND) next = SEA_HEIGHT;
    } else {
      if (distance > 1) continue;
      const falloff = (1 - distance * distance) ** 2;
      if (mode === "raise") next = height + strength * 2 * falloff;
      else if (mode === "lower") next = height - strength * 2 * falloff;
      else {
        const around = cells.c[cell].map(current);
        const mean = around.reduce((sum, value) => sum + value, 0) / around.length;
        next = height + (mean - height) * (strength / 10) * falloff;
      }
    }

    next = minmax(next, 0, 100);
    if (next === height) continue;
    pending.set(cell, next);
    updated.push(cell);
  }

  preview(updated);
}

const landColor = interpolateRgbBasis(["#a9c788", "#e3d59b", "#c79d6c", "#8d6c52", "#f4f4f4"]);
const heightColor = (height: number) => (height < LAND ? "#5b84b8" : landColor((height - LAND) / (100 - LAND)));

function preview(cells: number[]): void {
  if (!session || !cells.length) return;
  const { pending } = session;
  updatePaintOverlay(
    pack,
    cells.map(cell => {
      const height = Math.round(pending.get(cell)!);
      return { cell, values: [{ id: height, color: heightColor(height) }] };
    })
  );
}

/** apply the stroke: one undoable step, then redraw what it touched */
function commit(): void {
  if (!session?.pending.size) return;
  const { mode, pending } = session;
  const heights = new Map([...pending].map(([cell, height]) => [cell, Math.round(height)]));
  const cells = [...pending.keys()];
  pending.clear();

  const label = mode === "lasso" ? `Lasso ${settings.lassoSea ? "sea" : "land"}` : MODES[mode].title;
  const changed: number[] = []; // filled by the step, read back by its undo and redo
  const edit = UndoHistory.record(
    { label, domains: DOMAINS, layers: COAST_LAYERS, after: () => Terrain.resync(changed) },
    (): TerrainEdit => {
      const result = Terrain.setHeights(heights);
      changed.push(...result.changed);
      return result;
    }
  );

  removePaintOverlayCells(cells);
  Layers.draw(...(edit.coastChanged ? COAST_LAYERS : RELIEF_LAYERS));
  if (edit.anchored) {
    tip(
      `${edit.anchored} cell(s) stay above water: burgs and the centers of states, provinces, cultures and religions stand there`,
      false,
      "warn",
      4000
    );
  }
}

function fillPolygon(polygon: Point[], sea: boolean): void {
  if (!session || polygon.length < 3) return;
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const { cells } = pack;

  for (const cell of cells.i) {
    const [x, y] = cells.p[cell];
    if (x < minX || x > maxX || y < minY || y > maxY || !polygonContains(polygon, [x, y])) continue;
    if (sea && cells.h[cell] >= LAND) session.pending.set(cell, SEA_HEIGHT);
    if (!sea && cells.h[cell] < LAND) session.pending.set(cell, landHeight(x, y));
  }

  const previousSea = settings.lassoSea;
  settings.lassoSea = sea; // the step is named after what was filled
  commit();
  settings.lassoSea = previousSea;
}

/** a ridge along the drawn line: highest at the line, falling off over the width, craggy and tapered at both ends */
function raiseRange(path: Point[]): void {
  if (!session || path.length < 2) return;
  const { cells } = pack;
  const width = settings.radius;
  const peak = settings.strength * 6;

  const candidates = new Set<number>();
  for (const [x, y] of path) for (const cell of Pack.findAll(x, y, width)) candidates.add(cell);

  const length = path.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - path[i][0], y - path[i][1]), 0);
  for (const cell of candidates) {
    const [x, y] = cells.p[cell];
    const { distance, along } = nearestOnPath(path, x, y);
    if (distance > width) continue;
    const position = length ? along / length : 0.5;
    const taper = Math.min(1, position * 4, (1 - position) * 4);
    const crag = 0.55 + 0.9 * edgeNoise(x, y, width * 0.6);
    const lift = peak * (1 - distance / width) ** 1.6 * crag * taper;
    if (lift < 0.5) continue;
    session.pending.set(cell, minmax(cells.h[cell] + lift, 0, 100));
  }
  commit();
}

/** distance from a point to a polyline, and how far along the polyline its nearest point lies */
function nearestOnPath(path: Point[], x: number, y: number): { distance: number; along: number } {
  let best = { distance: Infinity, along: 0 };
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1];
    const [x1, y1] = path[i];
    const segment = Math.hypot(x1 - x0, y1 - y0);
    const t = segment ? minmax(((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / segment ** 2, 0, 1) : 0;
    const distance = Math.hypot(x - (x0 + (x1 - x0) * t), y - (y0 + (y1 - y0) * t));
    if (distance < best.distance) best = { distance, along: walked + segment * t };
    walked += segment;
  }
  return best;
}

/** fresh land is lowland with a gentle, position-bound variation, so neighbouring strokes match */
const landHeight = (x: number, y: number) => 21 + Math.round(6 * edgeNoise(x, y, 40));

/** smooth value noise in [0, 1], fixed to map coordinates */
function edgeNoise(x: number, y: number, scale: number): number {
  return 0.65 * valueNoise(x / scale, y / scale) + 0.35 * valueNoise(x / (scale / 2.5) + 17, y / (scale / 2.5) + 31);
}

function valueNoise(x: number, y: number): number {
  const [xi, yi] = [Math.floor(x), Math.floor(y)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const [u, v] = [smooth(x - xi), smooth(y - yi)];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const top = lerp(hash(xi, yi), hash(xi + 1, yi), u);
  const bottom = lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u);
  return lerp(top, bottom, v);
}

function hash(x: number, y: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** terrain tools need cell ids that survive coastline edits: a map on the classic graph is converted once */
async function ensureStableGraph(): Promise<boolean> {
  if (options.map.graph.stable) return true;
  if (!(await askConversion())) return false;

  showLoading();
  await new Promise(resolve => setTimeout(resolve, 50)); // let the splash paint before the heavy work
  try {
    convertToStableGraph();
  } finally {
    hideLoading();
  }
  return true;
}

function askConversion(): Promise<boolean> {
  return new Promise(resolve => {
    let confirmed = false;
    ensureEl("alertMessage").innerHTML = /* html */ `This map was generated on the classic graph, whose cells are
      rebuilt whenever the coastline changes. Drawing terrain needs a stable graph.
      <p>Convert the map now? States, burgs, routes and the rest are carried over. The conversion cannot be undone,
      so save the map first if you want to keep this version.</p>`;
    $("#alert").dialog({
      resizable: false,
      title: "Convert the map for drawing",
      width: "30em",
      buttons: {
        Convert: function (this: HTMLElement) {
          confirmed = true;
          $(this).dialog("close");
        },
        Cancel: function (this: HTMLElement) {
          $(this).dialog("close");
        }
      },
      close: function (this: HTMLElement) {
        $(this).dialog("option", "close", null); // #alert is shared: do not leave this handler on it
        resolve(confirmed);
      }
    });
  });
}

/** rebuild the map on a stable graph with an identity resample: every entity is carried over by position */
function convertToStableGraph(): void {
  const density = Object.entries(POINTS_BY_DENSITY).find(([, points]) => points === options.map.graph.points)?.[0];
  const requested = options.generation.graph.density;
  options.generation.graph.density = Math.max(Number(density ?? requested), MIN_STABLE_DENSITY);
  options.map.graph.stable = true;

  const identity = (x: number, y: number): [number, number] => [x, y];
  undraw();
  try {
    Resample.process({ projection: identity, inverse: identity, scale: 1 });
  } finally {
    options.generation.graph.density = requested; // the request for the next map is the user's, not ours
  }

  Layers.drawAll();
  fitMapToScreen();
  registerMap(); // a new graph: the undo history of the old one no longer applies
  tip("The map is converted: terrain can now be drawn", false, "success", 4000);
}

export const TerrainTools = { start, stop };
