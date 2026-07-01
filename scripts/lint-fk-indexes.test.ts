import { describe, expect, test } from 'bun:test'
import {
  findUnindexedFks,
  foldIndexEvents,
  parseMigrationEvents,
  parseMigrationIndexes,
} from './lint-fk-indexes'

describe('parseMigrationIndexes', () => {
  test('parses CREATE INDEX on a single column', () => {
    const sql = 'CREATE INDEX IF NOT EXISTS "idx_bookings_renterId" ON "bookings" ("renterId");'
    expect(parseMigrationIndexes(sql)).toEqual([{ table: 'bookings', columns: ['renterId'] }])
  })

  test('parses CREATE UNIQUE INDEX', () => {
    const sql = 'CREATE UNIQUE INDEX "u_users_phone" ON "users" ("phone");'
    expect(parseMigrationIndexes(sql)).toEqual([{ table: 'users', columns: ['phone'] }])
  })

  test('parses drizzle-kit output with USING btree', () => {
    const sql = 'CREATE INDEX "idx_vehicles_classId" ON "vehicles" USING btree ("classId");'
    expect(parseMigrationIndexes(sql)).toEqual([{ table: 'vehicles', columns: ['classId'] }])
  })

  test('parses composite indexes', () => {
    const sql = 'CREATE INDEX "idx_tp_composite" ON "thread_participants" ("threadId", "userId");'
    expect(parseMigrationIndexes(sql)).toEqual([
      { table: 'thread_participants', columns: ['threadId', 'userId'] },
    ])
  })

  test('ignores commented-out and non-index statements', () => {
    const sql = `
      CREATE TABLE "x" ("id" text PRIMARY KEY);
      -- CREATE INDEX commented ON x (y);
      ALTER TABLE "x" ADD COLUMN "y" text;
    `
    expect(parseMigrationIndexes(sql)).toEqual([])
  })
})

describe('findUnindexedFks', () => {
  test('empty when every FK has a matching leading-column index', () => {
    const missing = findUnindexedFks(
      [{ table: 'bookings', column: 'renterId' }],
      [],
      [{ table: 'bookings', columns: ['renterId'] }],
    )
    expect(missing).toEqual([])
  })

  test('primary-key columns are treated as already indexed', () => {
    const missing = findUnindexedFks(
      [{ table: 'accounts', column: 'providerAccountId' }],
      [{ table: 'accounts', column: 'providerAccountId' }],
      [],
    )
    expect(missing).toEqual([])
  })

  test('reports an FK that has no covering index', () => {
    const missing = findUnindexedFks(
      [{ table: 'vehicles', column: 'classId' }],
      [{ table: 'vehicles', column: 'id' }],
      [],
    )
    expect(missing).toEqual([{ table: 'vehicles', column: 'classId' }])
  })

  test('composite index covers the LEADING column only', () => {
    const missing = findUnindexedFks(
      [
        { table: 't', column: 'a' },
        { table: 't', column: 'b' },
      ],
      [],
      [{ table: 't', columns: ['a', 'b'] }],
    )
    expect(missing).toEqual([{ table: 't', column: 'b' }])
  })

  test('honours explicit exemptions', () => {
    const missing = findUnindexedFks([{ table: 'x', column: 'y' }], [], [], new Set(['x.y']))
    expect(missing).toEqual([])
  })
})

