// Drag to move, part of the default map interaction: burgs, burg and free labels, and markers follow the pointer
// and land as one undoable step. A click without movement still opens the element's editor
import { type D3DragEvent, drag, type Selection } from "d3";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { type HistoryAction, UndoHistory } from "@/components/undo-history";
import type { LabelType } from "@/generators/labels-generator";
import { getLabelData } from "@/renderers/labels/label-data";
import { redrawLabel } from "@/renderers/labels/labels-renderer";
import { rn } from "@/utils";

const MOVABLE =
  "#burgIcons use[data-id], #labels text[data-label-type='burg'], #labels text[data-label-type='added'], #markers > svg";

type DragEvent = D3DragEvent<SVGGElement, unknown, unknown>;

export function attachDragToMove(viewbox: Selection<SVGGElement, unknown, HTMLElement, unknown>): void {
  viewbox.call(
    drag<SVGGElement, unknown>()
      .container(() => viewbox.node()!)
      .filter(event => !event.button && Boolean(findMovable(event.target)))
      .on("start", start)
  );
}

const findMovable = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<SVGElement>(MOVABLE) : null;

function start(event: DragEvent): void {
  const element = findMovable(event.sourceEvent.target);
  if (!element) return;
  const [x0, y0] = [event.x, event.y];
  let moved = false;

  event
    .on("drag", ({ x, y }: DragEvent) => {
      moved = true;
      element.setAttribute("transform", `translate(${x - x0} ${y - y0})`);
    })
    .on("end", ({ x, y }: DragEvent) => {
      element.removeAttribute("transform");
      if (moved) drop(element, rn(x - x0, 2), rn(y - y0, 2));
    });
}

function drop(element: SVGElement, dx: number, dy: number): void {
  if (element.closest("#burgIcons")) moveBurg(Number(element.dataset.id), dx, dy);
  else if (element.closest("#markers")) moveMarker(Number(element.id.replace("marker", "")), dx, dy);
  else moveLabel(element.dataset.labelType as LabelType, Number(element.dataset.id), dx, dy);
}

function record(label: string, domains: HistoryAction["domains"], layers: HistoryAction["layers"], move: () => void) {
  UndoHistory.record({ label, domains, layers }, move);
}

function moveBurg(burgId: number, dx: number, dy: number): void {
  const burg = pack.burgs[burgId];
  if (!burg) return;
  let error: string | undefined;
  record("Move burg", ["burgs", "cells.burg", "states"], ["burgIcons", "labels", "emblems"], () => {
    error = Burgs.relocate(burgId, [burg.x + dx, burg.y + dy]);
  });
  if (error) tip(error, false, "error");

  Layers.draw("burgIcons");
  const label = getLabelData("burg", burgId);
  if (label) redrawLabel(label);
}

/** a burg or free label keeps its own offset, so moving it does not move what it names */
function moveLabel(type: LabelType, id: number, dx: number, dy: number): void {
  const entity = type === "burg" ? pack.burgs[id] : pack.addedLabels.find(label => label.i === id);
  if (!entity) return;
  record("Move label", [type === "burg" ? "burgs" : "addedLabels"], ["labels"], () => {
    const label = entity.label ?? {};
    entity.label = { ...label, dx: rn((label.dx ?? 0) + dx, 2), dy: rn((label.dy ?? 0) + dy, 2) };
  });

  const label = getLabelData(type, id);
  if (label) redrawLabel(label);
}

function moveMarker(markerId: number, dx: number, dy: number): void {
  const marker = pack.markers.find(marker => marker.i === markerId);
  if (!marker) return;
  record("Move marker", ["markers"], ["markers"], () => {
    marker.x = rn(marker.x + dx, 2);
    marker.y = rn(marker.y + dy, 2);
    marker.cell = Pack.findCell(marker.x, marker.y) ?? marker.cell;
  });
  Layers.draw("markers");
}
