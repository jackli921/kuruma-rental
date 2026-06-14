import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// Taxonomy level of a region node (#651 Slice 1). Drives the renter cascade
// (prefecture -> city -> area dropdowns) and marks which level is assignable.
export const regionTypeEnum = pgEnum('region_type', ['PREFECTURE', 'CITY', 'AREA'])
// Lifecycle of a region node. INACTIVE nodes are hidden from search + never
// matched by `nearestAssignableRegion` (assignment requires ACTIVE).
export const regionStatusEnum = pgEnum('region_status', ['ACTIVE', 'INACTIVE'])

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
    // Taxonomy level. Nullable on add (seed populates every row) — mirrors the
    // nullable-on-add pattern used for locations.regionId / coordinateSource.
    type: regionTypeEnum('type'),
    // Region centre in WGS84 decimal degrees, nullable. Set on assignable (area)
    // nodes so `nearestAssignableRegion` can match a pickup point; prefecture /
    // city nodes stay null (the map view falls back to fit-all-pins, #458).
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    // Whether a renter location may be assigned to this node. Only the deepest
    // (area) level is assignable; cities/prefectures are navigation-only.
    assignable: boolean('assignable').notNull().default(false),
    status: regionStatusEnum('status').notNull().default('ACTIVE'),
    // URL-stable handle for renter quick-chips (?region=namba) and deep links —
    // never expose the UUID. Unique; nullable on add (seed populates).
    slug: text('slug'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Covers the self-FK (lint-fk-indexes) + the recursive-descendant walk by parent.
    index('idx_regions_parentId').on(t.parentId),
    // Renter chip/deep-link lookups resolve a region by slug; also enforces global
    // slug uniqueness (Postgres treats NULL slugs as distinct, so pre-seed rows are fine).
    uniqueIndex('regions_slug_unique').on(t.slug),
  ],
)
