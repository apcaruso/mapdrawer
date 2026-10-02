import "@/components/shared/fill-box";
import { destroyDialog } from "@/components/dialog/dialog-helpers";
import { MapBrush } from "@/components/map-brush";
import type { FillBoxElement } from "@/components/shared/fill-box";
import { clearMainTip, showMainTip, tip } from "@/components/tooltips";
import { type HistoryAction, UndoHistory } from "@/components/undo-history";
import { Controllers } from "@/controllers";
import {
  openPaintOverlay,
  type PaintOverlayCell,
  removePaintOverlay,
  removePaintOverlayCells,
  updatePaintOverlay
} from "@/renderers/overlays/paint-overlay";
import type { Point } from "@/types/global";
import { ensureEl } from "@/utils";

export interface PaintEditorItem {
  id: number;
  name: string;
  color: string;
}

export interface PaintEditorCreator {
  label: string; // what is created, e.g. "state"
  hint: string; // where to click to create it
  at: (point: Point) => PaintEditorItem | undefined; // creates it, or explains why not and returns nothing
}

export interface PaintEditorRecolor {
  history: Omit<HistoryAction, "label" | "merge">; // what a new color changes, so it can be undone
  apply: (id: number, color: string) => void;
}

export interface PaintEditorAction {
  label: string;
  tip: string;
  run: () => void;
}

interface CommonPaintEditorOptions {
  title: string;
  parentDialogId: string;
  onClose: () => void;
  /** a function when the map can change the list while painting: it is read again after every undo and redo */
  items: readonly PaintEditorItem[] | (() => readonly PaintEditorItem[]);
  dontOverrideControl?: boolean;
  landOnlyControl?: boolean;
  history?: Omit<HistoryAction, "label">; // what the apply changes, so it can be undone
  live?: boolean; // every stroke is applied when it ends, as its own undo step: no Apply or Cancel
  fill?: boolean; // offers the bucket: a click fills the connected area of one value on one landmass
  create?: PaintEditorCreator; // offers a button to create a new item from the map
  rename?: (id: number, name: string) => void; // offers renaming the selected item
  recolor?: PaintEditorRecolor; // the color swatch opens the picker for the selected item
  renameTip?: string;
  actions?: PaintEditorAction[];
}

export interface PaintEditorOptions extends CommonPaintEditorOptions {
  mode?: "single";
  getValue: (cell: number) => number;
  filterCell?: (cell: number, currentValue: number, nextValue: number) => boolean;
  onApply: (changes: ReadonlyMap<number, number>) => void;
}

interface MultiplePaintEditorOptions extends CommonPaintEditorOptions {
  mode: "multiple";
  getValue: (cell: number) => readonly number[];
  filterCell?: (cell: number, currentValues: readonly number[], nextValue: number) => boolean;
  onApply: (changes: ReadonlyMap<number, readonly number[]>) => void;
}

type OpenPaintEditorOptions = PaintEditorOptions | MultiplePaintEditorOptions;
type PaintChanges = Map<number, readonly number[]>;
type PaintHistoryEntry = Map<number, readonly number[] | undefined>;

interface PaintEditorState {
  options: OpenPaintEditorOptions;
  itemsById: Map<number, PaintEditorItem>;
  tool: "brush" | "fill" | "place";
  changes: PaintChanges;
  history: PaintHistoryEntry[];
  selectedId: number | undefined;
  noneId: number | undefined; // the pinned item that means no assignment, such as Neutrals
  finalized: boolean;
  unsubscribe?: () => void;
}

const dialogId = "paintEditor" as const;
const historyLimit = 100;
const customizationMode = 2;
const defaultBrushRadius = 12;
const eraseAllValue = -1;

let state: PaintEditorState | null = null;
let brush: MapBrush | null = null;
const lastSelected = new Map<string, number>(); // per editor title, so reopening paints with the same item
let pickerSession = 0;
globalThis.addEventListener?.("map:generated", () => lastSelected.clear()); // the ids belong to the map

