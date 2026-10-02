// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Point } from "@/types/global";
import type { PaintEditorOptions } from "./paint-editor";
import { PaintEditor } from "./paint-editor";
import "@/generators/pack-generator"; // registers the Pack global the editor finds cells with

vi.mock("@/components/viewbox-events", () => ({ applyDefaultViewboxEvents: vi.fn() }));
const colorPicker = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock("@/controllers", () => ({ Controllers: { ColorPicker: colorPicker } }));
vi.mock("@/components/dialog/dialog-helpers", async importOriginal => ({
  ...(await importOriginal<typeof import("@/components/dialog/dialog-helpers")>()),
  closeDialogs: vi.fn()
}));

const getOptions = (overrides: Partial<PaintEditorOptions> = {}): PaintEditorOptions => ({
  title: "Paint states",
  parentDialogId: "parentDialog",
  onClose: vi.fn(),
  items: [
    { id: 2, name: "South", color: "#0000ff" },
    { id: 3, name: "West", color: "#ffffff" },
    { id: 1, name: "North", color: "#ff0000" }
  ],
  getValue: vi.fn(() => 0),
  onApply: vi.fn(),
  ...overrides
});

async function dragBrush(
  points: Point[] = [
    [1, 1],
    [2, 2]
  ]
): Promise<void> {
  const viewbox = document.getElementById("viewbox")!;
  const eventView = document.defaultView!;
  const MouseEvent = eventView.MouseEvent;
  const mouseEvent = (type: string, init: MouseEventInit) => {
    const event = new MouseEvent(type, init);
    Object.defineProperty(event, "view", { value: eventView });
    return event;
  };
  const [startX, startY] = points[0];
  viewbox.dispatchEvent(mouseEvent("mousedown", { bubbles: true, button: 0, clientX: startX, clientY: startY }));
  for (const [clientX, clientY] of points.slice(1)) {
    eventView.dispatchEvent(mouseEvent("mousemove", { bubbles: true, buttons: 1, clientX, clientY }));
  }
  const [clientX, clientY] = points.at(-1)!;
  eventView.dispatchEvent(mouseEvent("mouseup", { bubbles: true, button: 0, clientX, clientY }));
  await new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  window.dispatchEvent(new Event("map:generated")); // a fresh map: no remembered selection
  document.body.innerHTML =
    '<div id="dialogs"><div id="parentDialog" class="dialog"></div></div><div id="tooltip"></div><svg><g id="viewbox"></g><g id="debug"></g></svg>';
  globalThis.customization = 0;
  vi.spyOn(Pack, "findCell").mockReturnValue(3);
  globalThis.pack = {
    cells: {
      h: new Uint8Array(4).fill(30),
      v: [[], [], [], [0, 1, 2]],
      p: [
        [100, 100],
        [100, 101],
        [101, 100],
        [2, 2]
      ]
    },
    vertices: {
      p: [
        [0, 0],
        [1, 0],
        [0, 1]
      ]
    }
  } as unknown as typeof pack;
  const dialogOptions = new WeakMap<HTMLElement, Record<string, unknown>>();
  window.$ = vi.fn((target: string | HTMLElement) => {
    const element = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    const dialog = vi.fn((command: unknown, key?: string, value?: unknown) => {
      if (!element) return;
      const options = dialogOptions.get(element) ?? {};
      if (typeof command === "object") {
        dialogOptions.set(element, { ...options, ...command });
        element.classList.add("ui-dialog-content");
      } else if (command === "option" && value === undefined) return options[key!];
      else if (command === "option") dialogOptions.set(element, { ...options, [key!]: value });
      else if (command === "close") {
        element.style.display = "none";
        if (typeof options.close === "function") options.close();
      } else if (command === "open") element.style.removeProperty("display");
    });
    return { dialog };
  }) as unknown as typeof window.$;
  const parentDialog = document.getElementById("parentDialog")!;
  $(parentDialog).dialog({ close: () => parentDialog.remove() });
});

