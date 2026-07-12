import { getDb, runTx } from '@kuruma/shared/db'
import {
  operatorApplications,
  operatorMemberships,
  operators,
  users,
} from '@kuruma/shared/db/schema'
// Real-Neon lane: proves the Task-6 rewrite of approve() is genuinely all-or-nothing
// against the PRODUCTION driver. The approval tx writes:
//   1. operator INSERT
//   2. operatorMemberships INSERT (OPERATOR_OWNER, ACTIVE)
//   3. users UPDATE (role + operatorId projection)
//   4. operatorApplications UPDATE (status → APPROVED, race fence)
// If the race fence returns falsy (step 4), all prior writes must roll back.
//
// Two cases bracket the tx boundary through the SAME code path:
//   - positive control: successful approval commits operator + membership + projection
//   - rollback: injected fence failure AFTER the three writes must leave zero orphans
//
// Set NEON_TEST_DATABASE_URL to run; self-skips otherwise.
// Run locally: NEON_TEST_DATABASE_URL="postgresql://kuruma:kuruma@localhost:5709/kuruma_onboard" bun run --filter @kuruma/api test:neon
import { neonConfig } from '@neondatabase/serverless'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ws from 'ws'
import {
  DrizzleOperatorApplicationRepository,
  DrizzleOperatorMembershipRepository,
  DrizzleUserRepository,
  createDrizzleOperatorApproval,
} from '../../src/repositories/drizzle'
import type { RunOperatorApproval } from '../../src/repositories/types'
import { OperatorApplicationService } from '../../src/services/operator-application'

const NEON_URL = process.env.NEON_TEST_DATABASE_URL

neonConfig.webSocketConstructor = ws

if (NEON_URL && new URL(NEON_URL).hostname === 'localhost') {
  const proxyPort = process.env.NEON_PROXY_PORT ?? '4444'
  neonConfig.useSecureWebSocket = false
  neonConfig.wsProxy = (host) => `${host}:${proxyPort}/v2`
  neonConfig.fetchEndpoint = (host) => `http://${host}:${proxyPort}/sql`
}

const WEB_BASE_URL = 'https://app.example.test'
const noopAudit = () => {}
const uniq = () => crypto.randomUUID().slice(0, 8)

const baseApplication = {
  contactName: 'Hiroshi',
  contactPhone: '+81 80 1234 5678',
  serviceArea: 'Tokyo',
  estimatedFleetSize: '6-20' as const,
  website: null,
  businessLicenseNumber: null,
  businessType: null,
  message: null,
  submittedLocale: 'en' as const,
}

