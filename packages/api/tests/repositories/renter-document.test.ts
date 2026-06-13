import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError } from '../../src/middleware/auth'
import { InMemoryRenterDocumentRepository } from '../../src/repositories/in-memory'

const RENTER = 'renter_1'
const OTHER_RENTER = 'renter_2'

const renterCtx = (id: string): CallerContext => ({
  userId: id,
  role: 'RENTER',
  bypassScope: false,
})
const adminCtx: CallerContext = { userId: 'admin_1', role: 'PLATFORM_ADMIN', bypassScope: true }
const operatorCtx: CallerContext = {
  userId: 'op_owner',
  role: 'OPERATOR_OWNER',
  operatorId: 'op_a',
  bypassScope: false,
}

const idpInput = (renterId = RENTER) =>
  ({ renterId, type: 'IDP', storageKey: `renter-documents/${renterId}/abc.jpg` }) as const

describe('InMemoryRenterDocumentRepository — create', () => {
  let repo: InMemoryRenterDocumentRepository
  beforeEach(() => {
    repo = new InMemoryRenterDocumentRepository()
  })

  it('a renter uploads their own document as PENDING', async () => {
    const doc = await repo.create(renterCtx(RENTER), idpInput())
    expect(doc.id).toMatch(/[0-9a-f-]{36}/)
    expect(doc.renterId).toBe(RENTER)
    expect(doc.type).toBe('IDP')
    expect(doc.status).toBe('PENDING')
    expect(doc.expiryDate).toBeNull()
    expect(doc.verifiedAt).toBeNull()
    expect(doc.verifierId).toBeNull()
    expect(doc.createdAt).toBeInstanceOf(Date)
  })

  it('a renter cannot create a document for another renter', async () => {
    await expect(repo.create(renterCtx(RENTER), idpInput(OTHER_RENTER))).rejects.toThrow(
      ForbiddenError,
    )
  })

  it('a platform admin may create a document on behalf of a renter', async () => {
    const doc = await repo.create(adminCtx, idpInput(OTHER_RENTER))
    expect(doc.renterId).toBe(OTHER_RENTER)
  })
})

describe('InMemoryRenterDocumentRepository — read scoping', () => {
  let repo: InMemoryRenterDocumentRepository
  beforeEach(async () => {
    repo = new InMemoryRenterDocumentRepository()
    await repo.create(renterCtx(RENTER), idpInput(RENTER))
    await repo.create(adminCtx, idpInput(OTHER_RENTER))
  })

  it('findByRenter returns a renter their own documents', async () => {
    const docs = await repo.findByRenter(renterCtx(RENTER), RENTER)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.renterId).toBe(RENTER)
  })

  it('a renter cannot read another renter documents', async () => {
    const docs = await repo.findByRenter(renterCtx(RENTER), OTHER_RENTER)
    expect(docs).toEqual([])
  })

  it('a platform admin can read any renter documents', async () => {
    const docs = await repo.findByRenter(adminCtx, OTHER_RENTER)
    expect(docs).toHaveLength(1)
  })
})

describe('InMemoryRenterDocumentRepository — verify', () => {
  let repo: InMemoryRenterDocumentRepository
  let docId: string
  beforeEach(async () => {
    repo = new InMemoryRenterDocumentRepository()
    docId = (await repo.create(renterCtx(RENTER), idpInput())).id
  })

  it('platform-admin approval records expiry, verifier and verifiedAt', async () => {
    const verified = await repo.verify(adminCtx, docId, {
      status: 'APPROVED',
      verifierId: adminCtx.userId,
      expiryDate: '2030-01-31',
    })
    expect(verified?.status).toBe('APPROVED')
    expect(verified?.expiryDate).toBe('2030-01-31')
    expect(verified?.verifierId).toBe('admin_1')
    expect(verified?.verifiedAt).toBeInstanceOf(Date)
  })

  it('platform-admin rejection records the reason', async () => {
    const rejected = await repo.verify(adminCtx, docId, {
      status: 'REJECTED',
      verifierId: adminCtx.userId,
      rejectionReason: 'Blurry',
    })
    expect(rejected?.status).toBe('REJECTED')
    expect(rejected?.rejectionReason).toBe('Blurry')
  })

  it('a renter cannot verify a document', async () => {
    await expect(
      repo.verify(renterCtx(RENTER), docId, {
        status: 'APPROVED',
        verifierId: RENTER,
        expiryDate: '2030-01-31',
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('an operator cannot verify a document (platform-level only)', async () => {
    await expect(
      repo.verify(operatorCtx, docId, {
        status: 'APPROVED',
        verifierId: 'op_owner',
        expiryDate: '2030-01-31',
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('treats a verdict as terminal — re-verifying a decided doc returns undefined', async () => {
    await repo.verify(adminCtx, docId, {
      status: 'APPROVED',
      verifierId: adminCtx.userId,
      expiryDate: '2030-01-31',
    })
    const reVerify = await repo.verify(adminCtx, docId, {
      status: 'REJECTED',
      verifierId: adminCtx.userId,
      rejectionReason: 'changed my mind',
    })
    expect(reVerify).toBeUndefined()
  })
})

describe('InMemoryRenterDocumentRepository — pending queue + gate lookup', () => {
  let repo: InMemoryRenterDocumentRepository
  beforeEach(async () => {
    repo = new InMemoryRenterDocumentRepository()
    const a = await repo.create(renterCtx(RENTER), idpInput(RENTER))
    await repo.create(adminCtx, idpInput(OTHER_RENTER))
    await repo.verify(adminCtx, a.id, {
      status: 'APPROVED',
      verifierId: adminCtx.userId,
      expiryDate: '2030-01-31',
    })
  })

  it('listPending returns only PENDING docs with a total', async () => {
    const page = await repo.listPending(adminCtx)
    expect(page.total).toBe(1)
    expect(page.data.every((d) => d.status === 'PENDING')).toBe(true)
  })

  it('listPending rejects a renter', async () => {
    await expect(repo.listPending(renterCtx(RENTER))).rejects.toThrow(ForbiddenError)
  })

  it('findApprovedByType returns the renter approved IDP', async () => {
    const approved = await repo.findApprovedByType(RENTER, 'IDP')
    expect(approved).toHaveLength(1)
    expect(approved[0]?.status).toBe('APPROVED')
  })

  it('findApprovedByType is empty for a renter with no approved doc of that type', async () => {
    expect(await repo.findApprovedByType(OTHER_RENTER, 'IDP')).toEqual([])
  })
})
