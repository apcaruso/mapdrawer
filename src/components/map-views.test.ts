import { beforeEach, describe, expect, it, vi } from "vitest";

// the registry is replaced by a set of layer ids: a view is only a choice of layers
const layers = vi.hoisted(() => {
  const active = new Set<string>();
  const set = (ids: readonly string[]) => {
    active.clear();
    for (const id of ids) active.add(id);
  };
  return { active, set };
});
vi.mock("@/components/layers", () => ({
  Layers: {
    isOn: (id: string) => layers.active.has(id),
    set: vi.fn(layers.set),
    restore: vi.fn(({ active }: { active: string[] }) => layers.set(active)),
    state: { order: [] }
  }
}));

const { Layers } = await import("@/components/layers");
const { MAP_VIEWS, MapViews } = await import("./map-views");

beforeEach(() => {
  layers.set([]);
  vi.mocked(Layers.set).mockClear();
});

describe("MapViews", () => {
  it("shows exactly the layers of a view", () => {
    MapViews.show("political");
    expect([...layers.active].sort()).toEqual([...MAP_VIEWS.political.layers].sort());
    expect(MapViews.current()).toBe("political");
  });

  it("follows a tool into its view, and stays when the view is already on screen", () => {
    MapViews.show("physical");
    vi.mocked(Layers.set).mockClear();

    MapViews.follow("physical");
    expect(Layers.set).not.toHaveBeenCalled();

    MapViews.follow("political");
    expect(MapViews.current()).toBe("political");
    expect(layers.active.has("heightmap")).toBe(false);
  });

  it("leaves the view alone for a tool that works in any", () => {
    MapViews.show("biomes");
    vi.mocked(Layers.set).mockClear();
    MapViews.follow(undefined);
    expect(Layers.set).not.toHaveBeenCalled();
  });

  it("tells the view on screen by its layer, the one asked for last first", () => {
    layers.set(["heightmap", "states"]); // e.g. an editor turned states on over the physical view
    MapViews.restore("physical");
    layers.active.add("states");
    expect(MapViews.current()).toBe("physical");

    layers.active.delete("heightmap"); // the user turned the physical view's layer off
    expect(MapViews.current()).toBe("political");

    layers.set(["rivers"]);
    expect(MapViews.current()).toBeUndefined();
  });
});
