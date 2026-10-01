// River tool: drag from the source to the mouth; the river follows the stroke and widens downstream
import { Layers } from "@/components/layers";
import { MapFreehand } from "@/components/map-freehand";
import { hideToolOptions, showToolOptions } from "@/components/tools/tool-options";
import { clearMainTip, tip } from "@/components/tooltips";
import { UndoHistory } from "@/components/undo-history";
import { DrawnRivers } from "@/generators/drawn-rivers";
import type { Point } from "@/types/global";

const settings = { width: 1 };
let freehand: MapFreehand | null = null;

function start(): boolean {
  if (customization) {
    tip("Please exit the active edit mode first", false, "error");
    return false;
  }

  stop();
  Layers.show("rivers");
  const bar = showToolOptions(
    "River",
    `<div data-tip="How wide the river grows toward its mouth"><slider-input id="riverToolWidth" min="0.2" max="3" step="0.1" value="${settings.width}">Width:</slider-input></div>`
  );
  bar.addEventListener("input", event => {
    const target = event.target as HTMLInputElement;
    if (target.id === "riverToolWidth") settings.width = Number(target.value);
  });

  freehand = new MapFreehand({ stroke: "#3d6fb5", onEnd: drawRiver });
  freehand.attach();
  return true;
}

function stop(): void {
  freehand?.detach();
  freehand = null;
  hideToolOptions();
  clearMainTip();
}

function drawRiver(stroke: Point[]): void {
  const course = DrawnRivers.traceCourse(stroke);
  if (!course) {
    tip("Start the river on land and draw it across at least two cells", false, "warn", 3000);
    return;
  }

  UndoHistory.record(
    { label: "Draw river", domains: ["rivers", "cells.r", "cells.fl"], layers: ["rivers", "relief"] },
    () => {
      DrawnRivers.add(course, settings.width);
      if (pack.relief?.length) Relief.regenerateCells(course.cells); // no relief icons stand on a river
    }
  );
  Layers.draw("rivers", "relief");
}

export const RiverTool = { start, stop };
