import { renterDocuments, users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleRenterDocumentRepository } from '../../src/repositories/drizzle'
import type { Db } from '../../src/repositories/drizzle/shared'
import { db } from './setup'

const repo = new DrizzleRenterDocumentRepository(db as unknown as Db)

let renterId: string
let verifierId: string
const renterCtx = (): CallerContext => ({ userId: renterId, role: 'RENTER', bypassScope: false })

beforeAll(async () => {
  const [renter] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `doc-renter-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  const [staff] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `doc-staff-${Date.now()}@kuruma-test.com`,
      role: 'STAFF',
      language: 'en',
    })
    .returning()
  if (!renter || !staff) throw new Error('failed to seed users')
  renterId = renter.id
  verifierId = staff.id
})

afterAll(async () => {
  await db.delete(renterDocuments).where(inArray(renterDocuments.renterId, [renterId]))
  await db.delete(users).where(inArray(users.id, [renterId, verifierId]))
})

describe('DrizzleRenterDocumentRepository (Neon/postgres)', () => {
  it('round-trips create -> findByRenter -> listPending -> verify -> gate lookup', async () => {
    const created = await repo.create(renterCtx(), {
      renterId,
      type: 'IDP',
      storageKey: `renter-documents/${renterId}/scan.jpg`,
    })
    expect(created.status).toBe('PENDING')
    expect(created.expiryDate).toBeNull()

    const mine = await repo.findByRenter(renterCtx(), renterId)
    expect(mine.map((d) => d.id)).toContain(created.id)

    const pending = await repo.listPending(SYSTEM_CONTEXT, { limit: 50 })
    expect(pending.data.some((d) => d.id === created.id)).toBe(true)
    expect(pending.total).toBeGreaterThanOrEqual(1)

    // No approved IDP yet -> gate lookup empty.
    expect(await repo.findApprovedByType(renterId, 'IDP')).toEqual([])

    const verified = await repo.verify(SYSTEM_CONTEXT, created.id, {
      status: 'APPROVED',
      verifierId,
      expiryDate: '2030-06-30',
    })
    expect(verified?.status).toBe('APPROVED')
    expect(verified?.expiryDate).toBe('2030-06-30')
    expect(verified?.verifierId).toBe(verifierId)
    expect(verified?.verifiedAt).toBeInstanceOf(Date)

    const approved = await repo.findApprovedByType(renterId, 'IDP')
    expect(approved).toHaveLength(1)
    expect(approved[0]?.id).toBe(created.id)
  })
})
