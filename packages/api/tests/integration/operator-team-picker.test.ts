import { operatorMemberships, operators, providerInvites, users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError } from '../../src/auth/guards'
import type { CallerContext } from '../../src/middleware/auth'
import {
  DrizzleOperatorMembershipRepository,
  DrizzleOperatorRepository,
  DrizzleProviderInviteRepository,
  DrizzleUserRepository,
} from '../../src/repositories/drizzle'
import {
  type OperatorMemberDeactivatedAuditEvent,
  OperatorTeamService,
} from '../../src/services/operator-team'
import { ProviderInviteService } from '../../src/services/provider-invite'
import { db } from './setup'

// #1230 slice 6: a PLATFORM_ADMIN drives the operator team surface via
// `?operatorId=`. The picker path resolves the target tenant through
// resolveTeamOperatorId, so the write lands on the PICKED operator (X), never the
// admin's absent tenant — and the scope + last-owner + audit invariants hold
// against real Postgres, not just the in-memory twin.
describe('operator team writes as a picked operator (Drizzle, real Postgres) (#1230)', () => {
  const inviteRepo = new DrizzleProviderInviteRepository(db)
  const membershipRepo = new DrizzleOperatorMembershipRepository(db)
  const userRepo = new DrizzleUserRepository(db)
  const operatorRepo = new DrizzleOperatorRepository(db)
  const inviteService = new ProviderInviteService(
    inviteRepo,
    operatorRepo,
    { webBaseUrl: 'https://app.example.com' },
    () => {},
  )
  const recordedAudits: OperatorMemberDeactivatedAuditEvent[] = []
  const service = new OperatorTeamService(
    inviteRepo,
    membershipRepo,
    userRepo,
    inviteService,
    (e) => recordedAudits.push(e),
  )

  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opXId = `op_team_x_${uniq}`
  const opYId = `op_team_y_${uniq}`
  const adminId = crypto.randomUUID()
  const ownerXId = crypto.randomUUID()
  const staffXId = crypto.randomUUID()
  const memberYId = crypto.randomUUID()
  let ownerXMembershipId: string
  let staffXMembershipId: string
  let memberYMembershipId: string

  // A PLATFORM_ADMIN carries NO operatorId — the target tenant rides in via the pick.
  const ADMIN_CTX: CallerContext = { userId: adminId, role: 'PLATFORM_ADMIN', bypassScope: true }

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opXId, slug: `team-x-${uniq}`, name: 'Team Operator X' },
      { id: opYId, slug: `team-y-${uniq}`, name: 'Team Operator Y' },
    ])
    await db.insert(users).values([
      {
        id: adminId,
        email: `admin-${uniq}@kuruma-test.com`,
        role: 'PLATFORM_ADMIN',
        language: 'en',
      },
      {
        id: ownerXId,
        email: `ownerx-${uniq}@kuruma-test.com`,
        role: 'OPERATOR_OWNER',
        language: 'en',
        operatorId: opXId,
      },
      {
        id: staffXId,
        email: `staffx-${uniq}@kuruma-test.com`,
        role: 'OPERATOR_STAFF',
        language: 'en',
        operatorId: opXId,
      },
      {
        id: memberYId,
        email: `membery-${uniq}@kuruma-test.com`,
        role: 'OPERATOR_OWNER',
        language: 'en',
        operatorId: opYId,
      },
    ])
    ownerXMembershipId = (
      await membershipRepo.create({
        userId: ownerXId,
        operatorId: opXId,
        role: 'OPERATOR_OWNER',
        status: 'ACTIVE',
      })
    ).id
    staffXMembershipId = (
      await membershipRepo.create({
        userId: staffXId,
        operatorId: opXId,
        role: 'OPERATOR_STAFF',
        status: 'ACTIVE',
      })
    ).id
    memberYMembershipId = (
      await membershipRepo.create({
        userId: memberYId,
        operatorId: opYId,
        role: 'OPERATOR_OWNER',
        status: 'ACTIVE',
      })
    ).id
  })

  afterAll(async () => {
    await db.delete(providerInvites).where(inArray(providerInvites.operatorId, [opXId, opYId]))
    await db
      .delete(operatorMemberships)
      .where(inArray(operatorMemberships.operatorId, [opXId, opYId]))
    await db.delete(users).where(inArray(users.id, [adminId, ownerXId, staffXId, memberYId]))
    await db.delete(operators).where(inArray(operators.id, [opXId, opYId]))
  })

  it('(a) mints the invite under the PICKED operator X, stamping the admin as inviter — not its absent tenant', async () => {
    await service.inviteStaff(ADMIN_CTX, { email: `newstaff-${uniq}@op-x.com` }, opXId)
    const rows = await inviteRepo.listByOperator(opXId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.operatorId).toBe(opXId)
    expect(rows[0]?.invitedByUserId).toBe(adminId)
    expect(rows[0]?.status).toBe('PENDING')
  })

  it('(b) deactivating a member of Y via ?operatorId=X is 404 — the id is resolved within the PICKED tenant', async () => {
    await expect(service.deactivateMember(ADMIN_CTX, memberYMembershipId, opXId)).rejects.toThrow(
      NotFoundError,
    )
    // The Y member is untouched — the cross-tenant id never matched X's roster.
    expect((await membershipRepo.findActiveByOperator(opYId)).map((m) => m.id)).toContain(
      memberYMembershipId,
    )
  })

  it('(c) deactivating X’s last active owner is 409, even for the admin', async () => {
    await expect(service.deactivateMember(ADMIN_CTX, ownerXMembershipId, opXId)).rejects.toThrow(
      ConflictError,
    )
  })

  it('(d) deactivating X’s staff succeeds and the audit names the PICKED operator + admin actor', async () => {
    await service.deactivateMember(ADMIN_CTX, staffXMembershipId, opXId)
    expect((await membershipRepo.findActiveByOperator(opXId)).map((m) => m.id)).not.toContain(
      staffXMembershipId,
    )
    expect(recordedAudits).toContainEqual({
      type: 'OPERATOR_MEMBER_DEACTIVATED',
      operatorId: opXId,
      actorUserId: adminId,
      targetUserId: staffXId,
    })
  })
})
