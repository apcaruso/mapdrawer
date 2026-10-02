// Global undo and redo. An action declares the parts of the world it changes; the history keeps what they were and
// what they became, and only puts a step back while the map still matches it
import { refreshEditors } from "@/components/dialog/dialog-helpers";
import { type LayerId, Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";

const CELL_KEYS = [
  "h",
  "biome",
  "state",
  "province",
  "culture",
  "religion",
  "burg",
  "pop",
  "s",
  "r",
  "fl",
  "conf"
] as const;
// collections in the shape the .map file stores them, so JSON is a faithful copy
const JSON_KEYS = [
  "states",
  "provinces",
  "cultures",
  "religions",
  "burgs",
  "routes",
  "rivers",
  "markers",
  "zones",
  "addedLabels",
  "relief",
  "cells.routes"
] as const;

type CellKey = (typeof CELL_KEYS)[number];
type JsonKey = (typeof JSON_KEYS)[number];
export type HistoryDomain = `cells.${CellKey}` | JsonKey;

export interface HistoryAction {
  label: string;
  domains: readonly HistoryDomain[];
  layers: readonly LayerId[]; // redrawn after the step is undone or redone
  after?: () => void; // rebuilds what derives from the restored data, before the redraw
  merge?: string; // steps in a row with the same key are one, e.g. the picks made in one color picker
}

interface CellDiff {
  key: CellKey;
  indices: number[];
  before: number[];
  after: number[];
}

interface JsonDiff {
  key: JsonKey;
  before: string;
  after: string;
}

interface Entry {
  label: string;
  layers: readonly LayerId[];
  after?: () => void;
  merge?: string;
  cells: CellDiff[];
  json: JsonDiff[];
  bytes: number;
}

const MAX_ENTRIES = 100;
const OUTSIDE_LABEL = "Edits made in a dialog";
const MAX_BYTES = 64 * 1024 * 1024;

let past: Entry[] = [];
let future: Entry[] = [];
const listeners = new Set<() => void>();

const isJsonKey = (domain: HistoryDomain): domain is JsonKey => (JSON_KEYS as readonly string[]).includes(domain);
const cellKey = (domain: HistoryDomain) => domain.slice("cells.".length) as CellKey;
const cellArray = (key: CellKey) => pack.cells[key] as ArrayLike<number> & { [index: number]: number };

function readJson(key: JsonKey): string {
  return JSON.stringify(key === "cells.routes" ? pack.cells.routes : pack[key]);
}

function writeJson(key: JsonKey, value: string): void {
  if (key === "cells.routes") pack.cells.routes = JSON.parse(value);
  else (pack as unknown as Record<string, unknown>)[key] = JSON.parse(value);
}

/** Run an action and remember what it changed, so it can be undone */
function record<T>({ label, domains, layers, after, merge }: HistoryAction, action: () => T): T {
  const cellsBefore = domains
    .filter(domain => !isJsonKey(domain) && pack.cells[cellKey(domain)])
    .map(domain => {
      const key = cellKey(domain);
      return { key, values: Array.from(cellArray(key)) };
    });
  const jsonBefore = domains.filter(isJsonKey).map(key => ({ key, value: readJson(key) }));

  const result = action();

  const entry: Entry = { label, layers, after, merge, cells: [], json: [], bytes: 0 };
  for (const { key, values } of cellsBefore) {
    const current = cellArray(key);
    if (current.length !== values.length) {
      clear(); // the graph was rebuilt: no earlier step fits it any more
      return result;
    }

    const diff: CellDiff = { key, indices: [], before: [], after: [] };
    for (let i = 0; i < values.length; i++) {
      if (current[i] === values[i]) continue;
      diff.indices.push(i);
      diff.before.push(values[i]);
      diff.after.push(current[i]);
    }
    if (diff.indices.length) entry.cells.push(diff);
  }
  for (const { key, value } of jsonBefore) {
    const after = readJson(key);
    if (after !== value) entry.json.push({ key, before: value, after });
  }

  if (!entry.cells.length && !entry.json.length) return result;
  if (mergeInto(past.at(-1), entry)) {
    emit();
    return result;
  }
  entry.bytes =
    entry.cells.reduce((sum, diff) => sum + diff.indices.length * 24, 0) +
    entry.json.reduce((sum, diff) => sum + (diff.before.length + diff.after.length) * 2, 0);

  past.push(entry);
  future = [];
  trim();
  emit();
  return result;
}

/** fold a step into the previous one with the same merge key: it keeps its start and takes the new end */
function mergeInto(previous: Entry | undefined, entry: Entry): boolean {
  if (!entry.merge || previous?.merge !== entry.merge || entry.cells.length || previous.cells.length) return false;
  for (const diff of entry.json) {
    const same = previous.json.find(other => other.key === diff.key);
    if (same) same.after = diff.after;
    else previous.json.push(diff);
  }
  previous.bytes = previous.json.reduce((sum, diff) => sum + (diff.before.length + diff.after.length) * 2, 0);
  return true;
}

function trim(): void {
  let bytes = past.reduce((sum, entry) => sum + entry.bytes, 0);
  while (past.length > MAX_ENTRIES || (bytes > MAX_BYTES && past.length > 1)) bytes -= past.shift()!.bytes;
}

// the editors recount these whenever they open: not edits, so they never set a step apart from the map
const STATISTICS = new Set(["area", "cells", "burgs", "rural", "urban"]);
const COUNTED: readonly JsonKey[] = ["states", "provinces", "cultures", "religions"];

function sameData(key: JsonKey, a: string, b: string): boolean {
  if (a === b) return true;
  if (!COUNTED.includes(key)) return false;
  const strip = (json: string) =>
    JSON.stringify(JSON.parse(json), (field, value) => (STATISTICS.has(field) ? undefined : value));
  return strip(a) === strip(b);
}

/** does the map still look the way this side of the step left it */
function matches(entry: Entry, side: "before" | "after"): boolean {
  const cellsMatch = entry.cells.every(diff => {
    const current = cellArray(diff.key);
    return diff.indices.every((cell, index) => current[cell] === diff[side][index]);
  });
  return cellsMatch && entry.json.every(diff => sameData(diff.key, readJson(diff.key), diff[side]));
}

/** what changed after the step outside the history, e.g. in an editor dialog, as a step of its own */
function captureOutside(entry: Entry): Entry {
  const outside: Entry = {
    label: OUTSIDE_LABEL,
    layers: entry.layers,
    after: entry.after,
    cells: [],
    json: [],
    bytes: 0
  };
  for (const diff of entry.cells) {
    const current = cellArray(diff.key);
    const changed: CellDiff = { key: diff.key, indices: [], before: [], after: [] };
    diff.indices.forEach((cell, index) => {
      if (current[cell] === diff.after[index]) return;
      changed.indices.push(cell);
      changed.before.push(diff.after[index]);
      changed.after.push(current[cell]);
    });
    if (changed.indices.length) outside.cells.push(changed);
  }
  for (const diff of entry.json) {
    const current = readJson(diff.key);
    if (!sameData(diff.key, current, diff.after))
      outside.json.push({ key: diff.key, before: diff.after, after: current });
  }
  return outside;
}

function restore(entry: Entry, side: "before" | "after"): void {
  for (const diff of entry.cells) {
    const current = cellArray(diff.key);
    diff.indices.forEach((cell, index) => {
      current[cell] = diff[side][index];
    });
  }
  for (const diff of entry.json) writeJson(diff.key, diff[side]);

  if (entry.json.some(diff => diff.key === "routes" || diff.key === "cells.routes")) Routes.sync();
  entry.after?.();
  Layers.draw(...entry.layers);
  refreshEditors();
}

/** undo the latest change: one made outside the history since the last step comes first */
function undo(): void {
  const entry = past.at(-1);
  if (!entry) return void tip("Nothing to undo", false, "warn", 2000);

  if (matches(entry, "after")) {
    restore(entry, "before");
    future.push(past.pop()!);
  } else {
    const outside = captureOutside(entry);
    restore(outside, "before");
    future.push(outside);
  }
  tip(`Undone: ${future.at(-1)!.label}`, false, "info", 2000);
  emit();
}

function redo(): void {
  const entry = future.at(-1);
  if (!entry) return void tip("Nothing to redo", false, "warn", 2000);
  if (!matches(entry, "before")) {
    future = []; // the map changed since the undo: as with a new step, there is nothing to redo
    emit();
    return void tip("Nothing to redo: the map changed since the undo", false, "warn", 3000);
  }

  restore(entry, "after");
  past.push(future.pop()!);
  tip(`Redone: ${entry.label}`, false, "info", 2000);
  emit();
}

function clear(): void {
  past = [];
  future = [];
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** call back whenever what can be undone or redone changes; returns the unsubscribe */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const peek = () => ({ undo: past.at(-1)?.label, redo: future.at(-1)?.label });

globalThis.addEventListener?.("map:generated", clear); // a new or loaded world: nothing before it applies

export const UndoHistory = { record, undo, redo, clear, subscribe, peek };
