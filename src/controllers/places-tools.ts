// Places tools: burgs, labels, markers and routes, each placed with one gesture and named on the spot
import { pointer, select } from "d3";
import { refreshEditors } from "@/components/dialog/dialog-helpers";
import { commitInlineName, editNameInline } from "@/components/inline-name";
import { Layers } from "@/components/layers";
import { MapFreehand } from "@/components/map-freehand";
import { hideToolOptions, showToolOptions } from "@/components/tools/tool-options";
import { clearMainTip, tip } from "@/components/tooltips";
import { UndoHistory } from "@/components/undo-history";
import { applyDefaultViewboxEvents } from "@/components/viewbox-events";
import { Controllers } from "@/controllers";
import { DrawnRoutes } from "@/generators/drawn-routes";
import { redrawEmblem } from "@/renderers/draw-emblems";
import { createLabelArc } from "@/renderers/labels/label-arc";
import { getLabelData } from "@/renderers/labels/label-data";
import { redrawLabel } from "@/renderers/labels/labels-renderer";
import type { Point } from "@/types/global";
import { ensureEl, escapeHtml, rn } from "@/utils";

export type PlacesTool = "burg" | "label" | "marker" | "route";

const settings = {
  burgGroup: null as string | null, // "" is Auto; unset until the tool first opens
  connectRoads: false,
  labelGroup: "",
  markerType: "",
  routeGroup: "roads"
};
let freehand: MapFreehand | null = null;

function start(tool: PlacesTool): boolean {
  if (customization) {
    tip("Please exit the active edit mode first", false, "error");
    return false;
  }
  stop();

  if (tool === "burg") startBurgs();
  else if (tool === "label") startLabels();
  else if (tool === "marker") startMarkers();
  else startRoutes();
  return true;
}

function stop(): void {
  commitInlineName();
  freehand?.detach();
  freehand = null;
  hideToolOptions();
  clearMainTip();
  applyDefaultViewboxEvents();
}

/** options bar with one select; returns the select */
function showSelect(title: string, label: string, tipText: string, choices: [string, string][], selected: string) {
  const choicesHtml = choices
    .map(
      ([value, name]) =>
        `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(name)}</option>`
    )
    .join("");
  const bar = showToolOptions(
    title,
    `<label data-tip="${tipText}">${label} <select id="placesToolSelect">${choicesHtml}</select></label><span id="placesToolExtra"></span>`
  );
  return { bar, select: ensureEl<HTMLSelectElement>("placesToolSelect") };
}

function onMapClick(place: (point: Point) => void): void {
  select<SVGGElement, unknown>("#viewbox")
    .style("cursor", "crosshair")
    .on(".drag", null)
    .on("click", (event: MouseEvent) => place(pointer(event, event.currentTarget as SVGGElement) as Point));
}

// --- burgs

function startBurgs(): void {
  Layers.show("burgIcons", "labels");
  const groups = options.map.burgs.groups
    .filter(group => group.active !== false)
    .map(({ name }): [string, string] => [name, name]);
  // drawn land has no population yet, so Auto would make every burg a hamlet: a town is the visible default
  settings.burgGroup ??= groups.some(([name]) => name === "town") ? "town" : "";
  const { select: groupSelect } = showSelect(
    "Burg",
    "Type:",
    "What kind of settlement: Auto picks it from the population, like generated burgs",
    [["", "Auto"], ...groups],
    settings.burgGroup
  );
  groupSelect.addEventListener("change", () => (settings.burgGroup = groupSelect.value));
  ensureEl("placesToolExtra").innerHTML =
    `<label data-tip="Link every new burg to the nearest roads, as generated burgs are"><input id="placesToolRoads" type="checkbox" class="native" ${settings.connectRoads ? "checked" : ""}/> Roads</label>`;
  ensureEl<HTMLInputElement>("placesToolRoads").addEventListener("change", event => {
    settings.connectRoads = (event.currentTarget as HTMLInputElement).checked;
  });
  onMapClick(placeBurg);
}

function placeBurg(point: Point): void {
  const { cells } = pack;
  const cell = Pack.findCell(point[0], point[1]);
  if (cell === undefined) return;
  if (cells.h[cell] < 20) return void tip("A burg needs land: click on a land cell", false, "error");
  if (cells.burg[cell]) return void tip("There is already a burg in this cell", false, "error");

  const { connectRoads, burgGroup } = settings;
  const domains = connectRoads
    ? (["burgs", "cells.burg", "routes", "cells.routes"] as const)
    : (["burgs", "cells.burg"] as const);
  const burgId = UndoHistory.record(
    { label: "Add burg", domains: [...domains], layers: ["burgIcons", "labels", "routes", "emblems"] },
    () => {
      const id = Burgs.add(point, connectRoads);
      if (burgGroup) Burgs.changeGroup(pack.burgs[id], burgGroup);
      return id;
    }
  );

  redrawEmblem("burg", burgId);
  Layers.draw("burgIcons");
  if (connectRoads) Layers.draw("routes");
  redrawBurgLabel(burgId);
  refreshEditors();

  const burg = pack.burgs[burgId];
  editNameInline({
    point: [burg.x, burg.y],
    value: burg.name ?? "",
    onCommit: name =>
      UndoHistory.record({ label: "Rename burg", domains: ["burgs"], layers: ["labels"] }, () => {
        burg.name = name;
        if (burg.label?.text) burg.label.text = name;
        redrawBurgLabel(burgId);
        refreshEditors();
      })
  });
}

