import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError } from '../auth/guards'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryOperatorApplicationRepository } from '../repositories/in-memory/operator-application'
import { InMemoryOperatorMembershipRepository } from '../repositories/in-memory/operator-membership'
import { InMemoryProviderInviteRepository } from '../repositories/in-memory/provider-invite'
import { InMemoryUserRepository } from '../repositories/in-memory/user'
import type {
  Operator,
  OperatorApplication,
  OperatorMembership,
  ProviderInvite,
  User,
} from '../stores'
import { OperatorApplicationService } from './operator-application'

// Sign-in-first: submit no longer carries contactEmail (server-resolved from the
// users repo) but DOES carry applicantUserId (derived from the session at the route).
const input = {
  businessName: 'Osaka Rentals',
  contactName: 'Aiko',
  contactPhone: '+81 90',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20' as const,
  website: undefined,
  businessLicenseNumber: undefined,
  businessType: undefined,
  message: undefined,
  submittedLocale: 'en' as const,
  applicantUserId: 'user_7',
}

describe('OperatorApplicationService.submit', () => {
  let repo: InMemoryOperatorApplicationRepository
  let users: InMemoryUserRepository
  let memberships: InMemoryOperatorMembershipRepository
  let service: OperatorApplicationService

  beforeEach(async () => {
    repo = new InMemoryOperatorApplicationRepository()
    users = new InMemoryUserRepository()
    memberships = new InMemoryOperatorMembershipRepository()
    service = makeService(repo, vi.fn(), { users, memberships })
    // Seed the authenticated applicant's account so submit can resolve its email.
    await users.quickCreate({ name: 'Aiko', email: 'real@x.io', phone: null, language: 'en' })
    // quickCreate mints a random id; pin the applicant to a known id for the tests.
    const account = await users.findByEmail('real@x.io')
    input.applicantUserId = account!.id
  })

  it('persists a PENDING application and returns {id,status}', async () => {
    const r = await service.submit(input)
    expect(r).toMatchObject({ status: 'PENDING' })
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
  it('links the application to applicantUserId + uses the account email from the users repo', async () => {
    // No contactEmail is passed in — the service resolves it from the users repo.
    await service.submit(input)
    const [created] = await repo.list({ limit: 10, offset: 0 })
    expect(created).toMatchObject({
      applicantUserId: input.applicantUserId,
      contactEmail: 'real@x.io',
    })
  })
  it('throws ConflictError on a duplicate live email', async () => {
    await service.submit(input)
    await expect(service.submit(input)).rejects.toThrow(ConflictError)
    await expect(service.submit(input)).rejects.toThrow('already')
  })
  it('throws ConflictError when the caller already has an active membership', async () => {
    await memberships.create({
      userId: input.applicantUserId,
      operatorId: 'op_existing',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    await expect(service.submit(input)).rejects.toThrow(ConflictError)
    await expect(service.submit(input)).rejects.toThrow(/already/i)
  })
  it('throws ConflictError when the account has no email on file', async () => {
    const phoneOnly = await users.createWalkInRenter({ name: 'Phone Only', phone: '+81 70' })
    await expect(service.submit({ ...input, applicantUserId: phoneOnly.id })).rejects.toThrow(
      ConflictError,
    )
    await expect(service.submit({ ...input, applicantUserId: phoneOnly.id })).rejects.toThrow(
      /no email/i,
    )
  })
})

describe('OperatorApplicationService.list + reject', () => {
  let repo: InMemoryOperatorApplicationRepository
  let users: InMemoryUserRepository
  let recordAudit: ReturnType<typeof vi.fn>
  let service: OperatorApplicationService
  // Two seeded applicants — submit resolves each application's email from its
  // applicantUserId, so distinct rows now need distinct accounts (not a body email).
  let applicantA: string
  let applicantB: string

  beforeEach(async () => {
    repo = new InMemoryOperatorApplicationRepository()
    users = new InMemoryUserRepository()
    recordAudit = vi.fn()
    service = makeService(repo, recordAudit, {
      users,
      memberships: new InMemoryOperatorMembershipRepository(),
    })
    applicantA = (
      await users.quickCreate({ name: 'A', email: 'a@example.com', phone: null, language: 'en' })
    ).id
    applicantB = (
      await users.quickCreate({ name: 'B', email: 'b@example.com', phone: null, language: 'en' })
    ).id
  })

  it('list() returns applications newest-first', async () => {
    // Use fake timers so both records have distinct createdAt values — without
    // this, both are stamped at the same millisecond and the tie-break is by id.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    const a = await service.submit({ ...input, applicantUserId: applicantA })
    vi.setSystemTime(new Date('2024-01-02T00:00:00Z'))
    const b = await service.submit({ ...input, applicantUserId: applicantB })
    vi.useRealTimers()

    const all = await service.list({ limit: 50, offset: 0 })
    // b has a later createdAt so it sorts first (newest-first)
    expect(all).toHaveLength(2)
    expect(all[0]?.id).toBe(b.id)
    expect(all[1]?.id).toBe(a.id)
  })

  it('reject() flips status to REJECTED and returns the updated row', async () => {
    const { id } = await service.submit({ ...input, applicantUserId: applicantA })
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
    const { id } = await service.submit({ ...input, applicantUserId: applicantA })
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
    const { id } = await service.submit({ ...input, applicantUserId: applicantA })
    await service.reject(id, 'admin-1', 'first rejection')
    await expect(service.reject(id, 'admin-1', 'again')).rejects.toThrow(NotFoundError)
    // The audit event fired once for the first (successful) rejection only.
    expect(recordAudit).toHaveBeenCalledTimes(1)
  })

  it('list(status) filters by status', async () => {
    const pending = await service.submit({ ...input, applicantUserId: applicantA })
    const toReject = await service.submit({ ...input, applicantUserId: applicantB })
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
    // membershipStore + userStore back the direct-promotion writes (§6.2) so tests
    // can assert the OWNER membership row and the users projection after approval.
    const inviteStore = new Map<string, ProviderInvite>()
    const operatorStore = new Map<string, Operator>()
    const applicationStore = new Map<string, OperatorApplication>()
    const membershipStore = new Map<string, OperatorMembership>()
    const userStore = new Map<string, User>()
    const applications = new InMemoryOperatorApplicationRepository(applicationStore)
    const operators = new InMemoryOperatorRepository(operatorStore)
    const invites = new InMemoryProviderInviteRepository(inviteStore)
    const users = new InMemoryUserRepository(userStore)
    const memberships = new InMemoryOperatorMembershipRepository(membershipStore)
    const audit = vi.fn()

    // Transactional passthrough: snapshot the mutable stores, run the approval
    // callback, and roll the stores back if it throws — so a race-fence throw
    // (markApprovedIfPending -> undefined) or an exhausted slug retry leaves no
    // orphaned operator/membership/projection, exactly as the real DB tx guarantees.
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
      const membershipSnapshot = new Map(membershipStore)
      const userSnapshot = new Map(userStore)
      try {
        return await fn({ users, memberships, invites, operators, applications })
      } catch (err) {
        restoreStore(operatorStore, opSnapshot)
        restoreStore(applicationStore, appSnapshot)
        restoreStore(inviteStore, inviteSnapshot)
        restoreStore(membershipStore, membershipSnapshot)
        restoreStore(userStore, userSnapshot)
        throw err
      }
    }

    const service = new OperatorApplicationService(
      applications,
      audit,
      runOperatorApproval,
      { webBaseUrl: 'https://app.example.com' },
      memberships,
      users,
    )
    return {
      service,
      repos: {
        applications,
        operators,
        invites,
        users,
        memberships,
        inviteStore,
        membershipStore,
        userStore,
      },
      audit,
    }
  }

  // Seed the authenticated applicant a sign-in-first PENDING application belongs to:
  // a RENTER user row (so setOperatorAccess can flip its projection) plus the
  // application carrying that applicantUserId. Returns the seeded ids.
  async function seedApplicant(
    repos: ReturnType<typeof setupApprove>['repos'],
    overrides: Partial<typeof base> = {},
  ): Promise<{ applicationId: string; applicantUserId: string }> {
    const fields = { ...base, ...overrides }
    const applicant = await repos.users.quickCreate({
      name: fields.contactName,
      email: fields.contactEmail,
      phone: fields.contactPhone,
      language: 'en',
    })
    const app = await repos.applications.create({ ...fields, applicantUserId: applicant.id })
    return { applicationId: app.id, applicantUserId: applicant.id }
  }

  it('promotes the applicant account: creates an OWNER membership + sets users projection', async () => {
    const { service, repos, audit } = setupApprove()
    const { applicationId, applicantUserId } = await seedApplicant(repos)

    const r = await service.approve(applicationId, 'admin-1')

    // The approve() return contract drops inviteUrl/expiresAt entirely (§6.2).
    expect(r).toEqual({ operatorId: expect.any(String), operatorSlug: 'tokyo-wheels' })
    expect(r).not.toHaveProperty('inviteUrl')
    expect(r).not.toHaveProperty('expiresAt')

    // No invite is minted on the promotion path.
    expect(repos.inviteStore.size).toBe(0)

    const operator = await repos.operators.findBySlug(r.operatorSlug)
    expect(operator?.name).toBe(base.businessName)

    // The applicant's OWN account is promoted to OPERATOR_OWNER: a ledger row...
    const membership = await repos.memberships.findActiveByUserId(applicantUserId)
    expect(membership).toMatchObject({
      userId: applicantUserId,
      operatorId: r.operatorId,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    // ...and the denormalised users projection the JWT reads.
    expect(repos.userStore.get(applicantUserId)).toMatchObject({
      role: 'OPERATOR_OWNER',
      operatorId: r.operatorId,
    })

    const reloaded = await repos.applications.findById(applicationId)
    expect(reloaded).toMatchObject({ status: 'APPROVED', operatorId: r.operatorId })

    // The only audit event is the approval — no PROVIDER_INVITE_CREATED on this path.
    const auditTypes = (audit.mock.calls as [{ type: string }][]).map(([e]) => e.type)
    expect(auditTypes).toEqual(['OPERATOR_APPLICATION_APPROVED'])
  })

  it('is idempotency-safe: a second approve on the same id throws 409 and creates no second membership', async () => {
    const { service, repos } = setupApprove()
    const { applicationId, applicantUserId } = await seedApplicant(repos)

    await service.approve(applicationId, 'admin-1')
    await expect(service.approve(applicationId, 'admin-1')).rejects.toThrow(ConflictError)
    await expect(service.approve(applicationId, 'admin-1')).rejects.toThrow(/already reviewed/)

    // Exactly one operator and one ACTIVE membership for the applicant survive.
    expect((await repos.operators.list()).length).toBe(1)
    const applicantMemberships = [...repos.membershipStore.values()].filter(
      (m) => m.userId === applicantUserId,
    )
    expect(applicantMemberships).toHaveLength(1)
  })

  it('blocks approval when the applicant email already has an active operator (assertEmailUnclaimed)', async () => {
    const { service, repos } = setupApprove()
    const { applicationId } = await seedApplicant(repos)

    // The same email already owns an operator (an existing user + ACTIVE membership).
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

    const err = await service.approve(applicationId, 'admin-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err instanceof Error ? err.message : '').toMatch(/this email already has an operator/)
    // No new operator was provisioned beyond the pre-seeded one.
    expect((await repos.operators.list()).length).toBe(1)
  })

  it('blocks approval when the applicant email already has a live pending invite', async () => {
    const { service, repos } = setupApprove()
    const { applicationId } = await seedApplicant(repos)

    // A live PENDING invite for the same email at another operator (the C1 guard).
    const otherOperator = await repos.operators.create({
      name: 'Other Co',
      slug: 'other-co',
      preAuthHandoffUrl: null,
    })
    await repos.invites.create({
      email: base.contactEmail,
      operatorId: otherOperator.id,
      role: 'OPERATOR_OWNER',
      tokenHash: 'deadbeef'.repeat(8),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: 'some-admin',
      acceptedByUserId: null,
    })

    const err = await service.approve(applicationId, 'admin-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err instanceof Error ? err.message : '').toMatch(/already invited to an operator/)
  })

  it('rejects a legacy application with no applicantUserId (use the manual invite)', async () => {
    const { service, repos } = setupApprove()
    // A legacy/anonymous PENDING row carries no applicantUserId.
    const { id } = await repos.applications.create(base)

    const err = await service.approve(id, 'admin-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err instanceof Error ? err.message : '').toMatch(
      /not linked to an account; use the manual invite/,
    )
    // Nothing was provisioned; the row stays PENDING for the escape hatch.
    expect((await repos.operators.list()).length).toBe(0)
    expect(await repos.applications.findById(id)).toMatchObject({ status: 'PENDING' })
  })

  it('retries once on a concurrent operators.slug race, then promotes successfully', async () => {
    const { service, repos } = setupApprove()
    const { applicationId, applicantUserId } = await seedApplicant(repos)

    // First attempt loses the operators_slug_unique race; the retry re-resolves a
    // fresh slug against the now-committed row and succeeds (#1371b).
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

    const r = await service.approve(applicationId, 'admin-1')

    expect(attempts).toBe(2)
    expect(await repos.operators.findBySlug(r.operatorSlug)).toMatchObject({
      name: base.businessName,
    })
    expect(await repos.memberships.findActiveByUserId(applicantUserId)).toMatchObject({
      operatorId: r.operatorId,
      role: 'OPERATOR_OWNER',
    })
    expect(await repos.applications.findById(applicationId)).toMatchObject({ status: 'APPROVED' })
  })

  it('surfaces a distinct retryable 409 — never "already reviewed" — when the slug race persists', async () => {
    const { service, repos } = setupApprove()
    const { applicationId, applicantUserId } = await seedApplicant(repos)

    // Every attempt loses the slug race: after SLUG_ATTEMPTS the loser gets an
    // accurate, retryable message — NOT the misleading review conflict (#1371b).
    repos.operators.create = () =>
      Promise.reject(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint_name: 'operators_slug_unique',
        }),
      )

    const err = await service.approve(applicationId, 'admin-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    const message = err instanceof Error ? err.message : String(err)
    expect(message).toMatch(/could not allocate a unique operator slug/)
    expect(message).not.toMatch(/already reviewed/)
    // Rolled back: the application is left PENDING and nothing was provisioned.
    expect(await repos.applications.findById(applicationId)).toMatchObject({ status: 'PENDING' })
    expect((await repos.operators.list()).length).toBe(0)
    expect(await repos.memberships.findActiveByUserId(applicantUserId)).toBeUndefined()
  })

  it('race fence: markApprovedIfPending -> undefined rolls back the operator + membership + projection', async () => {
    const { service, repos } = setupApprove()
    const { applicationId, applicantUserId } = await seedApplicant(repos)

    // A concurrent approval won the atomic claim: our tx created the operator +
    // membership + projection, then the fence returns undefined -> ConflictError.
    repos.applications.markApprovedIfPending = () => Promise.resolve(undefined)

    const err = await service.approve(applicationId, 'admin-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err instanceof Error ? err.message : String(err)).toMatch(/already reviewed/)
    // Rollback proof: nothing the tx created survives.
    expect((await repos.operators.list()).length).toBe(0)
    expect(await repos.memberships.findActiveByUserId(applicantUserId)).toBeUndefined()
    // The applicant's projection is untouched — still a plain RENTER.
    expect(repos.userStore.get(applicantUserId)).toMatchObject({ role: 'RENTER' })
    // The pre-existing application row is left PENDING for a real retry.
    expect(await repos.applications.findById(applicationId)).toMatchObject({ status: 'PENDING' })
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
  deps: {
    users?: InMemoryUserRepository
    memberships?: InMemoryOperatorMembershipRepository
  } = {},
) {
  // Provide a stub runOperatorApproval that throws if accidentally called in
  // submit/reject tests — they don't need the approval transaction.
  const stubRunApproval = () => {
    throw new Error('runOperatorApproval called unexpectedly in non-approve test')
  }
  const memberships = deps.memberships ?? new InMemoryOperatorMembershipRepository()
  const users = deps.users ?? new InMemoryUserRepository()
  return new OperatorApplicationService(
    repo,
    recordAudit,
    stubRunApproval,
    { webBaseUrl: '' },
    memberships,
    users,
  )
}
