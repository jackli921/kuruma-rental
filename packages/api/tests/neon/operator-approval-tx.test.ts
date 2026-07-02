import { getDb, runTx } from '@kuruma/shared/db'
import { operatorApplications, operators, providerInvites, users } from '@kuruma/shared/db/schema'
// Real-Neon lane (#1387): proves the #1277 operator-approval transaction is
// genuinely all-or-nothing against the PRODUCTION driver, not just the
// single-threaded in-memory fake (which has no rollback — see
// composition/repositories.ts runOperatorApproval). The service's atomicity
// claim (operator INSERT + OWNER-invite INSERT roll back when the in-tx claim
// finds the row already reviewed) is otherwise asserted by no test.
//
// Two cases bracket the tx boundary through the SAME code path:
//   - positive control: a successful approval COMMITS the operator + invite;
//   - rollback: a claim that reports "already reviewed" (undefined) AFTER the
//     writes forces the throw, and both writes must be gone afterwards.
// The only difference between them is whether the claim succeeds, so the pair
// proves the writes' persistence is bound to the tx, not to the harness.
//
// Set NEON_TEST_DATABASE_URL to run it; self-skips otherwise (kept out of the
// unit + docker-integration lanes). `bun run test:neon:local` boots a local
// postgres + Neon proxy via docker and runs this lane with zero Neon usage.
import { neonConfig } from '@neondatabase/serverless'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ws from 'ws'
import {
  DrizzleOperatorApplicationRepository,
  createDrizzleOperatorApproval,
} from '../../src/repositories/drizzle'
import type { RunOperatorApproval } from '../../src/repositories/types'
import { OperatorApplicationService } from '../../src/services/operator-application'

const NEON_URL = process.env.NEON_TEST_DATABASE_URL

// Node/vitest has no global WebSocket; the serverless driver needs one.
neonConfig.webSocketConstructor = ws

// Local-proxy mode: a localhost URL points the driver at the docker Neon proxy
// (docker-compose.ci.yml), exercising the production neon-serverless tx path
// with no Neon branch and no secrets. Any other host = a real Neon branch.
if (NEON_URL && new URL(NEON_URL).hostname === 'localhost') {
  const proxyPort = process.env.NEON_PROXY_PORT ?? '4444'
  neonConfig.useSecureWebSocket = false
  neonConfig.wsProxy = (host) => `${host}:${proxyPort}/v2`
  neonConfig.fetchEndpoint = (host) => `http://${host}:${proxyPort}/sql`
}

const WEB_BASE_URL = 'https://app.example.test'
const noopAudit = () => {}
const uniq = () => crypto.randomUUID().slice(0, 8)

// Domain fields shared by both applications; businessName + contactEmail are
// overridden per case with a unique suffix so slugs/emails never collide with
// each other or with any seed data on the branch.
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