/** returns false when another edit mode is active and the editor cannot open */
function open(options: OpenPaintEditorOptions): boolean {
  if (customization) return false;

  $(`#${options.parentDialogId}`).dialog("close");
  customization = customizationMode;

  brush = new MapBrush({
    id: "paintEditorBrush",
    label: "Brush size:",
    radius: defaultBrushRadius,
    onStart: startPainting,
    stampOnStart: false, // a plain click selects the painted item instead
    stampOnMove: true,
    onClick: handleClick,
    onEnd: () => state?.options.live && applyLive(),
    onMove: showCellTip
  });

  const items = readItems(options);
  state = {
    options,
    itemsById: new Map(items.map(item => [item.id, item])),
    tool: "brush",
    changes: new Map(),
    history: [],
    selectedId: undefined,
    noneId: items[0]?.id <= 0 ? items[0].id : undefined, // pinned by sortItems
    finalized: false
  };

  try {
    renderDialog(options, items);
    renderItems(items);
    openPaintOverlay();
    addListeners();

    $(ensureEl(dialogId)).dialog({
      title: options.title,
      resizable: false,
      position: { my: "right top", at: "right-10 top+10", of: "svg", collision: "fit" },
      close: apply // closing keeps the painting, as switching tools does; Cancel discards it
    });

    if (typeof options.items === "function") state.unsubscribe = UndoHistory.subscribe(syncItems);

    // painting with the "none" item is erasing: start with a real item, or with creating the first one
    selectItem(pickInitialItem(options.title, items));
    if (options.create && !hasRealItems()) setTool("place");
    else tip(getStatus(), true);
  } catch (error) {
    close(options.onClose);
    throw error;
  }
  return true;
}

function readItems({ items }: OpenPaintEditorOptions): PaintEditorItem[] {
  return sortItems(typeof items === "function" ? items() : items);
}

/** the list after the map changed under it, e.g. an undo removed the state being painted */
function syncItems(): void {
  if (!state || state.finalized) return;
  const items = readItems(state.options);
  state.itemsById = new Map(items.map(item => [item.id, item]));
  ensureEl<HTMLSelectElement>("paintEditorSelect").replaceChildren();
  renderItems(items);

  if (!selectItem(state.selectedId)) selectItem(pickInitialItem(state.options.title, items));
  if (state.options.create && !hasRealItems()) setTool("place");
}

function pickInitialItem(title: string, items: readonly PaintEditorItem[]): number | undefined {
  const remembered = lastSelected.get(title);
  if (items.some(item => item.id === remembered)) return remembered;
  return (items.find(item => isRealItem(item.id)) ?? items[0])?.id;
}

/** an item the user made, as opposed to the pinned "none" item */
function isRealItem(id: number | undefined): id is number {
  return id !== undefined && id !== getState().noneId;
}

function hasRealItems(): boolean {
  return [...getState().itemsById.keys()].some(isRealItem);
}

/** what the user can do right now, for the main tip */
function getStatus(): string {
  if (!state) return "";
  const { tool, options } = state;
  const label = options.create?.label;
  if (tool === "place" && label) {
    const first = hasRealItems() ? `New ${label}` : `No ${label} yet`;
    return `${first}: ${options.create?.hint}, or drag to found it and paint its land at once`;
  }
  if (tool === "fill") return "Fill: click to fill the connected area of one color on one landmass";
  const create = label ? `, New ${label} to found another` : "";
  return `Drag to paint, click to pick the item under the pointer${create}. Shift + drag resizes the brush, Space + drag pans`;
}

function sortItems(items: readonly PaintEditorItem[]): PaintEditorItem[] {
  const pinned = items[0]?.id <= 0 ? items.slice(0, 1) : [];
  const sortable = items.slice(pinned.length).sort((a, b) => a.name.localeCompare(b.name));
  return [...pinned, ...sortable];
}

