// The default start of the fork: an empty ocean to draw on, instead of a random world
import { applyGraphSize, fitMapToScreen } from "@/components/canvas";
import { closeDialogs } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { registerMap } from "@/components/lifecycle";
import { MapViews } from "@/components/map-views";
import { syncOptionInputs } from "@/components/options/tabs/options-tab";
import { is3dView } from "@/components/options/view-mode";
import { setSeed } from "@/components/seed";
import { clearMainTip, tip } from "@/components/tooltips";
import { undraw } from "@/components/undraw";
import { invokeActiveZooming, resetZoom } from "@/components/zoom";
import { Controllers } from "@/controllers";
import { getPointsNumber } from "@/data/graph-density";
import { BlankWorldPipeline } from "@/generators/blank-world";
import { logStats } from "@/services/logging";
import { parseError } from "@/utils";

/** where on the globe the drawn region lies: the latitude shift of a map covering 20% of the globe */
export const CLIMATE_ZONES = {
  northCold: { name: "Northern cold", latitude: 3 },
  northTemperate: { name: "Northern temperate", latitude: 17 },
  equatorial: { name: "Equatorial", latitude: 50 },
  southTemperate: { name: "Southern temperate", latitude: 83 },
  southCold: { name: "Southern cold", latitude: 97 }
} as const;
export type ClimateZone = keyof typeof CLIMATE_ZONES;

const BLANK_MAP_SIZE = 20; // % of the globe

export interface BlankMapRequest {
  density: number; // the Points slider step
  zone: ClimateZone;
}

export const DEFAULT_BLANK_REQUEST: BlankMapRequest = { density: 6, zone: "northTemperate" };

/** the settings of a new blank map: defaults, plus the user's definition sets and style */
function establishBlankMap({ density, zone }: BlankMapRequest): void {
  const previous = options.map;
  const map = Options.getDefaultOptions().map;

  map.seed = previous.seed;
  map.style = previous.style;
  map.burgs.groups = previous.burgs.groups;
  map.labels.groups = previous.labels.groups;
  map.military.units = previous.military.units;
  map.transports = previous.transports;
  map.coastline = previous.coastline;

  const { width, height } = options.generation.graph;
  map.graph = { width, height, points: getPointsNumber(density), stable: true };
  map.geography.mapSize = BLANK_MAP_SIZE;
  map.geography.latitude = CLIMATE_ZONES[zone].latitude;
  map.geography.longitude = 50;
  map.lore.name = "Untitled";

  options.map = map;
  options.generation.graph.density = density;
}

async function generateBlank(request: BlankMapRequest): Promise<void> {
  Options.setGraphSize();
  setSeed(); // names and colors offered while drawing still come from the seeded generator
  establishBlankMap(request);
  applyGraphSize();

  await BlankWorldPipeline.run({});
  Options.persist();

  syncOptionInputs();
  registerMap();
  logStats();
  invokeActiveZooming();
}

function showError(error: unknown): void {
  ERROR && console.error(error);
  clearMainTip();
  tip(`Failed to create a blank map: ${parseError(error as Error)}`, false, "error", 10000);
}

/** Replace the map on screen with an empty ocean */
export async function newBlankMap(request: BlankMapRequest = DEFAULT_BLANK_REQUEST): Promise<void> {
  closeDialogs("#worldConfigurator, #options3d");
  customization = 0;
  resetZoom(1000);
  undraw();

  try {
    await generateBlank(request);
  } catch (error) {
    showError(error);
    return;
  }

  MapViews.restore("physical"); // the first thing drawn is land
  Layers.drawAll();
  if (is3dView()) Controllers.View3d.redraw();
  fitMapToScreen();
  clearMainTip();
}

/** The start-up path when nothing else is asked for */
export async function blankMapOnLoad(): Promise<void> {
  await applyStyleOnLoad();
  try {
    await generateBlank(DEFAULT_BLANK_REQUEST);
  } catch (error) {
    showError(error);
    return;
  }

  MapViews.restore("physical");
  Layers.drawAll();
  fitMapToScreen();
}

declare global {
  // biome-ignore lint/suspicious/noRedeclare: exposed on window for the perf probe and legacy JS
  var newBlankMap: (request?: BlankMapRequest) => Promise<void>;
}
window.newBlankMap = newBlankMap;
