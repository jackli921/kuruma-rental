import type { Region } from '../stores'

/**
 * Pure BFS over the parentId adjacency list: returns `rootId` plus every
 * descendant id (inclusive), or `[]` when `rootId` is absent. Shared by both
 * RegionRepository impls so the tree walk lives in ONE place (#394, §D6).
 *
 * We resolve descendants in app code rather than a Postgres WITH RECURSIVE CTE:
 * regions are tiny platform-global reference data (a few dozen rows), so a single
 * `SELECT *` + this walk is trivial and stays driver-agnostic — `db.execute(sql)`
 * returns a different result shape on neon-http (`.rows`) vs the postgres-js test
 * driver (an array), which a raw CTE would have to special-case.
 *
 * Cycle-safe: the `regions.parentId` self-FK has no DB-level cycle constraint, so
 * a malformed row (A→B→A, or a self-parent) is physically storable. This walk sits
 * behind the public, unauthenticated search path, so an unguarded BFS would be a
 * single-row CPU-exhaustion DoS. The `visited` set bounds the walk to each id once
 * regardless of input — and as a bonus dedupes diamond paths (a node reachable by
 * two parents would otherwise appear twice in the `IN (...)` predicate).
 */
export function collectDescendantIds(regions: readonly Region[], rootId: string): string[] {
  if (!regions.some((r) => r.id === rootId)) return []

  const childrenByParent = new Map<string, string[]>()
  for (const r of regions) {
    if (r.parentId === null) continue
    childrenByParent.set(r.parentId, [...(childrenByParent.get(r.parentId) ?? []), r.id])
  }

  const collected: string[] = []
  const visited = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (visited.has(id)) continue
    visited.add(id)
    collected.push(id)
    const children = childrenByParent.get(id)
    if (children) queue.push(...children)
  }
  return collected
}
