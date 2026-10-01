// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const draw = vi.fn();
const tip = vi.fn();
vi.mock("@/components/layers", () => ({ Layers: { draw } }));
vi.mock("@/components/dialog/dialog-helpers", () => ({ refreshEditors: vi.fn() }));
vi.mock("@/components/tooltips", () => ({ tip }));

const { UndoHistory } = await import("./undo-history");

const paintAction = { label: "Paint states", domains: ["cells.state", "states"], layers: ["states"] } as const;

beforeEach(() => {
  globalThis.pack = {
    cells: { state: new Uint16Array([0, 0, 1, 1]), routes: {} },
    states: [
      { i: 0, name: "Neutrals" },
      { i: 1, name: "Old" }
    ]
  } as unknown as typeof pack;
  UndoHistory.clear();
  draw.mockClear();
  tip.mockClear();
});

function paint(): void {
  UndoHistory.record(paintAction, () => {
    pack.cells.state[0] = 1;
    pack.states[1].name = "New";
  });
}

describe("UndoHistory", () => {
  it("puts back both the cells and the collection, and redoes them", () => {
    paint();
    expect(UndoHistory.peek()).toEqual({ undo: "Paint states", redo: undefined });

    UndoHistory.undo();
    expect(Array.from(pack.cells.state)).toEqual([0, 0, 1, 1]);
    expect(pack.states[1].name).toBe("Old");
    expect(draw).toHaveBeenCalledWith("states");

    UndoHistory.redo();
    expect(Array.from(pack.cells.state)).toEqual([1, 0, 1, 1]);
    expect(pack.states[1].name).toBe("New");
  });

  it("keeps the cell arrays it restores, so renderers holding them stay in sync", () => {
    const array = pack.cells.state;
    paint();
    UndoHistory.undo();
    expect(pack.cells.state).toBe(array);
  });

  it("records nothing when the action changes nothing", () => {
    UndoHistory.record(paintAction, () => {});
    expect(UndoHistory.peek().undo).toBeUndefined();
  });

  it("refuses to undo over a change it did not record, and forgets the stale steps", () => {
    paint();
    pack.states[1].name = "Renamed in an editor";

    UndoHistory.undo();
    expect(pack.states[1].name).toBe("Renamed in an editor");
    expect(UndoHistory.peek().undo).toBeUndefined();
    expect(tip).toHaveBeenCalledWith(expect.stringContaining("changed outside"), false, "error", 5000);
  });

  it("drops the redo branch on a new action", () => {
    paint();
    UndoHistory.undo();
    UndoHistory.record(paintAction, () => {
      pack.cells.state[3] = 0;
    });
    expect(UndoHistory.peek().redo).toBeUndefined();
  });

  it("forgets everything when the graph is rebuilt during an action", () => {
    paint();
    UndoHistory.record(paintAction, () => {
      pack.cells.state = new Uint16Array(10);
    });
    expect(UndoHistory.peek().undo).toBeUndefined();
  });

  it("starts over when a new map is generated or loaded", () => {
    paint();
    window.dispatchEvent(new Event("map:generated"));
    expect(UndoHistory.peek().undo).toBeUndefined();
  });
});
