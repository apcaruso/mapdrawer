import { Layers } from "@/components/layers";
import type { ReliefIcon } from "@/generators/relief-generator";
import { Scene, ViewportLayers, type ViewportRenderContext } from "@/renderers/viewport/viewport-renderer";

interface ReliefSceneIcon {
  id: string;
  data: ReliefIcon;
}

const scene = new Scene<ReliefSceneIcon>();
const layer = ViewportLayers.register({ id: "relief", render: reconcileRelief });
let frameId: number | null = null;

// On screen the icons in view are one SVG image: thousands of symbol instances, each its own transform and clip,
// made every repaint of the page slow, a mouse move included. The relief editor and exports get the icons as elements
let isEditing = false;
let imageUrl: string | null = null;

/** individual icon elements while the relief editor works on them, one image otherwise */
export function setReliefEditing(editing: boolean): void {
  if (isEditing === editing) return;
  isEditing = editing;
  layer.render();
}

export const drawRelief = (): void => {
  TIME && console.time("drawRelief");
  if (!pack.relief?.length) Relief.generate();
  scene.replace(pack.relief.map((data, i) => ({ id: String(i), data })));
  layer.render();
  TIME && console.timeEnd("drawRelief");
};

export const redrawRelief = (): void => {
  if (frameId !== null) return;
  frameId = requestAnimationFrame(() => {
    frameId = null;
    Layers.draw("relief");
  });
};

export const getSceneReliefIcon = (id: string): ReliefIcon | undefined => scene.get(id)?.data;

/** the icon drawn on top at a map point: as one image, the icons cannot be clicked themselves */
export function findReliefIconAt(x: number, y: number): string | undefined {
  if (isEditing || !scene.valid || !Layers.isOn("relief")) return undefined;
  let found: string | undefined;
  for (const { id, data } of scene.values()) {
    if (x >= data.x && x <= data.x + data.s && y >= data.y && y <= data.y + data.s) found = id; // later is on top
  }
  return found;
}

export function removeRelief(): void {
  scene.invalidate();
  document.querySelector("#terrain")?.replaceChildren();
  releaseImage();
}

function reconcileRelief(context: ViewportRenderContext): void {
  const terrain = context.root.querySelector("#terrain");
  if (!terrain) return;
  if (!scene.valid || !Layers.isOn("relief")) {
    if (context.root === document) releaseImage();
    return void terrain.replaceChildren();
  }

  const { x0, y0, x1, y1 } = context.bounds;
  const markup: string[] = [];
  const icons = new Set<string>();

  for (const { id, data } of scene.values()) {
    const { icon, x, y, s } = data;
    if (x > x1 || y > y1 || x + s < x0 || y + s < y0) continue;
    markup.push(`<use href="#${icon}" data-id="${id}" x="${x}" y="${y}" width="${s}" height="${s}"/>`);
    icons.add(icon);
  }

  if (isEditing || context.root !== document) {
    if (context.root === document) releaseImage();
    terrain.innerHTML = markup.join("");
    return;
  }
  showAsImage(terrain, markup, icons, context.bounds);
}

function showAsImage(
  terrain: Element,
  markup: string[],
  icons: Set<string>,
  bounds: ViewportRenderContext["bounds"]
): void {
  const { width, height } = options.map.graph;
  const x = Math.max(bounds.x0, 0);
  const y = Math.max(bounds.y0, 0);
  const w = Math.min(bounds.x1, width) - x;
  const h = Math.min(bounds.y1, height) - y;
  if (w <= 0 || h <= 0 || !markup.length) {
    releaseImage();
    return void terrain.replaceChildren();
  }

  const symbols = [...icons].map(icon => document.getElementById(icon)?.outerHTML ?? "").join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"><defs>${symbols}</defs>${markup.join("")}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));

  const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
  // clicks go to the rivers and lakes beneath; an icon is found by findReliefIconAt
  for (const [name, value] of Object.entries({ href: url, x, y, width: w, height: h, "pointer-events": "none" }))
    image.setAttribute(name, String(value));
  // the previous image stays until the new one is decoded, so the icons never blink
  const previous = [...terrain.children];
  const previousUrl = imageUrl;
  imageUrl = url;
  image.addEventListener(
    "load",
    () => {
      for (const element of previous) element.remove();
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    },
    { once: true }
  );
  terrain.append(image);
}

function releaseImage(): void {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
}