function renderDialog(options: OpenPaintEditorOptions, items: readonly PaintEditorItem[]): void {
  destroyDialog(dialogId);

  const selectedColor = items[0]?.color ?? "#ffffff";

  const dontOverrideControl = options.dontOverrideControl
    ? `<label data-tip="Only paint cells whose current value is 0 (neutral)" style="display: flex; align-items: center"><input id="paintEditorDontOverride" class="checkbox native" type="checkbox">Do not override existing</label>`
    : "";
  const landOnlyControl = options.landOnlyControl
    ? `<label style="display: flex; align-items: center"><input id="paintEditorLandOnly" class="checkbox native" type="checkbox" checked> Change land only</label>`
    : "";
  const createButton = options.create
    ? `<button id="paintEditorCreate" data-tip="New ${options.create.label}: ${options.create.hint}, or drag to found it and paint its land at once"><span class="icon-plus"></span> New ${options.create.label}</button>`
    : "";
  const renameInput = options.rename
    ? `<label style="display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0.4em" data-tip="${options.renameTip ?? "Rename the selected item"}">Name: <input id="paintEditorName" /></label>`
    : "";
  const modeButtons =
    options.fill || options.create
      ? `<div id="paintEditorModes" style="display: flex; gap: 0.4em">
        <button id="paintEditorBrushTool" class="pressed" data-tip="Brush: drag to paint, click to pick the item under the pointer">Brush</button>
        ${options.fill ? `<button id="paintEditorFillTool" data-tip="Fill: click to fill the connected area of one color on one landmass, e.g. a whole island. Alt + click fills with the brush too">Fill</button>` : ""}
        ${createButton}
      </div>`
      : "";
  const actionButtons = (options.actions ?? [])
    .map((action, index) => `<button data-action="${index}" data-tip="${action.tip}">${action.label}</button>`)
    .join("");
  const bottomButtons = options.live
    ? `<button id="paintEditorApply" data-tip="Finish painting. Every stroke is already applied: Ctrl + Z undoes it">Done</button>`
    : `<button id="paintEditorUndo" aria-label="Undo" data-tip="Undo last brush stroke" class="icon-ccw" disabled></button>
      <button id="paintEditorApply" aria-label="Apply" data-tip="Apply painted changes" class="icon-check"></button>
      <button id="paintEditorCancel" aria-label="Cancel" data-tip="Cancel painted changes" class="icon-cancel"></button>`;
  const html = /* html */ `<div id="${dialogId}" class="dialog" style="display: flex; flex-direction: column; gap: 0.6em">
    <div style="display: grid; gap: 0.5em;">
      <label style="display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.4em">Paint: <select id="paintEditorSelect"></select>${
        options.recolor
          ? `<fill-box id="paintEditorFill" fill="${selectedColor}" size="1.4em" data-tip="Click to change the color of the selected item"></fill-box>`
          : `<fill-box id="paintEditorFill" fill="${selectedColor}" size="1.4em" data-tip="Selected paint color" disabled></fill-box>`
      }</label>
      ${renameInput}
      ${modeButtons}
      ${brush?.markup ?? ""}
    </div>
    <div id="paintEditorControls" style="display: flex; flex-direction: column; align-items: center; gap: 0.4em;">${dontOverrideControl}${landOnlyControl}</div>
    ${actionButtons ? `<div id="paintEditorActions" style="display: flex; flex-wrap: wrap; gap: 0.4em">${actionButtons}</div>` : ""}
    <div style="display: flex; gap: 0.4em;">${bottomButtons}</div>
  </div>`;

  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);
}

function renderItems(items: readonly PaintEditorItem[]): void {
  for (const item of items) addOption(item);
}

function addOption(item: PaintEditorItem): void {
  const option = document.createElement("option");
  option.value = String(item.id);
  option.textContent = item.name;
  ensureEl<HTMLSelectElement>("paintEditorSelect").appendChild(option);
}

function updatePreview(cells: readonly number[]): void {
  const { changes, itemsById } = getState();
  const updates: PaintOverlayCell[] = [];
  const revertedCells: number[] = [];

  for (const cell of cells) {
    const values = changes.get(cell);
    if (values === undefined) revertedCells.push(cell);
    else updates.push({ cell, values: values.map(id => ({ id, color: itemsById.get(id)?.color ?? "#ffffff" })) });
  }

  updatePaintOverlay(pack, updates);
  removePaintOverlayCells(revertedCells);
}

