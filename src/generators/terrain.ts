// Live terrain edits on the stable graph: heights change in place and what derives from them follows
import Alea from "alea";
import { DrawnRivers } from "@/generators/drawn-rivers";
import type { TypedArray } from "@/types/PackedGraph";
import { minmax } from "@/utils";

const LAND = 20;

export interface TerrainEdit {
  changed: number[]; // cells whose height changed
  coastChanged: boolean; // some cell crossed sea level
  anchored: number; // cells kept above water because something stands on them
  riversChanged: boolean; // a river was shortened or removed because its land sank
}

/** land that must stay land: burgs, and the centers states, provinces, cultures and religions grow from */
function getAnchoredCells(): Set<number> {
  const anchored = new Set<number>();
  for (const burg of pack.burgs) if (burg?.i && !burg.removed) anchored.add(burg.cell);
  for (const collection of [pack.states, pack.provinces, pack.cultures, pack.religions]) {
    for (const entity of collection as { i?: number; removed?: boolean; center?: number }[]) {
      if (entity?.i && !entity.removed && entity.center !== undefined) anchored.add(entity.center);
    }
  }
  return anchored;
}

/** set the height of cells and bring the derived data up to date */
function setHeights(heights: ReadonlyMap<number, number>): TerrainEdit {
  const { cells } = pack;
  const anchoredCells = getAnchoredCells();
  const edit: TerrainEdit = { changed: [], coastChanged: false, anchored: 0, riversChanged: false };

  for (const [cell, value] of heights) {
    let height = minmax(Math.round(value), 0, 100);
    if (height < LAND && anchoredCells.has(cell)) {
      if (cells.h[cell] >= LAND) edit.anchored++;
      height = Math.max(height, LAND);
    }
    if (height === cells.h[cell]) continue;

    if (height >= LAND !== cells.h[cell] >= LAND) edit.coastChanged = true;
    cells.h[cell] = height;
    grid.cells.h[cells.g[cell]] = height;
    edit.changed.push(cell);
  }

  if (!edit.changed.length) return edit;
  if (edit.coastChanged) remarkup();
  Temperature.generate();
  Precipitation.generate();
  if (edit.coastChanged) {
    clearDrownedCells(edit.changed);
    edit.riversChanged = DrawnRivers.trimDrowned();
  }
  defineBiomes(edit.changed);
  updateRelief(edit.changed);
  return edit;
}

/**
 * After undo put heights and cell data back: the grid copy, features and climate follow, and the relief icons of
 * the cells the step had changed
 */
function resync(changed: readonly number[] = []): void {
  const { cells } = pack;
  for (const cell of cells.i) grid.cells.h[cells.g[cell]] = cells.h[cell];
  remarkup();
  Temperature.generate();
  Precipitation.generate();
  updateRelief(changed);
}

/** relief icons follow the edited cells; a map whose relief was never generated gets it when the layer is drawn */
function updateRelief(changed: readonly number[]): void {
  if (pack.relief?.length && changed.length) Relief.regenerateCells(changed);
}

/** rebuild islands, lakes and oceans, keeping the names and notes of the ones still there */
function remarkup(): void {
  const previousFeatureIds = pack.cells.f;
  const captured = Features.captureUserData();

  Features.markupGrid();
  Features.markupPack();
  Features.defineGroups();
  Features.restoreUserData(captured);
  nameNewFeatures();

  remapFeatureReferences(previousFeatureIds);
}

/** each new feature rolls its name from its own seed: a shared one would give every stroke the same first name */
function nameNewFeatures(): void {
  const random = Math.random;
  for (const feature of pack.features) {
    if (!feature || feature.name) continue;
    Math.random = Alea(`${options.map.seed}-${feature.firstCell}`);
    feature.name = Features.getName(feature);
  }
  Math.random = random;
}

/** entities refer to features by id, and a markup renumbers them: follow each old feature to where most of it is now */
function remapFeatureReferences(previousFeatureIds: TypedArray): void {
  const { cells } = pack;
  const votes = new Map<number, Map<number, number>>();
  for (let cell = 0; cell < previousFeatureIds.length; cell++) {
    const before = previousFeatureIds[cell];
    const now = cells.f[cell];
    if (!before || !now) continue;
    const counts = votes.get(before) ?? new Map<number, number>();
    counts.set(now, (counts.get(now) ?? 0) + 1);
    votes.set(before, counts);
  }

  const remap = (featureId: number): number | undefined => {
    const counts = votes.get(featureId);
    if (!counts) return undefined;
    return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  };

  for (const burg of pack.burgs) {
    if (!burg?.i || burg.removed) continue;
    burg.feature = cells.f[burg.cell];
    if (!burg.port) continue;
    const isCoastal = cells.t[burg.cell] === 1;
    burg.port = isCoastal ? cells.f[cells.haven[burg.cell]] : (remap(burg.port) ?? 0); // a coast port trades by its own shore
  }

  for (const route of pack.routes) {
    if (route.feature) route.feature = remap(route.feature) ?? route.feature;
  }
}

/** water holds no state, culture, religion or population */
function clearDrownedCells(changed: readonly number[]): void {
  const { cells } = pack;
  let politicalChange = false;
  for (const cell of changed) {
    if (cells.h[cell] >= LAND) continue;
    if (cells.state[cell] || cells.province[cell]) politicalChange = true;
    cells.state[cell] = 0;
    cells.province[cell] = 0;
    cells.culture[cell] = 0;
    cells.religion[cell] = 0;
    cells.pop[cell] = 0;
    cells.s[cell] = 0;
  }
  if (politicalChange) States.collectStatistics();
}

/** new biomes for the edited cells only: what the user painted elsewhere stays */
function defineBiomes(changed: readonly number[]): void {
  const previous = pack.cells.biome;
  Biomes.define();
  const edited = new Set(changed);
  const biomes = pack.cells.biome;
  for (let cell = 0; cell < biomes.length; cell++) {
    if (!edited.has(cell)) biomes[cell] = previous[cell];
  }
}

export const Terrain = { setHeights, resync, LAND };
