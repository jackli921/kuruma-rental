import { BEST_CAR_RENTAL_OPERATOR_ID, SECOND_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { operatorMemberships, providerInvites, users } from '@kuruma/shared/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { Db } from '../../src/repositories/drizzle'
import {
  DrizzleOperatorMembershipRepository,
  DrizzleOperatorRepository,
  DrizzleProviderInviteRepository,
  DrizzleUserRepository,
} from '../../src/repositories/drizzle'
import { createOperatorTeamRoutes } from '../../src/routes/operator-team'
import type { OperatorMemberDeactivatedAuditEvent } from '../../src/services/operator-team'
import { OperatorTeamService } from '../../src/services/operator-team'
import { ProviderInviteService } from '../../src/services/provider-invite'
import { testAuthMiddleware } from '../helpers/auth'
import { db } from './setup'

// Alias for the repo constructors: postgres-js drizzle and neon-http drizzle
// share the same query API surface but differ in driver type. Integration tests
// cast once (same pattern as user-projection.test.ts and renter-documents.test.ts).
const typedDb = db as unknown as Db

// #1230 slice 6: the picker-admin's write routes proven against real Postgres.
// A PLATFORM_ADMIN with ?operatorId=X writes under X (not a phantom admin tenant);
// a member-id belonging to Y is 404 when X is picked; the last-owner lockout
// fires at 409; and the audit event carries the picked operatorId.
describe('operator-team write routes — picker-admin (?operatorId=) (real Postgres)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const adminId = `tm_admin_${uniq}`
  const ownerXId = `tm_owner_x_${uniq}`
  const staffXId = `tm_staff_x_${uniq}`
  const ownerYId = `tm_owner_y_${uniq}`

  // Picked operator is X (BEST_CAR_RENTAL_OPERATOR_ID), Y is the other tenant.
  const opXId = BEST_CAR_RENTAL_OPERATOR_ID
  const opYId = SECOND_OPERATOR_ID

  let ownerXMembershipId: string
  let staffXMembershipId: string
  let ownerYMembershipId: string
  const auditEvents: OperatorMemberDeactivatedAuditEvent[] = []

  let app: Hono

  function buildApp(): Hono {
    const inviteRepo = new DrizzleProviderInviteRepository(typedDb)
    const membershipRepo = new DrizzleOperatorMembershipRepository(typedDb)
    const userRepo = new DrizzleUserRepository(typedDb)
    const operatorRepo = new DrizzleOperatorRepository(typedDb)
    const inviteService = new ProviderInviteService(
      inviteRepo,
      operatorRepo,
      { webBaseUrl: 'https://app.example.com' },
      () => {},
    )
    const service = new OperatorTeamService(
      inviteRepo,
      membershipRepo,
      userRepo,
      inviteService,
      (event) => {
        auditEvents.push(event)
      },
    )
    const hono = new Hono()
    setupGlobalHandlers(hono)
    // PLATFORM_ADMIN with no operatorId — must pick via ?operatorId=
    hono.use('*', testAuthMiddleware(adminId, 'PLATFORM_ADMIN'))
    hono.route('/', createOperatorTeamRoutes(service))
    return hono
  }

  beforeAll(async () => {
    await db.insert(users).values([
      {
        id: adminId,
        email: `tm-admin-${uniq}@test.com`,
        role: 'PLATFORM_ADMIN',
        language: 'en',
      },
      {
        id: ownerXId,
        email: `tm-owner-x-${uniq}@test.com`,
        role: 'OPERATOR_OWNER',
        language: 'en',
      },
      {
        id: staffXId,
        email: `tm-staff-x-${uniq}@test.com`,
        role: 'OPERATOR_STAFF',
        language: 'en',
      },
      {
        id: ownerYId,
        email: `tm-owner-y-${uniq}@test.com`,
        role: 'OPERATOR_OWNER',
        language: 'en',
      },
    ])
    const membershipRepo = new DrizzleOperatorMembershipRepository(typedDb)
    const mOwnerX = await membershipRepo.create({
      userId: ownerXId,
      operatorId: opXId,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    const mStaffX = await membershipRepo.create({
      userId: staffXId,
      operatorId: opXId,
      role: 'OPERATOR_STAFF',
      status: 'ACTIVE',
    })
    const mOwnerY = await membershipRepo.create({
      userId: ownerYId,
      operatorId: opYId,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    ownerXMembershipId = mOwnerX.id
    staffXMembershipId = mStaffX.id
    ownerYMembershipId = mOwnerY.id
    app = buildApp()
  })

  afterAll(async () => {
    // Remove the invite seeded in (a), scoped tightly by email to avoid
    // touching other tests' rows.
    await db
      .delete(providerInvites)
      .where(
        and(
          eq(providerInvites.operatorId, opXId),
          eq(providerInvites.email, `picker-invite-${uniq}@test.com`),
        ),
      )
    // Memberships are keyed on userId — these IDs are unique to this run.
    await db
      .delete(operatorMemberships)
      .where(inArray(operatorMemberships.userId, [ownerXId, staffXId, ownerYId]))
    await db.delete(users).where(inArray(users.id, [adminId, ownerXId, staffXId, ownerYId]))
  })

  it('(a) POST invite with ?operatorId=X creates a PENDING invite under X', async () => {
    const email = `picker-invite-${uniq}@test.com`
    const res = await app.request(`/operators/me/invites?operatorId=${opXId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.inviteUrl).toContain('/provider/invite/')

    // Confirm the row is stored under opX, not a phantom admin tenant.
    const [row] = await db
      .select()
      .from(providerInvites)
      .where(and(eq(providerInvites.operatorId, opXId), eq(providerInvites.email, email)))
    expect(row).toBeDefined()
    expect(row?.operatorId).toBe(opXId)
    expect(row?.status).toBe('PENDING')
  })

  it('(b) deactivating a member of Y via ?operatorId=X is 404 — cross-tenant id invisible', async () => {
    // ownerYMembershipId belongs to Y; the admin picked X.
    const res = await app.request(
      `/operators/me/members/${ownerYMembershipId}/deactivate?operatorId=${opXId}`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)

    // Y's owner is still ACTIVE — no cross-tenant mutation occurred.
    const [stillActive] = await db
      .select()
      .from(operatorMemberships)
      .where(
        and(
          eq(operatorMemberships.id, ownerYMembershipId),
          eq(operatorMemberships.status, 'ACTIVE'),
        ),
      )
    expect(stillActive).toBeDefined()
  })

  it('(c) deactivating X last owner via ?operatorId=X is 409 — lockout enforced', async () => {
    // ownerX is X's only OPERATOR_OWNER; the lockout counts owners (not total
    // members), so this 409 holds independently of the staff-deactivation in (d).
    const res = await app.request(
      `/operators/me/members/${ownerXMembershipId}/deactivate?operatorId=${opXId}`,
      { method: 'POST' },
    )
    expect(res.status).toBe(409)

    // Owner is still ACTIVE — a rejected deactivate mutates nothing.
    const [stillActive] = await db
      .select()
      .from(operatorMemberships)
      .where(
        and(
          eq(operatorMemberships.id, ownerXMembershipId),
          eq(operatorMemberships.status, 'ACTIVE'),
        ),
      )
    expect(stillActive).toBeDefined()
  })

  it('(d) deactivating X staff via ?operatorId=X is 200 and audit event carries operatorId=X', async () => {
    const res = await app.request(
      `/operators/me/members/${staffXMembershipId}/deactivate?operatorId=${opXId}`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ id: staffXMembershipId })

    // The staff membership row is now REVOKED.
    const [deactivated] = await db
      .select()
      .from(operatorMemberships)
      .where(eq(operatorMemberships.id, staffXMembershipId))
    expect(deactivated?.status).toBe('REVOKED')

    // The audit event names the PICKED operator, not a phantom admin tenant.
    const event = auditEvents.find((e) => e.targetUserId === staffXId)
    expect(event).toBeDefined()
    expect(event?.operatorId).toBe(opXId)
    expect(event?.type).toBe('OPERATOR_MEMBER_DEACTIVATED')
  })
})
