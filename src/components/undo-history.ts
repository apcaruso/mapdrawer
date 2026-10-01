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
  cells: CellDiff[];
  json: JsonDiff[];
  bytes: number;
}

const MAX_ENTRIES = 100;
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
function record<T>({ label, domains, layers, after }: HistoryAction, action: () => T): T {
  const cellsBefore = domains
    .filter(domain => !isJsonKey(domain) && pack.cells[cellKey(domain)])
    .map(domain => {
      const key = cellKey(domain);
      return { key, values: Array.from(cellArray(key)) };
    });
  const jsonBefore = domains.filter(isJsonKey).map(key => ({ key, value: readJson(key) }));

  const result = action();

  const entry: Entry = { label, layers, after, cells: [], json: [], bytes: 0 };
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
  entry.bytes =
    entry.cells.reduce((sum, diff) => sum + diff.indices.length * 24, 0) +
    entry.json.reduce((sum, diff) => sum + (diff.before.length + diff.after.length) * 2, 0);

  past.push(entry);
  future = [];
  trim();
  emit();
  return result;
}

function trim(): void {
  let bytes = past.reduce((sum, entry) => sum + entry.bytes, 0);
  while (past.length > MAX_ENTRIES || (bytes > MAX_BYTES && past.length > 1)) bytes -= past.shift()!.bytes;
}

/** does the map still look the way this side of the step left it */
function matches(entry: Entry, side: "before" | "after"): boolean {
  const cellsMatch = entry.cells.every(diff => {
    const current = cellArray(diff.key);
    return diff.indices.every((cell, index) => current[cell] === diff[side][index]);
  });
  return cellsMatch && entry.json.every(diff => readJson(diff.key) === diff[side]);
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

function undo(): void {
  const entry = past.at(-1);
  if (!entry) return void tip("Nothing to undo", false, "warn", 2000);
  if (!matches(entry, "after")) return void conflict();

  restore(entry, "before");
  future.push(past.pop()!);
  tip(`Undone: ${entry.label}`, false, "info", 2000);
  emit();
}

function redo(): void {
  const entry = future.at(-1);
  if (!entry) return void tip("Nothing to redo", false, "warn", 2000);
  if (!matches(entry, "before")) return void conflict();

  restore(entry, "after");
  past.push(future.pop()!);
  tip(`Redone: ${entry.label}`, false, "info", 2000);
  emit();
}

function conflict(): void {
  clear();
  tip("The map was changed outside the undo history, so earlier steps can no longer be undone", false, "error", 5000);
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

window.addEventListener("map:generated", clear); // a new or loaded world: nothing before it applies

export const UndoHistory = { record, undo, redo, clear, subscribe, peek };
