// Browser-mode test (vitest.browser.config.ts): the coordinates renderer takes its base label
// size from the store, not the retired data-size attribute.
import { beforeEach, expect, test } from "vitest";
import "@/components/options-model"; // declares the options global the renderer reads
import "@/generators/styles";
import { setViewportTransform } from "@/components/viewport";
import { drawCoordinates } from "./draw-coordinates";

beforeEach(() => {
  document.body.innerHTML = `<svg id="map" width="800" height="600">
      <g id="viewbox"><g id="coordinates"></g></g>
    </svg>`;
  setViewportTransform(4, 0, 0);
  options.map.graph = { width: 800, height: 600, points: 10000 };
  options.map.geography.coordinates = { lonT: 100, lonW: -50, lonE: 50, latN: 40, latS: -40, latT: 80 };
});

test("drawCoordinates sizes labels from the store, ignoring data-size", () => {
  styles.coordinates.options.fontSize = 20;
  document.getElementById("coordinates")!.setAttribute("data-size", "99");

  drawCoordinates();

  const rendered = Number(document.getElementById("coordinates")!.getAttribute("font-size"));
  expect(rendered).toBeCloseTo(20 / 4 ** 0.8, 2);
});

test("a pan at the same zoom moves the label rows and keeps the grid", () => {
  drawCoordinates();
  const grid = document.querySelector("#coordinateGrid path");
  const latitudeRow = document.getElementById("latitudeLabels")!.getAttribute("transform");

  setViewportTransform(4, -200, -100);
  document.getElementById("viewbox")!.setAttribute("transform", "translate(-200 -100) scale(4)");
  drawCoordinates();

  expect(document.querySelector("#coordinateGrid path")).toBe(grid); // not rebuilt
  expect(document.getElementById("latitudeLabels")!.getAttribute("transform")).not.toBe(latitudeRow);
});
