import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError } from '../auth/guards'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryOperatorApplicationRepository } from '../repositories/in-memory/operator-application'
import { InMemoryOperatorMembershipRepository } from '../repositories/in-memory/operator-membership'
import { InMemoryProviderInviteRepository } from '../repositories/in-memory/provider-invite'
import { InMemoryUserRepository } from '../repositories/in-memory/user'
import type { ProviderInvite } from '../stores'
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

    const all = await service.list()
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

    const onlyPending = await service.list('PENDING')
    expect(onlyPending).toHaveLength(1)
    expect(onlyPending[0]?.id).toBe(pending.id)

    const onlyRejected = await service.list('REJECTED')
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
    const inviteStore = new Map<string, ProviderInvite>()
    const applications = new InMemoryOperatorApplicationRepository()
    const operators = new InMemoryOperatorRepository()
    const invites = new InMemoryProviderInviteRepository(inviteStore)
    const users = new InMemoryUserRepository()
    const memberships = new InMemoryOperatorMembershipRepository()
    const audit = vi.fn()

    // Passthrough: no real transaction boundary in tests (single-threaded, no races).
    const runOperatorApproval = <T>(
      fn: (repos: {
        users: typeof users
        memberships: typeof memberships
        invites: typeof invites
        operators: typeof operators
        applications: typeof applications
      }) => Promise<T>,
    ) => fn({ users, memberships, invites, operators, applications })

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

  it('maps a concurrent operators.slug clash to a distinct, retry-able 409', async () => {
    const { service, repos } = setupApprove()
    const { id } = await repos.applications.create(base)
    // Two different same-named businesses approved concurrently: the loser hits
    // the operators.slug unique index. The message must tell the reviewer to
    // retry (a retry re-resolves the slug and succeeds), not the misleading
    // "already reviewed" — that would imply the application was already handled.
    repos.operators.create = () =>
      Promise.reject(
        Object.assign(new Error('dup'), {
          code: '23505',
          constraint_name: 'operators_slug_unique',
        }),
      )
    await expect(service.approve(id, 'admin-1')).rejects.toThrow(ConflictError)
    await expect(service.approve(id, 'admin-1')).rejects.toThrow(/retry/i)
  })

  it('maps a non-slug unique-violation inside the tx to the generic already-reviewed 409', async () => {
    const { service, repos } = setupApprove()
    const { id } = await repos.applications.create(base)
    // A race on the invite pending-email index (not the slug) still means
    // "someone else won this approval" — keep the generic already-reviewed 409.
    repos.operators.create = () =>
      Promise.reject(
        Object.assign(new Error('dup'), {
          code: '23505',
          constraint_name: 'provider_invites_pending_email_unique',
        }),
      )
    await expect(service.approve(id, 'admin-1')).rejects.toThrow(ConflictError)
    await expect(service.approve(id, 'admin-1')).rejects.toThrow(/already reviewed/)
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
})

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
