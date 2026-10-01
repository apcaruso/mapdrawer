// A freehand stroke over the map: a path follows the pointer and the tool gets it when the pointer is released
import { type D3DragEvent, drag, select } from "d3";
import { applyDefaultViewboxEvents } from "@/components/viewbox-events";
import type { Point } from "@/types/global";
import { ensureEl } from "@/utils";

interface MapFreehandOptions {
  closed?: boolean; // preview the path as a closed shape
  stroke?: string;
  fill?: string;
  onEnd: (points: Point[], event: MouseEvent | undefined) => void;
}

const PATH_ID = "freehandStroke";

export class MapFreehand {
  private events: AbortController | null = null;
  private space = false; // space + drag pans the map instead of drawing

  constructor(private readonly options: MapFreehandOptions) {}

  attach(): void {
    this.events = new AbortController();
    const { signal } = this.events;
    const trackSpace = (event: KeyboardEvent) => {
      if (event.code === "Space") this.space = event.type === "keydown";
    };
    document.addEventListener("keydown", trackSpace, { signal });
    document.addEventListener("keyup", trackSpace, { signal });
    window.addEventListener("blur", () => (this.space = false), { signal });

    const viewbox = ensureEl<SVGGElement>("viewbox");
    select<SVGGElement, unknown>("#viewbox")
      .style("cursor", "crosshair")
      .on("click", null)
      .call(
        drag<SVGGElement, unknown>()
          .container(() => viewbox)
          .filter(event => !this.space && !event.button)
          .on("start", (event: D3DragEvent<SVGGElement, unknown, unknown>) => this.start(event))
      );
  }

  detach(): void {
    this.events?.abort();
    this.events = null;
    this.space = false;
    document.getElementById(PATH_ID)?.remove();
    applyDefaultViewboxEvents();
  }

  private start(event: D3DragEvent<SVGGElement, unknown, unknown>): void {
    const { closed, stroke = "#222", fill = "none", onEnd } = this.options;
    const points: Point[] = [[event.x, event.y]];
    const path = select("#debug")
      .append("path")
      .attr("id", PATH_ID)
      .attr("fill", closed ? fill : "none")
      .attr("stroke", stroke)
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", closed ? "4 3" : null)
      .attr("stroke-linecap", "round")
      .attr("vector-effect", "non-scaling-stroke");

    event
      .on("drag", ({ x, y }: D3DragEvent<SVGGElement, unknown, unknown>) => {
        points.push([x, y]);
        path.attr("d", `M${points.join("L")}${closed ? "Z" : ""}`);
      })
      .on("end", (endEvent: D3DragEvent<SVGGElement, unknown, unknown>) => {
        path.remove();
        onEnd(points, endEvent.sourceEvent as MouseEvent | undefined);
      });
  }
}