function redrawBurgLabel(burgId: number): void {
  const label = getLabelData("burg", burgId);
  if (label) redrawLabel(label);
}

// --- labels

function startLabels(): void {
  Layers.show("labels");
  const groups = options.map.labels.groups
    .filter(group => group.type === "added")
    .map(({ name }): [string, string] => [name, name]);
  if (!settings.labelGroup) settings.labelGroup = groups[0]?.[0] ?? "";
  const { select: groupSelect } = showSelect(
    "Label",
    "Style:",
    "The label group, which sets the font and size. Click to place a straight label, drag to write along a curve",
    groups,
    settings.labelGroup
  );
  groupSelect.addEventListener("change", () => (settings.labelGroup = groupSelect.value));
  freehand = new MapFreehand({ stroke: "#555", onEnd: placeLabel });
  freehand.attach();
}

/** a click places a straight label, a drag a label written along the drawn curve */
function placeLabel(stroke: Point[]): void {
  const length = stroke.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - stroke[i][0], y - stroke[i][1]), 0);
  const curved = length > 20;
  const anchor = curved ? stroke[Math.floor(stroke.length / 2)] : stroke[0];
  const cell = Pack.findCell(anchor[0], anchor[1]);
  if (cell === undefined) return;

  const text = Names.getCulture(pack.cells.culture[cell]);
  const group = Labels.findGroup(settings.labelGroup, "added").name;
  const pathPoints = curved
    ? simplify(stroke, 8)
    : createLabelArc({ text, type: "added", group, anchor: [anchor[0], anchor[1]] });

  const addedLabel = UndoHistory.record({ label: "Add label", domains: ["addedLabels"], layers: ["labels"] }, () =>
    AddedLabels.add({ x: rn(anchor[0], 2), y: rn(anchor[1], 2), label: { text, group, pathPoints } })
  );
  redrawAddedLabel(addedLabel.i);

  editNameInline({
    point: anchor,
    value: text,
    onCommit: name =>
      UndoHistory.record({ label: "Rename label", domains: ["addedLabels"], layers: ["labels"] }, () => {
        addedLabel.label.text = name;
        // a straight label's arc is sized to its text; a drawn curve keeps the shape it was given
        if (!curved)
          addedLabel.label.pathPoints = createLabelArc({
            text: name,
            type: "added",
            group,
            anchor: [anchor[0], anchor[1]]
          });
        redrawAddedLabel(addedLabel.i);
      })
  });
}

function redrawAddedLabel(id: number): void {
  const label = getLabelData("added", id);
  if (label) redrawLabel(label);
}

/** drop stroke points closer than the step to the last kept one */
function simplify(points: Point[], step: number): Point[] {
  const kept: Point[] = [points[0]];
  for (const point of points.slice(1)) {
    const last = kept.at(-1)!;
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= step) kept.push(point);
  }
  if (kept.at(-1) !== points.at(-1)) kept.push(points.at(-1)!);
  return kept.map(([x, y]) => [rn(x, 1), rn(y, 1)]);
}

// --- markers

function startMarkers(): void {
  Layers.show("markers");
  const types = Markers.getConfig().map(({ type, icon }): [string, string] => [
    type,
    `${isImage(icon) ? "" : `${icon} `}${type}`
  ]);
  if (!settings.markerType) settings.markerType = types[0]?.[0] ?? "";
  const { select: typeSelect } = showSelect("Marker", "Type:", "What the marker shows", types, settings.markerType);
  typeSelect.addEventListener("change", () => (settings.markerType = typeSelect.value));
  onMapClick(point => {
    ensureEl<HTMLInputElement>("addedMarkerType").value = settings.markerType; // the creator places the type set there
    void Controllers.MarkerCreator.addAt(point);
  });
}

const isImage = (icon: string) => icon.startsWith("http") || icon.startsWith("data:") || icon.includes("/");

// --- routes

function startRoutes(): void {
  Layers.show("routes");
  const groups = Object.keys(styles.routes.groups).map((group): [string, string] => [group, group]);
  if (!groups.some(([group]) => group === settings.routeGroup)) settings.routeGroup = groups[0]?.[0] ?? "roads";
  const { select: groupSelect } = showSelect(
    "Route",
    "Type:",
    "Roads and trails run on land, sea routes on water. Ends drawn close to a burg reach it",
    groups,
    settings.routeGroup
  );
  groupSelect.addEventListener("change", () => (settings.routeGroup = groupSelect.value));
  freehand = new MapFreehand({ stroke: "#8a5a2b", onEnd: drawRoute });
  freehand.attach();
}

function drawRoute(stroke: Point[]): void {
  const onWater = settings.routeGroup === "searoutes";
  const course = DrawnRoutes.traceCourse(stroke, onWater);
  if (!course) {
    tip(`Draw the route ${onWater ? "on water" : "on land"} across at least two cells`, false, "warn", 3000);
    return;
  }
  UndoHistory.record({ label: "Draw route", domains: ["routes", "cells.routes"], layers: ["routes"] }, () =>
    DrawnRoutes.add(course, settings.routeGroup)
  );
  Layers.draw("routes");
}

export const PlacesTools = { start, stop };