describe.skipIf(!NEON_URL)('operator approval promotion transaction atomicity (Task 6)', () => {
  const seededUserIds: string[] = []
  const seededAppIds: string[] = []
  const usedOperatorNames: string[] = []
  let reviewerId: string

  beforeAll(async () => {
    process.env.DATABASE_URL = NEON_URL
    const db = getDb()
    const [reviewer] = await db
      .insert(users)
      .values({ name: 'Approval Reviewer', email: `reviewer-promo-${uniq()}@example.test` })
      .returning({ id: users.id })
    reviewerId = reviewer!.id
    seededUserIds.push(reviewerId)
  })

  afterAll(async () => {
    const db = getDb()
    // FK-safe order: applications reference operators (onDelete restrict), memberships
    // reference both operators and users, users.operatorId references operators.
    // Drop in reverse dependency order: apps → memberships → operators → users.
    if (seededAppIds.length > 0) {
      await db.delete(operatorApplications).where(inArray(operatorApplications.id, seededAppIds))
    }
    if (seededUserIds.length > 0) {
      // Reset any promoted users back before deleting operators they reference.
      await db
        .update(users)
        .set({ role: 'RENTER', operatorId: null, updatedAt: new Date() })
        .where(inArray(users.id, seededUserIds))
    }
    if (usedOperatorNames.length > 0) {
      // Delete memberships that reference these operators first.
      const orphanOps = await db
        .select({ id: operators.id })
        .from(operators)
        .where(inArray(operators.name, usedOperatorNames))
      const orphanOpIds = orphanOps.map((o) => o.id)
      if (orphanOpIds.length > 0) {
        await db
          .delete(operatorMemberships)
          .where(inArray(operatorMemberships.operatorId, orphanOpIds))
        await db.delete(operators).where(inArray(operators.id, orphanOpIds))
      }
    }
    if (seededUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, seededUserIds))
    }
  })

  it('commits operator + OWNER membership + users projection atomically (positive control)', async () => {
    const db = getDb()
    const repo = new DrizzleOperatorApplicationRepository(db)
    const suffix = uniq()
    const email = `promo-commit-${suffix}@example.test`
    const businessName = `Promo Commit Co ${suffix}`
    usedOperatorNames.push(businessName)

    // Seed an applicant user (RENTER) linked to the application.
    const [applicant] = await db
      .insert(users)
      .values({ name: 'Applicant Commit', email })
      .returning({ id: users.id })
    const applicantUserId = applicant!.id
    seededUserIds.push(applicantUserId)

    const app = await repo.create({
      ...baseApplication,
      businessName,
      contactEmail: email,
      applicantUserId,
    })
    seededAppIds.push(app.id)

    const service = new OperatorApplicationService(
      repo,
      noopAudit,
      createDrizzleOperatorApproval(runTx),
      { webBaseUrl: WEB_BASE_URL, fromAddress: 'noreply@test.io' },
      new DrizzleOperatorMembershipRepository(db),
      new DrizzleUserRepository(db),
      { send: async () => ({ providerMessageId: 'noop' }) },
    )
    const result = await service.approve(app.id, reviewerId)

    // Operator row committed.
    const [operator] = await db.select().from(operators).where(eq(operators.id, result.operatorId))
    expect(operator?.slug).toBe(result.operatorSlug)

    // OWNER membership committed (exactly one, ACTIVE).
    const memberships = await db
      .select()
      .from(operatorMemberships)
      .where(eq(operatorMemberships.operatorId, result.operatorId))
    expect(memberships).toHaveLength(1)
    expect(memberships[0]).toMatchObject({
      userId: applicantUserId,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })

    // users projection committed (role + operatorId).
    const [promoted] = await db.select().from(users).where(eq(users.id, applicantUserId))
    expect(promoted).toMatchObject({ role: 'OPERATOR_OWNER', operatorId: result.operatorId })

    // Application marked APPROVED and linked.
    const [appRow] = await db
      .select()
      .from(operatorApplications)
      .where(eq(operatorApplications.id, app.id))
    expect(appRow?.status).toBe('APPROVED')
    expect(appRow?.operatorId).toBe(result.operatorId)
  })

  it('rolls back operator + membership + users projection when the in-tx fence fails', async () => {
    const db = getDb()
    const repo = new DrizzleOperatorApplicationRepository(db)
    const suffix = uniq()
    const email = `promo-rollback-${suffix}@example.test`
    const businessName = `Promo Rollback Co ${suffix}`
    usedOperatorNames.push(businessName)

    // Seed a second applicant user for the rollback case.
    const [applicant] = await db
      .insert(users)
      .values({ name: 'Applicant Rollback', email })
      .returning({ id: users.id })
    const applicantUserId = applicant!.id
    seededUserIds.push(applicantUserId)

    const app = await repo.create({
      ...baseApplication,
      businessName,
      contactEmail: email,
      applicantUserId,
    })
    seededAppIds.push(app.id)

    // Wrap the real drizzle approval runner so that after the three writes (operator +
    // membership + users projection), markApprovedIfPending returns undefined — the
    // exact signal a concurrent approval winning the race produces. The service then
    // throws ConflictError, which must roll back all three writes.
    //
    // The injected markApprovedIfPending also probes the tx before returning: it
    // reads back the users row ON THE SAME TX CONNECTION to confirm the projection
    // write was already visible inside the tx at claim time. This turns the
    // post-rollback "role is still RENTER" assertion into a genuine rollback proof —
    // without the probe, a future reorder that runs the fence BEFORE the projection
    // write would mean the check passes vacuously rather than proving the write rolled back.
    const realRun = createDrizzleOperatorApproval(runTx)
    let projectionVisibleInTxAtClaim = false
    const failingFenceRun: RunOperatorApproval = (fn) =>
      realRun((repos) =>
        fn({
          ...repos,
          applications: {
            markApprovedIfPending: async () => {
              // Probe: read the users row through the TX-bound repo (same connection).
              const txUser = await repos.users.findByEmail(email)
              projectionVisibleInTxAtClaim = txUser?.role === 'OPERATOR_OWNER'
              return undefined // simulate the concurrent-approval race: fence returns falsy
            },
          },
        }),
      )

    const service = new OperatorApplicationService(
      repo,
      noopAudit,
      failingFenceRun,
      { webBaseUrl: WEB_BASE_URL, fromAddress: 'noreply@test.io' },
      new DrizzleOperatorMembershipRepository(db),
      new DrizzleUserRepository(db),
      { send: async () => ({ providerMessageId: 'noop' }) },
    )
    await expect(service.approve(app.id, reviewerId)).rejects.toThrow('already reviewed')

    // The projection write genuinely executed inside the tx (visible on the tx connection
    // when the fence ran) — so the assertions below prove rollback, not writes that never happened.
    expect(projectionVisibleInTxAtClaim).toBe(true)

    // No orphan operator.
    const orphanOperators = await db
      .select()
      .from(operators)
      .where(eq(operators.name, businessName))
    expect(orphanOperators).toHaveLength(0)

    // No orphan membership for this applicant.
    const orphanMemberships = await db
      .select()
      .from(operatorMemberships)
      .where(eq(operatorMemberships.userId, applicantUserId))
    expect(orphanMemberships).toHaveLength(0)

    // users projection rolled back: role still RENTER, operatorId still null.
    const [notPromoted] = await db.select().from(users).where(eq(users.id, applicantUserId))
    expect(notPromoted).toMatchObject({ role: 'RENTER', operatorId: null })

    // Application untouched: still PENDING, still unlinked.
    const reloaded = await repo.findById(app.id)
    expect(reloaded).toMatchObject({ status: 'PENDING', operatorId: null })
  })
})