describe('parseMigrationEvents', () => {
  test('captures a CREATE INDEX as a create event with its name', () => {
    const sql = 'CREATE INDEX "idx_reviews_bookingId" ON "reviews" USING btree ("bookingId");'
    expect(parseMigrationEvents(sql)).toEqual([
      { kind: 'create', name: 'idx_reviews_bookingId', table: 'reviews', columns: ['bookingId'] },
    ])
  })

  test('captures a DROP INDEX as a drop event with its name', () => {
    expect(parseMigrationEvents('DROP INDEX "idx_reviews_bookingId";')).toEqual([
      { kind: 'drop', name: 'idx_reviews_bookingId' },
    ])
  })

  test('matches DROP INDEX with CONCURRENTLY / IF EXISTS and unquoted names', () => {
    expect(parseMigrationEvents('DROP INDEX CONCURRENTLY IF EXISTS idx_foo;')).toEqual([
      { kind: 'drop', name: 'idx_foo' },
    ])
  })

  test('ignores DROP CONSTRAINT (constraint indexes were never tracked)', () => {
    const sql = 'ALTER TABLE "reviews" DROP CONSTRAINT "reviews_subject_per_booking_unique";'
    expect(parseMigrationEvents(sql)).toEqual([])
  })

  test('preserves source order across a drop-then-create in one migration (#1225 shape)', () => {
    const sql = `
      DROP INDEX "idx_reviews_bookingId";--> statement-breakpoint
      CREATE UNIQUE INDEX "reviews_subject_per_booking_unique" ON "reviews" USING btree ("bookingId","subject");
    `
    expect(parseMigrationEvents(sql)).toEqual([
      { kind: 'drop', name: 'idx_reviews_bookingId' },
      {
        kind: 'create',
        name: 'reviews_subject_per_booking_unique',
        table: 'reviews',
        columns: ['bookingId', 'subject'],
      },
    ])
  })

  test('ignores the WHERE clause of a partial index when capturing columns', () => {
    const sql =
      'CREATE UNIQUE INDEX "u" ON "reviews" ("bookingId","subject") WHERE "moderationStatus" = \'APPROVED\';'
    expect(parseMigrationEvents(sql)).toEqual([
      { kind: 'create', name: 'u', table: 'reviews', columns: ['bookingId', 'subject'] },
    ])
  })
})

describe('foldIndexEvents', () => {
  test('a create adds the index to the surviving set', () => {
    expect(
      foldIndexEvents([{ kind: 'create', name: 'i', table: 'reviews', columns: ['bookingId'] }]),
    ).toEqual([{ table: 'reviews', columns: ['bookingId'] }])
  })

  test('a later drop removes a previously-created index (the regression guard)', () => {
    expect(
      foldIndexEvents([
        { kind: 'create', name: 'idx_reviews_bookingId', table: 'reviews', columns: ['bookingId'] },
        { kind: 'drop', name: 'idx_reviews_bookingId' },
      ]),
    ).toEqual([])
  })

  test('drop of a never-created name is a no-op', () => {
    expect(foldIndexEvents([{ kind: 'drop', name: 'ghost' }])).toEqual([])
  })

  test('#1225: dropping idx_reviews_bookingId but adding the (bookingId,subject) uniqueIndex keeps bookingId covered', () => {
    const surviving = foldIndexEvents([
      { kind: 'create', name: 'idx_reviews_bookingId', table: 'reviews', columns: ['bookingId'] },
      { kind: 'drop', name: 'idx_reviews_bookingId' },
      {
        kind: 'create',
        name: 'reviews_subject_per_booking_unique',
        table: 'reviews',
        columns: ['bookingId', 'subject'],
      },
    ])
    // idx_reviews_bookingId is gone, but the uniqueIndex still leads with bookingId.
    expect(surviving).toEqual([{ table: 'reviews', columns: ['bookingId', 'subject'] }])
    expect(findUnindexedFks([{ table: 'reviews', column: 'bookingId' }], [], surviving)).toEqual([])
  })

  test('#1225 without the replacement uniqueIndex leaves bookingId UNINDEXED (guard fires)', () => {
    const surviving = foldIndexEvents([
      { kind: 'create', name: 'idx_reviews_bookingId', table: 'reviews', columns: ['bookingId'] },
      { kind: 'drop', name: 'idx_reviews_bookingId' },
    ])
    expect(findUnindexedFks([{ table: 'reviews', column: 'bookingId' }], [], surviving)).toEqual([
      { table: 'reviews', column: 'bookingId' },
    ])
  })
})
