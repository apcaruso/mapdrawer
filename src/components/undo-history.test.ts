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

  it("undoes a change made outside the history first, as a step of its own, then the steps before it", () => {
    paint();
    pack.states[1].name = "Renamed in an editor";

    UndoHistory.undo();
    expect(pack.states[1].name).toBe("New");
    expect(UndoHistory.peek()).toEqual({ undo: "Paint states", redo: "Edits made in a dialog" });

    UndoHistory.undo();
    expect(pack.states[1].name).toBe("Old");
    expect(Array.from(pack.cells.state)).toEqual([0, 0, 1, 1]);

    UndoHistory.redo();
    UndoHistory.redo();
    expect(pack.states[1].name).toBe("Renamed in an editor");
    expect(pack.cells.state[0]).toBe(1);
  });

  it("takes back an outside change of cells only where the step had changed them", () => {
    paint();
    pack.cells.state[0] = 2; // repainted in an editor
    pack.cells.state[3] = 2; // a cell the step never touched

    UndoHistory.undo();
    expect(Array.from(pack.cells.state)).toEqual([1, 0, 1, 2]);
  });

  it("ignores the statistics an editor recounts when it opens", () => {
    paint();
    Object.assign(pack.states[1], { area: 120, cells: 3, burgs: 1, rural: 2, urban: 1 });

    UndoHistory.undo();
    expect(pack.states[1].name).toBe("Old");
    expect(UndoHistory.peek()).toEqual({ undo: undefined, redo: "Paint states" });
  });

  it("drops only the redo branch when the map changed after an undo", () => {
    paint();
    UndoHistory.record(paintAction, () => {
      pack.cells.state[1] = 1;
    });
    UndoHistory.undo();
    pack.states[1].name = "Renamed in an editor";

    UndoHistory.redo();
    expect(pack.states[1].name).toBe("Renamed in an editor");
    expect(UndoHistory.peek()).toEqual({ undo: "Paint states", redo: undefined });
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
