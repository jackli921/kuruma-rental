import type { RunTx } from '@kuruma/shared/db'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { consentDocuments } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { CONSENT_DOC_OPERATOR_TVL_CONSTRAINT, pgConstraintName } from '../../src/pg-errors'
import { DrizzleConsentRepository } from '../../src/repositories/drizzle/consent'
import type { Db } from '../../src/repositories/drizzle/shared'
import type { NewConsentDocument } from '../../src/repositories/types-consent'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL must be set to run this test')
const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema: { consentDocuments } }) as unknown as Db
const runOnTestDb: RunTx = (fn) => db.transaction(fn)
const repo = new DrizzleConsentRepository(db, runOnTestDb)
const OP = BEST_CAR_RENTAL_OPERATOR_ID
const TYPE = 'OPERATOR_RENTAL_TERMS' as const

function row(over: Partial<NewConsentDocument>): NewConsentDocument {
  return {
    operatorId: OP,
    type: TYPE,
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
  it('replaceOperatorDraftRows inserts the version rows and lists them by operator+type', async () => {
    await repo.replaceOperatorDraftRows(OP, TYPE, 'v1', [row({}), row({ locale: 'ja' })])
    const all = await repo.findOperatorDocuments(OP, TYPE)
    expect(all.map((d) => d.locale).sort()).toEqual(['en', 'ja'])
    expect(all.every((d) => d.operatorId === OP)).toBe(true)
  })

  it('flips a version DRAFT→PUBLISHED and resolves the latest published version', async () => {
    await repo.replaceOperatorDraftRows(OP, TYPE, 'v1', [row({ version: 'v1' })])
    const now = new Date('2026-06-01T00:00:00Z')
    const published = await repo.setOperatorVersionStatus({
      operatorId: OP,
      type: TYPE,
      version: 'v1',
      from: 'DRAFT',
      to: 'PUBLISHED',
      publishedAt: now,
      now,
    })
    expect(published).toHaveLength(1)
    expect(published[0]?.status).toBe('PUBLISHED')
    expect(await repo.findLatestPublishedVersionForOperator(OP, TYPE, now)).toBe('v1')
    const doc = await repo.findPublishedOperatorDocument(OP, TYPE, 'v1', 'en')
    expect(doc?.title).toBe('T')
  })

  it('atomically drops the prior DRAFT of the version and inserts the new rows (#1498)', async () => {
    await repo.replaceOperatorDraftRows(OP, TYPE, 'v2', [
      row({ version: 'v2', title: 'old', locale: 'en' }),
      row({ version: 'v2', locale: 'ja' }),
    ])
    const rewritten = await repo.replaceOperatorDraftRows(OP, TYPE, 'v2', [
      row({ version: 'v2', title: 'new', locale: 'en' }),
    ])
    expect(rewritten.map((d) => d.locale)).toEqual(['en'])
    const all = await repo.findOperatorDocuments(OP, TYPE)
    expect(all).toHaveLength(1) // the stale ja draft is gone
    expect(all[0]?.title).toBe('new')
  })

  it('throws the operator_tvl unique (23505) when a surviving row already claims the (version, locale) — the seam the service maps to 409 (#1498)', async () => {
    // Publish v1/en, then a draft rewrite of v1: the delete touches only DRAFTs so
    // the PUBLISHED row survives, and the insert collides on (operator, type, v1, en).
    await repo.replaceOperatorDraftRows(OP, TYPE, 'v1', [row({ version: 'v1' })])
    const now = new Date('2026-06-01T00:00:00Z')
    await repo.setOperatorVersionStatus({
      operatorId: OP,
      type: TYPE,
      version: 'v1',
      from: 'DRAFT',
      to: 'PUBLISHED',
      publishedAt: now,
      now,
    })
    let caught: unknown
    try {
      await repo.replaceOperatorDraftRows(OP, TYPE, 'v1', [row({ version: 'v1' })])
    } catch (e) {
      caught = e
    }
    // Byte-for-byte parity with the constant OperatorTermsService branches on.
    expect(pgConstraintName(caught)).toBe(CONSENT_DOC_OPERATOR_TVL_CONSTRAINT)
  })
})