describe.skipIf(!NEON_URL)('operator approval transaction atomicity (#1387)', () => {
  const seededUserIds: string[] = []
  const seededAppIds: string[] = []
  const committedOperatorIds: string[] = []
  let reviewerId: string

  beforeAll(async () => {
    // getDb() and runTx both read process.env.DATABASE_URL — point both at the
    // Neon branch so the read handle and the tx helper can never diverge.
    process.env.DATABASE_URL = NEON_URL
    const db = getDb()
    const [reviewer] = await db
      .insert(users)
      .values({ name: 'Approval Reviewer', email: `reviewer-${uniq()}@example.test` })
      .returning({ id: users.id })
    reviewerId = reviewer!.id
    seededUserIds.push(reviewerId)
  })

  afterAll(async () => {
    const db = getDb()
    // FK-safe order: an approved application references its operator
    // (onDelete restrict), and invites reference operator + reviewer user.
    if (seededAppIds.length > 0) {
      await db.delete(operatorApplications).where(inArray(operatorApplications.id, seededAppIds))
    }
    if (committedOperatorIds.length > 0) {
      await db
        .delete(providerInvites)
        .where(inArray(providerInvites.operatorId, committedOperatorIds))
      await db.delete(operators).where(inArray(operators.id, committedOperatorIds))
    }
    if (seededUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, seededUserIds))
    }
  })

  it('commits the operator + OWNER invite when the approval succeeds (positive control)', async () => {
    const db = getDb()
    const repo = new DrizzleOperatorApplicationRepository(db)
    const email = `commit-${uniq()}@example.test`
    const businessName = `Commit Co ${uniq()}`
    const app = await repo.create({ ...baseApplication, businessName, contactEmail: email })
    seededAppIds.push(app.id)

    const service = new OperatorApplicationService(
      repo,
      noopAudit,
      createDrizzleOperatorApproval(runTx),
      { webBaseUrl: WEB_BASE_URL },
    )
    const result = await service.approve(app.id, reviewerId)
    committedOperatorIds.push(result.operatorId)

    const [operator] = await db.select().from(operators).where(eq(operators.id, result.operatorId))
    expect(operator?.name).toBe(businessName)

    const invites = await db.select().from(providerInvites).where(eq(providerInvites.email, email))
    expect(invites).toHaveLength(1)
    expect(invites[0]).toMatchObject({
      role: 'OPERATOR_OWNER',
      operatorId: result.operatorId,
      invitedByUserId: reviewerId,
      status: 'PENDING',
    })

    const reloaded = await repo.findById(app.id)
    expect(reloaded).toMatchObject({ status: 'APPROVED', operatorId: result.operatorId })
  })

  it('rolls back the operator + invite when the in-tx claim fails', async () => {
    const db = getDb()
    const repo = new DrizzleOperatorApplicationRepository(db)
    const email = `rollback-${uniq()}@example.test`
    const businessName = `Rollback Co ${uniq()}`
    const app = await repo.create({ ...baseApplication, businessName, contactEmail: email })
    seededAppIds.push(app.id)

    // Wrap the real drizzle approval tx: the C1 guards, operator INSERT and
    // invite INSERT run for real, then the claim reports the row already
    // reviewed (undefined) — the exact signal a concurrent approval winning the
    // race produces. The service throws, which must roll the whole tx back.
    //
    // The swapped claim also probes the tx before returning: the service runs
    // markApprovedIfPending AFTER invites.create, so at claim time the pending
    // invite must already be visible on this tx connection. Capturing that turns
    // the post-rollback "no phantom invite" check below into a real rollback
    // assertion — without it, a future reorder that ran the claim BEFORE
    // invites.create would never insert the invite, and the empty-check would
    // pass vacuously rather than proving the write was rolled back.
    const realRun = createDrizzleOperatorApproval(runTx)
    let inviteVisibleInTxAtClaim = false
    const failingClaimRun: RunOperatorApproval = (fn) =>
      realRun((repos) =>
        fn({
          ...repos,
          applications: {
            markApprovedIfPending: async () => {
              const live = await repos.invites.findPendingByEmail(email)
              inviteVisibleInTxAtClaim = live !== undefined
              return undefined
            },
          },
        }),
      )

    const service = new OperatorApplicationService(repo, noopAudit, failingClaimRun, {
      webBaseUrl: WEB_BASE_URL,
    })
    await expect(service.approve(app.id, reviewerId)).rejects.toThrow('already reviewed')

    // The invite INSERT genuinely executed inside the tx (its row was visible on
    // the tx connection when the claim ran) — so the phantom-invite assertion
    // below proves rollback, not a write that never happened. See the probe above.
    expect(inviteVisibleInTxAtClaim).toBe(true)

    // The operator + invite created inside the tx are gone (rolled back), so no
    // orphan operator and no phantom invite that would corrupt later C1 checks.
    const orphanOperators = await db
      .select()
      .from(operators)
      .where(eq(operators.name, businessName))
    expect(orphanOperators).toHaveLength(0)

    const phantomInvites = await db
      .select()
      .from(providerInvites)
      .where(eq(providerInvites.email, email))
    expect(phantomInvites).toHaveLength(0)

    // The application is untouched: still PENDING, still unlinked.
    const reloaded = await repo.findById(app.id)
    expect(reloaded).toMatchObject({ status: 'PENDING', operatorId: null })
  })
})
