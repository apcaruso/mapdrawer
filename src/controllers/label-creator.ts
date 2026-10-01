import { pointer } from "d3";
import { closeDialogs } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { stopMapPlacement, toggleMapPlacement } from "@/components/map-placement";
import { UndoHistory } from "@/components/undo-history";
import { Controllers } from "@/controllers";
import { createLabelArc } from "@/renderers/labels/label-arc";

function toggle(): void {
  if (document.getElementById("addLabel")?.classList.contains("pressed")) {
    stopMapPlacement();
    return;
  }

  closeDialogs(".stable");
  toggleMapPlacement("addLabel", addOnClick, "Click on map to place label. Hold Shift to add multiple");
  Layers.show("labels");
}

async function addOnClick(event: MouseEvent): Promise<void> {
  const point = pointer(event, event.currentTarget as SVGGElement);
  if ((await addAt(point)) && !event.shiftKey) stopMapPlacement();
}

/** place a label at a map point; false when the point is off the map */
async function addAt(point: [number, number]): Promise<boolean> {
  const cell = Pack.findCell(point[0], point[1]);
  if (cell === undefined) return false;

  const text = Names.getCulture(pack.cells.culture[cell]);
  const lastSelected = await Controllers.LabelsEditor.getLastSelectedGroup();
  const group = Labels.findGroup(lastSelected, "added").name;
  const [x, y] = point;
  const pathPoints = createLabelArc({ text, type: "added", group, anchor: [x, y] });
  UndoHistory.record({ label: "Add label", domains: ["addedLabels"], layers: ["labels"] }, () =>
    AddedLabels.add({ x, y, label: { text, group, pathPoints } })
  );
  Layers.draw("labels");
  return true;
}

export const LabelCreator = { toggle, addAt };
