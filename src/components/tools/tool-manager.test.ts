import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/map-placement", () => ({ stopMapPlacement: vi.fn() }));
vi.mock("@/components/tooltips", () => ({ tip: vi.fn() }));
vi.mock("@/components/viewbox-events", () => ({ applyDefaultViewboxEvents: vi.fn() }));
vi.mock("@/controllers", () => ({ Controllers: { PaintEditor: { apply: vi.fn() } } }));

const { SELECT_TOOL, ToolManager } = await import("./tool-manager");
type Tool = import("./tool-manager").Tool;

const log: string[] = [];
const ends: Record<string, () => void> = {};

function fakeTool(id: string, key?: string): Tool {
  return {
    id,
    name: id,
    group: "test",
    icon: "",
    key,
    hint: "",
    activate: async end => {
      await Promise.resolve();
      ends[id] = end;
      log.push(`+${id}`);
    },
    deactivate: () => {
      log.push(`-${id}`);
      ends[id]?.(); // a tool whose dialog closes while it is being stopped calls end too
    }
  };
}

ToolManager.register(fakeTool(SELECT_TOOL, "KeyV"), fakeTool("paint", "KeyP"), fakeTool("place", "KeyU"));

beforeEach(async () => {
  globalThis.customization = 0;
  await ToolManager.activate(SELECT_TOOL);
  log.length = 0;
});

describe("ToolManager", () => {
  it("starts on Select and finds tools by their shortcut", () => {
    expect(ToolManager.byKey("KeyP")?.id).toBe("paint");
    expect(ToolManager.byKey("KeyX")).toBeUndefined();
  });

  it("stops the active tool before starting the next, in the order the switches were asked", async () => {
    ToolManager.activate("paint");
    await ToolManager.activate("place");
    expect(log).toEqual(["-select", "+paint", "-paint", "+place"]);
    expect(ToolManager.getCurrent()?.id).toBe("place");
  });

  it("ignores the end call of a tool that is being replaced", async () => {
    await ToolManager.activate("paint");
    await ToolManager.activate("place");
    expect(ToolManager.getCurrent()?.id).toBe("place");
  });

  it("goes back to Select when the tool ends by itself", async () => {
    await ToolManager.activate("paint");
    ends.paint();
    expect(ToolManager.getCurrent()?.id).toBe(SELECT_TOOL);
  });

  it("does not switch while the heightmap editor is open", async () => {
    globalThis.customization = 1;
    await ToolManager.activate("paint");
    expect(ToolManager.getCurrent()?.id).toBe(SELECT_TOOL);
  });
});