function addListeners(): void {
  ensureEl<HTMLSelectElement>("paintEditorSelect").addEventListener("change", handleItemChange);
  document.getElementById("paintEditorUndo")?.addEventListener("click", undo);
  ensureEl("paintEditorApply").addEventListener("click", apply);
  document.getElementById("paintEditorCancel")?.addEventListener("click", cancel);
  document.getElementById("paintEditorCreate")?.addEventListener("click", () => setTool("place"));
  document.getElementById("paintEditorBrushTool")?.addEventListener("click", () => setTool("brush"));
  document.getElementById("paintEditorFillTool")?.addEventListener("click", () => setTool("fill"));
  document.getElementById("paintEditorName")?.addEventListener("change", renameSelected);
  if (getState().options.recolor) ensureEl("paintEditorFill").addEventListener("click", recolorSelected);
  document.getElementById("paintEditorActions")?.addEventListener("click", event => {
    const index = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (index !== undefined) getState().options.actions?.[Number(index)]?.run();
  });
  brush?.attach();
}

function setTool(tool: PaintEditorState["tool"]): void {
  const activeState = getState();
  activeState.tool = tool;
  document.getElementById("paintEditorBrushTool")?.classList.toggle("pressed", tool === "brush");
  document.getElementById("paintEditorFillTool")?.classList.toggle("pressed", tool === "fill");
  document.getElementById("paintEditorCreate")?.classList.toggle("pressed", tool === "place");
  tip(getStatus(), true);
}

function handleClick(point: Point, event?: MouseEvent): void {
  const { tool } = getState();
  if (tool === "place") placeNewItem(point);
  else if (tool === "fill" || event?.altKey) fillFrom(point);
  else selectPaintedItem(point);
}

/** create an item where the user clicked, add it to the list and paint with it */
function placeNewItem(point: Point): PaintEditorItem | undefined {
  const activeState = getState();
  const item = activeState.options.create?.at(point);
  if (!item) return undefined; // the creator explained why

  if (!activeState.itemsById.has(item.id)) addOption(item); // a list read from the map may have it already
  activeState.itemsById.set(item.id, item);
  selectItem(item.id);
  setTool("brush");
  tip(`${item.name} is founded: drag to paint its land`, true, "success");
  return item;
}

function renameSelected(event: Event): void {
  const activeState = getState();
  const { selectedId, options } = activeState;
  const item = selectedId === undefined ? undefined : activeState.itemsById.get(selectedId);
  const name = (event.currentTarget as HTMLInputElement).value.trim();
  if (!item || !name || !options.rename) return;

  options.rename(item.id, name);
  item.name = name;
  const option = ensureEl<HTMLSelectElement>("paintEditorSelect").querySelector(`option[value="${item.id}"]`);
  if (option) option.textContent = name;
}

/** the picker recolors the selected item; all the picks of one picker are one undo step */
function recolorSelected(): void {
  const { options, selectedId, itemsById } = getState();
  const item = selectedId === undefined ? undefined : itemsById.get(selectedId);
  if (!options.recolor || !item || !isRealItem(item.id)) return;

  const { history, apply } = options.recolor;
  const merge = `recolor-${++pickerSession}`;
  void Controllers.ColorPicker.open(item.color, color => {
    UndoHistory.record({ label: `Recolor ${item.name}`, merge, ...history }, () => apply(item.id, color));
    item.color = color;
    if (state?.selectedId === item.id) ensureEl<FillBoxElement>("paintEditorFill").fill = color;
  });
}

function showSelectedName(item: PaintEditorItem): void {
  const input = document.getElementById("paintEditorName") as HTMLInputElement | null;
  if (input) input.value = item.name;
}

