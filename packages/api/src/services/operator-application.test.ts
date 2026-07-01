import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, NotFoundError } from '../auth/guards'
import { InMemoryOperatorApplicationRepository } from '../repositories/in-memory/operator-application'
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

function makeService(
  repo: InMemoryOperatorApplicationRepository,
  recordAudit: ReturnType<typeof vi.fn> = vi.fn(),
) {
  return new OperatorApplicationService(repo, recordAudit)
}