afterEach(() => {
  PaintEditor.apply(); // a session a test left open would answer the next test's history events
  vi.restoreAllMocks();
  colorPicker.open.mockClear();
});

describe("PaintEditor", () => {
  it("reopens its destroyed parent through the close callback", () => {
    const onClose = vi.fn(() => {
      document
        .getElementById("dialogs")!
        .insertAdjacentHTML("beforeend", '<div id="parentDialog" class="dialog"></div>');
    });
    PaintEditor.open(getOptions({ onClose }));

    expect(document.getElementById("parentDialog")).toBeNull();
    document.getElementById("paintEditorCancel")?.click();

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.getElementById("parentDialog")).not.toBeNull();
  });

  it("owns customization and clears it when cancelled", () => {
    PaintEditor.open(getOptions());
    expect(globalThis.customization).toBe(2);

    document.getElementById("paintEditorCancel")?.click();

    expect(globalThis.customization).toBe(0);
    expect(document.getElementById("paintEditor")).toBeNull();
    expect(document.getElementById("paintEditorOverlay")).toBeNull();
  });

  it("owns selection independently of the calling editor", () => {
    PaintEditor.open(getOptions());
    const itemSelect = document.getElementById("paintEditorSelect") as HTMLSelectElement;
    const fillBox = document.getElementById("paintEditorFill") as HTMLElement & { fill: string };

    expect(itemSelect.value).toBe("1");
    expect(fillBox.fill).toBe("#ff0000");
    itemSelect.value = "2";
    itemSelect.dispatchEvent(new Event("change"));

    expect(itemSelect.value).toBe("2");
    expect(fillBox.fill).toBe("#0000ff");
  });

  it("sorts items alphabetically while keeping a leading special item pinned", () => {
    PaintEditor.open(
      getOptions({
        items: [
          { id: 0, name: "Neutral", color: "#ffffff" },
          { id: 2, name: "South", color: "#0000ff" },
          { id: 1, name: "North", color: "#ff0000" }
        ]
      })
    );

    const options = [...document.querySelectorAll<HTMLOptionElement>("#paintEditorSelect option")];
    expect(options.map(option => option.textContent)).toEqual(["Neutral", "North", "South"]);
  });

  it("shows the hovered item from the value getter", async () => {
    PaintEditor.open(getOptions({ getValue: () => 2 }));
    document
      .getElementById("viewbox")
      ?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 2, clientY: 2 }));
    await new Promise(requestAnimationFrame); // the brush answers pointer moves once per frame

    expect(document.getElementById("tooltip")?.textContent).toBe("South");
  });

  it("owns working changes and commits them through one apply callback", async () => {
    const calls: string[] = [];
    const onApply = vi.fn((_changes: ReadonlyMap<number, number>) => {
      calls.push("apply");
    });
    const onClose = vi.fn(() => calls.push("close"));
    PaintEditor.open(getOptions({ onApply, onClose }));

    await dragBrush();
    document.getElementById("paintEditorApply")?.click();

    const changes = onApply.mock.calls[0][0] as ReadonlyMap<number, number>;
    expect([...changes]).toEqual([[3, 1]]);
    expect(calls).toEqual(["apply", "close"]);
    expect(globalThis.customization).toBe(0);
  });

  it("paints the whole path of a fast swipe, not only where the pointer events landed", async () => {
    vi.spyOn(Pack, "findAll").mockImplementation(x => [Math.floor(x / 10)]); // one cell per 10px column
    pack.cells.h = new Uint8Array(7).fill(30);
    pack.cells.v = Array.from({ length: 7 }, () => [0, 1, 2]);
    pack.cells.p = Array.from({ length: 7 }, () => [2, 2]);
    const onApply = vi.fn();
    PaintEditor.open(getOptions({ onApply })); // default radius 12: stamps every 6px

    await dragBrush([
      [1, 1],
      [61, 1]
    ]);
    document.getElementById("paintEditorApply")?.click();

    const changes = onApply.mock.calls[0][0] as ReadonlyMap<number, number>;
    expect([...changes.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it.each([6, 20])("paints cells reached by a short movement with brush size %i", async radius => {
    pack.cells.p = [
      [0, 0],
      [radius + 0.5, 0],
      [radius + 1.5, 0],
      [0, radius + 0.5]
    ];
    pack.cells.v = Array.from({ length: 4 }, () => [0, 1, 2]);
    const onApply = vi.fn();
    PaintEditor.open(getOptions({ onApply }));
    const size = document.getElementById("paintEditorBrush") as HTMLInputElement;
    size.value = String(radius);
    size.dispatchEvent(new Event("input"));

    await dragBrush([
      [0, 0],
      [1, 0]
    ]);

    expect(
      [...document.querySelectorAll<SVGPolygonElement>("#paintEditorOverlay polygon")].map(p => +p.dataset.cell!)
    ).toEqual(expect.arrayContaining([0, 1]));
    document.getElementById("paintEditorApply")?.click();
    expect([...(onApply.mock.calls[0][0] as ReadonlyMap<number, number>).keys()].sort()).toEqual([0, 1]);
  });

  it("follows short turns and keeps the entire drag in one undo entry", async () => {
    pack.cells.p = [
      [0, 0],
      [20.5, 0],
      [0, 20.5],
      [22, 0]
    ];
    pack.cells.v = Array.from({ length: 4 }, () => [0, 1, 2]);
    const onApply = vi.fn();
    PaintEditor.open(getOptions({ onApply }));
    const size = document.getElementById("paintEditorBrush") as HTMLInputElement;
    size.value = "20";
    size.dispatchEvent(new Event("input"));

    await dragBrush([
      [0, 0],
      [1, 0],
      [0, 1]
    ]);

    const painted = [...document.querySelectorAll<SVGPolygonElement>("#paintEditorOverlay polygon")];
    expect(painted.map(p => +p.dataset.cell!).sort()).toEqual([0, 1, 2]);
    document.getElementById("paintEditorUndo")?.click();
    expect(document.querySelectorAll("#paintEditorOverlay polygon")).toHaveLength(0);
    expect((document.getElementById("paintEditorUndo") as HTMLButtonElement).disabled).toBe(true);
    document.getElementById("paintEditorApply")?.click();
    expect([...(onApply.mock.calls[0][0] as ReadonlyMap<number, number>)]).toEqual([]);
  });

  it("selects on a plain click without painting", async () => {
    const onApply = vi.fn();
    PaintEditor.open(getOptions({ getValue: () => 2, onApply }));
    await dragBrush([[1, 1]]);
    document
      .getElementById("viewbox")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));
    expect((document.getElementById("paintEditorSelect") as HTMLSelectElement).value).toBe("2");
    document.getElementById("paintEditorApply")?.click();
    expect([...(onApply.mock.calls[0][0] as ReadonlyMap<number, number>)]).toEqual([]);
  });

  it("owns stroke history", async () => {
    const onApply = vi.fn();
    PaintEditor.open(getOptions({ onApply }));
    await dragBrush();

    const undo = document.getElementById("paintEditorUndo") as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    undo.click();
    expect(undo.disabled).toBe(true);
    document.getElementById("paintEditorApply")?.click();

    expect([...(onApply.mock.calls[0][0] as ReadonlyMap<number, number>)]).toEqual([]);
  });

  it("supports overlapping values without delegating state management", async () => {
    const onApply = vi.fn();
    PaintEditor.open({
      title: "Paint zones",
      parentDialogId: "parentDialog",
      onClose: vi.fn(),
      mode: "multiple",
      items: [
        { id: 1, name: "Danger", color: "#ff0000" },
        { id: 2, name: "Magic", color: "#0000ff" }
      ],
      getValue: () => [1],
      onApply
    });
    const itemSelect = document.getElementById("paintEditorSelect") as HTMLSelectElement;
    itemSelect.value = "2";
    itemSelect.dispatchEvent(new Event("change"));

    await dragBrush();
    document.getElementById("paintEditorApply")?.click();

    const changes = onApply.mock.calls[0][0] as ReadonlyMap<number, readonly number[]>;
    expect([...changes]).toEqual([[3, [1, 2]]]);
  });

  it("enforces the universal zero-only protection toggle", async () => {
    const onApply = vi.fn();
    PaintEditor.open(getOptions({ dontOverrideControl: true, getValue: () => 1, onApply }));
    const itemSelect = document.getElementById("paintEditorSelect") as HTMLSelectElement;
    itemSelect.value = "2";
    itemSelect.dispatchEvent(new Event("change"));
    const protect = document.getElementById("paintEditorDontOverride") as HTMLInputElement;
    expect(protect.parentElement?.textContent).toContain("Do not override existing");
    protect.checked = true;

    await dragBrush();
    document.getElementById("paintEditorApply")?.click();

    expect([...(onApply.mock.calls[0][0] as ReadonlyMap<number, number>)]).toEqual([]);
  });

  it("uses the -1 item to remove all overlapping values", async () => {
    const onApply = vi.fn();
    PaintEditor.open({
      title: "Paint zones",
      parentDialogId: "parentDialog",
      onClose: vi.fn(),
      mode: "multiple",
      items: [
        { id: -1, name: "No zone", color: "#ffffff" },
        { id: 1, name: "Danger", color: "#ff0000" },
        { id: 2, name: "Magic", color: "#0000ff" }
      ],
      dontOverrideControl: true,
      landOnlyControl: true,
      getValue: () => [1, 2],
      onApply
    });
    const itemSelect = document.getElementById("paintEditorSelect") as HTMLSelectElement;
    const protect = document.getElementById("paintEditorDontOverride") as HTMLInputElement;
    const landOnly = document.getElementById("paintEditorLandOnly") as HTMLInputElement;
    expect(landOnly.checked).toBe(true);
    expect(itemSelect.value).toBe("1"); // erasing is picked on purpose, never by default
    itemSelect.value = "-1";
    itemSelect.dispatchEvent(new Event("change"));
    expect(document.getElementById("paintEditorErase")).toBeNull();
    protect.checked = true;

    await dragBrush();
    expect(document.querySelector("#paintEditorOverlay polygon")?.getAttribute("fill")).toBe("#ffffff");
    document.getElementById("paintEditorApply")?.click();

    const changes = onApply.mock.calls[0][0] as ReadonlyMap<number, readonly number[]>;
    expect([...changes]).toEqual([[3, []]]);
  });

  it("starts with a real item, not the pinned one that erases", () => {
    PaintEditor.open(
      getOptions({
        items: [
          { id: 0, name: "Neutral", color: "#ffffff" },
          { id: 2, name: "South", color: "#0000ff" },
          { id: 1, name: "North", color: "#ff0000" }
        ]
      })
    );
    expect((document.getElementById("paintEditorSelect") as HTMLSelectElement).value).toBe("1");
  });

  it("starts with the item painted last, until another map is made", () => {
    PaintEditor.open(getOptions());
    const itemSelect = document.getElementById("paintEditorSelect") as HTMLSelectElement;
    itemSelect.value = "3";
    itemSelect.dispatchEvent(new Event("change"));
    PaintEditor.apply();

    PaintEditor.open(getOptions());
    expect((document.getElementById("paintEditorSelect") as HTMLSelectElement).value).toBe("3");
    PaintEditor.apply();

    window.dispatchEvent(new Event("map:generated"));
    PaintEditor.open(getOptions());
    expect((document.getElementById("paintEditorSelect") as HTMLSelectElement).value).toBe("1");
  });

  it("with nothing made yet, a drag founds the first item where it starts and paints with it", async () => {
    const onApply = vi.fn();
    const at = vi.fn((_point: Point) => ({ id: 5, name: "Founded", color: "#00ff00" }));
    PaintEditor.open(
      getOptions({
        items: [{ id: 0, name: "Neutral", color: "#ffffff" }],
        live: true,
        create: { label: "state", hint: "click on land to place its capital", at },
        onApply
      })
    );
    expect(document.getElementById("paintEditorCreate")?.classList.contains("pressed")).toBe(true);
    expect(document.getElementById("tooltip")?.textContent).toContain("No state yet");

    await dragBrush();

    expect(at).toHaveBeenCalledTimes(1);
    expect(at.mock.calls[0][0]).toEqual([1, 1]);
    expect([...(onApply.mock.calls[0][0] as ReadonlyMap<number, number>)]).toEqual([[3, 5]]);
    expect((document.getElementById("paintEditorSelect") as HTMLSelectElement).value).toBe("5");
    expect(document.getElementById("paintEditorBrushTool")?.classList.contains("pressed")).toBe(true);
  });

  it("founds nothing on a drag the creator refuses, and paints nothing", async () => {
    const onApply = vi.fn();
    PaintEditor.open(
      getOptions({
        items: [{ id: 0, name: "Neutral", color: "#ffffff" }],
        live: true,
        create: { label: "state", hint: "click on land", at: () => undefined }, // e.g. the drag began at sea
        onApply
      })
    );
    await dragBrush();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("reads a changing list again after an undo, leaving an item that is gone", async () => {
    const { UndoHistory } = await import("@/components/undo-history");
    const states = [
      { i: 0, name: "Neutral", color: "#ffffff" },
      { i: 1, name: "North", color: "#ff0000" }
    ];
    (pack as unknown as { states: typeof states }).states = states;
    PaintEditor.open(getOptions({ items: () => pack.states.map(s => ({ id: s.i, name: s.name!, color: s.color! })) }));
    const options = () =>
      [...document.querySelectorAll<HTMLOptionElement>("#paintEditorSelect option")].map(o => o.textContent);

    UndoHistory.record({ label: "New state", domains: ["states"], layers: [] }, () =>
      states.push({ i: 2, name: "South", color: "#0000ff" })
    );
    expect(options()).toEqual(["Neutral", "North", "South"]);
    const itemSelect = document.getElementById("paintEditorSelect") as HTMLSelectElement;
    itemSelect.value = "2";
    itemSelect.dispatchEvent(new Event("change"));

    UndoHistory.undo();
    expect(options()).toEqual(["Neutral", "North"]);
    expect(itemSelect.value).toBe("1");
  });

  it("keeps the color swatch inert unless the caller offers recoloring", () => {
    PaintEditor.open(getOptions());
    document.getElementById("paintEditorFill")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(colorPicker.open).not.toHaveBeenCalled();
  });

  it("recolors the selected item from the swatch, all the picks of one picker in one undo step", async () => {
    const { UndoHistory } = await import("@/components/undo-history");
    UndoHistory.clear();
    const states = [
      { i: 0, name: "Neutral", color: "#ffffff" },
      { i: 1, name: "North", color: "#ff0000" }
    ];
    (pack as unknown as { states: typeof states }).states = states;
    const apply = vi.fn((id: number, color: string) => {
      pack.states[id].color = color;
    });
    PaintEditor.open(
      getOptions({
        items: () => pack.states.map(s => ({ id: s.i, name: s.name!, color: s.color! })),
        recolor: { history: { domains: ["states"], layers: [] }, apply }
      })
    );
    const swatch = document.getElementById("paintEditorFill") as HTMLElement & { fill: string };
    swatch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(colorPicker.open).toHaveBeenCalledWith("#ff0000", expect.any(Function));

    const pick = colorPicker.open.mock.calls[0][1] as (color: string) => void;
    pick("#00ff00");
    pick("#0000ff");
    expect(pack.states[1].color).toBe("#0000ff");
    expect(swatch.fill).toBe("#0000ff");

    UndoHistory.undo();
    expect(pack.states[1].color).toBe("#ff0000");
    expect(UndoHistory.peek().undo).toBeUndefined();
  });

  it("uses the default brush radius", () => {
    PaintEditor.open(getOptions());
    expect((document.getElementById("paintEditorBrush") as HTMLInputElement).getAttribute("value")).toBe("12");
  });
});
