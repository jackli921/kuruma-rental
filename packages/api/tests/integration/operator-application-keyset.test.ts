import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../../src/repositories/drizzle'
import { DrizzleOperatorApplicationRepository } from '../../src/repositories/drizzle'
import { testDb } from './pg-test-client'

// #1371 review finding: the admin-queue keyset cursor encodes createdAt at
// millisecond precision (Date.toISOString()), but the column was plain
// timestamptz (microsecond). Two applications whose createdAt share a
// millisecond but differ in microseconds land in the seek's dead zone: neither
// `createdAt < cursorMs` nor `createdAt = cursorMs AND id > cursorId` matches the
// second row, so it is silently skipped across the page boundary.
//
// This can only be reproduced against real Postgres — the in-memory repo's Dates
// are already millisecond. Fixed by pinning the column to millisecond precision
// (timestamptz(3)) so stored == read == cursor, closing the dead zone.

const db = testDb as unknown as Db
const repo = new DrizzleOperatorApplicationRepository(db)

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const mk = (n: number) => ({
  businessName: `Keyset ${n} ${uniq}`,
  contactName: `Contact ${n}`,
  contactEmail: `keyset-${n}-${uniq}@example.test`,
  contactPhone: '+81-3-0000-0000',
  serviceArea: 'KIX',
  estimatedFleetSize: '1-5' as const,
  website: null,
  businessLicenseNumber: null,
  businessType: 'INDIVIDUAL' as const,
  message: null,
  submittedLocale: 'en',
})

// Sorted first via a far-future createdAt, and both inside the millisecond
// bucket [.123000, .123400] so each reads back as ...123Z regardless of whether
// the driver rounds or truncates — but stored at DISTINCT microseconds, which is
// exactly the sub-millisecond gap the cursor cannot express.
const TS_A = '2099-01-01 00:00:00.123100+00'
const TS_B = '2099-01-01 00:00:00.123400+00'

let idA = ''
let idB = ''

beforeAll(async () => {
  const a = await repo.create(mk(1))
  const b = await repo.create(mk(2))
  idA = a.id
  idB = b.id
  await db.execute(sql`UPDATE operator_applications SET "createdAt" = ${TS_A} WHERE id = ${idA}`)
  await db.execute(sql`UPDATE operator_applications SET "createdAt" = ${TS_B} WHERE id = ${idB}`)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM operator_applications WHERE id IN (${idA}, ${idB})`)
})

describe('operator applications keyset pagination (real Postgres)', () => {
  it('does not skip a row whose createdAt shares a millisecond across the page boundary', async () => {
    const collected: string[] = []
    let after: { createdAt: Date; id: string } | undefined
    for (let page = 0; page < 2; page++) {
      const rows = await repo.list({ limit: 1, after })
      if (rows.length === 0) break
      const row = rows[0]
      if (!row) break
      collected.push(row.id)
      // Mirror the service cursor: it encodes row.createdAt (a millisecond Date)
      // and decodes it back into the `after` pivot. Feeding the row's Date walks
      // the same seek the production cursor does.
      after = { createdAt: row.createdAt, id: row.id }
    }
    // Both rows must surface across the two single-row pages; pre-fix the second
    // silently vanishes into the sub-millisecond gap.
    expect([...collected].sort()).toEqual([idA, idB].sort())
  })
})
