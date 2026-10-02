// The map views: what the land shows while drawing, a click away instead of a layer list. The view follows
// the tool too: the States tool shows the political map, the terrain tools the physical one
import { type LayerId, Layers } from "@/components/layers";

export interface MapView {
  name: string;
  tip: string;
  signature: LayerId; // the layer that tells the view is on screen
  layers: readonly LayerId[];
}

const BASE: LayerId[] = ["lakes", "rivers", "ice", "scaleBar", "vignette"];
const PLACES: LayerId[] = ["routes", "burgIcons", "labels", "markers"]; // what was drawn stays in every view

export const MAP_VIEWS = {
  physical: {
    name: "Physical",
    tip: "The land itself: elevation, mountains, rivers",
    signature: "heightmap",
    layers: ["heightmap", "relief", ...BASE, ...PLACES]
  },
  political: {
    name: "Political",
    tip: "States and their borders",
    signature: "states",
    layers: ["states", "borders", ...BASE, ...PLACES]
  },
  provinces: {
    name: "Provinces",
    tip: "Provinces within their states",
    signature: "provinces",
    layers: ["provinces", "borders", ...BASE, ...PLACES]
  },
  cultures: {
    name: "Cultures",
    tip: "Where every culture lives",
    signature: "cultures",
    layers: ["cultures", "borders", ...BASE, ...PLACES]
  },
  religions: {
    name: "Religions",
    tip: "Where every religion is followed",
    signature: "religions",
    layers: ["religions", "borders", ...BASE, ...PLACES]
  },
  biomes: {
    name: "Biomes",
    tip: "Forests, deserts, grasslands and the rest",
    signature: "biomes",
    layers: ["biomes", "relief", ...BASE, ...PLACES]
  }
} as const satisfies Record<string, MapView>;

export type ViewId = keyof typeof MAP_VIEWS;
export const VIEW_IDS = Object.keys(MAP_VIEWS) as ViewId[];

// several views may look on at once; the most specific one wins
const PRIORITY: ViewId[] = ["provinces", "political", "cultures", "religions", "biomes", "physical"];

let chosen: ViewId | undefined; // the last view asked for, until its layer is turned off

/** the view on screen, if the layers show one */
function current(): ViewId | undefined {
  if (chosen && Layers.isOn(MAP_VIEWS[chosen].signature)) return chosen;
  return PRIORITY.find(id => Layers.isOn(MAP_VIEWS[id].signature));
}

function show(id: ViewId): void {
  chosen = id;
  Layers.set(MAP_VIEWS[id].layers);
}

/** switch to the view a tool works in, unless it is already on screen */
function follow(id: ViewId | undefined): void {
  if (id && current() !== id) show(id);
}

/** set the view of a map about to be drawn: nothing is drawn or erased here */
function restore(id: ViewId): void {
  chosen = id;
  Layers.restore({ order: Layers.state.order, active: [...MAP_VIEWS[id].layers] });
}

export const MapViews = { current, show, follow, restore };
