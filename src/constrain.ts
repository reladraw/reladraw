import type { Placement } from './ast.js';

/**
 * The tightest arrangement satisfying a set of relative distances.
 *
 * Every placement in the language turns into the same shape of fact: one thing sits
 * at least so far along an axis from another. Written as `pos[to] >= pos[from]
 * + weight`, a whole diagram is a system of those, and the arrangement the
 * author meant is the one where nothing is further apart than it has to be.
 *
 * That arrangement is unique and is found by longest paths, so no search
 * happens and no alternative is ever weighed. Distances come out of the
 * arithmetic; which side of what a thing sits on came from the author.
 */
export interface Constraint {
  from: number;
  to: number;
  weight: number;
  /** The placement this came from, so a failure can be reported in the author's words. */
  placement?: Placement;
}

/** An exact distance, which is two inequalities pointing opposite ways. */
export function fix(from: number, to: number, distance: number, placement?: Placement): Constraint[] {
  return [
    { from, to, weight: distance, ...(placement ? { placement } : {}) },
    { from: to, to: from, weight: -distance, ...(placement ? { placement } : {}) },
  ];
}

export interface Contradiction {
  /** The placements that cannot all hold. Empty if the loop is entirely implicit. */
  placements: Placement[];
}

/**
 * Solve, or report the placements that fight.
 *
 * Longest path from a virtual source joined to everything at zero, which is
 * Bellman-Ford with the comparison flipped. A distance that keeps growing after
 * one pass per node means the constraints run in a circle that demands ever
 * more room, and that circle is exactly the set of placements to quote back.
 */
export function tightest(
  count: number,
  constraints: Constraint[],
): { positions: number[] } | { contradiction: Contradiction } {
  const positions = new Array<number>(count).fill(0);
  const cameFrom = new Array<Constraint | undefined>(count).fill(undefined);

  for (let pass = 0; pass < count; pass += 1) {
    let moved = false;
    for (const constraint of constraints) {
      const candidate = positions[constraint.from]! + constraint.weight;
      if (candidate > positions[constraint.to]! + 1e-9) {
        positions[constraint.to] = candidate;
        cameFrom[constraint.to] = constraint;
        moved = true;
      }
    }
    if (!moved) return { positions };
  }

  // Still moving after a full pass per node, so some loop demands more room
  // every time round it. Walk backwards to find it.
  for (const constraint of constraints) {
    if (positions[constraint.from]! + constraint.weight > positions[constraint.to]! + 1e-9) {
      return { contradiction: { placements: loopFrom(constraint.to, cameFrom, count) } };
    }
  }
  return { contradiction: { placements: [] } };
}

/**
 * Which members can be driven apart from which, along one axis.
 *
 * A constraint says `pos[to] >= pos[from] + weight`, so it bounds `to` from
 * below and leaves it free to move further away. Follow those edges and the
 * question "may this one end up beyond that one?" becomes plain reachability:
 * if `j` is reachable from `i` and `i` is not reachable from `j`, then the file
 * lets the distance from `i` to `j` grow without limit and never lets it be
 * closed from the other side. Pushing `j` past `i` is then the one separation
 * the file allows, and no choice was made.
 *
 * Reachable both ways means the two are pinned at a fixed distance, so they
 * cannot be separated along this axis at all. Reachable neither way means the
 * file said nothing that orders them, which is the case the caller must refuse
 * rather than guess at.
 */
export function reachability(count: number, constraints: Constraint[]): boolean[][] {
  const reach = Array.from({ length: count }, () => new Array<boolean>(count).fill(false));
  for (const constraint of constraints) reach[constraint.from]![constraint.to] = true;

  for (let via = 0; via < count; via += 1) {
    for (let from = 0; from < count; from += 1) {
      if (!reach[from]![via]) continue;
      for (let to = 0; to < count; to += 1) {
        if (reach[via]![to]) reach[from]![to] = true;
      }
    }
  }
  return reach;
}

/** The placements on the loop reached by following each position back to what set it. */
function loopFrom(
  start: number,
  cameFrom: (Constraint | undefined)[],
  count: number,
): Placement[] {
  let at = start;
  for (let step = 0; step < count; step += 1) {
    const previous = cameFrom[at];
    if (previous === undefined) break;
    at = previous.from;
  }

  const placements: Placement[] = [];
  const seen = new Set<number>();
  let cursor = at;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const previous = cameFrom[cursor];
    if (previous === undefined) break;
    if (previous.placement) placements.push(previous.placement);
    cursor = previous.from;
  }
  return placements.reverse();
}
