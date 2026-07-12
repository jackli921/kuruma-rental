// Append-only enforcement for consent_acceptances via Postgres role separation (#1553).
//
// The consent ledger is a legal evidence record. Instead of a symmetric HMAC
// record signature (dropped in #1553), row integrity is enforced at the database:
// the application runtime connects as a reduced-privilege, non-owner role
// (`kuruma_runtime`) that has INSERT/SELECT but NOT UPDATE/DELETE on this table.
// The owner role (migrations/seed) is the break-glass path for GDPR erasure and
// corrections.
//
// We exercise the runtime role via `SET LOCAL ROLE kuruma_runtime` inside a
// transaction (which pins a single pooled connection and auto-resets on commit),
// so the permission check is the real Postgres grant, not a code-level guard.
//
// Run with a real Postgres (not neon-http):
//   DATABASE_URL="postgres://kuruma:kuruma@localhost:5443/kuruma_1553" \
//     bun run --filter @kuruma/api test:integration consent-acceptances-append-only
import * as schema from '@kuruma/shared/db/schema'
import { consentAcceptances, consentDocuments, users } from '@kuruma/shared/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL must be set to run this test')

const RUNTIME_ROLE = 'kuruma_runtime'
const PG_INSUFFICIENT_PRIVILEGE = '42501'

const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema })

const createdUserIds: string[] = []
const createdDocIds: string[] = []
const createdAcceptanceIds: string[] = []

async function seedUser(): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: `append-only-${id.slice(0, 8)}@kuruma.test`,
    role: 'RENTER',
    operatorId: null,
    language: 'en',
  })
  createdUserIds.push(id)
  return id
}

async function seedDocument(): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  await db.insert(consentDocuments).values({
    id,
    type: 'RENTER_TOS',
    version: `v-${id.slice(0, 8)}`,
    locale: 'en',
    title: 'Terms of Service',
    body: 'You agree to the terms.',
    acceptanceLabel: 'I accept',
    contentHash: 'c'.repeat(64),
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  })
  createdDocIds.push(id)
  return { id }
}

/** Insert one RENTER_TOS acceptance as the owner role; returns its id. */
async function seedAcceptance(): Promise<string> {
  const userId = await seedUser()
  const doc = await seedDocument()
  const id = crypto.randomUUID()
  await db.insert(consentAcceptances).values({
    id,
    documentId: doc.id,
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
  })
  createdAcceptanceIds.push(id)
  return id
}

/** Assert a query rejects with Postgres insufficient_privilege (42501), unwrapping driver wrappers. */
async function expectInsufficientPrivilege(run: Promise<unknown>): Promise<void> {
  const err = await run.then(
    () => {
      throw new Error('expected the operation to be rejected with insufficient_privilege')
    },
    (e: unknown) => e as { code?: string; cause?: { code?: string } },
  )
  expect(err.code ?? err.cause?.code).toBe(PG_INSUFFICIENT_PRIVILEGE)
}

beforeAll(async () => {
  await db.select({ one: users.id }).from(users).limit(1)
})

afterAll(async () => {
  if (createdAcceptanceIds.length > 0)
    await db.delete(consentAcceptances).where(inArray(consentAcceptances.id, createdAcceptanceIds))
  if (createdDocIds.length > 0)
    await db.delete(consentDocuments).where(inArray(consentDocuments.id, createdDocIds))
  if (createdUserIds.length > 0) await db.delete(users).where(inArray(users.id, createdUserIds))
  await client.end()
})

describe('consent_acceptances append-only enforcement (#1553, role separation)', () => {
  it('the runtime role MAY INSERT an acceptance (append is allowed)', async () => {
    const userId = await seedUser()
    const doc = await seedDocument()
    const id = crypto.randomUUID()
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${RUNTIME_ROLE}`))
      await tx.insert(consentAcceptances).values({
        id,
        documentId: doc.id,
        consentType: 'RENTER_TOS',
        userId,
        actorRole: 'RENTER',
        acceptedAt: new Date('2026-06-24T00:00:00Z'),
        method: 'CLICKWRAP',
      })
    })
    createdAcceptanceIds.push(id)
    const [row] = await db.select().from(consentAcceptances).where(eq(consentAcceptances.id, id))
    expect(row?.id).toBe(id)
  })

  it('the runtime role may NOT UPDATE an acceptance', async () => {
    const acceptanceId = await seedAcceptance()
    await expectInsufficientPrivilege(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL ROLE ${RUNTIME_ROLE}`))
        await tx
          .update(consentAcceptances)
          .set({ ipAddress: '10.0.0.1' })
          .where(eq(consentAcceptances.id, acceptanceId))
      }),
    )
  })

  it('the runtime role may NOT DELETE an acceptance', async () => {
    const acceptanceId = await seedAcceptance()
    await expectInsufficientPrivilege(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL ROLE ${RUNTIME_ROLE}`))
        await tx.delete(consentAcceptances).where(eq(consentAcceptances.id, acceptanceId))
      }),
    )
  })

  it('the owner (break-glass) role MAY UPDATE and DELETE an acceptance', async () => {
    const acceptanceId = await seedAcceptance()
    await db
      .update(consentAcceptances)
      .set({ ipAddress: '10.0.0.2' })
      .where(eq(consentAcceptances.id, acceptanceId))
    await db.delete(consentAcceptances).where(eq(consentAcceptances.id, acceptanceId))
    const rows = await db
      .select()
      .from(consentAcceptances)
      .where(eq(consentAcceptances.id, acceptanceId))
    expect(rows).toHaveLength(0)
  })
})
