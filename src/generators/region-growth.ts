// Regions grow into the land nobody holds yet, cheapest path first from every cell each one already has
import type { TypedArray } from "@/types/PackedGraph";

const LAND = 20;

/** the cost of entering a cell: open lowland is cheap, forests, deserts and mountains are not */
function stepCost(cell: number): number {
  const { h, biome } = pack.cells;
  const biomeCost = pack.biomes[biome[cell]]?.cost ?? 50;
  const relief = h[cell] >= 67 ? 8 : h[cell] >= 44 ? 2 : 0;
  return 1 + biomeCost / 50 + relief;
}

/**
 * Grow every region of `values` (0 is unclaimed) over land into the unclaimed cells it reaches first.
 * `canClaim` restricts where a region may grow, e.g. a province within its state. Returns the claimed cells
 */
function expand(values: TypedArray, canClaim: (cell: number, region: number) => boolean = () => true): number[] {
  const { cells } = pack;
  const cost = new Float64Array(cells.i.length).fill(Infinity);
  const owner = new Uint32Array(cells.i.length);
  const queue = new MinQueue();

  for (const cell of cells.i) {
    if (!values[cell] || cells.h[cell] < LAND) continue;
    cost[cell] = 0;
    owner[cell] = values[cell];
    queue.push(cell, 0);
  }

  while (queue.size) {
    const [cell, cellCost] = queue.pop();
    if (cellCost > cost[cell]) continue; // a cheaper way here was found later
    const region = owner[cell];

    for (const next of cells.c[cell]) {
      if (values[next] || cells.h[next] < LAND || !canClaim(next, region)) continue;
      const nextCost = cellCost + stepCost(next);
      if (nextCost >= cost[next]) continue;
      cost[next] = nextCost;
      owner[next] = region;
      queue.push(next, nextCost);
    }
  }

  const claimed: number[] = [];
  for (const cell of cells.i) {
    if (values[cell] || !owner[cell]) continue;
    values[cell] = owner[cell];
    claimed.push(cell);
  }
  return claimed;
}

/** a binary heap of cells by cost */
class MinQueue {
  readonly cells: number[] = [];
  readonly costs: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, cost: number): void {
    const { cells, costs } = this;
    let index = cells.length;
    cells.push(cell);
    costs.push(cost);
    while (index) {
      const parent = (index - 1) >> 1;
      if (costs[parent] <= cost) break;
      [cells[index], cells[parent]] = [cells[parent], cells[index]];
      [costs[index], costs[parent]] = [costs[parent], costs[index]];
      index = parent;
    }
  }

  pop(): [cell: number, cost: number] {
    const { cells, costs } = this;
    const top: [number, number] = [cells[0], costs[0]];
    const lastCell = cells.pop()!;
    const lastCost = costs.pop()!;
    if (!cells.length) return top;

    cells[0] = lastCell;
    costs[0] = lastCost;
    for (let index = 0; ; ) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < cells.length && costs[left] < costs[smallest]) smallest = left;
      if (right < cells.length && costs[right] < costs[smallest]) smallest = right;
      if (smallest === index) break;
      [cells[index], cells[smallest]] = [cells[smallest], cells[index]];
      [costs[index], costs[smallest]] = [costs[smallest], costs[index]];
      index = smallest;
    }
    return top;
  }
}

export const RegionGrowth = { expand };
