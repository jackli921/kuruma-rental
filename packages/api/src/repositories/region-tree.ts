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
 */
export function collectDescendantIds(regions: readonly Region[], rootId: string): string[] {
  if (!regions.some((r) => r.id === rootId)) return []

  const childrenByParent = new Map<string, string[]>()
  for (const r of regions) {
    if (r.parentId === null) continue
    childrenByParent.set(r.parentId, [...(childrenByParent.get(r.parentId) ?? []), r.id])
  }

  // Visited guard: the DB self-FK enforces referential integrity but CANNOT
  // prevent a parentId cycle (a -> b -> a). Without `seen`, a cyclic chain
  // reachable from a public `?regionId=` search loops forever and hangs the
  // Worker. Records each id once, so the walk always terminates and de-dupes.
  const collected: string[] = []
  const seen = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    collected.push(id)
    const children = childrenByParent.get(id)
    if (children) queue.push(...children)
  }
  return collected
}
