// An ocean-only world to draw on: the physical base is computed, every collection starts empty
import type { Burg } from "@/generators/burgs-generator";
import { DEFAULT_CULTURE_TYPE } from "@/generators/cultures-generator";
import { GraphOverride } from "@/generators/graph-override";
import { Pipeline, type PipelineStep } from "@/generators/pipeline";
import type { Province } from "@/generators/provinces-generator";
import type { Religion } from "@/generators/religions-generator";
import type { State } from "@/generators/states-generator";
import type { GridGraph } from "@/types/GridGraph";

export const BLANK_OCEAN_HEIGHT = 10;

/** each collection in the shape its generator leaves when there is nothing to generate */
export function createEmptyCollections(): void {
  const { cells } = pack;
  const n = cells.i.length;

  cells.s = new Uint16Array(n);
  cells.pop = new Float32Array(n);
  cells.culture = new Uint16Array(n);
  cells.burg = new Uint16Array(n);
  cells.state = new Uint16Array(n);
  cells.religion = new Uint16Array(n);
  cells.province = new Uint16Array(n);
  cells.good = new Uint16Array(n);
  cells.market = new Uint16Array(n);
  cells.routes = {};

  pack.cultures = [{ name: "Wildlands", i: 0, base: 1, origins: [null], shield: "round", type: DEFAULT_CULTURE_TYPE }];
  pack.burgs = [0 as unknown as Burg];
  pack.states = [{ i: 0, name: "Neutrals", salesTax: 0, pollTax: 0, treasury: 0, diplomacy: [] } as unknown as State];
  pack.religions = [{ name: "No religion", i: 0 } as Religion];
  pack.provinces = [0 as unknown as Province];
  pack.routes = [];
  pack.relief = [];
  pack.ice = [];
  pack.markers = [];
  pack.zones = [];
  pack.measurers = [];
  pack.addedLabels = [];
  pack.journeys = [];
  pack.markets = [];
  pack.deals = [];

  // the goods catalogue is map-independent: kept so the economy can be built later
  pack.goods = [];
  Goods.restoreDefaults();
}

/** clear the river data the rivers step would write, so biomes and routes read an empty network */
function createEmptyRivers(): void {
  const n = pack.cells.i.length;
  pack.rivers = [];
  pack.cells.r = new Uint16Array(n);
  pack.cells.fl = new Uint16Array(n);
  pack.cells.conf = new Uint8Array(n);
}

/** rebuild the lookups other modules keep over the collections, so none points into the replaced world */
function syncDerivedIndexes(): void {
  Markets.sync();
  Routes.sync();
  Journeys.sync();
}

const blankPipelineSteps = [
  { id: "grid", run: ({ graph }) => Grid.prepare(graph) },
  { id: "ocean", run: () => (grid.cells.h = new Uint8Array(grid.points.length).fill(BLANK_OCEAN_HEIGHT)) },
  { id: "markupGrid", run: () => Features.markupGrid() },
  { id: "coordinates", run: () => Coordinates.calculate() }, // the position is requested, not derived from terrain
  { id: "temperatures", run: () => Temperature.generate() },
  { id: "precipitation", run: () => Precipitation.generate() },
  {
    id: "clearPack",
    run: () => {
      Pack.clear();
      GraphOverride.clear();
    }
  },
  { id: "regraph", run: () => Pack.generate() },
  { id: "markupPack", run: () => Features.markupPack() },
  { id: "rivers", run: () => createEmptyRivers() },
  { id: "biomes", run: () => Biomes.generate() },
  { id: "featureGroups", run: () => Features.defineGroups() },
  { id: "collections", run: () => createEmptyCollections() },
  { id: "featureNames", run: () => Features.defineNames() },
  { id: "sync", run: () => syncDerivedIndexes() }
] as const satisfies PipelineStep<string, BlankWorldContext>[];

type BlankWorldContext = { graph?: GridGraph };

export const BlankWorldPipeline = new Pipeline<(typeof blankPipelineSteps)[number]["id"], BlankWorldContext>(
  "Blank World Pipeline",
  blankPipelineSteps
);
