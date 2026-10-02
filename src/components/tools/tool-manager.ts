// One drawing tool is active at a time; Select is active when no other is
import { stopMapPlacement } from "@/components/map-placement";
import { MapViews, type ViewId } from "@/components/map-views";
import { tip } from "@/components/tooltips";
import { applyDefaultViewboxEvents } from "@/components/viewbox-events";
import { Controllers } from "@/controllers";

export interface Tool {
  id: string;
  name: string;
  group: string;
  icon: string; // markup inside the palette button
  key?: string; // KeyboardEvent.code of the shortcut
  hint: string; // what to do with the tool, shown when it is picked
  view?: ViewId; // the map view the tool works in, shown when it is picked
  /** what to do right now, when it depends on the map: shown instead of the hint */
  status?: () => string | undefined | Promise<string | undefined>;
  /** start the tool; it calls `end` when it stops by itself, e.g. its dialog is closed */
  activate: (end: () => void) => unknown;
  /** stop the tool when another one is picked, keeping its work */
  deactivate?: () => unknown;
  /** undo a step of the tool's own session; true when there was one */
  undo?: () => boolean | Promise<boolean>;
}

export const SELECT_TOOL = "select";

const tools: Tool[] = [];
let current: Tool | undefined;
let pending: Promise<void> = Promise.resolve(); // switches run one after another, never interleaved
const listeners = new Set<() => void>();

function register(...list: Tool[]): void {
  tools.push(...list);
  current ??= tools.find(tool => tool.id === SELECT_TOOL);
  emit();
}

const all = (): readonly Tool[] => tools;
const getCurrent = (): Tool | undefined => current;
const byKey = (code: string): Tool | undefined => tools.find(tool => tool.key === code);

/** switch to a tool; switching to the active one does nothing */
function activate(id: string): Promise<void> {
  pending = pending
    .then(() => switchTo(id))
    .catch(error => {
      ERROR && console.error(error);
    });
  return pending;
}

async function switchTo(id: string): Promise<void> {
  const tool = tools.find(tool => tool.id === id);
  if (!tool || tool === current) return;
  if (customization === 1) {
    tip("Please exit the heightmap edit mode first", false, "error");
    return;
  }

  const leaving = current;
  current = tool; // set first, so the leaving tool's own end call is recognized as stale
  emit();
  try {
    await leaving?.deactivate?.();
    await settleOtherModes();
  } catch (error) {
    ERROR && console.error(error); // a tool that fails to stop must not keep the next one from starting
  }

  let ended = false;
  const end = () => {
    if (ended || current !== tool) return;
    ended = true;
    current = tools.find(tool => tool.id === SELECT_TOOL);
    applyDefaultViewboxEvents();
    emit();
  };

  try {
    MapViews.follow(tool.view);
    await tool.activate(end);
    if (tool.id !== SELECT_TOOL) tip((await tool.status?.()) || `${tool.name}: ${tool.hint}`, true);
  } catch (error) {
    ERROR && console.error(error);
    tip(`Cannot start ${tool.name}: ${(error as Error).message}`, false, "error");
    end();
  }
}

/** modes started outside the palette give way: painting opened from an editor keeps its work, placement stops */
async function settleOtherModes(): Promise<void> {
  if (customization === 2) await Controllers.PaintEditor.apply();
  stopMapPlacement();
}

/** undo inside the active tool first; false when the tool has nothing of its own to undo */
async function undo(): Promise<boolean> {
  return (await current?.undo?.()) ?? false;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const ToolManager = { register, all, getCurrent, byKey, activate, undo, subscribe };
