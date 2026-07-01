import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from './setup'

// #1220: the slice-5 vehicle/class review aggregates scan
//   WHERE subjectVehicleId IN (...) AND publishedAt IS NOT NULL AND moderationStatus = 'VISIBLE'
//   GROUP BY <key>
// These two PARTIAL indexes prune the btree to the published+visible slice and carry
// `overall` as a trailing key column, so SUM(overall)+COUNT(*) per key is an Index Only
// Scan (Heap Fetches: 0) instead of reading every matched review from the heap.
//
// Introspects pg_indexes rather than a repo call: a migration that drops or reshapes
// either index (wrong columns, wrong order, or a lost partial predicate) turns this
// green test red. Mirrors the row-shape assertions in review-constraints.test.ts.

type IndexDefRow = { indexdef: string }

async function indexDef(name: string): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'reviews' AND indexname = ${name}`,
  )) as unknown as IndexDefRow[]
  return rows[0]?.indexdef ?? null
}

describe('review aggregate partial cover indexes (#1220)', () => {
  it('idx_reviews_subject_vehicle_published covers (subjectVehicleId, publishedAt) over published+visible rows', async () => {
    const def = await indexDef('idx_reviews_subject_vehicle_published')
    expect(def).not.toBeNull()
    // Leading key drives the IN(...)/GROUP BY; overall trails as a key column so it
    // covers SUM(overall) — the aggregate is an Index Only Scan (no heap fetch).
    expect(def).toMatch(/\("subjectVehicleId",\s*"publishedAt",\s*"?overall"?\)/)
    // Partial predicate: only published + visible rows are indexed.
    expect(def).toMatch(/\bWHERE\b/)
    expect(def).toContain(`'VISIBLE'`)
    expect(def).toMatch(/"publishedAt" IS NOT NULL/)
  })

  it('idx_reviews_subject_class_published covers (subjectClassId, publishedAt) over published+visible rows', async () => {
    const def = await indexDef('idx_reviews_subject_class_published')
    expect(def).not.toBeNull()
    expect(def).toMatch(/\("subjectClassId",\s*"publishedAt",\s*"?overall"?\)/)
    expect(def).toMatch(/\bWHERE\b/)
    expect(def).toContain(`'VISIBLE'`)
    expect(def).toMatch(/"publishedAt" IS NOT NULL/)
  })
})
