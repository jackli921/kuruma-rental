import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { consentDocuments } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { pgConstraintName, pgErrorCode } from '../../src/pg-errors'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL must be set to run this test')
const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema: { consentDocuments } })

const createdIds: string[] = []
function doc(
  over: Partial<typeof consentDocuments.$inferInsert>,
): typeof consentDocuments.$inferInsert {
  const id = crypto.randomUUID()
  createdIds.push(id)
  return {
    id,
    type: 'OPERATOR_RENTAL_TERMS',
    version: 'v-uniq',
    locale: 'en',
    title: 'Terms',
    body: 'Body',
    acceptanceLabel: 'I agree',
    contentHash: 'h',
    status: 'DRAFT',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}
async function insert(v: typeof consentDocuments.$inferInsert): Promise<unknown> {
  try {
    await db.insert(consentDocuments).values(v)
    return null
  } catch (e) {
    return e
  }
}
afterAll(async () => {
  if (createdIds.length)
    await db.delete(consentDocuments).where(inArray(consentDocuments.id, createdIds))
  await client.end()
})

describe('consent_documents partial uniques (§4.3)', () => {
  it('dedups platform docs (operatorId NULL) on (type,version,locale)', async () => {
    expect(await insert(doc({ operatorId: null }))).toBeNull()
    const dupe = await insert(doc({ operatorId: null }))
    expect(pgErrorCode(dupe)).toBe('23505')
    expect(pgConstraintName(dupe)).toBe('consent_documents_platform_tvl_unique')
  })

  it('lets an operator row coexist with a platform row of the same tuple, but dedups per operator', async () => {
    // Same (type,version,locale) as the platform row above — coexists because the
    // predicates are disjoint (NULL vs NOT NULL).
    expect(await insert(doc({ operatorId: BEST_CAR_RENTAL_OPERATOR_ID }))).toBeNull()
    const dupe = await insert(doc({ operatorId: BEST_CAR_RENTAL_OPERATOR_ID }))
    expect(pgErrorCode(dupe)).toBe('23505')
    expect(pgConstraintName(dupe)).toBe('consent_documents_operator_tvl_unique')
  })
})

describe('consent_documents PUBLISHED immutability trigger (§5.1)', () => {
  it('rejects content mutation of a PUBLISHED row but allows PUBLISHED→ARCHIVED', async () => {
    const base = doc({
      status: 'PUBLISHED',
      version: 'v-imm',
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    })
    await db.insert(consentDocuments).values(base)

    let err: unknown = null
    try {
      await db
        .update(consentDocuments)
        .set({ body: 'tampered' })
        .where(eq(consentDocuments.id, base.id))
    } catch (e) {
      err = e
    }
    expect(pgErrorCode(err)).toBe('23514')

    // status-only transition to ARCHIVED is allowed
    await db
      .update(consentDocuments)
      .set({ status: 'ARCHIVED' })
      .where(eq(consentDocuments.id, base.id))
    const [row] = await db.select().from(consentDocuments).where(eq(consentDocuments.id, base.id))
    expect(row?.status).toBe('ARCHIVED')
  })
})
