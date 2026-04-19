import { describe, expect, test } from 'bun:test'
import { findUnindexedFks, parseMigrationIndexes } from './lint-fk-indexes'

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
