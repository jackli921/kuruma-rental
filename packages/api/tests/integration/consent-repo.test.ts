// Real-pg parity test for DrizzleConsentRepository (#877).
// Run with: DATABASE_URL="postgres://postgres:postgres@localhost:5479/kuruma" bunx vitest run packages/api/src/repositories/drizzle/consent.test.ts
import * as schema from '@kuruma/shared/db/schema'
import { consentAcceptances, consentDocuments } from '@kuruma/shared/db/schema'
import type { ConsentType } from '@kuruma/shared/enums'
import type { DocumentSnapshot } from '@kuruma/shared/lib/consent-canonical'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleConsentRepository } from '../../src/repositories/drizzle/consent'
import type { Db } from '../../src/repositories/drizzle/shared'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL must be set to run this test')

const client = postgres(url, { max: 1 })
// Cast to Db (NeonHttp type) — postgres-js is structurally compatible for the
// query methods DrizzleConsentRepository uses (select/insert/delete).
const db = drizzle(client, { schema }) as unknown as Db
const repo = new DrizzleConsentRepository(db)

const createdDocIds: string[] = []
const createdAcceptanceIds: string[] = []
const createdUserIds: string[] = []

async function seedUser(): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(schema.users).values({
    id,
    email: `consent-drizzle-test-${id.slice(0, 8)}@kuruma.test`,
    role: 'RENTER',
    operatorId: null,
    language: 'en',
  })
  createdUserIds.push(id)
  return id
}

async function seedDocument(
  type: ConsentType = 'RENTER_TOS',
  overrides: Partial<typeof consentDocuments.$inferInsert> = {},
): Promise<typeof consentDocuments.$inferSelect> {
  const id = crypto.randomUUID()
  const [row] = await db
    .insert(consentDocuments)
    .values({
      id,
      type,
      version: `v-${id.slice(0, 8)}`,
      locale: 'en',
      title: 'Terms of Service',
      body: 'You agree to the terms.',
      acceptanceLabel: 'I accept',
      contentHash: 'c'.repeat(64),
      status: 'PUBLISHED',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    })
    .returning()
  if (!row) throw new Error('Failed to seed consent document')
  createdDocIds.push(id)
  return row
}

beforeAll(async () => {
  // warm up connection
  await db.select({ one: schema.users.id }).from(schema.users).limit(1)
})

afterAll(async () => {
  if (createdAcceptanceIds.length > 0) {
    await db.delete(consentAcceptances).where(inArray(consentAcceptances.id, createdAcceptanceIds))
  }
  if (createdDocIds.length > 0) {
    await db.delete(consentDocuments).where(inArray(consentDocuments.id, createdDocIds))
  }
  for (const uid of createdUserIds) {
    await db.delete(schema.users).where(eq(schema.users.id, uid))
  }
  await client.end()
})

describe('DrizzleConsentRepository — documentSnapshot + signatureCanonicalVersion round-trip (#877)', () => {
  it('persists and reads back documentSnapshot and signatureCanonicalVersion via findUserDocumentAcceptance', async () => {
    const userId = await seedUser()
    const docRow = await seedDocument()

    const snapshot: DocumentSnapshot = {
      version: docRow.version,
      locale: docRow.locale,
      title: docRow.title,
      body: docRow.body,
      acceptanceLabel: docRow.acceptanceLabel,
      contentHash: docRow.contentHash,
    }

    const created = await repo.createAcceptance({
      documentId: docRow.id,
      consentType: 'RENTER_TOS',
      userId,
      operatorId: null,
      operatorMembershipId: null,
      actorRole: 'RENTER',
      bookingId: null,
      acceptedAt: new Date('2026-06-24T00:00:00Z'),
      context: null,
      ipAddress: null,
      userAgent: null,
      method: 'CLICKWRAP',
      recordSignature: 'sig_abc',
      signingKeyId: 'key_v1',
      signatureCanonicalVersion: 'v1',
      documentSnapshot: snapshot,
    })
    createdAcceptanceIds.push(created.id)

    const found = await repo.findUserDocumentAcceptance(userId, docRow.id)
    expect(found).toBeDefined()
    expect(found?.documentSnapshot).toEqual(snapshot)
    expect(found?.signatureCanonicalVersion).toBe('v1')
  })

  it('reads back null documentSnapshot and null signatureCanonicalVersion when not set', async () => {
    const userId = await seedUser()
    const docRow = await seedDocument()

    const created = await repo.createAcceptance({
      documentId: docRow.id,
      consentType: 'RENTER_TOS',
      userId,
      operatorId: null,
      operatorMembershipId: null,
      actorRole: 'RENTER',
      bookingId: null,
      acceptedAt: new Date('2026-06-24T00:00:00Z'),
      context: null,
      ipAddress: null,
      userAgent: null,
      method: 'CLICKWRAP',
      recordSignature: null,
      signingKeyId: null,
      signatureCanonicalVersion: null,
      documentSnapshot: null,
    })
    createdAcceptanceIds.push(created.id)

    const found = await repo.findUserDocumentAcceptance(userId, docRow.id)
    expect(found).toBeDefined()
    expect(found?.documentSnapshot).toBeNull()
    expect(found?.signatureCanonicalVersion).toBeNull()
  })
})
