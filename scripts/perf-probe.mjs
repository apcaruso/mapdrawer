#!/usr/bin/env node

/**
 * Performance probe: boots the app in headless Chromium and reports what the user waits for.
 *
 *   node scripts/perf-probe.mjs                 start a Vite dev server, measure, stop it
 *   node scripts/perf-probe.mjs --url <url>     measure an app that is already running
 *   node scripts/perf-probe.mjs --out file.json also write the report to a file
 *   node scripts/perf-probe.mjs --gpu           rasterize on the GPU, as a desktop Chrome does: headless
 *                                               software raster exaggerates painting costs many times over
 *
 * CHROMIUM_PATH points at a browser binary when Playwright's managed one is missing or mismatched; --gpu needs a
 * full Chrome (Chrome for Testing), not the headless shell.
 * Moving the map is reported in ms per view update (gesture time / steps): frames per second mislead, since a
 * busy page shows many frames in which nothing moved.
 */

import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createServer } from "vite";

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const LAYERS = ["burgIcons", "labels", "routes", "states", "borders", "rivers", "ocean", "landmass", "coastline"];

let server = null;
let url = option("--url");
if (!url) {
  server = await createServer({ server: { port: 0 }, logLevel: "error" });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const executablePath = process.env.CHROMIUM_PATH || undefined;
const gpuArgs = ["--headless=new", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--enable-gpu"];
const browser = await chromium.launch({ executablePath, args: args.includes("--gpu") ? gpuArgs : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => message.type() === "error" && errors.push(message.text()));
await page.addInitScript(() => window.addEventListener("map:generated", () => (window.__mapsGenerated = (window.__mapsGenerated || 0) + 1)));

const report = { url, date: new Date().toISOString() };

const loadStart = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__mapsGenerated > 0, null, { timeout: 120000 });
report.firstMapMs = Date.now() - loadStart;
await page.waitForTimeout(1000);

/** generate one map through the given global, then time a full draw and the single-layer redraws */
const measureMap = (generator, layers) =>
  page.evaluate(
    async ({ generator, layers }) => {
      const count = window.__mapsGenerated;
      const start = performance.now();
      window[generator]();
      while (window.__mapsGenerated === count) await new Promise(resolve => setTimeout(resolve, 20));
      const generateMs = Math.round(performance.now() - start);

      const drawStart = performance.now();
      Layers.drawAll();
      const drawAllMs = Math.round(performance.now() - drawStart);

      const layerMs = {};
      for (const id of layers) {
        const layerStart = performance.now();
        Layers.draw(id);
        layerMs[id] = Math.round((performance.now() - layerStart) * 10) / 10;
      }

      return {
        generateMs,
        drawAllMs,
        layerMs,
        gridCells: grid.cells.i.length,
        packCells: pack.cells.i.length,
        landCells: Array.from(pack.cells.h).filter(h => h >= 20).length,
        burgs: pack.burgs.filter(burg => burg.i && !burg.removed).length,
        svgNodes: document.getElementById("map").querySelectorAll("*").length
      };
    },
    { generator, layers }
  );

report.random = await measureMap("regenerateMap", LAYERS);
report.moving = await measureMoving();
if (await page.evaluate(() => typeof window.newBlankMap === "function")) {
  report.blank = await measureMap("newBlankMap", LAYERS);
}
report.errors = errors;

/** ms per view update and long tasks while panning at full view, zooming in, panning zoomed in and zooming out */
async function measureMoving() {
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver(list => list.getEntries().forEach(e => window.__long.push(e.duration))).observe({
      entryTypes: ["longtask"]
    });
  });
  const gesture = async (steps, step) => {
    await page.evaluate(() => (window.__long = []));
    const start = Date.now();
    for (let i = 0; i < steps; i++) await step(i);
    const msPerUpdate = Math.round((Date.now() - start) / steps);
    await page.waitForTimeout(300);
    return { msPerUpdate, longTasks: await page.evaluate(() => window.__long.length) };
  };
  const drag = (x, y, dx, dy) => async i => {
    if (i === 0) {
      await page.mouse.move(x, y);
      await page.mouse.down();
    }
    await page.mouse.move(x + i * dx, y + i * dy);
    if (i === 59) await page.mouse.up();
  };
  const wheel = delta => async () => {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(16);
  };

  const result = {};
  result.pan = await gesture(60, drag(900, 450, -8, -3));
  await page.mouse.move(720, 450);
  result.zoomIn = await gesture(12, wheel(-120));
  result.panZoomed = await gesture(60, drag(700, 450, 6, 2));
  result.zoomOut = await gesture(12, wheel(120));
  return result;
}

await browser.close();
await server?.close();

const json = JSON.stringify(report, null, 2);
console.log(json);
const out = option("--out");
if (out) writeFileSync(out, `${json}\n`);
