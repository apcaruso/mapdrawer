import type { getIsolines } from "@/utils";

type Isolines = ReturnType<typeof getIsolines>;

/** One fill path per isoline, plus a stroked path where the area borders water, over the shores of all areas */
export function buildFillPaths(name: string, isolines: Isolines, getColor: (index: number) => string): string {
  const areas = Object.entries(isolines).map(([index, isoline]) => ({ index, color: getColor(+index), ...isoline }));
  const shores = areas.map(({ index, color, shore }) =>
    shore ? /* html */ `<path d="${shore}" fill="${color}" id="${name}-shore${index}" />` : ""
  );
  const fills = areas.map(({ index, color, fill, waterGap }) => {
    let paths = "";
    if (fill) paths += /* html */ `<path d="${fill}" fill="${color}" id="${name}${index}" />`;
    if (waterGap)
      paths += /* html */ `<path d="${waterGap}" fill="none" stroke="${color}" stroke-width="3" id="${name}-gap${index}" />`;
    return paths;
  });
  return shores.join("") + fills.join("");
}

/** Recolor in place an area drawn by buildFillPaths */
export function recolorFillPaths(container: Element | null, name: string, index: number, color: string): void {
  container?.querySelector(`#${name}${index}`)?.setAttribute("fill", color);
  container?.querySelector(`#${name}-shore${index}`)?.setAttribute("fill", color);
  container?.querySelector(`#${name}-gap${index}`)?.setAttribute("stroke", color);
}

/** Remove an area drawn by buildFillPaths */
export function removeFillPaths(container: Element | null, name: string, index: number): void {
  for (const id of [`${name}${index}`, `${name}-shore${index}`, `${name}-gap${index}`]) {
    container?.querySelector(`#${id}`)?.remove();
  }
}
