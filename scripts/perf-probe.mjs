#!/usr/bin/env node

/**
 * Performance probe: boots the app in headless Chromium and reports what the user waits for.
 *
 *   node scripts/perf-probe.mjs                 start a Vite dev server, measure, stop it
 *   node scripts/perf-probe.mjs --url <url>     measure an app that is already running
 *   node scripts/perf-probe.mjs --out file.json also write the report to a file
 *
 * CHROMIUM_PATH points at a browser binary when Playwright's managed one is missing or mismatched.
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
const browser = await chromium.launch({ executablePath });
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
if (await page.evaluate(() => typeof window.newBlankMap === "function")) {
  report.blank = await measureMap("newBlankMap", LAYERS);
}
report.errors = errors;

await browser.close();
await server?.close();

const json = JSON.stringify(report, null, 2);
console.log(json);
const out = option("--out");
if (out) writeFileSync(out, `${json}\n`);
