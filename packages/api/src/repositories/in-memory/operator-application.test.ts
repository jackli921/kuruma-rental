import { beforeEach, describe, expect, it } from 'vitest'
import type { OperatorApplication } from '../../stores'
import { InMemoryOperatorApplicationRepository } from './operator-application'

const base = {
  businessName: 'A',
  contactName: 'B',
  contactEmail: 'x@y.com',
  contactPhone: '090',
  serviceArea: 'Osaka',
  estimatedFleetSize: '1-5' as const,
  website: null,
  businessLicenseNumber: null,
  businessType: null,
  message: null,
  submittedLocale: 'en',
}

describe('InMemoryOperatorApplicationRepository', () => {
  let store: Map<string, OperatorApplication>
  let repo: InMemoryOperatorApplicationRepository
  beforeEach(() => {
    store = new Map()
    repo = new InMemoryOperatorApplicationRepository(store)
  })

  it('creates a PENDING row', async () => {
    const a = await repo.create(base)
    expect(a.status).toBe('PENDING')
    expect(store.size).toBe(1)
  })
  it('rejects a duplicate live email with a UNIQUE_VIOLATION carrying the named constraint', async () => {
    await repo.create(base)
    await expect(repo.create(base)).rejects.toMatchObject({ code: '23505' })
  })
  it('allows re-apply after the prior app is not live (rejected)', async () => {
    const a = await repo.create(base)
    await repo.markRejectedIfPending(a.id, 'admin', new Date(), 'no')
    await expect(repo.create(base)).resolves.toMatchObject({ status: 'PENDING' })
  })
  it('markApprovedIfPending returns undefined on a second call', async () => {
    const a = await repo.create(base)
    expect(await repo.markApprovedIfPending(a.id, 'op1', 'admin', new Date())).toBeTruthy()
    expect(await repo.markApprovedIfPending(a.id, 'op1', 'admin', new Date())).toBeUndefined()
  })
})
