// The tools of the palette: adapters over the existing editors and creators
import { SELECT_TOOL, type Tool } from "@/components/tools/tool-manager";
import { applyDefaultViewboxEvents } from "@/components/viewbox-events";
import { Controllers } from "@/controllers";
import type { PlacesTool } from "@/controllers/places-tools";
import type { TerrainMode } from "@/controllers/terrain-tools";
import { findEl } from "@/utils";

const icon = (name: string) => `<span class="icon-${name}"></span>`;
const svgIcon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

type ToolSpec = Pick<Tool, "id" | "name" | "group" | "icon" | "key" | "hint">;

/** paint cell values with the shared paint editor; the editor's own undo works on the strokes of the session */
function paintTool(spec: ToolSpec, paint: (end: () => void) => Promise<boolean>): Tool {
  return {
    ...spec,
    activate: async end => {
      if (!(await paint(end))) throw new Error("another edit mode is active");
    },
    deactivate: () => Controllers.PaintEditor.apply(),
    undo: () => Controllers.PaintEditor.undoStroke()
  };
}

/** shape the terrain; a map on the classic graph is offered a conversion first, and declining it ends the tool */
function terrainTool(spec: Omit<ToolSpec, "group">, mode: TerrainMode): Tool {
  return {
    ...spec,
    group: "terrain",
    activate: async end => {
      if (!(await Controllers.TerrainTools.start(mode))) end();
    },
    deactivate: () => Controllers.TerrainTools.stop()
  };
}

/** burgs, labels, markers and routes: placed with one gesture, the tool stays active until another is picked */
function placesTool(spec: Omit<ToolSpec, "group">, tool: PlacesTool): Tool {
  return {
    ...spec,
    group: "places",
    activate: async end => {
      if (!(await Controllers.PlacesTools.start(tool))) end();
    },
    deactivate: () => Controllers.PlacesTools.stop()
  };
}

/** a creator that works in its own dialog: the tool lives as long as the dialog */
function dialogTool(spec: ToolSpec, dialogId: string, open: () => unknown): Tool {
  return {
    ...spec,
    activate: async end => {
      await open();
      const dialog = findEl(dialogId);
      if (!dialog) throw new Error("another edit mode is active");
      $(dialog).one("dialogclose", end);
    },
    deactivate: () => {
      const dialog = findEl(dialogId);
      if (dialog) $(dialog).dialog("close");
    }
  };
}

export const DRAWING_TOOLS: Tool[] = [
  {
    id: SELECT_TOOL,
    name: "Select",
    group: "select",
    icon: svgIcon('<path d="M5 3l14 8-6 1.5L10 19z" fill="currentColor"/>'),
    key: "KeyV",
    hint: "click a map element to edit it",
    activate: applyDefaultViewboxEvents
  },
  terrainTool(
    { id: "land", name: "Land brush", icon: icon("brush"), key: "KeyB", hint: "drag to raise land from the sea" },
    "land"
  ),
  terrainTool(
    {
      id: "sea",
      name: "Sea brush",
      icon: icon("eraser"),
      key: "KeyE",
      hint: "drag to sink land into the sea; inside land it makes lakes"
    },
    "sea"
  ),
  terrainTool(
    {
      id: "lasso",
      name: "Lasso",
      icon: icon("draw-polygon"),
      key: "KeyL",
      hint: "draw a closed shape to fill it with land; hold Alt to carve sea instead"
    },
    "lasso"
  ),
  terrainTool(
    { id: "raise", name: "Raise", icon: icon("level-up"), key: "KeyH", hint: "drag to build hills" },
    "raise"
  ),
  terrainTool(
    { id: "lower", name: "Lower", icon: icon("level-down"), key: "KeyD", hint: "drag to lower the ground" },
    "lower"
  ),
  terrainTool(
    { id: "smooth", name: "Smooth", icon: icon("smooth"), key: "KeyF", hint: "drag to soften slopes" },
    "smooth"
  ),
  terrainTool(
    {
      id: "range",
      name: "Mountain range",
      icon: icon("mountain"),
      key: "KeyM",
      hint: "draw the ridge line; strength sets the height, width how far the range spreads"
    },
    "range"
  ),
  paintTool(
    {
      id: "states",
      name: "States",
      group: "political",
      icon: icon("crown"),
      key: "KeyS",
      hint: "drag to paint, click to pick the state under the pointer"
    },
    end => Controllers.StatesEditor.paint(end)
  ),
  paintTool(
    {
      id: "provinces",
      name: "Provinces",
      group: "political",
      icon: icon("flag"),
      key: "KeyP",
      hint: "drag to paint provinces within their state"
    },
    end => Controllers.ProvincesEditor.paint(end)
  ),
  paintTool(
    { id: "cultures", name: "Cultures", group: "political", icon: icon("users"), key: "KeyC", hint: "drag to paint" },
    end => Controllers.CulturesEditor.paint(end)
  ),
  paintTool(
    {
      id: "religions",
      name: "Religions",
      group: "political",
      icon: icon("place-of-worship"),
      key: "KeyR",
      hint: "drag to paint"
    },
    end => Controllers.ReligionsEditor.paint(end)
  ),
  paintTool(
    { id: "biomes", name: "Biomes", group: "nature", icon: icon("tree"), key: "KeyG", hint: "drag to paint" },
    end => Controllers.BiomesEditor.paint(end)
  ),
  dialogTool(
    {
      id: "reliefIcons",
      name: "Relief icons",
      group: "nature",
      icon: svgIcon('<path d="M2 19l5-8 4 6 3-4 6 6z"/>'),
      key: "KeyI",
      hint: "drag to place the icon picked in the dialog; switch the dialog to remove mode to erase"
    },
    "reliefEditor",
    async () => {
      await Controllers.ReliefEditor.open(undefined as unknown as SVGElement); // no icon picked: start with the brush
      findEl("reliefBulkAdd")?.click();
    }
  ),
  {
    id: "river",
    name: "River",
    group: "nature",
    icon: svgIcon('<path d="M4 4c4 2 0 6 4 8s6-2 8 2-2 6 4 6"/>'),
    key: "KeyW",
    hint: "drag from the source to the mouth; ending in another river makes a tributary",
    activate: async end => {
      if (!(await Controllers.RiverTool.start())) end();
    },
    deactivate: () => Controllers.RiverTool.stop()
  },
  placesTool(
    {
      id: "burg",
      name: "Burg",
      icon: icon("fort-awesome"),
      key: "KeyU",
      hint: "click on land to place a burg, then type its name"
    },
    "burg"
  ),
  placesTool(
    {
      id: "route",
      name: "Route",
      icon: icon("map-signs"),
      key: "KeyO",
      hint: "drag along the way; an end drawn close to a burg reaches it"
    },
    "route"
  ),
  placesTool(
    {
      id: "label",
      name: "Label",
      icon: icon("font"),
      key: "KeyT",
      hint: "click for a straight label or drag to write along a curve, then type the text"
    },
    "label"
  ),
  placesTool(
    { id: "marker", name: "Marker", icon: icon("map-pin"), key: "KeyK", hint: "click to place a marker" },
    "marker"
  )
];