/** the bucket: every connected cell with the clicked cell's value, on the same landmass or water body */
function fillFrom([x, y]: Point): void {
  const activeState = getState();
  const start = Pack.findCell(x, y);
  if (start === undefined || activeState.selectedId === undefined) return;

  const { c: neighbors, f: features } = pack.cells;
  const startValues = getCurrentValues(start);
  const visited = new Uint8Array(neighbors.length);
  const region: number[] = [];
  const queue = [start];
  visited[start] = 1;
  while (queue.length) {
    const cell = queue.pop()!;
    region.push(cell);
    for (const next of neighbors[cell]) {
      if (visited[next] || features[next] !== features[start] || !arraysEqual(getCurrentValues(next), startValues))
        continue;
      visited[next] = 1;
      queue.push(next);
    }
  }

  const historyEntry: PaintHistoryEntry = new Map();
  if (!paintCells(region, activeState.selectedId, historyEntry)) return;
  if (activeState.options.live) applyLive();
  else recordHistory(historyEntry);
}

function handleItemChange(event: Event): void {
  selectItem(+(event.currentTarget as HTMLSelectElement).value);
}

function selectPaintedItem([x, y]: Point): void {
  const cell = Pack.findCell(x, y);
  if (cell === undefined) return;

  const value = getCurrentValues(cell).at(-1);
  if (value !== undefined) selectItem(value);
}

function startPainting(origin: Point, radius: number) {
  const { tool, options, selectedId } = getState();
  if (tool === "fill") return undefined; // the bucket works on a click
  // a stroke that founds its item first: in the New mode, or with nothing to paint but the "none" item
  let founding = Boolean(options.create) && (tool === "place" || (!isRealItem(selectedId) && !hasRealItems()));
  let failed = false;
  const historyEntry: PaintHistoryEntry = new Map();
  let recorded = false;

  return ([x, y]: Point) => {
    if (failed) return;
    if (founding) {
      founding = false;
      failed = !placeNewItem(origin); // only once the pointer moves: a plain click is handled as a click
      if (failed) return;
    }
    const found = radius > 5 ? Pack.findAll(x, y, radius) : [Pack.findCell(x, y)];
    const cells = found.filter((cell): cell is number => cell !== undefined);
    const selectedId = getState().selectedId;
    if (!cells.length || selectedId === undefined || !paintCells(cells, selectedId, historyEntry) || recorded) return;

    recordHistory(historyEntry);
    recorded = true;
  };
}

/** the name of what is under the pointer; over nothing to pick, and while founding, what to do instead */
function showCellTip([x, y]: Point): void {
  const cell = Pack.findCell(x, y);
  const { itemsById, tool } = getState();
  if (cell === undefined || tool === "place") {
    showMainTip();
    return;
  }

  const names = getCurrentValues(cell)
    .filter(isRealItem)
    .map(value => itemsById.get(value)?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length) tip(names.join(", "));
  else showMainTip();
}

function selectItem(id: number | undefined): boolean {
  const activeState = getState();
  const item = id === undefined ? undefined : activeState.itemsById.get(id);
  if (!item) return false;

  activeState.selectedId = item.id;
  lastSelected.set(activeState.options.title, item.id);
  ensureEl<HTMLSelectElement>("paintEditorSelect").value = String(item.id);
  ensureEl<FillBoxElement>("paintEditorFill").fill = item.color;
  showSelectedName(item);
  return true;
}

function getBaseValues(cell: number): readonly number[] {
  const { options } = getState();
  return options.mode === "multiple" ? options.getValue(cell) : [options.getValue(cell)];
}

function getCurrentValues(cell: number): readonly number[] {
  return getState().changes.get(cell) ?? getBaseValues(cell);
}

