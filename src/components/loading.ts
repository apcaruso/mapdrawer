// The splash overlay shown while a map is being generated
import { select } from "d3";

const fade = (id: string, opacity: number, duration: number) =>
  select(`#${id}`).transition().duration(duration).style("opacity", String(opacity));

export function showLoading(): void {
  fade("loading", 1, 200);
  for (const id of ["optionsContainer", "toolPalette", "toolOptions"]) fade(id, 0, 100);
  fade("tooltip", 0, 200);
}

export function hideLoading(): void {
  fade("loading", 0, 3000);
  for (const id of ["optionsContainer", "toolPalette", "toolOptions"]) fade(id, 1, 2000);
  fade("tooltip", 1, 3000);
}
