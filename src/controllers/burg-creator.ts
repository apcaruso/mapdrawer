import { pointer } from "d3";
import { closeDialogs, refreshEditors } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { stopMapPlacement, toggleMapPlacement } from "@/components/map-placement";
import { tip } from "@/components/tooltips";
import { UndoHistory } from "@/components/undo-history";
import { redrawEmblem } from "@/renderers/draw-emblems";

function toggle(): void {
  if (isActive()) {
    stop();
    return;
  }

  closeDialogs(".stable");
  toggleMapPlacement(
    "addBurgTool",
    addOnClick,
    "Click on the map to create a new burg. Hold Shift to add multiple",
    "warn",
    unpressProxyButton
  );
  document.getElementById("addNewBurg")?.classList.add("pressed");

  Layers.show("burgIcons", "labels");
}

function addOnClick(event: MouseEvent): void {
  const point = pointer(event, event.currentTarget as SVGGElement);
  if (addAt(point) && !event.shiftKey) stop();
}

/** place a burg at a map point; false when the point cannot take one */
function addAt(point: [number, number]): boolean {
  const cell = Pack.findCell(point[0], point[1]);
  if (cell === undefined) return false;

  if (pack.cells.h[cell] < 20) {
    tip("You cannot place a burg in the water. Please click on a land cell", false, "error");
    return false;
  }
  if (pack.cells.burg[cell]) {
    tip("There is already a burg in this cell. Please select a free cell", false, "error");
    return false;
  }

  const burgId = UndoHistory.record(
    {
      label: "Add burg",
      domains: ["burgs", "cells.burg", "routes", "cells.routes"],
      layers: ["burgIcons", "labels", "routes", "emblems"]
    },
    () => Burgs.add(point)
  );
  redrawEmblem("burg", burgId);
  refreshEditors();
  Layers.draw("burgIcons", "labels", "routes");
  return true;
}

function stop(): void {
  if (isActive()) stopMapPlacement();
  else unpressProxyButton();
}

function isActive(): boolean {
  return document.getElementById("addBurgTool")?.classList.contains("pressed") ?? false;
}

function unpressProxyButton(): void {
  document.getElementById("addNewBurg")?.classList.remove("pressed");
}

export const BurgCreator = { toggle, stop, addAt };
