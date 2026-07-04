import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError } from '../auth/guards'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryOperatorApplicationRepository } from '../repositories/in-memory/operator-application'
import { InMemoryOperatorMembershipRepository } from '../repositories/in-memory/operator-membership'
import { InMemoryProviderInviteRepository } from '../repositories/in-memory/provider-invite'
import { InMemoryUserRepository } from '../repositories/in-memory/user'
import type { Operator, OperatorApplication, ProviderInvite } from '../stores'
import { OperatorApplicationService } from './operator-application'

const input = {
  businessName: 'Osaka Rentals',
  contactName: 'Aiko',
  contactEmail: 'aiko@example.com',
  contactPhone: '+81 90',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20' as const,
  website: undefined,
  businessLicenseNumber: undefined,
  businessType: undefined,
  message: undefined,
  submittedLocale: 'en' as const,
}

describe('OperatorApplicationService.submit', () => {
  let repo: InMemoryOperatorApplicationRepository
  let service: OperatorApplicationService
  beforeEach(() => {
    repo = new InMemoryOperatorApplicationRepository()
    service = makeService(repo)
  })

  it('persists a PENDING application and returns {id,status}', async () => {
    const r = await service.submit(input)
    expect(r).toMatchObject({ status: 'PENDING' })
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
  it('throws ConflictError on a duplicate live email', async () => {
    await service.submit(input)
    await expect(service.submit(input)).rejects.toThrow(ConflictError)
    await expect(service.submit(input)).rejects.toThrow('already')
  })
})

describe('OperatorApplicationService.list + reject', () => {
  let repo: InMemoryOperatorApplicationRepository
  let recordAudit: ReturnType<typeof vi.fn>
  let service: OperatorApplicationService

  beforeEach(() => {
    repo = new InMemoryOperatorApplicationRepository()
    recordAudit = vi.fn()
    service = makeService(repo, recordAudit)
  })

  it('list() returns applications newest-first', async () => {
    // Use fake timers so both records have distinct createdAt values — without
    // this, both are stamped at the same millisecond and the tie-break is by id.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    const a = await service.submit(input)
    vi.setSystemTime(new Date('2024-01-02T00:00:00Z'))
    const b = await service.submit({ ...input, contactEmail: 'other@example.com' })
    vi.useRealTimers()

    const all = await service.list({ limit: 50, offset: 0 })
    // b has a later createdAt so it sorts first (newest-first)
    expect(all).toHaveLength(2)
    expect(all[0]?.id).toBe(b.id)
    expect(all[1]?.id).toBe(a.id)
  })

  it('reject() flips status to REJECTED and returns the updated row', async () => {
    const { id } = await service.submit(input)
    const adminUserId = 'admin-user-1'
    const reason = 'Does not meet requirements'

    const row = await service.reject(id, adminUserId, reason)

    expect(row.id).toBe(id)
    expect(row.status).toBe('REJECTED')
    expect(row.reviewedByUserId).toBe(adminUserId)
    expect(row.rejectionReason).toBe(reason)
    expect(row.reviewedAt).toBeInstanceOf(Date)
  })

  it('reject() emits exactly one OPERATOR_APPLICATION_REJECTED audit event', async () => {
    const { id } = await service.submit(input)
    const adminUserId = 'admin-user-1'

    await service.reject(id, adminUserId, 'Too small fleet')

    expect(recordAudit).toHaveBeenCalledTimes(1)
    expect(recordAudit).toHaveBeenCalledWith({
      type: 'OPERATOR_APPLICATION_REJECTED',
      actorUserId: adminUserId,
      applicationId: id,
    })
  })

  it('reject() throws NotFoundError for a missing id and emits no audit event', async () => {
    await expect(service.reject('no-such-id', 'admin-1', 'reason')).rejects.toThrow(NotFoundError)
    await expect(service.reject('no-such-id', 'admin-1', 'reason')).rejects.toThrow(
      'no pending application with that id',
    )
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it('reject() on an already-rejected (non-PENDING) application throws NotFoundError', async () => {
    const { id } = await service.submit(input)
    await service.reject(id, 'admin-1', 'first rejection')
    await expect(service.reject(id, 'admin-1', 'again')).rejects.toThrow(NotFoundError)
    // The audit event fired once for the first (successful) rejection only.
    expect(recordAudit).toHaveBeenCalledTimes(1)
  })

  it('list(status) filters by status', async () => {
    const pending = await service.submit(input)
    const toReject = await service.submit({ ...input, contactEmail: 'reject@example.com' })
    await service.reject(toReject.id, 'admin-1', 'no')

    const onlyPending = await service.list({ status: 'PENDING', limit: 50, offset: 0 })
    expect(onlyPending).toHaveLength(1)
    expect(onlyPending[0]?.id).toBe(pending.id)

    const onlyRejected = await service.list({ status: 'REJECTED', limit: 50, offset: 0 })
    expect(onlyRejected).toHaveLength(1)
    expect(onlyRejected[0]?.id).toBe(toReject.id)
  })
})

describe('OperatorApplicationService.approve', () => {
  const base = {
    businessName: 'Tokyo Wheels',
    contactName: 'Hiroshi',
    contactEmail: 'owner@example.com',
    contactPhone: '+81 80 1234 5678',
    serviceArea: 'Tokyo',
    estimatedFleetSize: '6-20' as const,
    website: null,
    businessLicenseNumber: null,
    businessType: null,
    message: null,
    submittedLocale: 'en' as const,
  }

  function setupApprove() {
    // External Maps so the transactional runApproval below can snapshot + restore
    // them, faithfully emulating the real runTx rollback boundary in production.
    const inviteStore = new Map<string, ProviderInvite>()
    const operatorStore = new Map<string, Operator>()
    const applicationStore = new Map<string, OperatorApplication>()
    const applications = new InMemoryOperatorApplicationRepository(applicationStore)
    const operators = new InMemoryOperatorRepository(operatorStore)
    const invites = new InMemoryProviderInviteRepository(inviteStore)
    const users = new InMemoryUserRepository()
    const memberships = new InMemoryOperatorMembershipRepository()
    const audit = vi.fn()

    // Transactional passthrough: snapshot the mutable stores, run the approval
    // callback, and roll the stores back if it throws — so a race-fence throw
    // (markApprovedIfPending -> undefined) or an exhausted slug retry leaves no
    // orphaned operator/invite, exactly as the real DB transaction guarantees.
    const runOperatorApproval = async <T>(
      fn: (repos: {
        users: typeof users
        memberships: typeof memberships
        invites: typeof invites
        operators: typeof operators
        applications: typeof applications
      }) => Promise<T>,
    ): Promise<T> => {
      const opSnapshot = new Map(operatorStore)
      const appSnapshot = new Map(applicationStore)
      const inviteSnapshot = new Map(inviteStore)
      try {
        return await fn({ users, memberships, invites, operators, applications })
      } catch (err) {
        restoreStore(operatorStore, opSnapshot)
        restoreStore(applicationStore, appSnapshot)
        restoreStore(inviteStore, inviteSnapshot)
        throw err
      }
    }

    const service = new OperatorApplicationService(applications, audit, runOperatorApproval, {
      webBaseUrl: 'https://app.example.com',
    })
    return {
      service,
      repos: { applications, operators, invites, users, memberships, inviteStore },
      audit,
    }
  }

  it('provisions operator + invite and returns inviteUrl on first approval', async () => {
    const { service, repos, audit } = setupApprove()
    const { id } = await repos.applications.create(base)

    const r = await service.approve(id, 'admin-1')

    expect(r.inviteUrl).toMatch(/\/provider\/invite\//)

    const operator = await repos.operators.findBySlug(r.operatorSlug)
    expect(operator).toBeTruthy()
    expect(operator?.name).toBe(base.businessName)

    expect(repos.inviteStore.size).toBe(1)
    const invite = [...repos.inviteStore.values()][0]
    expect(invite).toMatchObject({
      role: 'OPERATOR_OWNER',
      email: 'owner@example.com',
      invitedByUserId: 'admin-1',
      acceptedByUserId: null,
      status: 'PENDING',
    })

    const reloaded = await repos.applications.findById(id)
    expect(reloaded).toMatchObject({ status: 'APPROVED', operatorId: r.operatorId })

    const auditTypes = (audit.mock.calls as [{ type: string }][]).map(([e]) => e.type)
    expect(auditTypes).toContain('PROVIDER_INVITE_CREATED')
    expect(auditTypes).toContain('OPERATOR_APPLICATION_APPROVED')
  })

  it('is idempotency-safe: second approve on same id throws and creates no duplicates', async () => {
    const { service, repos } = setupApprove()
    const { id } = await repos.applications.create(base)

    await service.approve(id, 'admin-1')
    await expect(service.approve(id, 'admin-1')).rejects.toThrow(/already reviewed/)

    expect(repos.inviteStore.size).toBe(1)
    expect((await repos.operators.list()).length).toBe(1)
  })

  it('C1 — blocks approval when contactEmail already has an active membership', async () => {
    const { service, repos } = setupApprove()
    const { id } = await repos.applications.create(base)

    // Seed an existing user + ACTIVE membership for the same email.
    const existingUser = await repos.users.quickCreate({
      name: 'Existing Owner',
      email: base.contactEmail,
      phone: null,
      language: 'en',
    })
    const existingOperator = await repos.operators.create({
      name: 'Old Co',
      slug: 'old-co',
      preAuthHandoffUrl: null,
    })
    await repos.memberships.create({
      userId: existingUser.id,
      operatorId: existingOperator.id,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })

    await expect(service.approve(id, 'admin-1')).rejects.toThrow(/already has/)
    // No new operator should have been created beyond the pre-seeded one.
    expect((await repos.operators.list()).length).toBe(1)
  })

  it('retries once on a concurrent operators.slug race, then provisions successfully', async () => {
    const { service, repos } = setupApprove()
    const { id } = await repos.applications.create(base)

    // First attempt loses the operators_slug_unique race; the retry re-resolves a
    // fresh slug against the now-committed row and succeeds (#1371b). The minted
    // invite is reused across attempts, so only one invite exists at the end.
    const realCreate = repos.operators.create.bind(repos.operators)
    let attempts = 0
    repos.operators.create = (data) => {
      attempts += 1
      if (attempts === 1) {
        return Promise.reject(
          Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint_name: 'operators_slug_unique',
          }),
        )
      }
      return realCreate(data)
    }

    const r = await service.approve(id, 'admin-1')

    expect(attempts).toBe(2)
    expect(await repos.operators.findBySlug(r.operatorSlug)).toMatchObject({
      name: base.businessName,
    })
    expect(repos.inviteStore.size).toBe(1)
    expect(await repos.applications.findById(id)).toMatchObject({ status: 'APPROVED' })
  })

  it('surfaces a distinct retryable 409 — never "already reviewed" — when the slug race persists', async () => {
    const { service, repos } = setupApprove()
    const { id } = await repos.applications.create(base)

    // Every attempt loses the slug race: after SLUG_ATTEMPTS the loser gets an
    // accurate, retryable message — critically NOT the misleading review conflict
    // the old catch-all mapping produced (#1371b).
    repos.operators.create = () =>
      Promise.reject(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint_name: 'operators_slug_unique',
        }),
      )

    const err = await service.approve(id, 'admin-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    const message = err instanceof Error ? err.message : String(err)
    expect(message).toMatch(/could not allocate a unique operator slug/)
    expect(message).not.toMatch(/already reviewed/)
    // Rolled back: the application is left PENDING and nothing was provisioned,
    // so a genuine retry can still succeed.
    expect(await repos.applications.findById(id)).toMatchObject({ status: 'PENDING' })
    expect((await repos.operators.list()).length).toBe(0)
    expect(repos.inviteStore.size).toBe(0)
  })

  it('race fence: markApprovedIfPending -> undefined rolls back the operator + invite', async () => {
    const { service, repos } = setupApprove()
    const { id } = await repos.applications.create(base)

    // A concurrent approval won the atomic claim: our tx created the operator +
    // invite, then the fence returns undefined -> ConflictError -> full rollback.
    repos.applications.markApprovedIfPending = () => Promise.resolve(undefined)

    const err = await service.approve(id, 'admin-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    const message = err instanceof Error ? err.message : String(err)
    expect(message).toMatch(/already reviewed/)
    // Rollback proof: nothing the tx created survives.
    expect((await repos.operators.list()).length).toBe(0)
    expect(repos.inviteStore.size).toBe(0)
    // The pre-existing application row is left PENDING for a real retry.
    expect(await repos.applications.findById(id)).toMatchObject({ status: 'PENDING' })
  })

  it('C1 — blocks approval when contactEmail already has a live pending invite', async () => {
    const { service, repos } = setupApprove()
    const { id } = await repos.applications.create(base)

    // Seed a pending invite for the same email at a different operator.
    const otherOperator = await repos.operators.create({
      name: 'Other Co',
      slug: 'other-co',
      preAuthHandoffUrl: null,
    })
    // Manually insert a PENDING invite with a dummy tokenHash (not testing token generation here).
    await repos.invites.create({
      email: base.contactEmail,
      operatorId: otherOperator.id,
      role: 'OPERATOR_OWNER',
      tokenHash: 'deadbeef'.repeat(8), // 64-char placeholder
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: 'some-admin',
      acceptedByUserId: null,
    })

    await expect(service.approve(id, 'admin-1')).rejects.toThrow(/invited/)
  })

  describe('remintInvite (#1370)', () => {
    it('revokes the stale invite and issues a fresh one for an approved application', async () => {
      const { service, repos, audit } = setupApprove()
      const { id } = await repos.applications.create(base)
      const first = await service.approve(id, 'admin-1')

      const second = await service.remintInvite(id, 'admin-2')

      // A genuinely new link (fresh token), not the lost/expired one.
      expect(second.inviteUrl).not.toBe(first.inviteUrl)
      expect(second.inviteUrl).toMatch(/\/provider\/invite\//)
      // Exactly one live invite remains; the prior one is revoked (kept for audit).
      const invites = [...repos.inviteStore.values()]
      expect(invites.filter((i) => i.status === 'PENDING')).toHaveLength(1)
      expect(invites.filter((i) => i.status === 'REVOKED')).toHaveLength(1)
      // The fresh invite is emitted through the same audit sink, crediting the
      // re-minting admin.
      const reminted = (audit.mock.calls as [{ type: string; invitedByUserId?: string }][])
        .map(([e]) => e)
        .filter((e) => e.type === 'PROVIDER_INVITE_CREATED' && e.invitedByUserId === 'admin-2')
      expect(reminted).toHaveLength(1)
    })

    it('refuses to re-invite an application that is not APPROVED (409)', async () => {
      const { service, repos } = setupApprove()
      const { id } = await repos.applications.create(base) // still PENDING

      const err = await service.remintInvite(id, 'admin-1').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ConflictError)
      expect(err instanceof Error ? err.message : '').toMatch(/only an approved application/)
    })

    it('throws NotFoundError for an unknown id', async () => {
      const { service } = setupApprove()
      await expect(service.remintInvite('no-such-id', 'admin-1')).rejects.toThrow(NotFoundError)
    })

    it('maps a concurrent re-invite race (pending-email 23505) to a retryable 409', async () => {
      const { service, repos } = setupApprove()
      const { id } = await repos.applications.create(base)
      await service.approve(id, 'admin-1') // real invite created

      // A concurrent remint claimed the (operatorId,email) pending slot between our
      // revoke and insert: the create loses the partial-unique index.
      repos.invites.create = () =>
        Promise.reject(
          Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint_name: 'provider_invites_pending_email_unique',
          }),
        )

      const err = await service.remintInvite(id, 'admin-2').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ConflictError)
      expect(err instanceof Error ? err.message : '').toMatch(/re-invite is already in progress/)
    })

    it('refuses to re-invite once the owner has onboarded (active membership) → 409', async () => {
      const { service, repos } = setupApprove()
      const { id } = await repos.applications.create(base)
      const approved = await service.approve(id, 'admin-1')

      // Simulate the owner accepting: a user + ACTIVE membership now exist.
      const owner = await repos.users.quickCreate({
        name: 'Owner',
        email: base.contactEmail,
        phone: null,
        language: 'en',
      })
      await repos.memberships.create({
        userId: owner.id,
        operatorId: approved.operatorId,
        role: 'OPERATOR_OWNER',
        status: 'ACTIVE',
      })

      const err = await service.remintInvite(id, 'admin-2').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ConflictError)
      expect(err instanceof Error ? err.message : '').toMatch(/already has an operator/)
    })

    it('C1 — refuses re-mint when the email holds a pending invite at another operator', async () => {
      const { service, repos } = setupApprove()
      const { id } = await repos.applications.create(base)
      const approved = await service.approve(id, 'admin-1')

      // The original owner link is lost, so this operator has no live invite left...
      const own = [...repos.inviteStore.values()].find(
        (i) => i.operatorId === approved.operatorId && i.status === 'PENDING',
      )
      await repos.invites.revoke(own!.id, approved.operatorId)
      // ...but the same email now holds a live pending invite at a DIFFERENT operator.
      const other = await repos.operators.create({
        name: 'Other Co',
        slug: 'other-co',
        preAuthHandoffUrl: null,
      })
      await repos.invites.create({
        email: base.contactEmail,
        operatorId: other.id,
        role: 'OPERATOR_OWNER',
        tokenHash: 'deadbeef'.repeat(8),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedByUserId: 'some-admin',
        acceptedByUserId: null,
      })

      // findPendingByEmail is cross-operator but revoke is operator-scoped: without the
      // C1 check the scoped revoke no-ops and a second live invite is minted (#1277).
      const err = await service.remintInvite(id, 'admin-2').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ConflictError)
      expect(err instanceof Error ? err.message : '').toMatch(/invited/)
      // The other operator's invite is untouched and NO duplicate was minted.
      const pending = [...repos.inviteStore.values()].filter((i) => i.status === 'PENDING')
      expect(pending).toHaveLength(1)
      expect(pending[0]?.operatorId).toBe(other.id)
    })
  })
})

// Roll a Map store back to a saved snapshot — the rollback half of the test's
// transactional runApproval (see setupApprove).
function restoreStore<V>(store: Map<string, V>, saved: Map<string, V>): void {
  store.clear()
  for (const [k, v] of saved) store.set(k, v)
}

function makeService(
  repo: InMemoryOperatorApplicationRepository,
  recordAudit: ReturnType<typeof vi.fn> = vi.fn(),
) {
  // Provide a stub runOperatorApproval that throws if accidentally called in
  // submit/reject tests — they don't need the approval transaction.
  const stubRunApproval = () => {
    throw new Error('runOperatorApproval called unexpectedly in non-approve test')
  }
  return new OperatorApplicationService(repo, recordAudit, stubRunApproval, { webBaseUrl: '' })
}
