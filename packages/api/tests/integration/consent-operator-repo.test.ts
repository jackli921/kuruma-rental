import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { consentDocuments } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DrizzleConsentRepository } from '../../src/repositories/drizzle/consent'
import type { Db } from '../../src/repositories/drizzle/shared'
import type { NewConsentDocument } from '../../src/repositories/types-consent'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL must be set to run this test')
const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema: { consentDocuments } }) as unknown as Db
const repo = new DrizzleConsentRepository(db)
const OP = BEST_CAR_RENTAL_OPERATOR_ID

function row(over: Partial<NewConsentDocument>): NewConsentDocument {
  return {
    operatorId: OP,
    type: 'OPERATOR_RENTAL_TERMS',
    version: 'v1',
    locale: 'en',
    title: 'T',
    body: 'B',
    acceptanceLabel: 'I agree',
    contentHash: 'h',
    status: 'DRAFT',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: null,
    ...over,
  }
}

beforeEach(async () => {
  await db.delete(consentDocuments).where(eq(consentDocuments.operatorId, OP))
})
afterAll(async () => {
  await db.delete(consentDocuments).where(eq(consentDocuments.operatorId, OP))
  await client.end()
})

describe('DrizzleConsentRepository operator authoring', () => {
  it('creates rows and lists them by operator+type', async () => {
    await repo.createOperatorDocuments([row({}), row({ locale: 'ja' })])
    const all = await repo.findOperatorDocuments(OP, 'OPERATOR_RENTAL_TERMS')
    expect(all.map((d) => d.locale).sort()).toEqual(['en', 'ja'])
    expect(all.every((d) => d.operatorId === OP)).toBe(true)
  })

  it('flips a version DRAFT→PUBLISHED and resolves the latest published version', async () => {
    await repo.createOperatorDocuments([row({ version: 'v1' })])
    const now = new Date('2026-06-01T00:00:00Z')
    const published = await repo.setOperatorVersionStatus({
      operatorId: OP,
      type: 'OPERATOR_RENTAL_TERMS',
      version: 'v1',
      from: 'DRAFT',
      to: 'PUBLISHED',
      publishedAt: now,
      now,
    })
    expect(published).toHaveLength(1)
    expect(published[0]?.status).toBe('PUBLISHED')
    expect(await repo.findLatestPublishedVersionForOperator(OP, 'OPERATOR_RENTAL_TERMS', now)).toBe(
      'v1',
    )
    const doc = await repo.findPublishedOperatorDocument(OP, 'OPERATOR_RENTAL_TERMS', 'v1', 'en')
    expect(doc?.title).toBe('T')
  })

  it('deletes only DRAFT rows of a version', async () => {
    await repo.createOperatorDocuments([row({ version: 'v2', status: 'DRAFT' })])
    await repo.deleteOperatorDraftRows(OP, 'OPERATOR_RENTAL_TERMS', 'v2')
    expect(await repo.findOperatorDocuments(OP, 'OPERATOR_RENTAL_TERMS')).toHaveLength(0)
  })
})