function paintCells(cells: readonly number[], nextValue: number, historyEntry: PaintHistoryEntry): boolean {
  const { options, changes } = getState();
  const isErase = options.mode === "multiple" && nextValue === eraseAllValue;
  const landOnly = options.landOnlyControl && ensureEl<HTMLInputElement>("paintEditorLandOnly").checked;
  const dontOverride =
    options.dontOverrideControl && ensureEl<HTMLInputElement>("paintEditorDontOverride").checked && !isErase;
  let changed = false;
  const changedCells: number[] = [];

  for (const cell of cells) {
    const currentValues = getCurrentValues(cell);
    if (landOnly && pack.cells.h[cell] < 20) continue;
    if (dontOverride && currentValues.some(value => value !== 0)) continue;

    const nextValues = getNextValues(options, cell, currentValues, nextValue);
    if (!nextValues || arraysEqual(nextValues, currentValues)) continue;

    if (!historyEntry.has(cell)) historyEntry.set(cell, changes.get(cell));
    if (arraysEqual(nextValues, getBaseValues(cell))) changes.delete(cell);
    else changes.set(cell, nextValues);
    changed = true;
    changedCells.push(cell);
  }

  if (changed) updatePreview(changedCells);
  return changed;
}

function getNextValues(
  options: OpenPaintEditorOptions,
  cell: number,
  currentValues: readonly number[],
  nextValue: number
): readonly number[] | null {
  if (options.mode === "multiple") {
    if (options.filterCell && !options.filterCell(cell, currentValues, nextValue)) return null;
    if (nextValue === eraseAllValue) return [];
    return currentValues.includes(nextValue) ? currentValues : [...currentValues, nextValue];
  }

  if (options.filterCell && !options.filterCell(cell, currentValues[0], nextValue)) return null;
  return [nextValue];
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function recordHistory(entry: PaintHistoryEntry): void {
  const activeState = getState();
  if (activeState.options.live) return; // a live stroke is undone by the global history
  activeState.history.push(entry);
  if (activeState.history.length > historyLimit) activeState.history.shift();
  ensureEl<HTMLButtonElement>("paintEditorUndo").disabled = false;
}

/** undo the latest stroke of the open session; false when there is none */
function undoStroke(): boolean {
  if (!state || state.finalized || !state.history.length) return false;
  undo();
  return true;
}

function undo(): void {
  const activeState = getState();
  const entry = activeState.history.pop();
  if (!entry) return;

  for (const [cell, values] of entry) {
    if (values === undefined) activeState.changes.delete(cell);
    else activeState.changes.set(cell, values);
  }
  updatePreview([...entry.keys()]);
  ensureEl<HTMLButtonElement>("paintEditorUndo").disabled = !activeState.history.length;
}

function apply(): void {
  finish(true);
}

function cancel(): void {
  finish(false);
}

function finish(shouldApply: boolean): void {
  const activeState = state;
  if (!activeState || activeState.finalized) return;
  activeState.finalized = true;

  try {
    if (shouldApply) applyChanges(activeState);
  } finally {
    close(activeState.options.onClose);
  }
}

function applyChanges({ options, changes }: PaintEditorState): void {
  const applyChanges = () => {
    if (options.mode === "multiple") options.onApply(new Map(changes));
    else options.onApply(new Map([...changes].map(([cell, values]) => [cell, values[0]])));
  };
  if (options.history) UndoHistory.record({ label: options.title, ...options.history }, applyChanges);
  else applyChanges();
}

/** live mode: the stroke just finished becomes part of the map and one undo step */
function applyLive(): void {
  const activeState = getState();
  if (!activeState.changes.size) return;
  const cells = [...activeState.changes.keys()];
  applyChanges(activeState);
  activeState.changes.clear();
  removePaintOverlayCells(cells);
}

function cleanup(): void {
  if (state?.options.recolor) void Controllers.ColorPicker.close(); // its picks belong to this session
  state?.unsubscribe?.();
  state = null;
  destroyDialog(dialogId);
  removePaintOverlay();
  brush?.detach();
  brush = null;
  clearMainTip();
  if (customization === customizationMode) customization = 0;
}

function close(onClose: () => void): void {
  try {
    cleanup();
  } finally {
    onClose();
  }
}

function getState(): PaintEditorState {
  if (!state) throw new Error("Paint editor is not open");
  return state;
}

export const PaintEditor = { open, apply, undoStroke, getStatus };
