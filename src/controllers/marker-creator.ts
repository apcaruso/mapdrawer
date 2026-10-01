import { pointer } from "d3";
import { refreshEditors } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { stopMapPlacement, toggleMapPlacement } from "@/components/map-placement";
import { UndoHistory } from "@/components/undo-history";
import type { Marker } from "@/generators/markers-generator";
import { ensureEl, findEl, rn } from "@/utils";

function toggle(baseMarker?: Marker): void {
  if (findEl("addMarker")?.classList.contains("pressed")) {
    unpressProxyButtons();
    stopMapPlacement();
    return;
  }

  toggleMapPlacement(
    "addMarker",
    event => addOnClick(event, baseMarker),
    "Click on map to add a marker. Hold Shift to add multiple",
    undefined,
    unpressProxyButtons
  );
  document.getElementById("markersAddFromOverview")?.classList.add("pressed");
  document.getElementById("markerAdd")?.classList.add("pressed");
  Layers.show("markers");
}

function addOnClick(event: MouseEvent, baseMarker?: Marker): void {
  const point = pointer(event, event.currentTarget as SVGGElement);
  if (!addAt(point, baseMarker) || event.shiftKey) return;

  unpressProxyButtons();
  stopMapPlacement();
}

/** place a marker of the selected type at a map point; false when the point is off the map */
function addAt(point: [number, number], baseMarker?: Marker): boolean {
  const cell = Pack.findCell(point[0], point[1]);
  if (cell === undefined) return false;

  const selectedType = ensureEl<HTMLSelectElement>("addedMarkerType").value;
  const selectedConfig = Markers.getConfig().find(({ type }) => type === selectedType);
  const template = baseMarker || selectedConfig || { icon: "❓", type: "custom" };
  UndoHistory.record({ label: "Add marker", domains: ["markers"], layers: ["markers"] }, () => {
    const marker = Markers.add({ ...template, x: rn(point[0], 2), y: rn(point[1], 2), cell } as Marker);
    selectedConfig?.add(marker, cell);
  });

  Layers.draw("markers");
  refreshEditors();
  return true;
}

function unpressProxyButtons(): void {
  document.getElementById("markerAdd")?.classList.remove("pressed");
  document.getElementById("markersAddFromOverview")?.classList.remove("pressed");
}

export const MarkerCreator = { toggle, addAt };
