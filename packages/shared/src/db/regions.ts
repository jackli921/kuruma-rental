import { type AnyPgColumn, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// #394 hierarchical region taxonomy (prefecture -> city -> area). PLATFORM-GLOBAL
// reference data — NO operatorId: every operator searches the same tree. Adjacency
// list: `parentId` self-refs `regions.id`; null = a root (a prefecture). Renter
// search filters by a selected node + all its recursive descendants (resolved by an
// app-code BFS — see api region-tree.ts). Names are stored trilingual (the renter UI is
// en/ja/zh) so the API stays locale-agnostic and the client picks by route locale.
//
// Lives in its own module (not schema.ts) so the aggregate schema file stays under
// the 800-line cap; re-exported from schema.ts so drizzle-kit (which reads schema.ts)
// still discovers the table. No circular import: schema.ts imports regions (for the
// locations.regionId FK), regions imports nothing from schema.ts.
export const regions = pgTable(
  'regions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Self-referential adjacency edge. null = root (prefecture). The explicit
    // `(): AnyPgColumn` return annotation is required for a self-ref FK — drizzle
    // cannot infer the column type while the table is still being defined.
    parentId: text('parentId').references((): AnyPgColumn => regions.id),
    nameEn: text('nameEn').notNull(),
    nameJa: text('nameJa').notNull(),
    nameZh: text('nameZh').notNull(),
    // Stable dropdown ordering within a level; ties break on nameEn at query time.
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  // Covers the self-FK (lint-fk-indexes) + the recursive-descendant walk by parent.
  (t) => [index('idx_regions_parentId').on(t.parentId)],
)
